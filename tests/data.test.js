import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAttempt, scoreAttempt, setAnswer } from '../js/engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(resolve(root, 'data/exams.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'scripts/exam_manifest.json'), 'utf8'));
const independentlyVerifiedRea = JSON.parse(await readFile(resolve(root, 'data/rea-verified-keys.json'), 'utf8'));
const START = 1_000_000;

// Fixed published-table checkpoints guard against using one form's scale for
// another. Positions refer to raw 0, 23, 25, 33, and 66 respectively.
const fixtures = {
  gr3768: { method: 'number-correct', key: ['A', 'A', 'B'], scale: [200, 480, 500, 580, 970] },
  gr1768: { method: 'number-correct', key: ['E', 'C', 'B'], scale: [280, 480, 500, 590, 910] },
  gr0568: { method: 'quarter-penalty', key: ['B', 'D', 'B'], scale: [390, 590, 600, 670, 900] },
  gr9768: { method: 'quarter-penalty', key: ['C', 'A', 'E'], scale: [360, 540, 560, 620, 890] },
  gr9367: { method: 'quarter-penalty', key: ['D', 'C', 'B'], scale: [420, 660, 680, 760, 990] },
  gr8767: { method: 'quarter-penalty', key: ['B', 'E', 'B'], scale: [410, 630, 650, 730, 990] },
};
const unofficialIds = ['princeton2010', ...Array.from({ length: 6 }, (_, i) => `rea-2012-${i + 1}`)];

async function readAsset(relative) {
  assert.equal(typeof relative, 'string');
  assert(!relative.startsWith('/') && !/^[a-z]+:/i.test(relative), `Asset must work under a GitHub Pages project path: ${relative}`);
  const full = resolve(root, relative);
  assert(full.startsWith(root + sep), `Asset escapes site root: ${relative}`);
  assert((await stat(full)).isFile(), `Missing asset: ${relative}`);
  const bytes = await readFile(full);
  assert(bytes.length > 0, `Empty asset: ${relative}`);
  return bytes;
}

test('all fourteen supplied PDFs are audited exactly once, including books containing multiple tests', async () => {
  assert.deepEqual(catalog.exams.map(e => e.id).sort(), [...Object.keys(fixtures), ...unofficialIds].sort());
  assert.equal(catalog.uniqueExamCount, 13);
  assert.equal(catalog.questionTotal, 857);
  assert.equal(catalog.sourceFileCount, 14);
  assert.equal(catalog.exams.filter(e => e.category === 'official').length, 6);
  assert.equal(catalog.exams.filter(e => e.category === 'unofficial').length, 7);
  const sourceDocuments = manifest.sourceDocuments;
  assert(Array.isArray(sourceDocuments), 'The manifest must audit each supplied source document');
  const sources = sourceDocuments.map(source => source.sourceFile);
  assert.equal(new Set(sources).size, sources.length, 'Each source document gets one audit record');
  const supplied = (await readdir(root)).filter(name => name.toLowerCase().endsWith('.pdf'));
  assert.deepEqual([...sources].sort(), [...supplied].sort());
  for (const source of sourceDocuments) {
    const bytes = await readAsset(source.sourceFile);
    if (source.sourceSha256) assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sourceSha256);
  }
  for (const exam of catalog.exams) {
    const hash = createHash('sha256').update(await readAsset(exam.sourceFile)).digest('hex');
    assert.equal(hash, exam.sourceSha256, `${exam.id}: source PDF changed`);
    assert(sources.includes(exam.sourceFile));
    for (const duplicate of exam.duplicateFiles || []) {
      assert(sources.includes(duplicate));
      await readAsset(duplicate);
    }
    assert(['official', 'unofficial'].includes(exam.category));
    assert(typeof exam.publisher === 'string' && exam.publisher.length > 0);
  }
});

