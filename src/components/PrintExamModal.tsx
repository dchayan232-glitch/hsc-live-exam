import React, { useState } from 'react';
import { Printer, X, FileText, KeyRound } from 'lucide-react';
import { ExamDocument, SUBJECT_MAP } from '../types/exam';
import { BANGLA_OPTION_LABELS, toBanglaDigits } from '../utils/examEngine';

interface PrintExamModalProps {
  exam: ExamDocument;
  onClose: () => void;
}

export const PrintExamModal: React.FC<PrintExamModalProps> = ({ exam, onClose }) => {
  const [viewMode, setViewMode] = useState<'paper' | 'answerKey'>('paper');
  const subj = SUBJECT_MAP[exam.subject];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-3 sm:p-6 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-exam-title"
    >
      <div className="print-only-container mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Sticky Modal Controls (hidden on print) */}
        <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-slate-200 bg-white/95 px-5 py-3.5 backdrop-blur-md">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('paper')}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                viewMode === 'paper'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>প্রশ্নপত্র (Question Paper)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('answerKey')}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                viewMode === 'answerKey'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>উত্তরপত্র ও ব্যাখ্যা (Answer Key)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>প্রিন্ট / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              aria-label="প্রিন্ট প্রিভিউ বন্ধ করুন"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Body */}
        <div className="p-6 sm:p-10">
          <div className="border-b-2 border-slate-900 pb-4 text-center">
            <p className="text-xs font-semibold text-slate-600">
              এইচএসসি মডেল টেস্ট · {subj.bnName} ({subj.enName})
            </p>
            <h1 id="print-exam-title" className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
              {exam.examTitle}
            </h1>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs font-semibold text-slate-700">
              <span>পূর্ণমান: {toBanglaDigits(exam.questions.length)}</span>
              <span>সময়: ২০ মিনিট</span>
              <span>
                কপি: {viewMode === 'paper' ? 'শিক্ষার্থীর প্রশ্নপত্র' : 'শিক্ষকের উত্তরপত্র ও ব্যাখ্যা'}
              </span>
            </div>
          </div>

          {viewMode === 'answerKey' && (
            <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-bold text-slate-900">সংক্ষিপ্ত উত্তরমালা (Answer Key)</h2>
              <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10 text-xs tabular-nums">
                {exam.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center font-semibold text-slate-900"
                  >
                    {toBanglaDigits(idx + 1)}. {BANGLA_OPTION_LABELS[q.answer]}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div
            className={`mt-6 ${
              viewMode === 'paper'
                ? 'grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2'
                : 'space-y-5'
            }`}
          >
            {exam.questions.map((q, idx) => (
              <article key={q.id} className="print-break-inside-avoid">
                <p className="text-sm font-bold leading-relaxed text-slate-900">
                  <span className="tabular-nums">{toBanglaDigits(idx + 1)}.</span> {q.question}
                </p>

                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 pl-4 text-sm text-slate-800">
                  {q.options.map((opt, optIdx) => {
                    const isAns = viewMode === 'answerKey' && optIdx === q.answer;
                    return (
                      <div
                        key={optIdx}
                        className={isAns ? 'font-bold text-emerald-800 underline decoration-emerald-600' : ''}
                      >
                        ({BANGLA_OPTION_LABELS[optIdx]}) {opt}
                      </div>
                    );
                  })}
                </div>

                {viewMode === 'answerKey' && (
                  <div className="mt-2 ml-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 border border-slate-200">
                    <span className="font-semibold text-slate-900">
                      সঠিক উত্তর: ({BANGLA_OPTION_LABELS[q.answer]}) · টপিক: {q.topic} · মান: {q.difficulty}
                    </span>
                    {q.explanation && <p className="mt-1">ব্যাখ্যা: {q.explanation}</p>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
