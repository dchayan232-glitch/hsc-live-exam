import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';

export const MAX_PDF_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB (Gemini File Search Store limit)
export const VERCEL_SAFE_CHUNK_BYTES = Math.floor(3.8 * 1024 * 1024); // 3.8 MB (safely below Vercel 4.5 MB limit)
export const CLOUD_RUN_SAFE_CHUNK_BYTES = 24 * 1024 * 1024; // 24 MB (safely below Cloud Run 32 MB limit)

const PDF_UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'hsc-mcq-pdf-uploads');
const VALID_SUBJECTS = new Set(['Physics', 'Chemistry', 'Zoology', 'Botany', 'Math', 'ICT']);
const SUBJECT_BN_NAMES: Record<string, string> = {
  Physics: 'পদার্থবিজ্ঞান',
  Chemistry: 'রসায়ন',
  Zoology: 'প্রাণিবিজ্ঞান',
  Botany: 'উদ্ভিদবিজ্ঞান',
  Math: 'উচ্চতর গণিত',
  ICT: 'তথ্য ও যোগাযোগ প্রযুক্তি',
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Lightweight brute-force protection for Teacher PIN verification
const failedPinAttempts = new Map<string, { count: number; resetAt: number }>();
const PIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PIN_FAILURES = 15;

export function getExpectedTeacherPin(): string {
  const envPin = process.env.TEACHER_PIN?.trim();
  return envPin && envPin.length >= 4 ? envPin : '2026';
}

function getSessionSigningKey(): Buffer {
  const secretSource =
    process.env.TEACHER_SESSION_SECRET?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    getExpectedTeacherPin();
  return crypto
    .createHash('sha256')
    .update(`hsc-live-mcq-teacher-session-v1:${secretSource}`)
    .digest();
}

export function timingSafeStringEquals(input: string, expected: string): boolean {
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Issues a stateless HMAC-SHA256 signed teacher session token that works identically
 * across both long-running Node servers (Cloud Run) and stateless Serverless Functions (Vercel).
 */
export function issueTeacherSessionToken(nowMs = Date.now()): string {
  const expiresAt = nowMs + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

export function verifyTeacherSessionToken(token: string, nowMs = Date.now()): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, nonce, providedSig] = parts;
  if (!/^\d{10,16}$/.test(expStr)) return false;
  if (!/^[a-f0-9]{32}$/i.test(nonce)) return false;
  if (!/^[a-f0-9]{64}$/i.test(providedSig)) return false;

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs) {
    return false;
  }

  const payload = `${expStr}.${nonce}`;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(payload)
    .digest('hex');

  return timingSafeStringEquals(providedSig.toLowerCase(), expectedSig.toLowerCase());
}

function requireTeacherAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস। শিক্ষক পিন দিয়ে আনলক করুন।' });
    return;
  }
  const token = match[1];
  if (!verifyTeacherSessionToken(token)) {
    res.status(401).json({ error: 'সেশনের মেয়াদ শেষ হয়েছে। অনুগ্রহ করে পুনরায় পিন দিন।' });
    return;
  }
  next();
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'সার্ভারে GEMINI_API_KEY কনফিগার করা নেই। Settings > Environment Variables / Secrets প্যানেলে GEMINI_API_KEY যুক্ত করুন।'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getStoreDisplayName(subject: string): string {
  return `hsc-kb-${subject}`;
}

async function findSubjectFileSearchStore(ai: GoogleGenAI, subject: string) {
  const targetDisplayName = getStoreDisplayName(subject);
  const pager = await ai.fileSearchStores.list({ config: { pageSize: 20 } });
  for await (const store of pager) {
    if (store.displayName === targetDisplayName && store.name) {
      return store;
    }
  }
  return null;
}

async function listStoreDocuments(ai: GoogleGenAI, storeName: string) {
  const docs: Array<{
    name: string;
    displayName: string;
    state: string;
    sizeBytes?: string;
    createTime?: string;
  }> = [];
  const pager = await ai.fileSearchStores.documents.list({
    parent: storeName,
    config: { pageSize: 20 },
  });
  for await (const doc of pager) {
    if (doc.name) {
      docs.push({
        name: doc.name,
        displayName: doc.displayName || doc.name.split('/').pop() || 'PDF Document',
        state: String(doc.state || 'STATE_ACTIVE'),
        sizeBytes: doc.sizeBytes,
        createTime: doc.createTime,
      });
    }
  }
  return docs;
}

function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('AI থেকে প্রাপ্ত আউটপুট সঠিক JSON ফরম্যাটে পার্স করা যায়নি।');
  }
}

