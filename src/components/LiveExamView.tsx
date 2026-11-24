import React, { useEffect, useState } from 'react';
import {
  Clock,
  Lock,
  ChevronLeft,
  ChevronRight,
  Grid2x2,
  Send,
  Zap,
  X,
  AlertTriangle,
} from 'lucide-react';
import { ExamDocument, LiveExamState, StudentInfo } from '../types/exam';
import {
  BANGLA_OPTION_LABELS,
  QUESTION_BASE_SECONDS,
  createInitialLiveExamState,
  formatClock,
  lockAnswerOption,
  submitLiveExam,
  tickLiveExam,
  toBanglaDigits,
} from '../utils/examEngine';

interface LiveExamViewProps {
  exam: ExamDocument;
  student: StudentInfo;
  onComplete: (finalState: LiveExamState) => void;
}

export const LiveExamView: React.FC<LiveExamViewProps> = ({ exam, student, onComplete }) => {
  const [liveState, setLiveState] = useState<LiveExamState>(() =>
    createInitialLiveExamState(exam.questions.length)
  );
  const [showNavDrawer, setShowNavDrawer] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  // Strict 1-second timer loop
  useEffect(() => {
    if (liveState.submitted) return;
    const interval = window.setInterval(() => {
      setLiveState((prev) => tickLiveExam(prev));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [liveState.submitted]);

  // Notify parent when submitted (manual or auto-submit)
  useEffect(() => {
    if (liveState.submitted) {
      onComplete(liveState);
    }
  }, [liveState, onComplete]);

  const currentQuestion = exam.questions[liveState.currentIndex];
  const currentAttempt = liveState.attempts[liveState.currentIndex];
  const answeredCount = liveState.attempts.filter((a) => a.selectedOption !== null).length;
  const totalQuestions = exam.questions.length;

  const isLocked = currentAttempt.selectedOption !== null;
  const isExpired = currentAttempt.expired;
  const isUsingBonusBank =
    !isLocked && !isExpired && currentAttempt.remainingSec === 0 && liveState.bonusBankSec > 0;

  const questionProgressPct = isLocked
    ? 100
    : isUsingBonusBank
    ? 100
    : Math.max(0, Math.min(100, (currentAttempt.remainingSec / QUESTION_BASE_SECONDS) * 100));

  const overallCritical = liveState.overallRemainingSec <= 60;
  const overallWarning = liveState.overallRemainingSec <= 180 && !overallCritical;

  const handleSelectOption = (optionIdx: number) => {
    setLiveState((prev) => lockAnswerOption(prev, prev.currentIndex, optionIdx));
  };

  const handleJumpTo = (idx: number) => {
    setLiveState((prev) => ({ ...prev, currentIndex: idx }));
    setShowNavDrawer(false);
  };

  const handleManualSubmit = () => {
    setShowSubmitConfirm(false);
    setLiveState((prev) => submitLiveExam(prev, false));
  };

  const renderNavigatorGrid = () => (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-5">
      {exam.questions.map((q, idx) => {
        const att = liveState.attempts[idx];
        const isCurrent = idx === liveState.currentIndex;
        const isAns = att.selectedOption !== null;
        const isExp = att.expired;

        let styleClass = 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
        if (isAns) {
          // Neutral blue locked state — zero right/wrong color reveal
          styleClass = 'border-blue-600 bg-blue-600 text-white';
        } else if (isExp) {
          styleClass = 'border-slate-200 bg-slate-200 text-slate-500';
        }

        return (
          <button
            key={q.id}
            type="button"
            onClick={() => handleJumpTo(idx)}
            aria-label={`প্রশ্ন ${toBanglaDigits(idx + 1)} ${isAns ? '(উত্তর লকড)' : isExp ? '(সময় শেষ)' : '(বাকি)'}`}
            aria-current={isCurrent ? 'step' : undefined}
            className={`flex min-h-[42px] items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors cursor-pointer ${styleClass} ${
              isCurrent ? 'ring-2 ring-slate-900 ring-offset-1' : ''
            }`}
          >
            {toBanglaDigits(idx + 1)}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 lg:pb-10">
      {/* Compact Sticky Exam HUD (strictly < 15% mobile viewport height) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6">
          {/* Overall 20:00 Timer */}
          <div className="flex items-center gap-3 sm:gap-5">
            <div
              className={`flex items-center gap-1.5 text-sm font-bold tabular-nums sm:text-base ${
                overallCritical
                  ? 'text-red-700'
                  : overallWarning
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
              aria-label="মোট অবশিষ্ট সময়"
            >
              <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{toBanglaDigits(formatClock(liveState.overallRemainingSec))}</span>
            </div>

            <span className="h-4 w-px bg-slate-200" aria-hidden="true" />

            {/* Bonus Time Bank */}
            <div
              className={`flex items-center gap-1 text-xs font-semibold tabular-nums sm:text-sm ${
                isUsingBonusBank ? 'text-amber-700' : 'text-blue-700'
              }`}
              title="বোনাস টাইম ব্যাংক"
              aria-label="বোনাস টাইম ব্যাংক"
            >
              <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline font-semibold">বোনাস ব্যাংক:</span>
              <span>+{toBanglaDigits(liveState.bonusBankSec)}সে.</span>
            </div>
          </div>

          {/* Answered counter + Navigator Toggle + Submit */}
          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-xs font-medium text-slate-500 truncate max-w-[200px]">
              {student.studentName} ({student.studentRoll})
            </span>
            <button
              type="button"
              onClick={() => setShowNavDrawer(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 lg:hidden cursor-pointer"
              aria-label="প্রশ্ন নেভিগেটর খুলুন"
            >
              <Grid2x2 className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">
                {toBanglaDigits(answeredCount)}/{toBanglaDigits(totalQuestions)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowSubmitConfirm(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer sm:text-sm"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span>সাবমিট</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area: Responsive 2-Column Layout on Desktop */}
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 pt-5 sm:px-6 lg:grid-cols-[1fr_296px] lg:pt-8">
        {/* Question Card Column */}
        <section aria-live="polite" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-500">
            <span className="truncate max-w-full">{exam.examTitle}</span>
            <span className="tabular-nums text-slate-600">
              উত্তর লকড: {toBanglaDigits(answeredCount)} / {toBanglaDigits(totalQuestions)}
            </span>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            {/* Per-question header & 40s timer bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <span className="font-bold text-slate-900 tabular-nums">
                  প্রশ্ন {toBanglaDigits(liveState.currentIndex + 1)} / {toBanglaDigits(totalQuestions)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{currentQuestion.topic}</span>
              </div>

              <div
                className={`text-sm font-bold tabular-nums ${
                  isLocked
                    ? 'text-blue-700'
                    : isExpired
                    ? 'text-slate-500'
                    : isUsingBonusBank
                    ? 'text-amber-700'
                    : currentAttempt.remainingSec <= 10
                    ? 'text-red-600'
                    : 'text-slate-900'
                }`}
              >
                {isLocked ? (
                  <span className="inline-flex items-center gap-1 font-sans text-xs font-semibold">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    লকড
                    {currentAttempt.bankSavedSec > 0
                      ? ` (+${toBanglaDigits(currentAttempt.bankSavedSec)}সে. বোনাস)`
                      : ''}
                  </span>
                ) : isExpired ? (
                  <span className="font-sans text-xs font-semibold">সময় শেষ (অনুত্তরিত)</span>
                ) : isUsingBonusBank ? (
                  <span className="font-sans text-xs font-semibold">
                    বোনাস ব্যাংক চলছে (+{toBanglaDigits(liveState.bonusBankSec)}সে.)
                  </span>
                ) : (
                  <span>{toBanglaDigits(currentAttempt.remainingSec)} সেকেন্ড</span>
                )}
              </div>
            </div>

            {/* Thin Per-question Progress Track */}
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full transition-all duration-300 ${
                  isLocked
                    ? 'bg-blue-600'
                    : isExpired
                    ? 'bg-slate-300'
                    : isUsingBonusBank
                    ? 'bg-amber-500'
                    : currentAttempt.remainingSec <= 10
                    ? 'bg-red-600'
                    : 'bg-blue-700'
                }`}
                style={{ width: `${questionProgressPct}%` }}
              />
            </div>

            {/* Question Text */}
            <h1 className="mt-5 text-lg font-bold leading-relaxed text-slate-900 sm:text-xl">
              {currentQuestion.question}
            </h1>

            {/* 4 Options with Neutral Blue One-Time Lock */}
            <div className="mt-6 space-y-3" role="group" aria-label="উত্তরের অপশনসমূহ">
              {currentQuestion.options.map((optText, optIdx) => {
                const isSelected = currentAttempt.selectedOption === optIdx;
                const isDisabled = isLocked || isExpired;

                return (
                  <button
                    key={optIdx}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSelectOption(optIdx)}
                    aria-pressed={isSelected}
                    className={`flex w-full min-h-[54px] items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left text-base transition-all ${
                      isSelected
                        ? 'border-2 border-blue-600 bg-blue-50 text-blue-950 font-semibold'
                        : isDisabled
                        ? 'border-slate-200 bg-slate-50/70 text-slate-500 cursor-not-allowed'
                        : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-blue-50/40 cursor-pointer active:scale-[0.995]'
                    }`}
                  >
                    <span className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold shrink-0 ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {BANGLA_OPTION_LABELS[optIdx]}
                      </span>
                      <span className="leading-snug">{optText}</span>
                    </span>

                    {isSelected && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 shrink-0">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>লকড</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {isExpired && !isLocked && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900">
                এই প্রশ্নের নির্ধারিত সময় শেষ হওয়ায় অপশন নির্বাচন বন্ধ হয়ে গেছে। পরবর্তী প্রশ্নে যান।
              </p>
            )}

            {/* Prev / Next Navigation Footer */}
            <div className="mt-7 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                disabled={liveState.currentIndex === 0}
                onClick={() => handleJumpTo(liveState.currentIndex - 1)}
                className="inline-flex min-h-[46px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span>পূর্ববর্তী</span>
              </button>

              {liveState.currentIndex < totalQuestions - 1 ? (
                <button
                  type="button"
                  onClick={() => handleJumpTo(liveState.currentIndex + 1)}
                  className="inline-flex min-h-[46px] items-center gap-1.5 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 cursor-pointer"
                >
                  <span>পরবর্তী প্রশ্ন</span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSubmitConfirm(true)}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 cursor-pointer"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>পরীক্ষা জমা দিন</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Desktop 1-30 Navigator Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">প্রশ্ন নেভিগেটর (১–{toBanglaDigits(totalQuestions)})</h2>
              <span className="text-xs font-semibold text-slate-500 tabular-nums">
                {toBanglaDigits(answeredCount)}/{toBanglaDigits(totalQuestions)}
              </span>
            </div>

            <div className="mt-4">{renderNavigatorGrid()}</div>

            <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-xs bg-blue-600" aria-hidden="true" />
                <span>উত্তর লকড (নীল)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-xs border border-slate-300 bg-white" aria-hidden="true" />
                <span>অবশিষ্ট প্রশ্ন</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-xs bg-slate-200" aria-hidden="true" />
                <span>সময় শেষ (অনুত্তরিত)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSubmitConfirm(true)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 cursor-pointer"
            >
              চূড়ান্ত সাবমিট করুন
            </button>
          </div>
        </aside>
      </main>

      {/* Mobile Bottom Sheet Navigator Drawer */}
      {showNavDrawer && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-xs lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-nav-title"
        >
          <div className="max-h-[82vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true" />
            <div className="flex items-center justify-between gap-4">
              <h2 id="mobile-nav-title" className="text-base font-bold text-slate-900">
                প্রশ্ন নেভিগেটর ({toBanglaDigits(answeredCount)}/{toBanglaDigits(totalQuestions)} লকড)
              </h2>
              <button
                type="button"
                onClick={() => setShowNavDrawer(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
                aria-label="নেভিগেটর বন্ধ করুন"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4">{renderNavigatorGrid()}</div>
          </div>
        </div>
      )}

      {/* Manual Submit Confirmation Modal */}
      {showSubmitConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 shrink-0">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="submit-confirm-title" className="text-lg font-bold text-slate-900">
                  পরীক্ষা চূড়ান্তভাবে জমা দেবেন?
                </h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  আপনি মোট <strong className="text-slate-900">{toBanglaDigits(answeredCount)}টি</strong> প্রশ্নের উত্তর লক করেছেন এবং{' '}
                  <strong className="text-slate-900">{toBanglaDigits(totalQuestions - answeredCount)}টি</strong> প্রশ্ন অনুত্তরিত আছে। জমা দেওয়ার পর পূর্ণাঙ্গ ১০-পয়েন্টের রিপোর্ট দেখতে পারবেন।
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                ফিরে যান
              </button>
              <button
                type="button"
                onClick={handleManualSubmit}
                className="min-h-[44px] rounded-xl bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                হ্যাঁ, সাবমিট করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
