import React from 'react';
import { Lock, GraduationCap } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type AppMode = 'student' | 'teacher';

interface HeaderProps {
  mode: AppMode;
  onSelectMode: (mode: AppMode) => void;
  teacherUnlocked: boolean;
  isLiveExamActive: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onSelectMode,
  teacherUnlocked,
  isLiveExamActive,
}) => {
  if (isLiveExamActive) {
    return null;
  }

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:h-16 sm:gap-8 sm:px-6">
        {/* Zone 1: Single-element Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectMode('student')}
          className="flex items-center gap-2.5 text-left text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer sm:text-lg"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-white shrink-0">
            <GraduationCap className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span>এইচএসসি লাইভ এমসিকিউ</span>
        </button>

        {/* Zone 2 & 3: Navigation links + contextual PWA Install action */}
        <div className="flex items-center gap-4 sm:gap-6">
          <nav aria-label="প্রধান নেভিগেশন" className="flex items-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={() => onSelectMode('student')}
              className={`min-h-[40px] px-1 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                mode === 'student'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              শিক্ষার্থী পোর্টাল
            </button>
            <button
              type="button"
              onClick={() => onSelectMode('teacher')}
              className={`inline-flex min-h-[40px] items-center gap-1.5 px-1 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                mode === 'teacher'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{teacherUnlocked ? 'শিক্ষক প্যানেল' : 'শিক্ষক অ্যাডমিন'}</span>
            </button>
          </nav>

          <div className="hidden sm:flex items-center shrink-0 empty:hidden">
            <PWAInstallButton />
          </div>
        </div>
      </div>
    </header>
  );
};
