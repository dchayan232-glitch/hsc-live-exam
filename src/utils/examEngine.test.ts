import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialLiveExamState,
  lockAnswerOption,
  tickLiveExam,
  submitLiveExam,
  buildExamReport,
  parseAndValidateExamJson,
  toBanglaDigits,
  formatClock,
  QUESTION_BASE_SECONDS,
  OVERALL_EXAM_SECONDS,
} from './examEngine';
import type { ExamDocument } from '../types/exam';

function makeMockExam(count = 30): ExamDocument {
  const diffs = ['সহজ', 'মধ্যম', 'কঠিন'] as const;
  return {
    id: 'test-physics-1',
    subject: 'Physics',
    examTitle: 'পদার্থবিজ্ঞান ১ম পত্র — অধ্যায় ২: ভেক্টর',
    isActive: true,
    sourceType: 'seed',
    questionCount: count,
    createdBy: 'seed',
    questions: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      topic: i % 2 === 0 ? 'ভেক্টর বিভাজন' : 'ডট ও ক্রস গুণন',
      difficulty: diffs[i % 3],
      source: 'তপন স্যার',
      question: `প্রশ্ন ${i + 1}`,
      options: ['অপশন ক', 'অপশন খ', 'অপশন গ', 'অপশন ঘ'],
      answer: i % 4,
      explanation: `ব্যাখ্যা ${i + 1}`,
    })),
  };
}

test('Bangla digit conversion and clock formatting', () => {
  assert.equal(toBanglaDigits(2026), '২০২৬');
  assert.equal(toBanglaDigits('04:15'), '০৪:১৫');
  assert.equal(formatClock(1200), '20:00');
  assert.equal(formatClock(40), '00:40');
});

test('One-time option lock carries unused seconds into Bonus Time Bank and blocks edits', () => {
  let state = createInitialLiveExamState(30);
  // Spend 12 seconds on question 0 -> 28 seconds left
  for (let s = 0; s < 12; s++) {
    state = tickLiveExam(state);
  }
  assert.equal(state.attempts[0].remainingSec, QUESTION_BASE_SECONDS - 12);
  assert.equal(state.overallRemainingSec, OVERALL_EXAM_SECONDS - 12);

  // Lock answer option 2
  state = lockAnswerOption(state, 0, 2);
  assert.equal(state.attempts[0].selectedOption, 2);
  assert.equal(state.attempts[0].remainingSec, 0);
  assert.equal(state.bonusBankSec, 28);
  assert.equal(state.totalBankEarnedSec, 28);

  // Attempt to change answer -> MUST stay locked at 2
  const attemptedChange = lockAnswerOption(state, 0, 1);
  assert.equal(attemptedChange.attempts[0].selectedOption, 2);
  assert.equal(attemptedChange.bonusBankSec, 28);
});

test('Bonus Time Bank sustains unanswered question past 40s before expiring and auto-advancing', () => {
  let state = createInitialLiveExamState(3);
  // Answer Q0 after 35s -> +5s into Bonus Bank
  for (let s = 0; s < 35; s++) state = tickLiveExam(state);
  state = lockAnswerOption(state, 0, 0);
  assert.equal(state.bonusBankSec, 5);

  // Move to Q1
  state = { ...state, currentIndex: 1 };
  // Tick 40s on Q1 -> Q1 own timer hits 0, bonusBank still 5 so NOT expired yet
  for (let s = 0; s < 40; s++) state = tickLiveExam(state);
  assert.equal(state.attempts[1].remainingSec, 0);
  assert.equal(state.attempts[1].expired, false);
  assert.equal(state.bonusBankSec, 5);

  // Tick 3 more seconds -> draws from bonusBank (down to 2)
  for (let s = 0; s < 3; s++) state = tickLiveExam(state);
  assert.equal(state.bonusBankSec, 2);
  assert.equal(state.attempts[1].bankUsedSec, 3);
  assert.equal(state.attempts[1].expired, false);

  // Tick 2 final seconds -> bonusBank hits 0, Q1 expires & auto-advances to Q2
  state = tickLiveExam(state);
  state = tickLiveExam(state);
  assert.equal(state.bonusBankSec, 0);
  assert.equal(state.attempts[1].expired, true);
  assert.equal(state.currentIndex, 2);
});

test('Overall timer reaching zero triggers automatic submission', () => {
  let state = createInitialLiveExamState(5);
  state = { ...state, overallRemainingSec: 1 };
  state = tickLiveExam(state);
  assert.equal(state.overallRemainingSec, 0);
  assert.equal(state.submitted, true);
  assert.equal(state.autoSubmitted, true);
});

test('buildExamReport computes exact score, percentage, topic stats, and Apps Script payload', () => {
  const exam = makeMockExam(4);
  let state = createInitialLiveExamState(4);
  // Q0 answer=0 -> choose 0 (correct)
  state = lockAnswerOption(state, 0, 0);
  // Q1 answer=1 -> choose 1 (correct)
  state = lockAnswerOption(state, 1, 1);
  // Q2 answer=2 -> choose 3 (wrong)
  state = lockAnswerOption(state, 2, 3);
  // Q3 unanswered
  state = submitLiveExam(state, false);

  const report = buildExamReport(
    exam,
    { studentName: 'তানভীর আহমেদ', studentRoll: 'HSC-26-104' },
    state
  );

  assert.equal(report.correct, 2);
  assert.equal(report.wrong, 1);
  assert.equal(report.unanswered, 1);
  assert.equal(report.score, 2);
  assert.equal(report.percentage, 50);
  assert.equal(report.topicStats.length, 2);
  assert.equal(report.revisionTips.length >= 2, true);
  assert.deepEqual(report.webhookPayload, {
    subject: exam.examTitle,
    studentName: 'তানভীর আহমেদ',
    studentRoll: 'HSC-26-104',
    score: 2,
    percentage: 50,
    correct: 2,
    wrong: 1,
    unanswered: 1,
  });
});

test('parseAndValidateExamJson accepts valid schema and rejects malformed payloads', () => {
  const validJson = JSON.stringify({
    subject: 'Physics',
    examTitle: 'পদার্থবিজ্ঞান ১ম পত্র - গতিবিদ্যা',
    questions: [
      {
        id: 1,
        topic: 'প্রাস',
        difficulty: 'সহজ',
        source: 'বোর্ড বই',
        question: 'প্রাসের সর্বাধিক উচ্চতায় বেগের উল্লম্ব উপাংশ কত?',
        options: ['শূন্য', 'সর্বোচ্চ', 'ধ্রুবক', 'ঋণাত্মক'],
        answer: 0,
        explanation: 'সর্বাধিক উচ্চতায় উল্লম্ব বেগ শূন্য হয়।',
      },
    ],
  });
  const okRes = parseAndValidateExamJson(validJson);
  assert.equal(okRes.ok, true);
  if (okRes.ok) {
    assert.equal(okRes.data.subject, 'Physics');
    assert.equal(okRes.data.questions.length, 1);
  }

  const badAnswer = parseAndValidateExamJson(
    JSON.stringify({
      subject: 'Physics',
      examTitle: 'Test',
      questions: [
        {
          id: 1,
          topic: 'T',
          difficulty: 'সহজ',
          source: 'S',
          question: 'Q?',
          options: ['A', 'B', 'C', 'D'],
          answer: 5,
          explanation: 'E',
        },
      ],
    })
  );
  assert.equal(badAnswer.ok, false);
});