test('all 857 questions retain their reviewed image, answer, and source mapping without duplicate full exams', async () => {
  const paths = new Set(), examFingerprints = new Set(), officialContents = new Set();
  for (const exam of catalog.exams) {
    const reviewed = manifest.exams.find(entry => entry.id === exam.id);
    assert(reviewed, `${exam.id}: no reviewed extraction manifest`);
    assert.equal(exam.durationSeconds, 10200);
    assert.equal(exam.questionCount, exam.id === 'princeton2010' ? 65 : 66);
    assert.equal(exam.questions.length, exam.questionCount);
    assert.deepEqual(exam.questions.map(q => q.number), Array.from({ length: exam.questionCount }, (_, i) => i + 1));
    const reviewedAnswers = Array.isArray(reviewed.answers) ? reviewed.answers.join('') : reviewed.answers;
    assert.equal(exam.questions.map(q => q.answer).join(''), reviewedAnswers, `${exam.id}: answer order differs from reviewed key`);
    if (fixtures[exam.id]) assert.deepEqual([0, 32, 65].map(i => exam.questions[i].answer), fixtures[exam.id].key);
    const fullExamHash = createHash('sha256');
    for (const [index, question] of exam.questions.entries()) {
      assert(/^[A-E]$/.test(question.answer));
      assert(Number.isInteger(question.sourcePage) && question.sourcePage > 0);
      assert.equal(question.sourcePage, reviewed.questions[index].sourcePage ?? reviewed.questions[index].segments?.[0]?.sourcePage);
      assert(question.imageWidth >= 200 && question.imageHeight >= 30);
      assert(!paths.has(question.image), `Repeated question asset path: ${question.image}`);
      paths.add(question.image);
      const bytes = await readAsset(question.image);
      assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', question.image);
      assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', question.image);
      const digest = createHash('sha256').update(bytes).digest('hex');
      fullExamHash.update(digest).update(question.answer);
      if (exam.category === 'official') {
        assert(!officialContents.has(digest), `Repeated official question image: ${question.image}`);
        officialContents.add(digest);
      }
    }
    const fingerprint = fullExamHash.digest('hex');
    assert(!examFingerprints.has(fingerprint), `Repeated complete question set: ${exam.id}`);
    examFingerprints.add(fingerprint);
  }
  assert.equal(paths.size, 857);
  assert.equal(officialContents.size, 396);
});

for (const exam of catalog.exams.filter(e => Object.hasOwn(fixtures, e.id))) {
  const expected = fixtures[exam.id];
  test(`${exam.form}: complete published scoring table and question-key fixtures`, async () => {
    assert.equal(exam.scoring.method, expected.method);
    assert.deepEqual(exam.scoring.conversion.map(row => row.raw), Array.from({ length: 67 }, (_, i) => i));
    assert.deepEqual([0, 23, 25, 33, 66].map(raw => exam.scoring.conversion[raw].scaled), expected.scale);
    for (const [index, row] of exam.scoring.conversion.entries()) {
      assert(Number.isInteger(row.scaled) && row.scaled >= 200 && row.scaled <= 990 && row.scaled % 10 === 0);
      if (index > 0) assert(row.scaled >= exam.scoring.conversion[index - 1].scaled);
    }
    assert.equal(exam.scoring.sourcePages.length, 2);
    await readAsset(exam.scoring.keyImage);
    await readAsset(exam.scoring.conversionImage);
    const attempt = createAttempt(exam, START);
    assert.equal(scoreAttempt(exam, attempt).scaledScore, expected.scale[0]);
    for (let i = 0; i < 25; i++) setAnswer(attempt, i, exam.questions[i].answer, START);
    for (let i = 25; i < 35; i++) setAnswer(attempt, i, exam.questions[i].answer === 'A' ? 'B' : 'A', START);
    const mixed = scoreAttempt(exam, attempt);
    assert.deepEqual([mixed.correct, mixed.incorrect, mixed.omitted], [25, 10, 31]);
    assert.equal(mixed.currentRaw, 25);
    assert.equal(mixed.roundedRaw, expected.method === 'quarter-penalty' ? 23 : 25);
    assert.equal(mixed.scaledScore, expected.scale[expected.method === 'quarter-penalty' ? 1 : 2]);
    for (let i = 0; i < 66; i++) setAnswer(attempt, i, exam.questions[i].answer, START);
    assert.equal(scoreAttempt(exam, attempt).scaledScore, expected.scale[4]);
    for (let i = 0; i < 66; i++) setAnswer(attempt, i, exam.questions[i].answer === 'A' ? 'B' : 'A', START);
    assert.equal(scoreAttempt(exam, attempt).scaledScore, expected.method === 'quarter-penalty' ? null : expected.scale[0]);
  });
}