async function readPdfMagicHeader(filePath: string): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const headerBuf = Buffer.alloc(5);
    const { bytesRead } = await handle.read(headerBuf, 0, 5, 0);
    return headerBuf.subarray(0, bytesRead).toString('ascii');
  } finally {
    await handle.close();
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(PDF_UPLOAD_TMP_DIR, { recursive: true });
      cb(null, PDF_UPLOAD_TMP_DIR);
    },
    filename: (_req, _file, cb) => {
      cb(null, `upload-${Date.now()}-${crypto.randomBytes(12).toString('hex')}.pdf`);
    },
  }),
  limits: {
    fileSize: MAX_PDF_SIZE_BYTES, // 100 MB limit
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const isPdfExt = file.originalname.toLowerCase().endsWith('.pdf');
    const isPdfMime =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === '';
    if (isPdfExt && isPdfMime) {
      cb(null, true);
    } else {
      cb(new Error('শুধুমাত্র PDF ফাইল (.pdf) আপলোড করা যাবে।'));
    }
  },
});

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const api = express.Router();

  // Health endpoint
  api.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      runtime: process.env.VERCEL ? 'vercel' : 'node',
    });
  });

  // 1. Teacher PIN verification (server-side, rate-limited, stateless HMAC token)
  api.post('/teacher/verify-pin', (req: Request, res: Response) => {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '') ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';
    const now = Date.now();
    const record = failedPinAttempts.get(clientIp);
    if (record && record.resetAt > now && record.count >= MAX_PIN_FAILURES) {
      res.status(429).json({
        error: 'অতিরিক্ত ভুল চেষ্টার কারণে সাময়িকভাবে ব্লক করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।',
      });
      return;
    }

    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!pin || pin.length > 32) {
      res.status(400).json({ error: 'সঠিক পিন নম্বর দিন।' });
      return;
    }
    const expected = getExpectedTeacherPin();
    if (!timingSafeStringEquals(pin, expected)) {
      const nextCount = record && record.resetAt > now ? record.count + 1 : 1;
      failedPinAttempts.set(clientIp, { count: nextCount, resetAt: now + PIN_WINDOW_MS });
      res.status(401).json({ error: 'ভুল পিন নম্বর! আবার চেষ্টা করুন।' });
      return;
    }
    failedPinAttempts.delete(clientIp);
    const token = issueTeacherSessionToken(now);
    const isVercel = Boolean(process.env.VERCEL);
    res.json({
      ok: true,
      token,
      maxChunkBytes: isVercel ? VERCEL_SAFE_CHUNK_BYTES : CLOUD_RUN_SAFE_CHUNK_BYTES,
    });
  });

  // 2. Get Subject Knowledge Base (Gemini File Search Store + Documents)
  api.get('/teacher/kb/:subject', requireTeacherAuth, async (req: Request, res: Response) => {
    const subject = String(req.params.subject || '');
    if (!VALID_SUBJECTS.has(subject)) {
      res.status(400).json({ error: 'অবৈধ বিষয় নির্বাচন করা হয়েছে।' });
      return;
    }
    try {
      const ai = getGeminiClient();
      const store = await findSubjectFileSearchStore(ai, subject);
      if (!store || !store.name) {
        res.json({
          subject,
          storeName: null,
          displayName: getStoreDisplayName(subject),
          documents: [],
        });
        return;
      }
      const documents = await listStoreDocuments(ai, store.name);
      res.json({
        subject,
        storeName: store.name,
        displayName: store.displayName || getStoreDisplayName(subject),
        documents,
      });
    } catch (err) {
      console.error('KB fetch error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'নলেজ বেস লোড করতে সমস্যা হয়েছে।',
      });
    }
  });

  // 3. Upload Textbook/Guide PDF (streamed directly via /tmp disk to Gemini File Search Store)
  api.post(
    '/teacher/kb/:subject/upload',
    requireTeacherAuth,
    (req: Request, res: Response, next: NextFunction) => {
      const subject = String(req.params.subject || '');
      if (!VALID_SUBJECTS.has(subject)) {
        res.status(400).json({ error: 'অবৈধ বিষয় নির্বাচন করা হয়েছে।' });
        return;
      }
      if (typeof req.setTimeout === 'function') req.setTimeout(300_000);
      if (typeof res.setTimeout === 'function') res.setTimeout(300_000);

      upload.single('pdf')(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({
              error: 'PDF ফাইলের সর্বোচ্চ সীমা ১০০ MB। অনুগ্রহ করে ১০০ MB বা তার কম আকারের PDF আপলোড করুন।',
            });
            return;
          }
          res.status(400).json({
            error: err instanceof Error ? err.message : 'ফাইল আপলোডে সমস্যা হয়েছে।',
          });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const subject = String(req.params.subject || '');
      const file = req.file;
      if (!file || !file.path || file.size === 0) {
        if (file?.path) {
          await fs.promises.unlink(file.path).catch(() => {});
        }
        res.status(400).json({ error: 'কোনো PDF ফাইল নির্বাচন করা হয়নি।' });
        return;
      }

      try {
        if (file.size > MAX_PDF_SIZE_BYTES) {
          res.status(413).json({
            error: 'PDF ফাইলের সর্বোচ্চ সীমা ১০০ MB। অনুগ্রহ করে ১০০ MB বা তার কম আকারের PDF আপলোড করুন।',
          });
          return;
        }

        // Verify PDF magic header (%PDF-) by reading only the first 5 bytes from disk
        const magic = await readPdfMagicHeader(file.path);
        if (magic !== '%PDF-') {
          res.status(400).json({ error: 'আপলোড করা ফাইলটি বৈধ PDF নথি নয়।' });
          return;
        }

        const ai = getGeminiClient();
        let store = await findSubjectFileSearchStore(ai, subject);
        if (!store || !store.name) {
          store = await ai.fileSearchStores.create({
            config: {
              displayName: getStoreDisplayName(subject),
            },
          });
        }

        if (!store.name) {
          throw new Error('Gemini File Search Store তৈরি করা যায়নি।');
        }

        const safeDisplayName =
          file.originalname.replace(/[^\w.\-\u0980-\u09FF\s()]/g, '').trim().slice(0, 120) ||
          `${subject}-textbook.pdf`;

        // Pass local disk path so @google/genai streams chunks directly without buffering base64 in RAM
        let operation = await ai.fileSearchStores.uploadToFileSearchStore({
          fileSearchStoreName: store.name,
          file: file.path,
          config: {
            displayName: safeDisplayName,
            mimeType: 'application/pdf',
          },
        });

        // Poll indexing operation (shorter cap on Vercel 60s functions, longer on Cloud Run)
        const maxPolls = process.env.VERCEL ? 20 : 60;
        let polls = 0;
        while (!operation.done && polls < maxPolls) {
          await new Promise((r) => setTimeout(r, 2000));
          operation = await ai.operations.get({ operation });
          polls++;
        }

        if (operation.error) {
          throw new Error(String(operation.error.message || 'PDF ইনডেক্সিং ব্যর্থ হয়েছে।'));
        }

        const documents = await listStoreDocuments(ai, store.name);
        res.json({
          ok: true,
          subject,
          storeName: store.name,
          displayName: store.displayName || getStoreDisplayName(subject),
          documents,
        });
      } catch (err) {
        console.error('PDF upload error:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'PDF আপলোড ও ইনডেক্স করতে সমস্যা হয়েছে।',
        });
      } finally {
        await fs.promises.unlink(file.path).catch(() => {});
      }
    }
  );

  // 4. Delete a PDF Document from Subject's Gemini File Search Store
  api.delete('/teacher/kb/:subject/documents', requireTeacherAuth, async (req: Request, res: Response) => {
    const subject = String(req.params.subject || '');
    const documentName = typeof req.body?.documentName === 'string' ? req.body.documentName.trim() : '';

    if (!VALID_SUBJECTS.has(subject)) {
      res.status(400).json({ error: 'অবৈধ বিষয়।' });
      return;
    }
    if (!documentName || !documentName.startsWith('fileSearchStores/') || !documentName.includes('/documents/')) {
      res.status(400).json({ error: 'অবৈধ ডকুমেন্ট রেফারেন্স।' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const store = await findSubjectFileSearchStore(ai, subject);
      if (!store?.name || !documentName.startsWith(`${store.name}/documents/`)) {
        res.status(403).json({ error: 'এই ডকুমেন্টটি নির্বাচিত বিষয়ের স্টোরের অন্তর্ভুক্ত নয়।' });
        return;
      }

      await ai.fileSearchStores.documents.delete({
        name: documentName,
        config: { force: true },
      });

      const documents = await listStoreDocuments(ai, store.name);
      res.json({
        ok: true,
        subject,
        storeName: store.name,
        displayName: store.displayName || getStoreDisplayName(subject),
        documents,
      });
    } catch (err) {
      console.error('KB delete error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'PDF ডকুমেন্ট মুছতে সমস্যা হয়েছে।',
      });
    }
  });

  // 5. 1-Click AI Exam Generator (30 Balanced Bangla HSC & Admission MCQs grounded strictly in Subject PDF Store)
  api.post('/teacher/generate-exam', requireTeacherAuth, async (req: Request, res: Response) => {
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const paper = typeof req.body?.paper === 'string' ? req.body.paper.trim().slice(0, 100) : '';
    const chapter = typeof req.body?.chapter === 'string' ? req.body.chapter.trim().slice(0, 150) : '';

    if (!VALID_SUBJECTS.has(subject)) {
      res.status(400).json({ error: 'সঠিক বিষয় নির্বাচন করুন।' });
      return;
    }
    if (!chapter || chapter.length < 2) {
      res.status(400).json({ error: 'অধ্যায়ের নাম লিখুন।' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const store = await findSubjectFileSearchStore(ai, subject);
      if (!store?.name) {
        res.status(400).json({
          error: `${SUBJECT_BN_NAMES[subject]} বিষয়ের নলেজ বেসে এখনো কোনো পাঠ্যবই/গাইড PDF আপলোড করা হয়নি। আগে অন্তত একটি PDF আপলোড করুন।`,
        });
        return;
      }

      const docs = await listStoreDocuments(ai, store.name);
      if (docs.length === 0) {
        res.status(400).json({
          error: `${SUBJECT_BN_NAMES[subject]} বিষয়ের স্টোরে কোনো PDF নথি নেই। আগে একটি PDF আপলোড করুন।`,
        });
        return;
      }

      const subjectBn = SUBJECT_BN_NAMES[subject];
      const examTitle = paper
        ? `${subjectBn} ${paper} — ${chapter}`
        : `${subjectBn} — ${chapter}`;

      const systemInstruction = `তুমি বাংলাদেশের অভিজ্ঞ HSC বোর্ড এবং বিশ্ববিদ্যালয় ভর্তি পরীক্ষার (BUET, DU, Medical) প্রশ্নপ্রণেতা।
তোমাকে অবশ্যই সংযুক্ত File Search Store-এর পাঠ্যবই/গাইড PDF থেকে তথ্য নিয়ে নির্ভুল বাংলায় ঠিক ৩০টি মানসম্মত MCQ তৈরি করতে হবে।
কঠোর নিয়মাবলি:
১. অবশ্যই ঠিক ৩০টি প্রশ্ন (id: 1 থেকে 30) তৈরি করবে।
২. কাঠিন্য বণ্টন অবশ্যই হুবহু এই অনুপাতে হবে:
   - ১০টি "সহজ" (জ্ঞানমূলক ও সরাসরি পাঠ্যবইভিত্তিক)
   - ১২টি "মধ্যম" (অনুধাবন ও প্রয়োগমূলক, HSC বোর্ড মান)
   - ৮টি "কঠিন" (উচ্চতর দক্ষতা, গাণিতিক বিশ্লেষণ ও BUET/DU/Medical ভর্তি মান)
৩. প্রতিটি প্রশ্নের ৪টি স্পষ্ট বাংলা অপশন (options অ্যারেতে ঠিক ৪টি স্ট্রিং) থাকবে এবং সঠিক উত্তরের ০-ভিত্তিক ইনডেক্স (0, 1, 2 বা 3) answer ফিল্ডে থাকবে।
৪. প্রতিটি প্রশ্নে নির্দিষ্ট topic (উপ-টপিক), source (পাঠ্যবইয়ের রেফারেন্স বা বোর্ড/ভর্তি মান), এবং স্পষ্ট ও সংক্ষিপ্ত বাংলা explanation (ব্যাখ্যা) থাকবে।
৫. কোনো তথ্য PDF-এর বাইরে থেকে বানিয়ে লিখবে না; সংযুক্ত PDF-এর অধ্যায় "${chapter}" (${paper || subjectBn}) থেকে কঠোরভাবে প্রশ্ন তৈরি করবে।
৬. শুধুমাত্র বৈধ JSON আউটপুট দেবে।`;

      const userPrompt = `সংযুক্ত File Search Store-এর ${subjectBn} (${paper || 'সংশ্লিষ্ট পত্র'}) পাঠ্যবই/গাইড PDF থেকে "${chapter}" অধ্যায়ের ওপর ঠিক ৩০টি বাংলা HSC ও ভর্তি-মানের MCQ (১০টি সহজ, ১২টি মধ্যম, ৮টি কঠিন) তৈরি করো।
JSON কাঠামো:
{
  "subject": "${subject}",
  "examTitle": "${examTitle}",
  "questions": [
    {
      "id": 1,
      "topic": "উপ-টপিকের নাম",
      "difficulty": "সহজ",
      "source": "পাঠ্যবই / অধ্যায় রেফারেন্স",
      "question": "প্রশ্নবাক্য...",
      "options": ["অপশন ক", "অপশন খ", "অপশন গ", "অপশন ঘ"],
      "answer": 0,
      "explanation": "সঠিক উত্তরের স্পষ্ট বাংলা ব্যাখ্যা..."
    }
  ]
}`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          examTitle: { type: Type.STRING },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                topic: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                source: { type: Type.STRING },
                question: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                answer: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
              },
              required: ['id', 'topic', 'difficulty', 'source', 'question', 'options', 'answer', 'explanation'],
            },
          },
        },
        required: ['subject', 'examTitle', 'questions'],
      };

      let rawText = '';
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: userPrompt,
          config: {
            systemInstruction,
            tools: [
              {
                fileSearch: {
                  fileSearchStoreNames: [store.name],
                },
              },
            ],
            responseMimeType: 'application/json',
            responseSchema,
          },
        });
        rawText = response.text ?? '';
      } catch (toolSchemaErr) {
        console.warn('Retrying fileSearch generation without strict responseSchema:', toolSchemaErr);
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `${userPrompt}\n\nশুধুমাত্র খাঁটি JSON অবজেক্ট রিটার্ন করো, কোনো অতিরিক্ত কথা বা মার্কডাউন ছাড়া।`,
          config: {
            systemInstruction,
            tools: [
              {
                fileSearch: {
                  fileSearchStoreNames: [store.name],
                },
              },
            ],
          },
        });
        rawText = response.text ?? '';
      }

      if (!rawText) {
        throw new Error('Gemini মডেল থেকে কোনো উত্তর পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
      }

      const parsed = extractJsonObject(rawText) as {
        examTitle?: string;
        questions?: Array<{
          id?: number;
          topic?: string;
          difficulty?: string;
          source?: string;
          question?: string;
          options?: string[];
          answer?: number;
          explanation?: string;
        }>;
      };

      const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      if (rawQuestions.length === 0) {
        throw new Error('PDF থেকে কোনো MCQ তৈরি করা যায়নি। অধ্যায়ের নাম সঠিকভাবে লিখে আবার চেষ্টা করুন।');
      }

      const normalizedQuestions = rawQuestions.slice(0, 30).map((q, idx) => {
        const opts = Array.isArray(q.options) ? q.options.slice(0, 4).map((o) => String(o || '').trim()) : [];
        while (opts.length < 4) {
          opts.push(`অপশন ${opts.length + 1}`);
        }
        const ans =
          Number.isInteger(Number(q.answer)) && Number(q.answer) >= 0 && Number(q.answer) <= 3
            ? Number(q.answer)
            : 0;
        const rawDiff = String(q.difficulty || '').trim();
        const difficulty =
          rawDiff === 'সহজ' || rawDiff === 'মধ্যম' || rawDiff === 'কঠিন'
            ? rawDiff
            : idx < 10
            ? 'সহজ'
            : idx < 22
            ? 'মধ্যম'
            : 'কঠিন';

        return {
          id: idx + 1,
          topic: String(q.topic || chapter).trim().slice(0, 200),
          difficulty,
          source: String(q.source || `${subjectBn} পাঠ্যবই PDF`).trim().slice(0, 200),
          question: String(q.question || '').trim().slice(0, 2000),
          options: [opts[0], opts[1], opts[2], opts[3]] as [string, string, string, string],
          answer: ans,
          explanation: String(q.explanation || 'পাঠ্যবইয়ের অধ্যায় অনুযায়ী ব্যাখ্যা।').trim().slice(0, 3000),
        };
      });

      res.json({
        ok: true,
        exam: {
          subject,
          examTitle: parsed.examTitle?.trim().slice(0, 200) || examTitle,
          paper,
          chapter,
          questions: normalizedQuestions,
        },
      });
    } catch (err) {
      console.error('AI exam generation error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI দিয়ে প্রশ্ন তৈরি করতে সমস্যা হয়েছে।',
      });
    }
  });

  app.use('/api', api);

  // Return clean JSON 404 for unknown /api/* routes instead of HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'অনুরোধকৃত API এন্ডপয়েন্ট পাওয়া যায়নি।' });
  });

  return app;
}
