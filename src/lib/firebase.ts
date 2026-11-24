import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { ExamDocument, SubjectCode } from '../types/exam';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const BOOTSTRAPPED_ADMIN_EMAIL = 'dchayan232@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export function subscribeAuthState(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export function isVerifiedAdminUser(user: User | null): boolean {
  if (!user) return false;
  return Boolean(user.emailVerified && user.email === BOOTSTRAPPED_ADMIN_EMAIL);
}

export async function signInTeacherWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutTeacher(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribes to active exams visible to students.
 * Matches Firestore rule: `allow list: if existing().isActive == true || isBootstrappedAdmin();`
 */
export function subscribeActiveExams(
  onData: (exams: ExamDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'exams';
  const q = query(collection(db, path), where('isActive', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ExamDocument[] = snapshot.docs.map((d) => ({
        ...(d.data() as ExamDocument),
        id: d.id,
        isLocalOnly: false,
      }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

/**
 * Subscribes to ALL exams (both active and hidden) for verified teacher admin.
 */
export function subscribeAllExamsAdmin(
  onData: (exams: ExamDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'exams';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: ExamDocument[] = snapshot.docs.map((d) => ({
        ...(d.data() as ExamDocument),
        id: d.id,
        isLocalOnly: false,
      }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export function generateValidExamId(subject: SubjectCode): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${subject.toLowerCase()}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export async function publishExamToFirestore(
  exam: Omit<ExamDocument, 'createdBy' | 'createdAt' | 'updatedAt' | 'isLocalOnly'>
): Promise<ExamDocument> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('ফায়ারস্টোরে পাবলিশ করতে শিক্ষক হিসেবে Google সাইন-ইন প্রয়োজন।');
  }

  const safeId = exam.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || generateValidExamId(exam.subject);
  const path = `exams/${safeId}`;

  const payload: Record<string, unknown> = {
    id: safeId,
    subject: exam.subject,
    examTitle: exam.examTitle.trim().slice(0, 200),
    isActive: Boolean(exam.isActive),
    sourceType: exam.sourceType,
    questionCount: exam.questions.length,
    questions: exam.questions.slice(0, 60).map((q, idx) => ({
      id: idx + 1,
      topic: (q.topic || 'সাধারণ টপিক').trim().slice(0, 200),
      difficulty: (q.difficulty || 'মধ্যম').trim().slice(0, 40),
      source: (q.source || 'HSC বোর্ড সিলেবাস').trim().slice(0, 200),
      question: q.question.trim().slice(0, 2000),
      options: q.options.map((opt) => opt.trim().slice(0, 500)),
      answer: q.answer,
      explanation: (q.explanation || '').trim().slice(0, 3000),
    })),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (exam.paper && exam.paper.trim()) {
    payload.paper = exam.paper.trim().slice(0, 100);
  }
  if (exam.chapter && exam.chapter.trim()) {
    payload.chapter = exam.chapter.trim().slice(0, 150);
  }

  try {
    await setDoc(doc(db, 'exams', safeId), payload);
    return {
      ...exam,
      id: safeId,
      questionCount: exam.questions.length,
      createdBy: user.uid,
      isLocalOnly: false,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleExamVisibilityInFirestore(
  examId: string,
  nextIsActive: boolean
): Promise<void> {
  const path = `exams/${examId}`;
  try {
    await updateDoc(doc(db, 'exams', examId), {
      isActive: nextIsActive,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteExamFromFirestore(examId: string): Promise<void> {
  const path = `exams/${examId}`;
  try {
    await deleteDoc(doc(db, 'exams', examId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncKnowledgeBaseMetaToFirestore(params: {
  subject: SubjectCode;
  storeName: string;
  displayName: string;
  documentCount: number;
}): Promise<void> {
  const user = auth.currentUser;
  if (!isVerifiedAdminUser(user) || !user) return;
  const path = `knowledge_bases/${params.subject}`;
  try {
    await setDoc(doc(db, 'knowledge_bases', params.subject), {
      subject: params.subject,
      storeName: params.storeName.slice(0, 200),
      displayName: params.displayName.slice(0, 120),
      documentCount: Math.max(0, Math.min(100, Math.floor(params.documentCount))),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
