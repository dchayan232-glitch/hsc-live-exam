import {
  ExamDocument,
  ExamReport,
  LiveExamState,
  MCQQuestion,
  QuestionAttemptState,
  StudentInfo,
  SubjectCode,
  SubmissionWebhookPayload,
  TopicReportItem,
  DifficultyReportItem,
} from '../types/exam';

export const QUESTION_BASE_SECONDS = 40;
export const OVERALL_EXAM_SECONDS = 20 * 60; // 20 minutes = 1200 seconds
export const RESULTS_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbzAiijBN_vtwnF-CG9diEiFCYBld9Fb_prmeU0xkXZKndO8swQXaiDsP-g26RhZaEN9fw/exec';

export const BANGLA_OPTION_LABELS = ['ক', 'খ', 'গ', 'ঘ'] as const;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function createInitialLiveExamState(questionCount: number): LiveExamState {
  const attempts: QuestionAttemptState[] = Array.from({ length: questionCount }, () => ({
    selectedOption: null,
    remainingSec: QUESTION_BASE_SECONDS,
    timeSpentSec: 0,
    expired: false,
    bankSavedSec: 0,
    bankUsedSec: 0,
  }));

  return {
    currentIndex: 0,
    overallRemainingSec: OVERALL_EXAM_SECONDS,
    bonusBankSec: 0,
    totalBankEarnedSec: 0,
    totalBankUsedSec: 0,
    attempts,
    submitted: false,
    autoSubmitted: false,
  };
}

/**
 * One-time option lock: once an option is selected for a question (or if the question has expired),
 * it cannot be changed. Unused seconds from the 40s per-question budget carry over into the Bonus Time Bank.
 */
export function lockAnswerOption(
  state: LiveExamState,
  questionIndex: number,
  optionIndex: number
): LiveExamState {
  if (state.submitted) return state;
  if (questionIndex < 0 || questionIndex >= state.attempts.length) return state;
  if (optionIndex < 0 || optionIndex > 3) return state;

  const current = state.attempts[questionIndex];
  if (current.selectedOption !== null || current.expired) {
    return state;
  }

  const savedSec = Math.max(0, current.remainingSec);
  const nextAttempts = state.attempts.map((item, idx) =>
    idx === questionIndex
      ? {
          ...item,
          selectedOption: optionIndex,
          remainingSec: 0,
          bankSavedSec: savedSec,
        }
      : item
  );

  return {
    ...state,
    bonusBankSec: state.bonusBankSec + savedSec,
    totalBankEarnedSec: state.totalBankEarnedSec + savedSec,
    attempts: nextAttempts,
  };
}

/**
 * Finds the next unanswered, non-expired question index after `fromIndex` (wrapping around),
 * or returns null if all questions are answered or expired.
 */
export function findNextOpenQuestionIndex(
  attempts: QuestionAttemptState[],
  fromIndex: number
): number | null {
  const len = attempts.length;
  for (let offset = 1; offset <= len; offset++) {
    const candidate = (fromIndex + offset) % len;
    const item = attempts[candidate];
    if (item.selectedOption === null && !item.expired) {
      return candidate;
    }
  }
  return null;
}

/**
 * Advances live exam timers by 1 second:
 * - Decrements overallRemainingSec (auto-submits at 0).
 * - If current question is unanswered & not expired:
 *   - Uses question's own remainingSec first.
 *   - When remainingSec hits 0, automatically draws from bonusBankSec if available.
 *   - When both remainingSec and bonusBankSec are 0, marks question expired and advances to next open question.
 */
