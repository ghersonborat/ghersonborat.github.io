import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COMPLETION_COOKIE, cookiePath, encodeCompletion, decodeCompletion, readCompletion, saveCompletion } from '../js/companion-progress.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('data/companion.json', root), 'utf8'));
const ids = catalog.entries.flatMap(entry => entry.problemIds);

test('the complete companion retains 316 concepts, 1,647 quizzes, and every matching solution', async () => {
  assert.equal(catalog.entryCount, 316);
  assert.equal(catalog.entries.length, 316);
  assert.equal(catalog.chapters.length, 11);
  assert.equal(catalog.problemCount, 1647);
  assert.equal(ids.length, 1647);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(catalog.chapters.map(chapter => chapter.entries.length), [29, 56, 32, 16, 33, 36, 79, 2, 4, 1, 28]);
  assert.deepEqual(catalog.chapters.flatMap(chapter => chapter.entries), catalog.entries.map(entry => entry.id));
  const source = await readFile(new URL(catalog.sourceFile, root));
  assert.equal(createHash('sha256').update(source).digest('hex'), catalog.sourceSha256);
  const imagePaths = new Set();
  let index = 0;
  for (const summary of catalog.entries) {
    const entry = JSON.parse(await readFile(new URL(summary.dataFile, root), 'utf8'));
    assert.equal(entry.title, summary.title);
    assert.equal(entry.id, summary.id);
    assert(entry.exposition.length && entry.title && entry.terms);
    assert(entry.problems.length >= 5);
    assert.deepEqual(entry.problems.map(q => q.id), summary.problemIds);
    for (const [i, question] of entry.problems.entries()) {
      assert.equal(question.id, `${entry.id}.${i + 1}`);
      assert.equal(question.index, index++);
      assert.match(question.answer, /^[A-E]$/);
      assert(question.question.length && question.solution.length);
      assert(question.question.every(s => s.page >= 26 && s.page <= 625));
      assert(question.solution.every(s => s.page >= 659 && s.page <= 909));
    }
    for (const segments of [entry.exposition, ...entry.problems.flatMap(q => [q.question, q.solution])]) {
      for (const segment of segments) {
        assert.match(segment.image, /^assets\/companion\/\d{3}\/[\w.\-]+\.webp$/);
        assert(!imagePaths.has(segment.image));
        imagePaths.add(segment.image);
        assert(segment.width >= 900 && segment.height >= 20);
        assert(segment.text.trim());
        assert(!/Problem \d{3}\.\d|Solution \d{3}\.\d|Back to problem|See solution/.test(segment.text), `Neighbor leaked into ${segment.image}`);
        assert((await stat(new URL(segment.image, root))).size > 100);
      }
    }
  }
  // Checkpoints read directly from the supplied PDF's solution headings.
  const first = JSON.parse(await readFile(new URL('data/companion/001.json', root), 'utf8'));
  const last = JSON.parse(await readFile(new URL('data/companion/316.json', root), 'utf8'));
  assert.equal(first.problems.map(q => q.answer).join(''), 'CCADAC');
  assert.equal(last.problems.map(q => q.answer).join(''), 'CBBCE');
});

test('completion for the entire book fits in one small cookie and round-trips exactly', () => {
  const all = new Set(ids);
  assert.equal(encodeCompletion(ids, all).length, 412);
  assert.deepEqual(decodeCompletion(encodeCompletion(ids, all), ids), all);
  const sparse = new Set([ids[0], ids[3], ids[4], ids[865], ids.at(-1)]);
  assert.deepEqual(decodeCompletion(encodeCompletion(ids, sparse), ids), sparse);
  assert.deepEqual(decodeCompletion(encodeCompletion(ids, new Set()), ids), new Set());
  const header = `unrelated=hello; ${COMPLETION_COOKIE}=${encodeCompletion(ids, sparse)}; another=123`;
  assert.deepEqual(readCompletion(header, ids), sparse);
  for (const bad of [null, '', 'f', 'z'.repeat(412), 'f'.repeat(413), '%ff', '<script>']) {
    assert.deepEqual(decodeCompletion(bad, ids), new Set());
  }
});

test('saving merges another tab, persists only problem completion, and scopes cookies to the site', () => {
  let value = `${COMPLETION_COOKIE}=${encodeCompletion(ids, new Set([ids[1]]))}`;
  let write = '';
  const doc = { get cookie() { return value; }, set cookie(cookie) { write = cookie; value = cookie.split(';')[0]; } };
  const completed = new Set([ids[0]]);
  assert(saveCompletion(doc, {pathname:'/GRE-Prep/companion.html', protocol:'https:'}, ids, completed));
  assert.deepEqual(completed, new Set([ids[0], ids[1]]));
  assert.match(write, /; Path=\/GRE-Prep\/; Max-Age=31536000; SameSite=Lax; Secure$/);
  assert.equal(write.split('=')[0], COMPLETION_COOKIE);
  assert(write.length < 600);
  assert(!/answer|read|score|timestamp|entry/i.test(value));
  assert.equal(cookiePath('/companion.html'), '/');
  assert.equal(cookiePath('/nested/site/companion.html'), '/nested/site/');
  assert(saveCompletion(doc, {pathname:'/companion.html', protocol:'http:'}, ids, completed));
  assert(!write.includes('Secure'));
});

test('blocked cookie access or writes preserve in-memory completion and report failure', () => {
  const completed = new Set([ids[7]]);
  const location = {pathname:'/companion.html', protocol:'http:'};
  assert.equal(saveCompletion({get cookie() {return '';}, set cookie(_) {}}, location, ids, completed), false);
  assert.equal(saveCompletion({get cookie() {throw Error('blocked');}}, location, ids, completed), false);
  assert(completed.has(ids[7]));
});
