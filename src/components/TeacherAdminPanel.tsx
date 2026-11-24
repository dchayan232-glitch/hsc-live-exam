import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Upload,
  Sparkles,
  FileJson,
  FolderKanban,
  Trash2,
  Eye,
  EyeOff,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileText,
  LogIn,
  LogOut,
  Lock,
  Loader2,
  CloudUpload,
} from 'lucide-react';
import {
  ExamDocument,
  KnowledgeBaseStatus,
  MCQQuestion,
  SUBJECTS,
  SUBJECT_MAP,
  SubjectCode,
} from '../types/exam';
import {
  BANGLA_OPTION_LABELS,
  parseAndValidateExamJson,
  toBanglaDigits,
} from '../utils/examEngine';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  isVerifiedAdminUser,
  signInTeacherWithGoogle,
  signOutTeacher,
  syncKnowledgeBaseMetaToFirestore,
} from '../lib/firebase';
import {
  MAX_CHUNK_SIZE_BYTES,
  MAX_TOTAL_PDF_SIZE_BYTES,
  formatFileSizeMb,
  splitPdfIntoChunks,
} from '../utils/pdfChunker';
import { PrintExamModal } from './PrintExamModal';

interface TeacherAdminPanelProps {
  teacherToken: string;
  firebaseUser: User | null;
  exams: ExamDocument[];
  onPublishExam: (payload: {
    subject: SubjectCode;
    examTitle: string;
    paper?: string;
    chapter?: string;
    sourceType: 'ai' | 'json' | 'seed';
    questions: MCQQuestion[];
  }) => Promise<{ persistedToFirestore: boolean }>;
  onToggleExamActive: (exam: ExamDocument) => Promise<void>;
  onDeleteExam: (exam: ExamDocument) => Promise<void>;
  onLockPanel: () => void;
}

type AdminTab = 'ai' | 'json' | 'manage';

const SAMPLE_JSON_TEMPLATE = JSON.stringify(
  {
    subject: 'Physics',
    examTitle: 'পদার্থবিজ্ঞান ১ম পত্র — অধ্যায় ৩: গতিবিদ্যা (মডেল টেস্ট)',
    questions: [
      {
        id: 1,
        topic: 'প্রাসের গতি',
        difficulty: 'সহজ',
        source: 'তপন স্যার / ঢাকা বোর্ড ২০২৩',
        question: 'প্রাসের গতিপথের আকৃতি কীরূপ?',
        options: ['বৃত্তাকার', 'পরাবৃত্তাকার', 'উপবৃত্তাকার', 'সরলরৈখিক'],
        answer: 1,
        explanation: 'অভিকর্ষজ ত্বরণের প্রভাবে নিক্ষিপ্ত বস্তুর গতিপথ পরাবৃত্তাকার (Parabolic) হয়।',
      },
      {
        id: 2,
        topic: 'সর্বাধিক পাল্লা',
        difficulty: 'মধ্যম',
        source: 'রাজশাহী বোর্ড ২০২২',
        question: 'প্রাসের অনুভূমিক পাল্লা সর্বাধিক হওয়ার জন্য নিক্ষেপণ কোণ কত হতে হবে?',
        options: ['30°', '45°', '60°', '90°'],
        answer: 1,
        explanation: 'R = (v₀² sin 2θ)/g; sin 2θ = 1 হলে θ = 45° কোণে পাল্লা সর্বাধিক হয়।',
      },
      {
        id: 3,
        topic: 'গতির সমীকরণ',
        difficulty: 'কঠিন',
        source: 'বুয়েট ভর্তি মান',
        question: 'স্থির অবস্থান থেকে সমত্বরণে চলমান একটি বস্তু প্রথম ৪ সেকেন্ডে ৩২ মিটার অতিক্রম করলে ত্বরণ কত?',
        options: ['2 m/s²', '4 m/s²', '8 m/s²', '16 m/s²'],
        answer: 1,
        explanation: 's = ½at² => 32 = ½ × a × 16 => 8a = 32 => a = 4 m/s²।',
      },
    ],
  },
  null,
  2
);