export function tickLiveExam(state: LiveExamState): LiveExamState {
  if (state.submitted) return state;

  const nextOverall = Math.max(0, state.overallRemainingSec - 1);
  if (nextOverall === 0) {
    return {
      ...state,
      overallRemainingSec: 0,
      submitted: true,
      autoSubmitted: true,
    };
  }

  const idx = state.currentIndex;
  const current = state.attempts[idx];
  if (!current || current.selectedOption !== null || current.expired) {
    return {
      ...state,
      overallRemainingSec: nextOverall,
    };
  }

  let nextBonusBank = state.bonusBankSec;
  let nextTotalBankUsed = state.totalBankUsedSec;
  let nextQuestionRem = current.remainingSec;
  let nextQuestionExpired = false;
  let nextQuestionBankUsed = current.bankUsedSec;

  if (current.remainingSec > 0) {
    nextQuestionRem = current.remainingSec - 1;
    // If question's own 40s hit 0 AND there is no bonus bank left, mark expired
    if (nextQuestionRem === 0 && nextBonusBank === 0) {
      nextQuestionExpired = true;
    }
  } else if (nextBonusBank > 0) {
    nextBonusBank -= 1;
    nextTotalBankUsed += 1;
    nextQuestionBankUsed += 1;
    if (nextBonusBank === 0) {
      nextQuestionExpired = true;
    }
  } else {
    nextQuestionExpired = true;
  }

  const nextAttempts = state.attempts.map((item, i) =>
    i === idx
      ? {
          ...item,
          remainingSec: nextQuestionRem,
          timeSpentSec: item.timeSpentSec + 1,
          expired: nextQuestionExpired,
          bankUsedSec: nextQuestionBankUsed,
        }
      : item
  );

  let nextIndex = idx;
  if (nextQuestionExpired) {
    const openIdx = findNextOpenQuestionIndex(nextAttempts, idx);
    if (openIdx !== null) {
      nextIndex = openIdx;
    }
  }

  return {
    ...state,
    currentIndex: nextIndex,
    overallRemainingSec: nextOverall,
    bonusBankSec: nextBonusBank,
    totalBankUsedSec: nextTotalBankUsed,
    attempts: nextAttempts,
  };
}

export function submitLiveExam(state: LiveExamState, auto = false): LiveExamState {
  if (state.submitted) return state;
  return {
    ...state,
    submitted: true,
    autoSubmitted: auto,
  };
}

function getBanglaAssessment(percentage: number): {
  gradeLabel: string;
  assessmentTitle: string;
  assessmentMessage: string;
} {
  if (percentage >= 85) {
    return {
      gradeLabel: 'A+ (অসাধারণ)',
      assessmentTitle: 'বোর্ড ও ভর্তি পরীক্ষার জন্য চমৎকার প্রস্তুতি',
      assessmentMessage:
        'আপনার ধারণা অত্যন্ত স্পষ্ট এবং সময় ব্যবস্থাপনাও প্রশংসনীয়। কঠিন ও ভর্তি-মানের প্রশ্নগুলোতেও আপনার দখল শক্তিশালী।',
    };
  }
  if (percentage >= 70) {
    return {
      gradeLabel: 'A (খুব ভালো)',
      assessmentTitle: 'দৃঢ় প্রস্তুতি, সামান্য অনুশীলনেই পূর্ণ দক্ষতা',
      assessmentMessage:
        'মূল অধ্যায়গুলোর ওপর আপনার ভালো দখল রয়েছে। ভুল হওয়া নির্দিষ্ট টপিকগুলো রিভিশন করলে নম্বর ৮৫%-এর ওপরে নেওয়া সহজ হবে।',
    };
  }
  if (percentage >= 60) {
    return {
      gradeLabel: 'A- (ভালো)',
      assessmentTitle: 'ভিত্তি ভালো, মধ্যম ও কঠিন প্রশ্নে জোর দিন',
      assessmentMessage:
        'পাঠ্যবইয়ের মৌলিক অংশগুলো ভালোভাবে আয়ত্ত করেছেন। গাণিতিক ও প্রয়োগমূলক প্রশ্ন আরও অনুশীলন করুন।',
    };
  }
  if (percentage >= 50) {
    return {
      gradeLabel: 'B (সন্তোষজনক)',
      assessmentTitle: 'মাঝারি প্রস্তুতি, নিয়মিত রিভিশন প্রয়োজন',
      assessmentMessage:
        'বেশ কিছু গুরুত্বপূর্ণ টপিকে ঘাটতি রয়েছে। নিচের টপিকভিত্তিক অগ্রগতি দেখে দুর্বল অধ্যায়গুলো আবার পড়ুন।',
    };
  }
  if (percentage >= 33) {
    return {
      gradeLabel: 'C (উন্নতি প্রয়োজন)',
      assessmentTitle: 'মূল পাঠ্যবই পুনরায় মনোযোগ দিয়ে পড়া জরুরি',
      assessmentMessage:
        'প্রশ্নের ধরন বুঝতে এবং সূত্র প্রয়োগে আরও অনুশীলন দরকার। প্রতিটি প্রশ্নের ব্যাখ্যা ভালোভাবে পড়ে আবার পরীক্ষা দিন।',
    };
  }
  return {
    gradeLabel: 'F (পুনরায় অনুশীলন জরুরি)',
    assessmentTitle: 'অধ্যায়টি শুরু থেকে গুছিয়ে পড়ুন',
    assessmentMessage:
      'হতাশ হবেন না! মূল পাঠ্যবইয়ের উদাহরণ ও অনুশীলনী ভালোভাবে সম্পন্ন করে নিচের ব্যাখ্যাগুলো দেখে আবার চেষ্টা করুন।',
  };
}

