import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAttempt, expireAttempt, finishAttempt, remainingSeconds,
  roundHistoricalRaw, scoreAttempt, setAnswer, toggleMark, visitQuestion,
} from '../js/engine.js';

const START = 1_000_000;

function sampleExam(overrides = {}) {
  return {
    id: 'test-form',
    questionCount: 4,
    durationSeconds: 10,
    questions: ['A', 'B', 'C', 'D'].map((answer, index) => ({ number: index + 1, answer })),
    scoring: { method: 'quarter-penalty', conversion: [{ raw: 0, scaled: 200 }, { raw: 1, scaled: 300 }, { raw: 4, scaled: 900 }] },
    ...overrides,
  };
}

test('new attempts preserve independent answer, visit, and review state', () => {
  const first = createAttempt(sampleExam(), START);
  const second = createAttempt(sampleExam(), START);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.answers, [null, null, null, null]);
  assert.deepEqual(first.visited, [true, false, false, false]);
  assert.equal(first.deadline, START + 10_000);
  setAnswer(first, 0, 'B', START);
  toggleMark(first, 0, START);
  visitQuestion(first, 3, START);
  assert.deepEqual(first.answers, ['B', null, null, null]);
  assert.deepEqual(first.marked, [true, false, false, false]);
  assert.deepEqual(first.visited, [true, false, false, true]);
  assert.equal(first.current, 3);
  assert.deepEqual(second.answers, [null, null, null, null]);
  setAnswer(first, 0, null, START);
  assert.equal(first.answers[0], null);
  assert.equal(first.marked[0], true);
});

test('legacy scoring penalizes wrong answers, leaves omissions unpenalized, and rounds', () => {
  const exam = sampleExam();
  const attempt = createAttempt(exam, START);
  setAnswer(attempt, 0, 'A', START);
  setAnswer(attempt, 1, 'A', START);
  setAnswer(attempt, 2, 'A', START);
  toggleMark(attempt, 1, START);
  const score = scoreAttempt(exam, attempt);
  assert.equal(score.correct, 1);
  assert.equal(score.incorrect, 2);
  assert.equal(score.omitted, 1);
  assert.equal(score.accuracy, 0.25);
  assert.equal(score.answeredAccuracy, 1 / 3);
  assert.equal(score.currentRaw, 1);
  assert.equal(score.historicalRaw, 0.5);
  assert.equal(score.roundedRaw, 1);
  assert.equal(score.scaledScore, 300);
  assert.equal(score.conversionStatus, 'matched');
  assert.deepEqual(score.results[1], {
    index: 1, number: 2, selection: 'A', correctAnswer: 'B',
    status: 'incorrect', isCorrect: false, marked: true,
  });
  assert.equal(score.results[3].status, 'omitted');
  assert.equal(score.results[3].selection, null);
});

test('rounding follows nearest integer with half-points upward', () => {
  for (const [raw, expected] of [[1.25, 1], [1.5, 2], [1.75, 2], [-0.5, 0], [-0.75, -1], [-1.5, -1]]) {
    assert.equal(roundHistoricalRaw(raw), expected);
  }
});

test('number-correct scoring has no guessing penalty or invented scaled score', () => {
  const exam = sampleExam({ scoring: { method: 'number-correct' } });
  const attempt = createAttempt(exam, START);
  setAnswer(attempt, 0, 'A', START);
  setAnswer(attempt, 1, 'A', START);
  const score = scoreAttempt(exam, attempt);
  assert.equal(score.currentRaw, 1);
  assert.equal(score.historicalRaw, 1);
  assert.equal(score.roundedRaw, 1);
  assert.equal(score.scaledScore, null);
  assert.equal(score.conversionStatus, 'unavailable');
});

test('conversion never interpolates, clamps, or extrapolates a missing raw score', () => {
  const exam = sampleExam();
  const attempt = createAttempt(exam, START);
  setAnswer(attempt, 0, 'A', START);
  setAnswer(attempt, 1, 'B', START);
  const score = scoreAttempt(exam, attempt);
  assert.equal(score.roundedRaw, 2);
  assert.equal(score.scaledScore, null);
  assert.equal(score.conversionStatus, 'outside-table');
  for (let i = 0; i < attempt.answers.length; i++) setAnswer(attempt, i, 'E', START);
  assert.equal(scoreAttempt(exam, attempt).roundedRaw, -1);
  assert.equal(scoreAttempt(exam, attempt).scaledScore, null);
});

