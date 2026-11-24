export type SubjectCode =
  | 'Physics'
  | 'Chemistry'
  | 'Zoology'
  | 'Botany'
  | 'Math'
  | 'ICT';

export type DifficultyLevel = 'সহজ' | 'মধ্যম' | 'কঠিন';

export interface SubjectInfo {
  code: SubjectCode;
  bnName: string;
  enName: string;
  papers: string[];
  shortCode: string;
  accentText: string;
  accentBg: string;
  accentBorder: string;
}

export const SUBJECTS: SubjectInfo[] = [
  {
    code: 'Physics',
    bnName: 'পদার্থবিজ্ঞান',
    enName: 'Physics',
    papers: ['১ম পত্র', '২য় পত্র'],
    shortCode: 'PHY',
    accentText: 'text-blue-700',
    accentBg: 'bg-blue-50',
    accentBorder: 'border-blue-200',
  },
  {
    code: 'Chemistry',
    bnName: 'রসায়ন',
    enName: 'Chemistry',
    papers: ['১ম পত্র', '২য় পত্র'],
    shortCode: 'CHE',
    accentText: 'text-teal-700',
    accentBg: 'bg-teal-50',
    accentBorder: 'border-teal-200',
  },
  {
    code: 'Zoology',
    bnName: 'প্রাণিবিজ্ঞান',
    enName: 'Zoology',
    papers: ['জীববিজ্ঞান ২য় পত্র'],
    shortCode: 'ZOO',
    accentText: 'text-rose-700',
    accentBg: 'bg-rose-50',
    accentBorder: 'border-rose-200',
  },
  {
    code: 'Botany',
    bnName: 'উদ্ভিদবিজ্ঞান',
    enName: 'Botany',
    papers: ['জীববিজ্ঞান ১ম পত্র'],
    shortCode: 'BOT',
    accentText: 'text-emerald-700',
    accentBg: 'bg-emerald-50',
    accentBorder: 'border-emerald-200',
  },
  {
    code: 'Math',
    bnName: 'উচ্চতর গণিত',
    enName: 'Math',
    papers: ['১ম পত্র', '২য় পত্র'],
    shortCode: 'MAT',
    accentText: 'text-indigo-700',
    accentBg: 'bg-indigo-50',
    accentBorder: 'border-indigo-200',
  },
  {
    code: 'ICT',
    bnName: 'তথ্য ও যোগাযোগ প্রযুক্তি',
    enName: 'ICT',
    papers: ['একক পত্র'],
    shortCode: 'ICT',
    accentText: 'text-amber-700',
    accentBg: 'bg-amber-50',
    accentBorder: 'border-amber-200',
  },
];

export const SUBJECT_MAP: Record<SubjectCode, SubjectInfo> = SUBJECTS.reduce(
  (acc, item) => {
    acc[item.code] = item;
    return acc;
  },
  {} as Record<SubjectCode, SubjectInfo>
);

export interface MCQQuestion {
  id: number;
  topic: string;
  difficulty: DifficultyLevel | string;
  source: string;
  question: string;
  options: [string, string, string, string];
  answer: number; // 0 | 1 | 2 | 3
  explanation: string;
}

export interface ExamDocument {
  id: string;
  subject: SubjectCode;
  examTitle: string;
  paper?: string;
  chapter?: string;
  isActive: boolean;
  sourceType: 'ai' | 'json' | 'seed';
  questionCount: number;
  questions: MCQQuestion[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  isLocalOnly?: boolean;
}

export interface StudentInfo {
  studentName: string;
  studentRoll: string;
}

export interface QuestionAttemptState {
  selectedOption: number | null;
  remainingSec: number;
  timeSpentSec: number;
  expired: boolean;
  bankSavedSec: number;
  bankUsedSec: number;
}

export interface LiveExamState {
  currentIndex: number;
  overallRemainingSec: number;
  bonusBankSec: number;
  totalBankEarnedSec: number;
  totalBankUsedSec: number;
  attempts: QuestionAttemptState[];
  submitted: boolean;
  autoSubmitted: boolean;
}

export interface TopicReportItem {
  topic: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  percentage: number;
}

export interface DifficultyReportItem {
  difficulty: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  percentage: number;
}

export interface SubmissionWebhookPayload {
  subject: string;
  studentName: string;
  studentRoll: string;
  score: number;
  percentage: number;
  correct: number;
  wrong: number;
  unanswered: number;
}

export interface ExamReport {
  exam: ExamDocument;
  student: StudentInfo;
  score: number;
  totalQuestions: number;
  percentage: number;
  correct: number;
  wrong: number;
  unanswered: number;
  gradeLabel: string;
  assessmentTitle: string;
  assessmentMessage: string;
  totalTimeUsedSec: number;
  avgTimePerAnsweredSec: number;
  totalBankEarnedSec: number;
  totalBankUsedSec: number;
  autoSubmitted: boolean;
  topicStats: TopicReportItem[];
  difficultyStats: DifficultyReportItem[];
  revisionTips: string[];
  attempts: QuestionAttemptState[];
  webhookPayload: SubmissionWebhookPayload;
  submittedAtIso: string;
}

export interface KnowledgeBaseDocument {
  name: string;
  displayName: string;
  state: string;
  sizeBytes?: string;
  createTime?: string;
}

export interface KnowledgeBaseStatus {
  subject: SubjectCode;
  storeName: string | null;
  displayName: string;
  documents: KnowledgeBaseDocument[];
}