export function buildExamReport(
  exam: ExamDocument,
  student: StudentInfo,
  liveState: LiveExamState
): ExamReport {
  const totalQuestions = exam.questions.length;
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  let answeredTimeSum = 0;
  let answeredCount = 0;

  const topicMap = new Map<string, { total: number; correct: number; wrong: number; unanswered: number }>();
  const diffOrder = ['সহজ', 'মধ্যম', 'কঠিন'];
  const diffMap = new Map<string, { total: number; correct: number; wrong: number; unanswered: number }>();

  exam.questions.forEach((q, idx) => {
    const attempt = liveState.attempts[idx] ?? {
      selectedOption: null,
      remainingSec: 0,
      timeSpentSec: 0,
      expired: false,
      bankSavedSec: 0,
      bankUsedSec: 0,
    };

    const topicName = q.topic?.trim() || 'সাধারণ টপিক';
    if (!topicMap.has(topicName)) {
      topicMap.set(topicName, { total: 0, correct: 0, wrong: 0, unanswered: 0 });
    }
    const tBucket = topicMap.get(topicName)!;
    tBucket.total += 1;

    const diffName = q.difficulty?.trim() || 'মধ্যম';
    if (!diffMap.has(diffName)) {
      diffMap.set(diffName, { total: 0, correct: 0, wrong: 0, unanswered: 0 });
    }
    const dBucket = diffMap.get(diffName)!;
    dBucket.total += 1;

    if (attempt.selectedOption === null) {
      unanswered += 1;
      tBucket.unanswered += 1;
      dBucket.unanswered += 1;
    } else {
      answeredCount += 1;
      answeredTimeSum += attempt.timeSpentSec;
      if (attempt.selectedOption === q.answer) {
        correct += 1;
        tBucket.correct += 1;
        dBucket.correct += 1;
      } else {
        wrong += 1;
        tBucket.wrong += 1;
        dBucket.wrong += 1;
      }
    }
  });

  const score = correct;
  const percentage =
    totalQuestions > 0 ? Math.round((correct / totalQuestions) * 1000) / 10 : 0;

  const topicStats: TopicReportItem[] = Array.from(topicMap.entries())
    .map(([topic, s]) => ({
      topic,
      total: s.total,
      correct: s.correct,
      wrong: s.wrong,
      unanswered: s.unanswered,
      percentage: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
    }))
    .sort((a, b) => a.percentage - b.percentage);

  const difficultyStats: DifficultyReportItem[] = Array.from(diffMap.entries())
    .sort((a, b) => {
      const ia = diffOrder.indexOf(a[0]);
      const ib = diffOrder.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([difficulty, s]) => ({
      difficulty,
      total: s.total,
      correct: s.correct,
      wrong: s.wrong,
      unanswered: s.unanswered,
      percentage: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
    }));

  const { gradeLabel, assessmentTitle, assessmentMessage } = getBanglaAssessment(percentage);

  const totalTimeUsedSec = Math.max(0, OVERALL_EXAM_SECONDS - liveState.overallRemainingSec);
  const avgTimePerAnsweredSec =
    answeredCount > 0 ? Math.round(answeredTimeSum / answeredCount) : 0;

  // Build actionable Bangla revision tips
  const revisionTips: string[] = [];
  const weakTopics = topicStats.filter((t) => t.percentage < 60).slice(0, 3);
  if (weakTopics.length > 0) {
    revisionTips.push(
      `দুর্বল টপিক চিহ্নিতকরণ: ${weakTopics
        .map((t) => `“${t.topic}” (${toBanglaDigits(t.percentage)}%)`)
        .join(', ')} — এই অংশগুলো পাঠ্যবই থেকে পুনরায় রিভিশন দিন।`
    );
  } else {
    revisionTips.push(
      'সব টপিকেই আপনার ৬০% বা তার বেশি নির্ভুলতা রয়েছে। এখন কঠিন মানের ভর্তি-পরীক্ষার প্রশ্ন অনুশীলনে জোর দিন।'
    );
  }

  if (unanswered >= 4) {
    revisionTips.push(
      `সময় ব্যবস্থাপনা: আপনার ${toBanglaDigits(unanswered)}টি প্রশ্ন অনুত্তরিত ছিল। সহজ প্রশ্নগুলো দ্রুত (১৫–২০ সেকেন্ডে) লক করে বোনাস টাইম ব্যাংক জমিয়ে রাখুন।`
    );
  } else {
    revisionTips.push(
      `বোনাস টাইম ব্যাংক ব্যবহার: দ্রুত উত্তর দিয়ে আপনি মোট ${toBanglaDigits(liveState.totalBankEarnedSec)} সেকেন্ড বোনাস সময় সঞ্চয় করেছেন।`
    );
  }

  const hardStat = difficultyStats.find((d) => d.difficulty === 'কঠিন');
  if (hardStat && hardStat.percentage < 60) {
    revisionTips.push(
      `কঠিন প্রশ্ন কৌশল: কঠিন স্তরের প্রশ্নগুলোতে নির্ভুলতা ${toBanglaDigits(hardStat.percentage)}%। প্রতিটি ভুল প্রশ্নের নিচের ব্যাখ্যা নোট খাতায় লিখে রাখুন।`
    );
  } else if (wrong > 0) {
    revisionTips.push(
      `ভুল সংশোধন: আপনার ভুল হওয়া ${toBanglaDigits(wrong)}টি প্রশ্নের সঠিক ব্যাখ্যা মনোযোগ দিয়ে দেখে নিন যাতে বোর্ড পরীক্ষায় একই ভুল আর না হয়।`
    );
  }

  const webhookPayload: SubmissionWebhookPayload = {
    subject: exam.examTitle,
    studentName: student.studentName.trim(),
    studentRoll: student.studentRoll.trim(),
    score,
    percentage,
    correct,
    wrong,
    unanswered,
  };

  return {
    exam,
    student,
    score,
    totalQuestions,
    percentage,
    correct,
    wrong,
    unanswered,
    gradeLabel,
    assessmentTitle,
    assessmentMessage,
    totalTimeUsedSec,
    avgTimePerAnsweredSec,
    totalBankEarnedSec: liveState.totalBankEarnedSec,
    totalBankUsedSec: liveState.totalBankUsedSec,
    autoSubmitted: liveState.autoSubmitted,
    topicStats,
    difficultyStats,
    revisionTips,
    attempts: liveState.attempts,
    webhookPayload,
    submittedAtIso: new Date().toISOString(),
  };
}

const SUBJECT_ALIAS_MAP: Record<string, SubjectCode> = {
  physics: 'Physics',
  'পদার্থবিজ্ঞান': 'Physics',
  chemistry: 'Chemistry',
  'রসায়ন': 'Chemistry',
  'রসায়ন': 'Chemistry',
  zoology: 'Zoology',
  'প্রাণিবিজ্ঞান': 'Zoology',
  botany: 'Botany',
  'উদ্ভিদবিজ্ঞান': 'Botany',
  math: 'Math',
  'higher math': 'Math',
  'উচ্চতর গণিত': 'Math',
  ict: 'ICT',
  'তথ্য ও যোগাযোগ প্রযুক্তি': 'ICT',
};

export function normalizeSubjectCode(raw: string): SubjectCode | null {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return SUBJECT_ALIAS_MAP[key] ?? SUBJECT_ALIAS_MAP[raw.trim()] ?? null;
}

export interface ParsedExamPayload {
  subject: SubjectCode;
  examTitle: string;
  paper?: string;
  chapter?: string;
  questions: MCQQuestion[];
}

export function parseAndValidateExamJson(
  rawText: string
): { ok: true; data: ParsedExamPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'সঠিক JSON ফরম্যাট নয়। কমা, কোটেশন ও ব্র্যাকেট যাচাই করুন।' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON একটি অবজেক্ট হতে হবে যাতে subject, examTitle এবং questions থাকবে।' };
  }

  const obj = parsed as Record<string, unknown>;
  const subject = normalizeSubjectCode(String(obj.subject ?? ''));
  if (!subject) {
    return {
      ok: false,
      error:
        'অবৈধ subject মান। অনুমোদিত বিষয়: Physics, Chemistry, Zoology, Botany, Math, ICT।',
    };
  }

  const examTitle = typeof obj.examTitle === 'string' ? obj.examTitle.trim() : '';
  if (examTitle.length < 2 || examTitle.length > 200) {
    return { ok: false, error: 'examTitle অবশ্যই ২ থেকে ২০০ অক্ষরের মধ্যে হতে হবে।' };
  }

  if (!Array.isArray(obj.questions) || obj.questions.length === 0) {
    return { ok: false, error: 'questions অ্যারেতে কমপক্ষে ১টি প্রশ্ন থাকতে হবে।' };
  }

  if (obj.questions.length > 60) {
    return { ok: false, error: 'একটি পরীক্ষায় সর্বোচ্চ ৬০টি প্রশ্ন রাখা যাবে।' };
  }

  const validatedQuestions: MCQQuestion[] = [];
  for (let i = 0; i < obj.questions.length; i++) {
    const q = obj.questions[i] as Record<string, unknown>;
    if (!q || typeof q !== 'object') {
      return { ok: false, error: `প্রশ্ন #${toBanglaDigits(i + 1)} সঠিক অবজেক্ট নয়।` };
    }

    const questionText = typeof q.question === 'string' ? q.question.trim() : '';
    if (!questionText || questionText.length > 2000) {
      return {
        ok: false,
        error: `প্রশ্ন #${toBanglaDigits(i + 1)}-এর প্রশ্নবাক্য ফাঁকা বা অতিরিক্ত দীর্ঘ।`,
      };
    }

    if (!Array.isArray(q.options) || q.options.length !== 4) {
      return {
        ok: false,
        error: `প্রশ্ন #${toBanglaDigits(i + 1)}-এ অবশ্যই ঠিক ৪টি অপশন (options) থাকতে হবে।`,
      };
    }

    const opts = q.options.map((o) => String(o ?? '').trim());
    if (opts.some((o) => !o || o.length > 500)) {
      return {
        ok: false,
        error: `প্রশ্ন #${toBanglaDigits(i + 1)}-এর প্রতিটি অপশন ফাঁকা থাকা যাবে না (সর্বোচ্চ ৫০০ অক্ষর)।`,
      };
    }

    const answerIdx = Number(q.answer);
    if (!Number.isInteger(answerIdx) || answerIdx < 0 || answerIdx > 3) {
      return {
        ok: false,
        error: `প্রশ্ন #${toBanglaDigits(i + 1)}-এর answer অবশ্যই ০ থেকে ৩-এর মধ্যে পূর্ণসংখ্যা হতে হবে।`,
      };
    }

    const topic = String(q.topic ?? 'সাধারণ টপিক').trim().slice(0, 200) || 'সাধারণ টপিক';
    const rawDiff = String(q.difficulty ?? 'মধ্যম').trim().slice(0, 40);
    const difficulty = rawDiff || 'মধ্যম';
    const source = String(q.source ?? 'HSC বোর্ড সিলেবাস').trim().slice(0, 200);
    const explanation = String(q.explanation ?? '').trim().slice(0, 3000);

    validatedQuestions.push({
      id: i + 1,
      topic,
      difficulty,
      source,
      question: questionText,
      options: [opts[0], opts[1], opts[2], opts[3]],
      answer: answerIdx,
      explanation,
    });
  }

  return {
    ok: true,
    data: {
      subject,
      examTitle,
      paper: typeof obj.paper === 'string' ? obj.paper.trim().slice(0, 100) : undefined,
      chapter: typeof obj.chapter === 'string' ? obj.chapter.trim().slice(0, 150) : undefined,
      questions: validatedQuestions,
    },
  };
}

/**
 * Auto-POSTs student results to the teacher's Google Apps Script endpoint
 * using exact required mode: "no-cors" and Content-Type: "text/plain;charset=utf-8".
 */
export async function postResultToAppsScript(
  payload: SubmissionWebhookPayload
): Promise<{ sent: boolean; error?: string }> {
  try {
    await fetch(RESULTS_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'নেটওয়ার্ক ত্রুটির কারণে ফলাফল পাঠানো যায়নি।',
    };
  }
}