export const TeacherAdminPanel: React.FC<TeacherAdminPanelProps> = ({
  teacherToken,
  firebaseUser,
  exams,
  onPublishExam,
  onToggleExamActive,
  onDeleteExam,
  onLockPanel,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('ai');
  const [authBusy, setAuthBusy] = useState(false);
  const [globalNotice, setGlobalNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // --- Tab 1: PDF Knowledge Base + AI Exam Generator state ---
  const [kbSubject, setKbSubject] = useState<SubjectCode>('Physics');
  const [kbStatus, setKbStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbError, setKbError] = useState('');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    phase: 'splitting' | 'uploading';
    currentPart: number;
    totalParts: number;
    percent: number;
    detail: string;
    chunkSizeLabel?: string;
  } | null>(null);
  const [deletingDocName, setDeletingDocName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [paperInput, setPaperInput] = useState('১ম পত্র');
  const [chapterInput, setChapterInput] = useState('');
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPreview, setAiPreview] = useState<{
    subject: SubjectCode;
    examTitle: string;
    paper?: string;
    chapter?: string;
    questions: MCQQuestion[];
  } | null>(null);
  const [publishingAi, setPublishingAi] = useState(false);

  // --- Tab 2: Manual JSON Import state ---
  const [jsonInput, setJsonInput] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [jsonPreview, setJsonPreview] = useState<{
    subject: SubjectCode;
    examTitle: string;
    paper?: string;
    chapter?: string;
    questions: MCQQuestion[];
  } | null>(null);
  const [publishingJson, setPublishingJson] = useState(false);

  // --- Tab 3: Manage Exams state ---
  const [manageSubjectFilter, setManageSubjectFilter] = useState<'ALL' | SubjectCode>('ALL');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [printExam, setPrintExam] = useState<ExamDocument | null>(null);
  const [busyExamId, setBusyExamId] = useState<string | null>(null);

  const isAdminSignedIn = isVerifiedAdminUser(firebaseUser);

  // Update default paper label when subject changes
  useEffect(() => {
    const info = SUBJECT_MAP[kbSubject];
    setPaperInput(info.papers[0] || '১ম পত্র');
  }, [kbSubject]);

  const fetchKnowledgeBase = useCallback(
    async (subject: SubjectCode) => {
      setKbLoading(true);
      setKbError('');
      try {
        const res = await fetch(`/api/teacher/kb/${subject}`, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'নলেজ বেস লোড করা যায়নি।');
        }
        setKbStatus(data);
        if (data.storeName && isAdminSignedIn) {
          void syncKnowledgeBaseMetaToFirestore({
            subject,
            storeName: data.storeName,
            displayName: data.displayName,
            documentCount: data.documents?.length ?? 0,
          }).catch(() => {});
        }
      } catch (err) {
        setKbError(err instanceof Error ? err.message : 'নলেজ বেস লোড করতে ব্যর্থ।');
        setKbStatus({
          subject,
          storeName: null,
          displayName: `hsc-kb-${subject}`,
          documents: [],
        });
      } finally {
        setKbLoading(false);
      }
    },
    [teacherToken, isAdminSignedIn]
  );

  useEffect(() => {
    if (activeTab === 'ai') {
      void fetchKnowledgeBase(kbSubject);
    }
  }, [activeTab, kbSubject, fetchKnowledgeBase]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setGlobalNotice(null);
    try {
      const user = await signInTeacherWithGoogle();
      if (user.email !== BOOTSTRAPPED_ADMIN_EMAIL) {
        setGlobalNotice({
          type: 'error',
          text: `সতর্কতা: ফায়ারস্টোর অ্যাডমিন রাইটের জন্য ${BOOTSTRAPPED_ADMIN_EMAIL} অ্যাকাউন্ট ব্যবহার করুন।`,
        });
      } else {
        setGlobalNotice({
          type: 'success',
          text: 'Google শিক্ষক অ্যাকাউন্ট সংযুক্ত হয়েছে। এখন সব পরীক্ষা সরাসরি ফায়ারস্টোরে স্থায়ীভাবে সংরক্ষিত হবে।',
        });
      }
    } catch (err) {
      setGlobalNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google সাইন-ইন সম্পন্ন করা যায়নি।',
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleUploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const resetInput = () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const isPdfExt = file.name.toLowerCase().endsWith('.pdf');
    const isPdfMime =
      file.type === 'application/pdf' ||
      file.type === 'application/octet-stream' ||
      file.type === '';
    if (!isPdfExt || !isPdfMime) {
      setKbError('শুধুমাত্র PDF ফাইল (.pdf) আপলোড করা যাবে।');
      resetInput();
      return;
    }

    if (file.size === 0) {
      setKbError('খালি PDF ফাইল আপলোড করা যাবে না।');
      resetInput();
      return;
    }

    if (file.size > MAX_TOTAL_PDF_SIZE_BYTES) {
      setKbError('PDF ফাইলের আকার ২৫০ MB-এর বেশি। সর্বোচ্চ ২৫০ MB পর্যন্ত PDF আপলোড করা যাবে।');
      resetInput();
      return;
    }

    // Verify %PDF- magic header by reading only the first 5 bytes (zero memory overhead)
    try {
      const header = await file.slice(0, 5).text();
      if (header !== '%PDF-') {
        setKbError('নির্বাচিত ফাইলটি বৈধ PDF নথি নয় (%PDF- হেডার পাওয়া যায়নি)।');
        resetInput();
        return;
      }
    } catch {
      setKbError('PDF ফাইলটি পড়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
      resetInput();
      return;
    }

    setUploadingPdf(true);
    setKbError('');
    setGlobalNotice(null);

    try {
      // Build upload queue: files <= 24 MB upload directly; larger files (up to 250 MB)
      // are automatically split in the browser via pdf-lib into valid < 25 MB PDF chunks.
      let uploadQueue: Array<{ file: File; partNumber: number; totalParts: number }> = [];

      if (file.size <= MAX_CHUNK_SIZE_BYTES) {
        uploadQueue = [{ file, partNumber: 1, totalParts: 1 }];
      } else {
        setUploadProgress({
          phase: 'splitting',
          currentPart: 0,
          totalParts: 0,
          percent: 5,
          detail: `বড় PDF (${formatFileSizeMb(file.size)}) বিশ্লেষণ ও ২৫ MB-এর কম অংশে ভাগ করা হচ্ছে...`,
        });

        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        const chunks = await splitPdfIntoChunks(sourceBytes, file.name, {
          maxChunkBytes: MAX_CHUNK_SIZE_BYTES,
          onProgress: (p) => {
            if (p.stage === 'splitting' && p.totalPages > 0) {
              const splitPct = Math.max(
                8,
                Math.min(95, Math.round((p.processedPages / p.totalPages) * 100))
              );
              setUploadProgress({
                phase: 'splitting',
                currentPart: p.chunksCreated,
                totalParts: 0,
                percent: splitPct,
                detail: `পৃষ্ঠা ${toBanglaDigits(p.processedPages)} / ${toBanglaDigits(p.totalPages)} প্রক্রিয়াকরণ সম্পন্ন (${toBanglaDigits(p.chunksCreated)}টি অংশ তৈরি)...`,
              });
            }
          },
        });

        uploadQueue = chunks.map((chunk) => ({
          file: new File([new Uint8Array(chunk.bytes)], chunk.fileName, {
            type: 'application/pdf',
          }),
          partNumber: chunk.partNumber,
          totalParts: chunk.totalParts,
        }));
      }

      const totalParts = uploadQueue.length;
      let latestStoreData: {
        storeName: string | null;
        displayName: string;
        documents: KnowledgeBaseStatus['documents'];
      } | null = null;

      for (let i = 0; i < totalParts; i++) {
        const item = uploadQueue[i];
        const startPct = Math.round(((i + 0.15) / totalParts) * 100);

        setUploadProgress({
          phase: 'uploading',
          currentPart: item.partNumber,
          totalParts,
          percent: Math.max(5, Math.min(95, startPct)),
          detail:
            totalParts > 1
              ? `Uploading part ${item.partNumber} of ${totalParts}... (${item.file.name})`
              : `“${item.file.name}” আপলোড ও ইনডেক্স হচ্ছে...`,
          chunkSizeLabel: formatFileSizeMb(item.file.size),
        });

        const formData = new FormData();
        formData.append('pdf', item.file, item.file.name);

        const res = await fetch(`/api/teacher/kb/${kbSubject}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${teacherToken}` },
          body: formData,
        });
        const data = await res.json();

        if (!res.ok) {
          const partPrefix =
            totalParts > 1
              ? `অংশ ${toBanglaDigits(item.partNumber)}/${toBanglaDigits(totalParts)} আপলোড ব্যর্থ: `
              : '';
          throw new Error(`${partPrefix}${data.error || 'PDF আপলোড ব্যর্থ হয়েছে।'}`);
        }

        latestStoreData = {
          storeName: data.storeName,
          displayName: data.displayName,
          documents: data.documents || [],
        };

        setKbStatus({
          subject: kbSubject,
          storeName: latestStoreData.storeName,
          displayName: latestStoreData.displayName,
          documents: latestStoreData.documents,
        });

        setUploadProgress({
          phase: 'uploading',
          currentPart: item.partNumber,
          totalParts,
          percent: Math.round(((i + 1) / totalParts) * 100),
          detail:
            totalParts > 1
              ? `Uploading part ${item.partNumber} of ${totalParts}... সম্পন্ন`
              : `ইনডেক্সিং সম্পন্ন হয়েছে`,
          chunkSizeLabel: formatFileSizeMb(item.file.size),
        });
      }

      if (latestStoreData?.storeName && isAdminSignedIn) {
        void syncKnowledgeBaseMetaToFirestore({
          subject: kbSubject,
          storeName: latestStoreData.storeName,
          displayName: latestStoreData.displayName,
          documentCount: latestStoreData.documents.length,
        }).catch(() => {});
      }

      setGlobalNotice({
        type: 'success',
        text:
          totalParts > 1
            ? `“${file.name}” সফলভাবে ${toBanglaDigits(totalParts)}টি অংশে বিভক্ত হয়ে ${SUBJECT_MAP[kbSubject].bnName} Gemini File Search Store-এ ইনডেক্স হয়েছে।`
            : `“${file.name}” সফলভাবে ${SUBJECT_MAP[kbSubject].bnName} Gemini File Search Store-এ ইনডেক্স হয়েছে।`,
      });
    } catch (err) {
      setKbError(err instanceof Error ? err.message : 'PDF আপলোডে সমস্যা হয়েছে।');
    } finally {
      setUploadingPdf(false);
      setUploadProgress(null);
      resetInput();
    }
  };

  const handleDeleteKbDocument = async (documentName: string) => {
    setDeletingDocName(documentName);
    setKbError('');
    try {
      const res = await fetch(`/api/teacher/kb/${kbSubject}/documents`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'PDF মুছতে সমস্যা হয়েছে।');
      }
      setKbStatus({
        subject: kbSubject,
        storeName: data.storeName,
        displayName: data.displayName,
        documents: data.documents || [],
      });
    } catch (err) {
      setKbError(err instanceof Error ? err.message : 'PDF মুছতে ব্যর্থ।');
    } finally {
      setDeletingDocName(null);
    }
  };

  const handleGenerateAiExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanChapter = chapterInput.trim();
    if (cleanChapter.length < 2) {
      setAiError('অনুগ্রহ করে অধ্যায়ের নাম লিখুন (যেমন: অধ্যায় ২: ভেক্টর)।');
      return;
    }

    setGeneratingAi(true);
    setAiError('');
    setAiPreview(null);
    setGlobalNotice(null);

    try {
      const res = await fetch('/api/teacher/generate-exam', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: kbSubject,
          paper: paperInput.trim(),
          chapter: cleanChapter,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.exam) {
        throw new Error(data.error || 'AI দিয়ে MCQ তৈরি করা যায়নি।');
      }
      setAiPreview(data.exam);
      setGlobalNotice({
        type: 'success',
        text: `${toBanglaDigits(data.exam.questions.length)}টি MCQ তৈরি সম্পন্ন হয়েছে। প্রিভিউ যাচাই করে স্টুডেন্ট পোর্টালে পাবলিশ করুন।`,
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'প্রশ্ন তৈরিতে সমস্যা হয়েছে।');
    } finally {
      setGeneratingAi(false);
    }
  };

  const handlePublishAiPreview = async () => {
    if (!aiPreview) return;
    setPublishingAi(true);
    setGlobalNotice(null);
    try {
      const result = await onPublishExam({
        ...aiPreview,
        sourceType: 'ai',
      });
      setAiPreview(null);
      setChapterInput('');
      setGlobalNotice({
        type: 'success',
        text: result.persistedToFirestore
          ? 'পরীক্ষাটি সফলভাবে ফায়ারস্টোরে সেভ ও স্টুডেন্ট পোর্টালে পাবলিশ হয়েছে!'
          : 'পরীক্ষাটি স্টুডেন্ট পোর্টালে পাবলিশ হয়েছে (ফায়ারস্টোরে স্থায়ীভাবে সংরক্ষণের জন্য উপরে Google সাইন-ইন করুন)।',
      });
      setActiveTab('manage');
    } catch (err) {
      setGlobalNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'পাবলিশ করতে সমস্যা হয়েছে।',
      });
    } finally {
      setPublishingAi(false);
    }
  };

  const handleValidateJson = () => {
    setJsonError('');
    setJsonPreview(null);
    const result = parseAndValidateExamJson(jsonInput);
    if (!result.ok) {
      setJsonError(result.error);
      return;
    }
    setJsonPreview(result.data);
  };

  const handlePublishJsonPreview = async () => {
    if (!jsonPreview) return;
    setPublishingJson(true);
    setGlobalNotice(null);
    try {
      const result = await onPublishExam({
        ...jsonPreview,
        sourceType: 'json',
      });
      setJsonPreview(null);
      setJsonInput('');
      setGlobalNotice({
        type: 'success',
        text: result.persistedToFirestore
          ? 'JSON পরীক্ষাটি ফায়ারস্টোরে সংরক্ষিত ও স্টুডেন্ট পোর্টালে পাবলিশ হয়েছে!'
          : 'JSON পরীক্ষাটি স্টুডেন্ট পোর্টালে যুক্ত হয়েছে (স্থায়ী সংরক্ষণের জন্য Google সাইন-ইন করুন)।',
      });
      setActiveTab('manage');
    } catch (err) {
      setGlobalNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'JSON পাবলিশ করতে সমস্যা হয়েছে।',
      });
    } finally {
      setPublishingJson(false);
    }
  };

  const filteredManagedExams = useMemo(() => {
    if (manageSubjectFilter === 'ALL') return exams;
    return exams.filter((e) => e.subject === manageSubjectFilter);
  }, [exams, manageSubjectFilter]);

  const countDifficulty = (questions: MCQQuestion[]) => {
    let easy = 0;
    let med = 0;
    let hard = 0;
    questions.forEach((q) => {
      if (q.difficulty === 'সহজ') easy++;
      else if (q.difficulty === 'কঠিন') hard++;
      else med++;
    });
    return { easy, med, hard };
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Admin Top Header & Firestore Auth Bar */}
      <section className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold text-blue-700">শিক্ষক অ্যাডমিন কন্ট্রোল</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            HSC নলেজ বেস ও পরীক্ষা ব্যবস্থাপনা
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            মোট {toBanglaDigits(exams.length)}টি পরীক্ষা ·{' '}
            {toBanglaDigits(exams.filter((e) => e.isActive).length)}টি সক্রিয়
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isAdminSignedIn ? (
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold text-emerald-700">
                Firestore যুক্ত ({firebaseUser?.email})
              </span>
              <button
                type="button"
                onClick={() => void signOutTeacher()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>সাইন-আউট</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleGoogleSignIn()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100 cursor-pointer"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>{authBusy ? 'যুক্ত হচ্ছে...' : 'Google দিয়ে Firestore যুক্ত করুন'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLockPanel}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>প্যানেল লক করুন</span>
          </button>
        </div>
      </section>

      {globalNotice && (
        <div
          role={globalNotice.type === 'error' ? 'alert' : 'status'}
          className={`mt-5 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium ${
            globalNotice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {globalNotice.type === 'success' ? (
            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4.5 w-4.5 text-red-600 shrink-0" aria-hidden="true" />
          )}
          <span>{globalNotice.text}</span>
        </div>
      )}

      {/* Primary Workspace Tabs */}
      <div
        role="tablist"
        aria-label="শিক্ষক প্যানেল ট্যাব"
        className="mt-6 flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ai'}
          onClick={() => setActiveTab('ai')}
          className={`inline-flex min-h-[42px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'ai'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <span>PDF নলেজ বেস ও AI জেনারেটর</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'json'}
          onClick={() => setActiveTab('json')}
          className={`inline-flex min-h-[42px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'json'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileJson className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <span>ম্যানুয়াল JSON ইমপোর্ট</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'manage'}
          onClick={() => setActiveTab('manage')}
          className={`inline-flex min-h-[42px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'manage'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FolderKanban className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <span>পরীক্ষা পরিচালনা ({toBanglaDigits(exams.length)})</span>
        </button>
      </div>

      {/* TAB 1: PDF Knowledge Base + 1-Click AI Exam Generator */}
      {activeTab === 'ai' && (
        <div className="mt-6 space-y-6">
          {/* Subject Selector Strip */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-sm font-bold text-slate-900">১. বিষয় নির্বাচন করুন</h2>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {SUBJECTS.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => {
                    setKbSubject(s.code);
                    setAiPreview(null);
                    setAiError('');
                  }}
                  className={`min-h-[48px] rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors cursor-pointer ${
                    kbSubject === s.code
                      ? 'border-blue-600 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="truncate">{s.bnName}</div>
                  <div className="text-[11px] font-medium text-slate-500">{s.enName}</div>
                </button>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left: Gemini File Search Store PDF Knowledge Base */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    ২. {SUBJECT_MAP[kbSubject].bnName} PDF নলেজ বেস
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    পাঠ্যবই বা গাইড PDF আপলোড করুন — Gemini File Search Store-এ সংরক্ষিত থাকবে।
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={uploadingPdf}
                  onChange={handleUploadPdf}
                  className="hidden"
                  id="kb-pdf-upload"
                />
                <label
                  htmlFor="kb-pdf-upload"
                  className={`flex min-h-[120px] flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
                    uploadingPdf
                      ? 'border-blue-300 bg-blue-50/50 cursor-wait'
                      : 'border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer'
                  }`}
                >
                  {uploadingPdf ? (
                    <div className="w-full max-w-md space-y-2.5">
                      <div className="flex items-center justify-center gap-2 text-sm font-semibold text-blue-900">
                        <Loader2 className="h-4.5 w-4.5 animate-spin text-blue-700 shrink-0" aria-hidden="true" />
                        <span>
                          {uploadProgress?.phase === 'splitting'
                            ? 'বড় PDF স্বয়ংক্রিয়ভাবে ২৫ MB-এর কম অংশে ভাগ হচ্ছে...'
                            : uploadProgress && uploadProgress.totalParts > 1
                            ? `Uploading part ${uploadProgress.currentPart} of ${uploadProgress.totalParts}...`
                            : 'PDF আপলোড ও Gemini File Search Store-এ ইনডেক্স হচ্ছে...'}
                        </span>
                      </div>

                      {uploadProgress && (
                        <>
                          <div
                            role="progressbar"
                            aria-label="PDF আপলোড অগ্রগতি"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={uploadProgress.percent}
                            className="h-2.5 w-full overflow-hidden rounded-full bg-blue-100"
                          >
                            <div
                              className="h-full rounded-full bg-blue-700 transition-all duration-300"
                              style={{ width: `${uploadProgress.percent}%` }}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-600 tabular-nums">
                            <span className="truncate text-left">{uploadProgress.detail}</span>
                            <span className="shrink-0 font-bold text-blue-800">
                              {uploadProgress.chunkSizeLabel
                                ? `${uploadProgress.chunkSizeLabel} · `
                                : ''}
                              {toBanglaDigits(uploadProgress.percent)}%
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-blue-700" aria-hidden="true" />
                      <span className="mt-2 text-sm font-semibold text-slate-900">
                        পাঠ্যবই / গাইড PDF আপলোড করতে ক্লিক করুন
                      </span>
                      <span className="mt-1 text-xs text-slate-500">
                        সর্বোচ্চ ২৫০ MB · বড় PDF স্বয়ংক্রিয়ভাবে ২৫ MB অংশে ভাগ হয়ে আপলোড হবে (.pdf)
                      </span>
                    </>
                  )}
                </label>
              </div>

              {kbError && (
                <div
                  role="alert"
                  className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                  <span>{kbError}</span>
                </div>
              )}

              <div className="mt-5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>সংরক্ষিত PDF নথিসমূহ</span>
                  <span className="tabular-nums">
                    {toBanglaDigits(kbStatus?.documents.length ?? 0)}টি ফাইল
                  </span>
                </div>

                {kbLoading ? (
                  <div className="mt-3 space-y-2">
                    <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                    <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                  </div>
                ) : !kbStatus || kbStatus.documents.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-center text-xs text-slate-500">
                    {SUBJECT_MAP[kbSubject].bnName} বিষয়ে এখনো কোনো PDF আপলোড করা হয়নি।
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {kbStatus.documents.map((doc) => (
                      <li
                        key={doc.name}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="h-4 w-4 text-blue-700 shrink-0" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {doc.displayName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {doc.state === 'STATE_ACTIVE' ? 'ইনডেক্স প্রস্তুত' : doc.state}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={deletingDocName === doc.name}
                          onClick={() => void handleDeleteKbDocument(doc.name)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 shrink-0 cursor-pointer"
                          aria-label={`মুছুন ${doc.displayName}`}
                        >
                          {deletingDocName === doc.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Right: 1-Click AI Exam Generator */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <h2 className="text-base font-bold text-slate-900">
                ৩. ১-ক্লিক AI এমসিকিউ জেনারেটর (৩০ প্রশ্ন)
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                আপলোড করা PDF থেকে ঠিক ১০টি সহজ, ১২টি মধ্যম ও ৮টি কঠিন (HSC ও ভর্তি মান) বাংলা MCQ তৈরি হবে।
              </p>

              <form onSubmit={handleGenerateAiExam} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="ai-paper-input" className="block text-sm font-semibold text-slate-800">
                    পত্র (Paper)
                  </label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {SUBJECT_MAP[kbSubject].papers.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPaperInput(p)}
                        className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          paperInput === p
                            ? 'border-blue-600 bg-blue-50 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    id="ai-paper-input"
                    type="text"
                    value={paperInput}
                    onChange={(e) => setPaperInput(e.target.value)}
                    placeholder="যেমন: ১ম পত্র"
                    maxLength={100}
                    className="mt-2 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div>
                  <label htmlFor="ai-chapter-input" className="block text-sm font-semibold text-slate-800">
                    অধ্যায়ের নাম (Chapter Name) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="ai-chapter-input"
                    type="text"
                    value={chapterInput}
                    onChange={(e) => {
                      setChapterInput(e.target.value);
                      if (aiError) setAiError('');
                    }}
                    placeholder="যেমন: অধ্যায় ২: ভেক্টর / অধ্যায় ৩: সংখ্যা পদ্ধতি"
                    maxLength={150}
                    required
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                {aiError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" aria-hidden="true" />
                    <span>{aiError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={generatingAi}
                  className="inline-flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
                >
                  {generatingAi ? (
                    <>
                      <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden="true" />
                      <span>PDF থেকে ৩০টি MCQ তৈরি হচ্ছে...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
                      <span>Generate 30 MCQs (৩০টি MCQ তৈরি করুন)</span>
                    </>
                  )}
                </button>
              </form>
            </section>
          </div>

          {/* AI Preview & 1-Click Publish */}
          {aiPreview && (
            <section className="rounded-2xl border border-blue-200 bg-white p-5 sm:p-6">
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-blue-700">AI জেনারেটেড প্রিভিউ</p>
                  <h3 className="mt-1 text-lg font-bold text-slate-900">{aiPreview.examTitle}</h3>
                  {(() => {
                    const c = countDifficulty(aiPreview.questions);
                    return (
                      <p className="mt-1 text-xs text-slate-600 tabular-nums">
                        মোট {toBanglaDigits(aiPreview.questions.length)} প্রশ্ন · সহজ:{' '}
                        {toBanglaDigits(c.easy)} · মধ্যম: {toBanglaDigits(c.med)} · কঠিন:{' '}
                        {toBanglaDigits(c.hard)}
                      </p>
                    );
                  })()}
                </div>

                <button
                  type="button"
                  disabled={publishingAi}
                  onClick={() => void handlePublishAiPreview()}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60 shrink-0 cursor-pointer"
                >
                  <CloudUpload className="h-4.5 w-4.5" aria-hidden="true" />
                  <span>
                    {publishingAi ? 'পাবলিশ হচ্ছে...' : 'স্টুডেন্ট পোর্টালে পাবলিশ করুন'}
                  </span>
                </button>
              </div>

              <div className="mt-4 max-h-[460px] space-y-4 overflow-y-auto pr-1">
                {aiPreview.questions.map((q, idx) => (
                  <div key={q.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="text-xs text-slate-500">
                      প্রশ্ন {toBanglaDigits(idx + 1)} · {q.topic} · {q.difficulty} · {q.source}
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate-900">{q.question}</p>
                    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-xs">
                      {q.options.map((opt, optIdx) => (
                        <div
                          key={optIdx}
                          className={`rounded-lg border px-2.5 py-1.5 ${
                            optIdx === q.answer
                              ? 'border-emerald-400 bg-emerald-50 font-bold text-emerald-900'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          ({BANGLA_OPTION_LABELS[optIdx]}) {opt}
                        </div>
                      ))}
                    </div>
                    {q.explanation && (
                      <p className="mt-2 text-xs text-slate-600">
                        <strong>ব্যাখ্যা:</strong> {q.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* TAB 2: Manual JSON Import Backup */}
      {activeTab === 'json' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">ম্যানুয়াল JSON ইমপোর্ট ব্যাকআপ</h2>
              <p className="mt-1 text-xs text-slate-600">
                নির্ধারিত JSON স্কিমা পেস্ট করে সরাসরি প্রিভিউ দেখুন এবং স্টুডেন্ট পোর্টালে পাবলিশ করুন।
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setJsonInput(SAMPLE_JSON_TEMPLATE);
                setJsonError('');
                setJsonPreview(null);
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <span>নমুনা JSON লোড করুন</span>
            </button>
          </div>

          <div className="mt-4">
            <label htmlFor="manual-json-textarea" className="block text-sm font-semibold text-slate-800">
              Exam JSON পেস্ট করুন
            </label>
            <textarea
              id="manual-json-textarea"
              rows={11}
              value={jsonInput}
              onChange={(e) => {
                setJsonInput(e.target.value);
                if (jsonError) setJsonError('');
              }}
              placeholder='{ "subject": "Physics", "examTitle": "...", "questions": [{ "id": 1, "topic": "", "difficulty": "সহজ", "source": "", "question": "", "options": ["","","",""], "answer": 0, "explanation": "" }] }'
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>

          {jsonError && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <span>{jsonError}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleValidateJson}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              <span>JSON যাচাই ও প্রিভিউ দেখুন</span>
            </button>

            {jsonPreview && (
              <button
                type="button"
                disabled={publishingJson}
                onClick={() => void handlePublishJsonPreview()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
              >
                <CloudUpload className="h-4 w-4" aria-hidden="true" />
                <span>
                  {publishingJson ? 'পাবলিশ হচ্ছে...' : 'স্টুডেন্ট পোর্টালে পাবলিশ করুন'}
                </span>
              </button>
            )}
          </div>

          {jsonPreview && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">{jsonPreview.examTitle}</h3>
                <span className="text-xs font-semibold text-emerald-700">
                  {SUBJECT_MAP[jsonPreview.subject].bnName} · {toBanglaDigits(jsonPreview.questions.length)}টি প্রশ্ন বৈধ
                </span>
              </div>
              <div className="mt-4 max-h-[380px] space-y-3 overflow-y-auto pr-1">
                {jsonPreview.questions.map((q, idx) => (
                  <div key={q.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-sm">
                    <p className="font-bold text-slate-900">
                      {toBanglaDigits(idx + 1)}. {q.question}
                    </p>
                    <p className="mt-1 text-xs text-emerald-800 font-semibold">
                      সঠিক উত্তর: ({BANGLA_OPTION_LABELS[q.answer]}) {q.options[q.answer]}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: Manage Exams (Active/Hidden toggle, Delete, View/Print Question Paper & Answer Key) */}
      {activeTab === 'manage' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-slate-900">সকল পরীক্ষা পরিচালনা</h2>

            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setManageSubjectFilter('ALL')}
                className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  manageSubjectFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                সব ({toBanglaDigits(exams.length)})
              </button>
              {SUBJECTS.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => setManageSubjectFilter(s.code)}
                  className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                    manageSubjectFilter === s.code
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s.bnName}
                </button>
              ))}
            </div>
          </div>

          {filteredManagedExams.length === 0 ? (
            <p className="mt-8 text-center text-sm text-slate-500">
              এই ফিল্টারে কোনো পরীক্ষা পাওয়া যায়নি।
            </p>
          ) : (
            <div className="mt-5 divide-y divide-slate-200">
              {filteredManagedExams.map((exam) => {
                const subj = SUBJECT_MAP[exam.subject];
                const isBusy = busyExamId === exam.id;
                return (
                  <div
                    key={exam.id}
                    className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                        <span className={subj.accentText}>{subj.bnName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {toBanglaDigits(exam.questions.length)} MCQ
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            exam.isActive
                              ? 'font-semibold text-emerald-700'
                              : 'font-semibold text-slate-500'
                          }
                        >
                          {exam.isActive ? 'সক্রিয় (শিক্ষার্থীদের জন্য উন্মুক্ত)' : 'লুকানো'}
                        </span>
                        {exam.isLocalOnly && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700">বিল্ট-ইন / লোকাল</span>
                          </>
                        )}
                      </div>
                      <h3 className="mt-1 text-base font-bold text-slate-900">
                        {exam.examTitle}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyExamId(exam.id);
                          try {
                            await onToggleExamActive(exam);
                          } finally {
                            setBusyExamId(null);
                          }
                        }}
                        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                          exam.isActive
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {exam.isActive ? (
                          <>
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>লুকান</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>সক্রিয় করুন</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPrintExam(exam)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>প্রশ্ন / উত্তরপত্র</span>
                      </button>

                      {confirmDeleteId === exam.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyExamId(exam.id);
                              try {
                                await onDeleteExam(exam);
                                setConfirmDeleteId(null);
                              } finally {
                                setBusyExamId(null);
                              }
                            }}
                            className="min-h-[40px] rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
                          >
                            নিশ্চিত মুছুন
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-[40px] rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            বাতিল
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(exam.id)}
                          aria-label={`মুছুন ${exam.examTitle}`}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-red-200 bg-red-50/60 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>মুছুন</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {printExam && <PrintExamModal exam={printExam} onClose={() => setPrintExam(null)} />}
    </main>
  );
};
