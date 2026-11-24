import React, { useState } from 'react';
import { Lock, ArrowRight, AlertCircle, Shield } from 'lucide-react';

interface TeacherPinGateProps {
  onUnlock: (token: string, maxChunkBytes?: number) => void;
  onCancel: () => void;
}

export const TeacherPinGate: React.FC<TeacherPinGateProps> = ({ onUnlock, onCancel }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pin.trim();
    if (!cleaned) {
      setError('শিক্ষক অ্যাডমিন পিন লিখুন।');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/teacher/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleaned }),
      });
      const rawText = await res.text();
      let data: { ok?: boolean; token?: string; maxChunkBytes?: number; error?: string } = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (!res.ok || !data.token) {
        if (res.status === 404) {
          setError('ব্যাকএন্ড API (/api/teacher/verify-pin) পাওয়া যায়নি। অনুগ্রহ করে অ্যাপটি পুনরায় ডিপ্লয় করুন।');
        } else if (res.status >= 500 && !data.error) {
          setError(`সার্ভার ত্রুটি (${res.status})। কিছুক্ষণ পর আবার চেষ্টা করুন।`);
        } else {
          setError(data.error || 'ভুল পিন নম্বর! আবার চেষ্টা করুন।');
        }
        setSubmitting(false);
        return;
      }
      onUnlock(data.token, typeof data.maxChunkBytes === 'number' ? data.maxChunkBytes : undefined);
    } catch {
      setError('সার্ভারের সাথে সংযোগ করা যায়নি। পুনরায় চেষ্টা করুন।');
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[75vh] max-w-md items-center justify-center px-4 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>

        <h1 className="mt-4 text-xl font-bold text-slate-900">শিক্ষক অ্যাডমিন প্যানেল</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          PDF নলেজ বেস পরিচালনা, AI প্রশ্ন তৈরি, JSON ইমপোর্ট এবং পরীক্ষা নিয়ন্ত্রণের জন্য শিক্ষক পিন প্রবেশ করান।
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="teacher-pin-input" className="block text-sm font-semibold text-slate-800">
              অ্যাডমিন পিন
            </label>
            <input
              id="teacher-pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                if (error) setError('');
              }}
              placeholder="••••"
              maxLength={16}
              required
              className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 font-mono text-lg tracking-widest text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
          >
            <span>{submitting ? 'যাচাই করা হচ্ছে...' : 'প্যানেল আনলক করুন'}</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            শিক্ষার্থী পোর্টালে ফিরে যান
          </button>
        </form>

        <p className="mt-5 flex items-center gap-1.5 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <Shield className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <span>সার্ভার-ভেরিফাইড শিক্ষক সেশন সুরক্ষিতভাবে সংযুক্ত।</span>
        </p>
      </section>
    </main>
  );
};
