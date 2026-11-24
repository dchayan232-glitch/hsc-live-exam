import React, { useMemo, useState } from 'react';
import {
  Atom,
  FlaskConical,
  Bug,
  Leaf,
  Sigma,
  Cpu,
  ArrowLeft,
  ArrowRight,
  Clock,
  ShieldCheck,
  BookOpen,
  AlertCircle,
} from 'lucide-react';
import { ExamDocument, SUBJECTS, SUBJECT_MAP, StudentInfo, SubjectCode } from '../types/exam';
import { toBanglaDigits } from '../utils/examEngine';
import { PWAInstallButton } from './PWAInstallButton';

interface StudentPortalProps {
  exams: ExamDocument[];
  loading: boolean;
  onStartExam: (exam: ExamDocument, student: StudentInfo) => void;
}

const SUBJECT_ICONS: Record<SubjectCode, React.FC<{ className?: string }>> = {
  Physics: Atom,
  Chemistry: FlaskConical,
  Zoology: Bug,
  Botany: Leaf,
  Math: Sigma,
  ICT: Cpu,
};

export const StudentPortal: React.FC<StudentPortalProps> = ({ exams, loading, onStartExam }) => {
  const [selectedSubject, setSelectedSubject] = useState<SubjectCode | null>(null);
  const [selectedExam, setSelectedExam] = useState<ExamDocument | null>(null);
  const [studentName, setStudentName] = useState('');
  const [studentRoll, setStudentRoll] = useState('');
  const [formError, setFormError] = useState('');

  const activeExams = useMemo(() => exams.filter((e) => e.isActive), [exams]);

  const countsBySubject = useMemo(() => {
    const map: Record<SubjectCode, number> = {
      Physics: 0,
      Chemistry: 0,
      Zoology: 0,
      Botany: 0,
      Math: 0,
      ICT: 0,
    };
    activeExams.forEach((e) => {
      if (map[e.subject] !== undefined) {
        map[e.subject] += 1;
      }
    });
    return map;
  }, [activeExams]);

  const subjectExams = useMemo(() => {
    if (!selectedSubject) return [];
    return activeExams.filter((e) => e.subject === selectedSubject);
  }, [activeExams, selectedSubject]);

  const handleSubmitStart = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = studentName.trim();
    const cleanRoll = studentRoll.trim();

    if (cleanName.length < 2) {
      setFormError('অনুগ্রহ করে শিক্ষার্থীর পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।');
      return;
    }
    if (cleanRoll.length < 1) {
      setFormError('অনুগ্রহ করে আপনার রোল নম্বর অথবা ব্যাচের নাম লিখুন।');
      return;
    }
    if (!selectedExam) return;

    setFormError('');
    onStartExam(selectedExam, { studentName: cleanName, studentRoll: cleanRoll });
  };

  // Step 3: Student Registration & Strict Exam Rules Briefing
  if (selectedExam) {
    const subj = SUBJECT_MAP[selectedExam.subject];
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <button
          type="button"
          onClick={() => {
            setSelectedExam(null);
            setFormError('');
          }}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>অধ্যায় তালিকায় ফিরে যান</span>
        </button>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className={subj.accentText}>{subj.bnName}</span>
            <span aria-hidden="true">·</span>
            <span>{toBanglaDigits(selectedExam.questions.length)}টি এমসিকিউ</span>
            <span aria-hidden="true">·</span>
            <span>২০ মিনিট লাইভ পরীক্ষা</span>
          </div>

          <h1 className="mt-2 text-xl font-bold leading-snug text-slate-900 sm:text-2xl text-balance">
            {selectedExam.examTitle}
          </h1>

          {/* Strict Exam Rules */}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
              <span>কঠোর লাইভ পরীক্ষার নিয়মাবলি</span>
            </h2>
            <ul className="mt-3 grid grid-cols-1 gap-2.5 text-sm text-slate-600 sm:grid-cols-2">
              <li className="flex items-start gap-2">
                <span className="text-xs font-bold text-blue-700 tabular-nums pt-0.5">০১.</span>
                <span>মোট {toBanglaDigits(selectedExam.questions.length)}টি প্রশ্ন এবং সর্বমোট সময় ২০ মিনিট।</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-xs font-bold text-blue-700 tabular-nums pt-0.5">০২.</span>
                <span>প্রতি প্রশ্নে ৪০ সেকেন্ড সময়। দ্রুত উত্তর দিলে বেঁচে যাওয়া সময় বোনাস টাইম ব্যাংকে জমা হবে।</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-xs font-bold text-blue-700 tabular-nums pt-0.5">০৩.</span>
                <span>কোনো অপশনে ক্লিক করলে তা স্থায়ীভাবে নীল রঙে লক হবে — পরে পরিবর্তন করা যাবে না।</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-xs font-bold text-blue-700 tabular-nums pt-0.5">০৪.</span>
                <span>সম্পূর্ণ পরীক্ষা সাবমিট করার আগে কোনো সঠিক উত্তর বা নম্বর দেখানো হবে না।</span>
              </li>
            </ul>
          </div>

          {/* Student Name & Roll Form */}
          <form onSubmit={handleSubmitStart} className="mt-6 space-y-4 border-t border-slate-100 pt-6" noValidate>
            <div>
              <label htmlFor="student-name" className="block text-sm font-semibold text-slate-800">
                শিক্ষার্থীর পূর্ণ নাম <span className="text-red-600">*</span>
              </label>
              <input
                id="student-name"
                type="text"
                value={studentName}
                onChange={(e) => {
                  setStudentName(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="যেমন: তানভীর আহমেদ"
                maxLength={80}
                required
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="student-roll" className="block text-sm font-semibold text-slate-800">
                রোল নম্বর / ব্যাচ <span className="text-red-600">*</span>
              </label>
              <input
                id="student-roll"
                type="text"
                value={studentRoll}
                onChange={(e) => {
                  setStudentRoll(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="যেমন: রোল ১০৪ / ব্যাচ ২০২৬"
                maxLength={60}
                required
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <button
              type="submit"
              className="mt-2 inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800 active:scale-[0.99] cursor-pointer"
            >
              <span>লাইভ পরীক্ষা শুরু করুন</span>
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </form>
        </section>
      </main>
    );
  }

  // Step 2: Chapter Exam Selection for Selected Subject
  if (selectedSubject) {
    const subj = SUBJECT_MAP[selectedSubject];
    const SubjIcon = SUBJECT_ICONS[selectedSubject];

    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setSelectedSubject(null)}
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>সকল বিষয়</span>
          </button>

          {/* Quick Subject Switcher */}
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
            {SUBJECTS.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => setSelectedSubject(s.code)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedSubject === s.code
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s.bnName}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3.5">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl border ${subj.accentBg} ${subj.accentBorder} ${subj.accentText} shrink-0`}
          >
            <SubjIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{subj.bnName}</h1>
            <p className="text-sm text-slate-500">
              {subj.enName} · {toBanglaDigits(subjectExams.length)}টি সক্রিয় অধ্যায়ভিত্তিক পরীক্ষা
            </p>
          </div>
        </div>

        {subjectExams.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
            <h2 className="mt-3 text-base font-bold text-slate-900">
              এই বিষয়ে এখনো কোনো সক্রিয় পরীক্ষা প্রকাশ করা হয়নি
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              শিক্ষক প্যানেল থেকে নতুন অধ্যায়ভিত্তিক এমসিকিউ পরীক্ষা পাবলিশ করলে এখানে দেখা যাবে।
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {subjectExams.map((exam) => (
              <article
                key={exam.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-300"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                    <span>{exam.paper || subj.bnName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {toBanglaDigits(exam.questions.length)} MCQ
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>২০ মিনিট</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-snug text-slate-900">
                    {exam.examTitle}
                  </h2>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>প্রশ্নপ্রতি ৪০ সেকেন্ড + বোনাস টাইম ব্যাংক · এককালীন অপশন লক</span>
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSelectedExam(exam)}
                    className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 cursor-pointer"
                  >
                    <span>পরীক্ষায় প্রবেশ করুন</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    );
  }

  // Step 1: Subject Hub (6 HSC Subjects)
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Compact, high-clarity Academic Masthead */}
      <section className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-blue-700">
            এইচএসসি বিজ্ঞান ও আইসিটি · লাইভ বোর্ড ও ভর্তি-মান মূল্যায়ন
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl text-balance">
            বিষয় নির্বাচন করে আপনার লাইভ এমসিকিউ পরীক্ষা শুরু করুন
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
            প্রতিটি পরীক্ষায় ৩০টি প্রশ্ন, প্রশ্নপ্রতি ৪০ সেকেন্ড ও বোনাস টাইম ব্যাংক, এককালীন অপশন লক এবং জমা দেওয়ার পর ১০-পয়েন্টের পূর্ণাঙ্গ বাংলা বিশ্লেষণ রিপোর্ট।
          </p>
        </div>

        <div className="flex items-center gap-3 sm:hidden">
          <PWAInstallButton />
        </div>
      </section>

      {/* 6 Subject Selection Grid */}
      <section aria-labelledby="subjects-heading" className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="subjects-heading" className="text-base font-bold text-slate-900 sm:text-lg">
            বিষয়সমূহ (৬টি বিষয়)
          </h2>
          <span className="text-xs font-medium text-slate-500 tabular-nums">
            মোট {toBanglaDigits(activeExams.length)}টি সক্রিয় পরীক্ষা
          </span>
        </div>

        {loading && activeExams.length === 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUBJECTS.map((subj) => {
              const Icon = SUBJECT_ICONS[subj.code];
              const count = countsBySubject[subj.code];
              return (
                <button
                  key={subj.code}
                  type="button"
                  onClick={() => setSelectedSubject(subj.code)}
                  className="group flex min-h-[132px] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left transition-all hover:border-blue-400 hover:bg-blue-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl border ${subj.accentBg} ${subj.accentBorder} ${subj.accentText} shrink-0`}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <span className="font-mono text-xs font-semibold text-slate-400">
                      {subj.shortCode}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-800 transition-colors">
                      {subj.bnName}
                    </h3>
                    <div className="mt-1 flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>
                        {subj.enName} · {toBanglaDigits(count)}টি সক্রিয় পরীক্ষা
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-700"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};
