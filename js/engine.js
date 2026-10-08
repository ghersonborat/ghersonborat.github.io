/** Exam state and scoring, shared by the static browser app and Node tests. */
export const ANSWER_CHOICES = Object.freeze(['A', 'B', 'C', 'D', 'E']);
export const DEFAULT_DURATION_SECONDS = 170 * 60;

function assertTime(now) {
  if (!Number.isFinite(now)) throw new TypeError('Time must be a finite timestamp.');
}

function assertQuestion(attempt, index) {
  if (!Number.isInteger(index) || index < 0 || index >= attempt.answers.length) {
    throw new RangeError('Question index is outside this exam.');
  }
}

function assertActive(attempt, now) {
  expireAttempt(attempt, now);
  if (attempt.status !== 'active') {
    const error = new Error('This attempt has ended and its answers are locked.');
    error.code = 'ATTEMPT_CLOSED';
    throw error;
  }
}

/** Create an attempt. All timestamps are milliseconds since the Unix epoch. */
export function createAttempt(exam, now = Date.now()) {
  assertTime(now);
  if (!exam?.id || !Array.isArray(exam.questions) || exam.questions.length === 0) {
    throw new TypeError('An exam needs an ID and at least one question.');
  }
  if (exam.questionCount != null && exam.questionCount !== exam.questions.length) {
    throw new RangeError('The exam question count does not match its questions.');
  }
  const duration = exam.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Exam duration must be positive.');
  }
  const count = exam.questions.length;
  const visited = Array(count).fill(false);
  visited[0] = true;
  return {
    version: 1,
    id: globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`,
    examId: exam.id,
    startedAt: now,
    deadline: now + duration * 1000,
    finishedAt: null,
    finishReason: null,
    answers: Array(count).fill(null),
    marked: Array(count).fill(false),
    visited,
    current: 0,
    status: 'active',
  };
}

/** Remaining whole display seconds, based on a deadline rather than interval ticks. */
export function remainingSeconds(attempt, now = Date.now()) {
  assertTime(now);
  const reference = attempt.status === 'active' ? now : (attempt.finishedAt ?? now);
  return Math.max(0, Math.ceil((attempt.deadline - reference) / 1000));
}

/** End an attempt once. Calling again cannot change the recorded finish. */
export function finishAttempt(attempt, reason = 'submitted', now = Date.now()) {
  assertTime(now);
  if (attempt.status !== 'active') return attempt;
  if (!['submitted', 'time-expired'].includes(reason)) {
    throw new RangeError('Finish reason must be submitted or time-expired.');
  }
  const expired = now >= attempt.deadline || reason === 'time-expired';
  attempt.status = 'finished';
  attempt.finishedAt = expired ? attempt.deadline : Math.max(attempt.startedAt, now);
  attempt.finishReason = expired ? 'time-expired' : 'submitted';
  return attempt;
}

/** Catch up after a background tab, device sleep, reload, or missed timer tick. */
export function expireAttempt(attempt, now = Date.now()) {
  assertTime(now);
  if (attempt.status === 'active' && now >= attempt.deadline) {
    finishAttempt(attempt, 'time-expired', now);
    return true;
  }
  return false;
}

/** Store or clear an answer; answer letters stay independent of presentation. */
export function setAnswer(attempt, index, answer, now = Date.now()) {
  assertQuestion(attempt, index);
  if (answer !== null && !ANSWER_CHOICES.includes(answer)) {
    throw new RangeError('Answer must be A, B, C, D, E, or null.');
  }
  assertActive(attempt, now);
  attempt.answers[index] = answer;
  attempt.visited[index] = true;
  return attempt;
}

/** A review mark is independent of whether a question has been answered. */
export function toggleMark(attempt, index, now = Date.now()) {
  assertQuestion(attempt, index);
  assertActive(attempt, now);
  attempt.marked[index] = !attempt.marked[index];
  return attempt;
}

export function visitQuestion(attempt, index, now = Date.now()) {
  assertQuestion(attempt, index);
  assertActive(attempt, now);
  attempt.current = index;
  attempt.visited[index] = true;
  return attempt;
}

/** ETS legacy booklets round a half point upward, including negative halves. */
export function roundHistoricalRaw(raw) {
  if (!Number.isFinite(raw)) throw new TypeError('Raw score must be finite.');
  return Math.floor(raw + 0.5);
}

/** Use only supplied table entries or explicitly documented inclusive ranges. */
function convertScore(conversion, raw) {
  if (!Array.isArray(conversion) || conversion.length === 0) {
    return { scaledScore: null, conversionStatus: 'unavailable' };
  }
  const matches = conversion.filter((row) => {
    if (Number.isFinite(row.raw)) return row.raw === raw;
    return Number.isFinite(row.rawMin) && Number.isFinite(row.rawMax)
      && raw >= row.rawMin && raw <= row.rawMax;
  });
  const scores = [...new Set(matches.map((row) => row.scaled))];
  if (scores.length === 1 && Number.isFinite(scores[0])) {
    return { scaledScore: scores[0], conversionStatus: 'matched' };
  }
  return {
    scaledScore: null,
    conversionStatus: scores.length > 1 ? 'ambiguous' : 'outside-table',
  };
}

/**
 * Score using this particular exam's answer key and conversion table.
 * currentRaw reports number correct; historicalRaw applies that form's method.
 * A legacy conversion is a practice estimate, never an official current score.
 */
export function scoreAttempt(exam, attempt) {
  if (attempt.examId !== exam.id || attempt.answers.length !== exam.questions.length) {
    throw new RangeError('Attempt does not belong to this exam.');
  }
  const method = exam.scoring?.method ?? 'number-correct';
  if (!['quarter-penalty', 'number-correct'].includes(method)) {
    throw new RangeError('Unknown scoring method.');
  }
  const results = exam.questions.map((question, index) => {
    if (!ANSWER_CHOICES.includes(question.answer)) {
      throw new RangeError(`Question ${index + 1} has no valid answer key.`);
    }
    const selection = attempt.answers[index];
    if (selection !== null && !ANSWER_CHOICES.includes(selection)) {
      throw new RangeError(`Question ${index + 1} has an invalid saved answer.`);
    }
    const status = selection === null ? 'omitted' : selection === question.answer ? 'correct' : 'incorrect';
    return {
      index,
      number: question.number ?? index + 1,
      selection,
      correctAnswer: question.answer,
      status,
      isCorrect: status === 'correct',
      marked: Boolean(attempt.marked[index]),
    };
  });
  const correct = results.filter((item) => item.status === 'correct').length;
  const incorrect = results.filter((item) => item.status === 'incorrect').length;
  const omitted = results.length - correct - incorrect;
  const historicalRaw = correct - (method === 'quarter-penalty' ? incorrect * 0.25 : 0);
  const roundedRaw = roundHistoricalRaw(historicalRaw);
  return {
    total: results.length,
    correct,
    incorrect,
    omitted,
    answered: correct + incorrect,
    accuracy: results.length ? correct / results.length : 0,
    answeredAccuracy: correct + incorrect ? correct / (correct + incorrect) : 0,
    currentRaw: correct,
    historicalRaw,
    roundedRaw,
    scoringMethod: method,
    ...convertScore(exam.scoring?.conversion, roundedRaw),
    results,
  };
}