test('explicit conversion ranges are respected and conflicting rows rejected', () => {
  const exam = sampleExam({ scoring: { method: 'quarter-penalty', conversion: [{ rawMin: -4, rawMax: 0, scaled: 200 }] } });
  const attempt = createAttempt(exam, START);
  for (let i = 0; i < attempt.answers.length; i++) setAnswer(attempt, i, 'E', START);
  assert.equal(scoreAttempt(exam, attempt).scaledScore, 200);
  exam.scoring.conversion.push({ raw: -1, scaled: 210 });
  assert.equal(scoreAttempt(exam, attempt).scaledScore, null);
  assert.equal(scoreAttempt(exam, attempt).conversionStatus, 'ambiguous');
});

test('timer uses absolute deadline, even across suspended tabs and JSON restoration', () => {
  const original = createAttempt(sampleExam(), START);
  const attempt = JSON.parse(JSON.stringify(original));
  assert.equal(remainingSeconds(attempt, START), 10);
  assert.equal(remainingSeconds(attempt, START + 1), 10);
  assert.equal(remainingSeconds(attempt, START + 9_001), 1);
  assert.equal(expireAttempt(attempt, START + 9_999), false);
  assert.equal(expireAttempt(attempt, START + 80_000), true);
  assert.equal(attempt.status, 'finished');
  assert.equal(attempt.finishReason, 'time-expired');
  assert.equal(attempt.finishedAt, START + 10_000);
  assert.equal(remainingSeconds(attempt, START + 90_000), 0);
  assert.equal(expireAttempt(attempt, START + 90_000), false);
});

test('submission freezes answers and remaining time and is idempotent', () => {
  const attempt = createAttempt(sampleExam(), START);
  setAnswer(attempt, 0, 'A', START);
  finishAttempt(attempt, 'submitted', START + 2_500);
  assert.equal(remainingSeconds(attempt, START + 50_000), 8);
  assert.equal(attempt.finishedAt, START + 2_500);
  assert.equal(attempt.finishReason, 'submitted');
  finishAttempt(attempt, 'time-expired', START + 50_000);
  assert.equal(attempt.finishedAt, START + 2_500);
  assert.equal(attempt.finishReason, 'submitted');
  for (const mutate of [
    () => setAnswer(attempt, 0, 'B', START + 3_000),
    () => toggleMark(attempt, 0, START + 3_000),
    () => visitQuestion(attempt, 1, START + 3_000),
  ]) assert.throws(mutate, { code: 'ATTEMPT_CLOSED' });
  assert.equal(attempt.answers[0], 'A');
});

test('answers arriving at the exact deadline are rejected and finish the exam', () => {
  const attempt = createAttempt(sampleExam(), START);
  assert.throws(() => setAnswer(attempt, 0, 'A', START + 10_000), { code: 'ATTEMPT_CLOSED' });
  assert.equal(attempt.status, 'finished');
  assert.equal(attempt.finishReason, 'time-expired');
  assert.equal(attempt.answers[0], null);
});

test('late submission is recorded as timeout', () => {
  const attempt = createAttempt(sampleExam(), START);
  finishAttempt(attempt, 'submitted', START + 10_001);
  assert.equal(attempt.finishReason, 'time-expired');
  assert.equal(attempt.finishedAt, attempt.deadline);
});

test('invalid keys, question indices, exam shape, and mismatched attempts are rejected', () => {
  const exam = sampleExam();
  const attempt = createAttempt(exam, START);
  for (const answer of ['a', 'F', '', 0, undefined]) {
    assert.throws(() => setAnswer(attempt, 0, answer, START), RangeError);
  }
  for (const index of [-1, 4, 0.5, NaN]) {
    assert.throws(() => setAnswer(attempt, index, 'A', START), RangeError);
    assert.throws(() => visitQuestion(attempt, index, START), RangeError);
  }
  assert.throws(() => createAttempt(sampleExam({ questionCount: 5 }), START), RangeError);
  assert.throws(() => createAttempt(sampleExam({ durationSeconds: 0 }), START), RangeError);
  assert.throws(() => createAttempt(sampleExam(), NaN), TypeError);
  assert.throws(() => scoreAttempt({ ...exam, id: 'other-form' }, attempt), RangeError);
  exam.questions[0].answer = '?';
  assert.throws(() => scoreAttempt(exam, attempt), /valid answer key/);
});

test('exam length is data-driven, including 68-question historical forms', () => {
  const exam = sampleExam({ questionCount: 68, questions: Array.from({ length: 68 }, (_, index) => ({ number: index + 1, answer: 'A' })) });
  const attempt = createAttempt(exam, START);
  assert.equal(attempt.answers.length, 68);
  visitQuestion(attempt, 67, START);
  setAnswer(attempt, 67, 'A', START);
  assert.equal(scoreAttempt(exam, attempt).correct, 1);
  assert.equal(scoreAttempt(exam, attempt).omitted, 67);
});
