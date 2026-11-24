import { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppMode, Header } from './components/Header';
import { StudentPortal } from './components/StudentPortal';
import { LiveExamView } from './components/LiveExamView';
import { ExamReportView } from './components/ExamReportView';
import { TeacherPinGate } from './components/TeacherPinGate';
import { TeacherAdminPanel } from './components/TeacherAdminPanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SEED_EXAMS } from './data/seedExams';
import {
  ExamDocument,
  ExamReport,
  LiveExamState,
  MCQQuestion,
  StudentInfo,
  SubjectCode,
} from './types/exam';
import { buildExamReport, postResultToAppsScript } from './utils/examEngine';
import {
  deleteExamFromFirestore,
  generateValidExamId,
  isVerifiedAdminUser,
  publishExamToFirestore,
  subscribeActiveExams,
  subscribeAllExamsAdmin,
  subscribeAuthState,
  toggleExamVisibilityInFirestore,
} from './lib/firebase';

const LOCAL_EXAMS_STORAGE_KEY = 'hsc_mcq_local_exams_v1';
const HIDDEN_SEED_IDS_KEY = 'hsc_mcq_hidden_seeds_v1';
const DELETED_SEED_IDS_KEY = 'hsc_mcq_deleted_seeds_v1';

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('student');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firestoreExams, setFirestoreExams] = useState<ExamDocument[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);

  // Teacher PIN session token held strictly in React memory (never localStorage)
  const [teacherToken, setTeacherToken] = useState<string | null>(null);
  const [maxUploadChunkBytes, setMaxUploadChunkBytes] = useState<number | undefined>(undefined);

  // Local fallback exams & seed state overrides (used before teacher signs into Google Auth)
  const [localExams, setLocalExams] = useState<ExamDocument[]>(() =>
    readJsonStorage<ExamDocument[]>(LOCAL_EXAMS_STORAGE_KEY, [])
  );
  const [hiddenSeedIds, setHiddenSeedIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(HIDDEN_SEED_IDS_KEY, [])
  );
  const [deletedSeedIds, setDeletedSeedIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(DELETED_SEED_IDS_KEY, [])
  );

  // Live exam & report state
  const [activeExamSession, setActiveExamSession] = useState<{
    exam: ExamDocument;
    student: StudentInfo;
  } | null>(null);
  const [completedReport, setCompletedReport] = useState<ExamReport | null>(null);
  const [syncStatus, setSyncStatus] = useState<'sending' | 'sent' | 'failed'>('sending');
  const [syncError, setSyncError] = useState<string | undefined>(undefined);

  // Persist local preview state
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCAL_EXAMS_STORAGE_KEY, JSON.stringify(localExams));
      window.localStorage.setItem(HIDDEN_SEED_IDS_KEY, JSON.stringify(hiddenSeedIds));
      window.localStorage.setItem(DELETED_SEED_IDS_KEY, JSON.stringify(deletedSeedIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [localExams, hiddenSeedIds, deletedSeedIds]);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    return subscribeAuthState((user) => {
      setFirebaseUser(user);
    });
  }, []);

  // Subscribe to Firestore exams (all exams if verified admin in teacher mode, else active exams)
  useEffect(() => {
    setLoadingExams(true);
    const isAdmin = isVerifiedAdminUser(firebaseUser);
    const unsub = isAdmin
      ? subscribeAllExamsAdmin(
          (items) => {
            setFirestoreExams(items);
            setLoadingExams(false);
          },
          () => setLoadingExams(false)
        )
      : subscribeActiveExams(
          (items) => {
            setFirestoreExams(items);
            setLoadingExams(false);
          },
          () => setLoadingExams(false)
        );
    return () => unsub();
  }, [firebaseUser]);

  // Merge Firestore exams + local exams + seed exams cleanly
  const allExams = useMemo(() => {
    const byId = new Map<string, ExamDocument>();
    // 1. Seed exams (unless deleted by teacher)
    SEED_EXAMS.forEach((seed) => {
      if (!deletedSeedIds.includes(seed.id)) {
        byId.set(seed.id, {
          ...seed,
          isActive: !hiddenSeedIds.includes(seed.id),
        });
      }
    });
    // 2. Local session exams
    localExams.forEach((ex) => {
      byId.set(ex.id, ex);
    });
    // 3. Authoritative Firestore exams override matching IDs
    firestoreExams.forEach((ex) => {
      byId.set(ex.id, ex);
    });
    return Array.from(byId.values());
  }, [firestoreExams, localExams, hiddenSeedIds, deletedSeedIds]);

  const sendReportToAppsScript = useCallback(async (report: ExamReport) => {
    setSyncStatus('sending');
    setSyncError(undefined);
    const res = await postResultToAppsScript(report.webhookPayload);
    if (res.sent) {
      setSyncStatus('sent');
    } else {
      setSyncStatus('failed');
      setSyncError(res.error);
    }
  }, []);

  const handleStartExam = useCallback((exam: ExamDocument, student: StudentInfo) => {
    setCompletedReport(null);
    setActiveExamSession({ exam, student });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCompleteExam = useCallback(
    (finalState: LiveExamState) => {
      if (!activeExamSession) return;
      const report = buildExamReport(
        activeExamSession.exam,
        activeExamSession.student,
        finalState
      );
      setActiveExamSession(null);
      setCompletedReport(report);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      void sendReportToAppsScript(report);
    },
    [activeExamSession, sendReportToAppsScript]
  );

  const handlePublishExam = useCallback(
    async (payload: {
      subject: SubjectCode;
      examTitle: string;
      paper?: string;
      chapter?: string;
      sourceType: 'ai' | 'json' | 'seed';
      questions: MCQQuestion[];
    }): Promise<{ persistedToFirestore: boolean }> => {
      const id = generateValidExamId(payload.subject);
      const baseExam = {
        id,
        subject: payload.subject,
        examTitle: payload.examTitle,
        paper: payload.paper,
        chapter: payload.chapter,
        isActive: true,
        sourceType: payload.sourceType,
        questionCount: payload.questions.length,
        questions: payload.questions,
      };

      if (isVerifiedAdminUser(firebaseUser)) {
        await publishExamToFirestore(baseExam);
        return { persistedToFirestore: true };
      }

      // Local publish fallback until teacher connects Google account for Firestore writes
      setLocalExams((prev) => [
        {
          ...baseExam,
          createdBy: 'local_teacher',
          isLocalOnly: true,
        },
        ...prev,
      ]);
      return { persistedToFirestore: false };
    },
    [firebaseUser]
  );

  const handleToggleExamActive = useCallback(
    async (exam: ExamDocument) => {
      if (!exam.isLocalOnly && isVerifiedAdminUser(firebaseUser)) {
        await toggleExamVisibilityInFirestore(exam.id, !exam.isActive);
        return;
      }
      const isSeed = SEED_EXAMS.some((s) => s.id === exam.id);
      if (isSeed) {
        setHiddenSeedIds((prev) =>
          exam.isActive ? [...prev, exam.id] : prev.filter((id) => id !== exam.id)
        );
      } else {
        setLocalExams((prev) =>
          prev.map((item) =>
            item.id === exam.id ? { ...item, isActive: !item.isActive } : item
          )
        );
      }
    },
    [firebaseUser]
  );

  const handleDeleteExam = useCallback(
    async (exam: ExamDocument) => {
      if (!exam.isLocalOnly && isVerifiedAdminUser(firebaseUser)) {
        await deleteExamFromFirestore(exam.id);
        return;
      }
      const isSeed = SEED_EXAMS.some((s) => s.id === exam.id);
      if (isSeed) {
        setDeletedSeedIds((prev) => (prev.includes(exam.id) ? prev : [...prev, exam.id]));
      } else {
        setLocalExams((prev) => prev.filter((item) => item.id !== exam.id));
      }
    },
    [firebaseUser]
  );

  const handleSelectMode = (nextMode: AppMode) => {
    setMode(nextMode);
    if (nextMode === 'student') {
      setCompletedReport(null);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <Header
          mode={mode}
          onSelectMode={handleSelectMode}
          teacherUnlocked={Boolean(teacherToken)}
          isLiveExamActive={Boolean(activeExamSession)}
        />

        {activeExamSession ? (
          <LiveExamView
            exam={activeExamSession.exam}
            student={activeExamSession.student}
            onComplete={handleCompleteExam}
          />
        ) : mode === 'student' ? (
          completedReport ? (
            <ExamReportView
              report={completedReport}
              syncStatus={syncStatus}
              syncError={syncError}
              onRetrySync={() => void sendReportToAppsScript(completedReport)}
              onBackToPortal={() => setCompletedReport(null)}
            />
          ) : (
            <StudentPortal
              exams={allExams}
              loading={loadingExams}
              onStartExam={handleStartExam}
            />
          )
        ) : teacherToken ? (
          <TeacherAdminPanel
            teacherToken={teacherToken}
            maxChunkBytes={maxUploadChunkBytes}
            firebaseUser={firebaseUser}
            exams={allExams}
            onPublishExam={handlePublishExam}
            onToggleExamActive={handleToggleExamActive}
            onDeleteExam={handleDeleteExam}
            onLockPanel={() => {
              setTeacherToken(null);
              setMaxUploadChunkBytes(undefined);
            }}
          />
        ) : (
          <TeacherPinGate
            onUnlock={(token, chunkLimit) => {
              setTeacherToken(token);
              setMaxUploadChunkBytes(chunkLimit);
            }}
            onCancel={() => setMode('student')}
          />
        )}

        <OfflineIndicator />
      </div>
    </ErrorBoundary>
  );
}
