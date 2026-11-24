import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  Zap,
  Printer,
  ArrowLeft,
  CloudCheck,
  RefreshCw,
  BookOpen,
  Lightbulb,
  BarChart3,
} from 'lucide-react';
import { ExamReport } from '../types/exam';
import {
  BANGLA_OPTION_LABELS,
  formatClock,
  toBanglaDigits,
} from '../utils/examEngine';

interface ExamReportViewProps {
  report: ExamReport;
  syncStatus: 'sending' | 'sent' | 'failed';
  syncError?: string;
  onRetrySync: () => void;
  onBackToPortal: () => void;
}

type ReviewFilter = 'all' | 'wrong' | 'correct' | 'unanswered';

export const ExamReportView: React.FC<ExamReportViewProps> = ({
  report,
  syncStatus,
  syncError,
  onRetrySync,
  onBackToPortal,
}) => {
  const [filter, setFilter] = useState<ReviewFilter>('all');

  const filteredQuestions = useMemo(() => {
    return report.exam.questions
      .map((q, idx) => ({
        question: q,
        attempt: report.attempts[idx],
        index: idx,
      }))
      .filter(({ question, attempt }) => {
        if (filter === 'all') return true;
        if (filter === 'unanswered') return attempt.selectedOption === null;
        if (filter === 'correct') return attempt.selectedOption === question.answer;
        return attempt.selectedOption !== null && attempt.selectedOption !== question.answer;
      });
  }, [report, filter]);

  return (
    <main className="print-only-container mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Top Action Bar */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToPortal}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>শিক্ষার্থী পোর্টালে ফিরুন</span>
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          <span>রিপোর্ট প্রিন্ট / PDF সংরক্ষণ</span>
        </button>
      </div>

      {/* Point 1 & 3: Score, Percentage, Student Identity & Assessment Header */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold text-blue-700">
              ১০-পয়েন্টের পূর্ণাঙ্গ বাংলা ফলাফল রিপোর্ট
              {report.autoSubmitted ? ' · সময় শেষ হওয়ায় স্বয়ংক্রিয় সাবমিট' : ''}
            </p>
            <h1 className="mt-1.5 text-xl font-bold text-slate-900 sm:text-2xl">
              {report.exam.examTitle}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              শিক্ষার্থী: <strong className="text-slate-900">{report.student.studentName}</strong>
              <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
              রোল/ব্যাচ: <strong className="text-slate-900">{report.student.studentRoll}</strong>
            </p>
          </div>

          <div className="flex items-baseline gap-5 border-t border-slate-100 pt-4 md:border-t-0 md:pt-0">
            <div>
              <div className="text-xs font-medium text-slate-500">প্রাপ্ত নম্বর</div>
              <div className="mt-0.5 text-3xl font-bold text-slate-900 tabular-nums sm:text-4xl">
                {toBanglaDigits(report.score)}
                <span className="text-lg font-medium text-slate-400">
                  /{toBanglaDigits(report.totalQuestions)}
                </span>
              </div>
            </div>
            <div className="h-10 w-px bg-slate-200" aria-hidden="true" />
            <div>
              <div className="text-xs font-medium text-slate-500">শতকরা হার</div>
              <div className="mt-0.5 text-3xl font-bold text-blue-700 tabular-nums sm:text-4xl">
                {toBanglaDigits(report.percentage)}%
              </div>
            </div>
          </div>
        </div>

        {/* Point 2: Correct / Wrong / Unanswered Breakdown */}
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-100 pt-6">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>সঠিক উত্তর</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-emerald-900 tabular-nums">
              {toBanglaDigits(report.correct)}
            </div>
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50/60 p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
              <XCircle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
              <span>ভুল উত্তর</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-red-900 tabular-nums">
              {toBanglaDigits(report.wrong)}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <MinusCircle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
              <span>অনুত্তরিত</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-amber-900 tabular-nums">
              {toBanglaDigits(report.unanswered)}
            </div>
          </div>
        </div>

        {/* Point 3 (Detailed Assessment) & Point 4 (Time & Bonus Bank Analytics) */}
        <div className="mt-6 grid grid-cols-1 gap-6 border-t border-slate-100 pt-6 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-slate-500">সামগ্রিক মূল্যায়ন ও গ্রেড</div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {report.gradeLabel} — {report.assessmentTitle}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              {report.assessmentMessage}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>মোট ব্যয়িত সময়</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
                {toBanglaDigits(formatClock(report.totalTimeUsedSec))} মি.
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>গড় সময় / প্রশ্ন</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
                {toBanglaDigits(report.avgTimePerAnsweredSec)} সেকেন্ড
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Zap className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                <span>বোনাস ব্যাংক সঞ্চয়</span>
              </div>
              <div className="mt-1 text-base font-bold text-blue-700 tabular-nums">
                +{toBanglaDigits(report.totalBankEarnedSec)} সে.
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Zap className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <span>বোনাস ব্যাংক ব্যবহার</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
                {toBanglaDigits(report.totalBankUsedSec)} সে.
              </div>
            </div>
          </div>
        </div>

        {/* Point 7: Google Sheet Auto-POST Webhook Status */}
        <div className="no-print mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs">
          {syncStatus === 'sending' && (
            <span className="font-medium text-slate-600">
              শিক্ষকের ফলাফল শিটে ডেটা পাঠানো হচ্ছে...
            </span>
          )}
          {syncStatus === 'sent' && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
              <CloudCheck className="h-4 w-4" aria-hidden="true" />
              <span>ফলাফল স্বয়ংক্রিয়ভাবে শিক্ষকের গুগল শিটে সংরক্ষিত হয়েছে</span>
            </span>
          )}
          {syncStatus === 'failed' && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-red-700">
                শিটে ফলাফল পাঠানো যায়নি: {syncError || 'নেটওয়ার্ক সমস্যা'}
              </span>
              <button
                type="button"
                onClick={onRetrySync}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1 font-semibold text-red-800 hover:bg-red-100 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>আবার পাঠান</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Point 5 (Topic-wise Progress Bars) & Point 6 (Difficulty Breakdown) */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <BarChart3 className="h-4.5 w-4.5 text-blue-700" aria-hidden="true" />
            <span>টপিকভিত্তিক দক্ষতা ও অগ্রগতি বার</span>
          </h2>
          <div className="mt-4 grid max-h-[380px] grid-cols-1 gap-x-6 gap-y-3.5 overflow-y-auto pr-2 sm:grid-cols-2 print:max-h-none print:overflow-visible">
            {report.topicStats.map((t) => {
              const barColor =
                t.percentage >= 75
                  ? 'bg-emerald-600'
                  : t.percentage >= 50
                  ? 'bg-blue-600'
                  : 'bg-red-600';
              return (
                <div key={t.topic}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-semibold text-slate-800" title={t.topic}>
                      {t.topic}
                    </span>
                    <span className="text-xs font-semibold text-slate-600 tabular-nums shrink-0">
                      {toBanglaDigits(t.correct)}/{toBanglaDigits(t.total)} ({toBanglaDigits(t.percentage)}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${t.percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-6">
          {/* Point 6: Difficulty Breakdown */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-slate-900">কাঠিন্যস্তর ভিত্তিক বিশ্লেষণ</h2>
            <div className="mt-4 space-y-3">
              {report.difficultyStats.map((d) => (
                <div
                  key={d.difficulty}
                  className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0 text-sm"
                >
                  <span className="font-semibold text-slate-800">{d.difficulty}</span>
                  <span className="text-xs font-semibold text-slate-600 tabular-nums">
                    সঠিক {toBanglaDigits(d.correct)}/{toBanglaDigits(d.total)} · {toBanglaDigits(d.percentage)}%
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Point 8: Personalized Bangla Revision Tips */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Lightbulb className="h-4.5 w-4.5 text-amber-600" aria-hidden="true" />
              <span>রিভিশন ও উন্নতির পরামর্শ</span>
            </h2>
            <ul className="mt-3.5 space-y-2.5 text-sm leading-relaxed text-slate-700">
              {report.revisionTips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-xs font-bold text-blue-700 tabular-nums pt-1">
                    {toBanglaDigits(i + 1)}.
                  </span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* Point 9: Full Question-by-Question Review & Bangla Explanations */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <BookOpen className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <span>পূর্ণাঙ্গ উত্তরপত্র ও ব্যাখ্যা</span>
          </h2>

          {/* Interactive Filter Controls */}
          <div className="no-print flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ['all', `সব (${toBanglaDigits(report.totalQuestions)})`],
                ['wrong', `ভুল (${toBanglaDigits(report.wrong)})`],
                ['correct', `সঠিক (${toBanglaDigits(report.correct)})`],
                ['unanswered', `অনুত্তরিত (${toBanglaDigits(report.unanswered)})`],
              ] as [ReviewFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {filteredQuestions.map(({ question, attempt, index }) => {
            const isCorrect = attempt.selectedOption === question.answer;
            const isUnanswered = attempt.selectedOption === null;

            return (
              <article
                key={question.id}
                className="print-break-inside-avoid border-t border-slate-200 pt-5 first:border-t-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 tabular-nums">
                      প্রশ্ন {toBanglaDigits(index + 1)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{question.topic}</span>
                    <span aria-hidden="true">·</span>
                    <span>{question.difficulty}</span>
                    {question.source && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{question.source}</span>
                      </>
                    )}
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      isCorrect
                        ? 'text-emerald-700'
                        : isUnanswered
                        ? 'text-amber-700'
                        : 'text-red-700'
                    }`}
                  >
                    {isCorrect ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> সঠিক
                      </>
                    ) : isUnanswered ? (
                      <>
                        <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" /> অনুত্তরিত
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> ভুল
                      </>
                    )}
                  </span>
                </div>

                <h3 className="mt-2 text-base font-bold leading-relaxed text-slate-900">
                  {question.question}
                </h3>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {question.options.map((opt, optIdx) => {
                    const isAns = optIdx === question.answer;
                    const isPicked = optIdx === attempt.selectedOption;

                    let boxClass = 'border-slate-200 bg-white text-slate-700';
                    if (isAns) {
                      boxClass = 'border-emerald-500 bg-emerald-50 text-emerald-950 font-semibold';
                    } else if (isPicked && !isAns) {
                      boxClass = 'border-red-400 bg-red-50 text-red-950 font-semibold';
                    }

                    return (
                      <div
                        key={optIdx}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${boxClass}`}
                      >
                        <span className="flex items-start gap-2">
                          <span className="font-bold shrink-0">
                            ({BANGLA_OPTION_LABELS[optIdx]})
                          </span>
                          <span>{opt}</span>
                        </span>
                        {isAns && (
                          <span className="text-xs font-bold text-emerald-700 shrink-0">
                            সঠিক
                          </span>
                        )}
                        {isPicked && !isAns && (
                          <span className="text-xs font-bold text-red-700 shrink-0">
                            আপনার উত্তর
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {question.explanation && (
                  <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
                    <strong className="text-slate-900">ব্যাখ্যা: </strong>
                    {question.explanation}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
};