test('the GR1268 reprint is consolidated without discarding its different published scale', async () => {
  const exam = catalog.exams.find(e => e.id === 'gr1768');
  assert(exam.duplicateFiles.includes('Practice 1.pdf'));
  assert(!catalog.exams.some(e => e.id === 'gr1268'));
  const alternate = exam.alternateScoring.find(scoring => scoring.form === 'GR1268');
  assert.equal(alternate.method, 'quarter-penalty');
  assert.equal(alternate.conversion.length, 67);
  assert.equal(alternate.conversion.find(row => row.raw === 33).scaled, 660);
  assert.equal(exam.scoring.conversion.find(row => row.raw === 33).scaled, 590);
  await readAsset(alternate.sourceFile);
});

test('the two additional ETS books are consolidated and the original GR9767 curve is preserved', async () => {
  const audit = JSON.parse(await readFile(resolve(root, 'data/import-ets-audit.json'), 'utf8'));
  assert.equal(audit.uniqueExamsAdded, 0);
  assert.equal(audit.sources.length, 2);
  assert.equal(audit.sources.reduce((count, source) => count + source.matches.length, 0), 3);
  assert(audit.sources.every(source => source.matches.every(match => match.answerKeyMatches)));
  assert(!catalog.exams.some(e => e.id === 'gr9767'));
  const alternate = catalog.exams.find(e => e.id === 'gr9768').alternateScoring?.find(scoring => scoring.form === 'GR9767');
  assert(alternate, 'Preserve the distinct original GR9767 score table as alternate scoring');
  assert.equal(alternate.conversion.length, 67);
  assert.equal(alternate.conversion.find(row => row.raw === 33).scaled, 800);
  assert.equal(alternate.conversion.find(row => row.raw === 66).scaled, 990);
  await readAsset(alternate.sourceFile);
  await readAsset(alternate.keyImage);
  await readAsset(alternate.conversionImage);
});

test('Princeton reports raw results only and never invents a scaled score', async () => {
  const exam = catalog.exams.find(e => e.id === 'princeton2010');
  assert(exam);
  assert.equal(exam.category, 'unofficial');
  assert.equal(exam.questionCount, 65);
  assert.equal(exam.scoring.method, 'number-correct');
  assert.deepEqual(exam.scoring.conversion, []);
  assert(!exam.scoring.conversionImage);
  const attempt = createAttempt(exam, START);
  for (let i = 0; i < 13; i++) setAnswer(attempt, i, exam.questions[i].answer, START);
  const score = scoreAttempt(exam, attempt);
  assert.equal(score.correct, 13);
  assert.equal(score.accuracy, 0.2);
  assert.equal(score.scaledScore, null);
  assert.equal(score.conversionStatus, 'unavailable');
  for (let i = 0; i < 65; i++) setAnswer(attempt, i, exam.questions[i].answer, START);
  assert.equal(scoreAttempt(exam, attempt).scaledScore, null);
});

test('all six REA exams label the shared published curve as a publisher approximation', async () => {
  for (let i = 1; i <= 6; i++) {
    const exam = catalog.exams.find(e => e.id === `rea-2012-${i}`);
    assert(exam);
    assert.equal(exam.category, 'unofficial');
    assert.equal(exam.scoring.method, 'quarter-penalty');
    assert.equal(exam.scoring.curveType, 'publisher-approximation');
    const verifiedKey = independentlyVerifiedRea.keys.find(key => key.examId === exam.id);
    assert(verifiedKey, `No independently verified key for ${exam.id}`);
    assert.equal(exam.questions.map(question => question.answer).join(''), verifiedKey.answers);
    assert(/approx|estimate/i.test(exam.scoring.notes));
    assert.equal(exam.scoring.conversion.length, 67);
    assert.deepEqual([0, 30, 46, 66].map(raw => exam.scoring.conversion.find(row => row.raw === raw).scaled), [360, 600, 730, 890]);
    const attempt = createAttempt(exam, START);
    for (let index = 0; index < 30; index++) setAnswer(attempt, index, exam.questions[index].answer, START);
    assert.equal(scoreAttempt(exam, attempt).scaledScore, 600);
    await readAsset(exam.scoring.keyImage);
    await readAsset(exam.scoring.conversionImage);
  }
});
