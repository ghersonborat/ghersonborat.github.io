/**
 * Dependency-free, offline browser smoke test for restricted build environments.
 * Run: node scripts/browser-smoke.mjs /path/to/firefox-or-waterfox
 * It uses the actual app, engine, CSS, and catalog, with JSON initialization
 * performed synchronously. No HTTP or browser-debugging port is required. HTML and screenshots
 * are temporary artifacts; the production site remains unchanged.
 */
import { readFile, writeFile, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = process.argv[2] || process.env.GRE_TEST_BROWSER;
assert(browser, 'Provide the path to a Firefox-family browser executable.');
const out = await mkdtemp(join(tmpdir(), 'gre-browser-smoke-'));
const [index, css, engine, source, exams, research] = await Promise.all([
  'index.html', 'styles.css', 'js/engine.js', 'js/app.js', 'data/exams.json', 'research.json',
].map(file => readFile(join(root, file), 'utf8')));

const harness = String.raw`
const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(name);
  checks.push(name);
};
const click = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error('Missing control: ' + selector);
  element.click();
};
const act = (name) => click('[data-action="' + name + '"]');
const snapshot = () => JSON.parse(localStorage.getItem(STORAGE_KEY));
check('every catalog exam has one library card', document.querySelectorAll('.exam-card').length === exams.length);
check('all form IDs remain unique', new Set(exams.map(e => e.id)).size === exams.length);
check('official and unofficial tests have distinct library sections', document.querySelectorAll('.exam-category[data-category="official"] .exam-card').length === 6 && document.querySelectorAll('.exam-category[data-category="unofficial"] .exam-card').length === 7);
if (SCENE === 'library') return checks;
if (SCENE === 'raw-only' || SCENE === 'unofficial') {
  const rawExam = exams.find(exam => exam.category === 'unofficial' && !exam.scoring.conversion.length);
  check('a raw-only unofficial test is available', !!rawExam);
  const rawCard = document.querySelector('[data-exam-id="' + rawExam.id + '"]');
  check('raw-only card explains missing curve', rawCard.textContent.includes('No published score curve'));
  click('[data-action="prepare"][data-id="' + rawExam.id + '"]');
  check('directions identify unofficial origin and missing curve', document.querySelector('.instructions').textContent.includes('Unofficial') && document.querySelector('.instructions').textContent.includes('No published score curve'));
  act('instruction-next'); act('instruction-next'); act('begin');
  check('raw-only test starts with its actual question count', attempt.answers.length === 65 && document.querySelector('.test-status').textContent.includes('of 65'));
  click('input[name="answer"][value="' + rawExam.questions[0].answer + '"]');
  act('next');
  const wrongAnswer = rawExam.questions[1].answer === 'A' ? 'B' : 'A';
  click('input[name="answer"][value="' + wrongAnswer + '"]');
  act('review-list'); click('[data-review-row="64"]'); act('goto-question'); act('mark');
  check('raw-only navigation reaches and marks its final question', attempt.current === 64 && attempt.marked[64]);
  act('exit-section'); act('confirm-finish'); act('report-scores');
  const rawScore = scoreAttempt(rawExam, attempt);
  check('missing curve reports accurate counts without scaled score', rawScore.correct === 1 && rawScore.incorrect === 1 && rawScore.omitted === 63 && rawScore.scaledScore === null);
  check('results explicitly label raw result and missing curve', document.querySelector('.main-score').textContent.includes('Raw practice result') && document.querySelector('.main-score').textContent.includes('No published score curve'));
  check('raw-only results retain all65 questions', document.querySelectorAll('.report-table tbody tr').length === 65);
  check('raw-only results identify unofficial publisher', document.querySelector('.report-meta').textContent.includes(rawExam.publisher) && document.querySelector('.report-meta').textContent.includes('Unofficial'));
  if (SCENE === 'raw-only') return checks;
  act('review-all');
  check('raw-only answer review is still locked', document.querySelector('.answer-set').disabled);
  act('show-results'); act('library');
  const publisherExam = exams.find(exam => exam.category === 'unofficial' && exam.scoring.conversion.length);
  check('publisher-curve card labels its approximate scale', document.querySelector('[data-exam-id="' + publisherExam.id + '"]').textContent.includes('approximate'));
  click('[data-action="prepare"][data-id="' + publisherExam.id + '"]');
  act('instruction-next'); act('instruction-next'); act('begin');
  click('input[name="answer"][value="' + publisherExam.questions[0].answer + '"]');
  act('exit-section'); act('confirm-finish'); act('report-scores');
  check('publisher curve yields its documented score', scoreAttempt(publisherExam, attempt).scaledScore === 360);
  check('publisher result is distinct from an official ETS scale', document.querySelector('.main-score').textContent.includes('Publisher') && document.querySelector('.main-score').textContent.includes('Not ETS-equated'));
  check('unofficial scenarios have no uncaught browser errors', browserErrors.length === 0);
  return checks;
}
click('[data-action="prepare"][data-id="gr3768"]');
check('instructions do not start the clock', activeAttempt() === undefined);
act('instruction-next'); act('instruction-next'); act('begin');
check('exam starts with 170 minutes', remainingSeconds(attempt) === 10200);
check('first question image is present', document.querySelector('.question-image').getAttribute('src') === examFor(attempt).questions[0].image);
click('input[name="answer"][value="B"]');
act('mark'); act('next'); act('next');
click('input[name="answer"][value="D"]');
check('answers persist immediately', snapshot().attempts[0].answers[0] === 'B' && snapshot().attempts[0].answers[2] === 'D');
check('mark is independent of answer', attempt.marked[0] && attempt.answers[0] === 'B');
act('review-list');
const rowText = i => modal.querySelector('[data-review-row="' + i + '"]').textContent;
check('review popup distinguishes answered and visited/unvisited blanks', rowText(0).includes('Answered') && rowText(1).includes('Not Answered') && rowText(3).includes('Not Encountered'));
check('review popup shows review marks', rowText(0).includes('✓'));
click('[data-review-row="0"]'); act('goto-question');
check('review popup returns to selected question', attempt.current === 0);
act('clear');
check('clear answer preserves review flag', attempt.answers[0] === null && attempt.marked[0]);
click('input[name="answer"][value="B"]');
act('toggle-time');
check('hide time hides countdown', document.querySelector('#timer').hidden);
attempt.deadline = Date.now() + 299000; updateTimer();
check('last five minutes reveals countdown and warning', !document.querySelector('#timer').hidden && !!document.querySelector('.timer-warning'));
attempt.deadline = attempt.startedAt + 10200000; attempt.warningShown = false; attempt.hideTime = false; save();
// Re-run the same restoration path used by init, preserving the absolute clock.
const beforeRestore = attempt.deadline;
loadSaved(); attempt = activeAttempt(); render();
check('restoration retains answers, flags, and deadline', attempt.deadline === beforeRestore && attempt.answers[0] === 'B' && attempt.marked[0]);
if (SCENE === 'exam') return checks;
act('review-list');
if (SCENE === 'review') return checks;
act('close'); act('exit-section');
check('end-section confirmation includes unanswered count', modal.textContent.includes('64 unanswered'));
act('close');
check('canceling submission keeps exam active', attempt.status === 'active');
act('exit-section'); act('confirm-finish');
check('submission locks the attempt', attempt.status === 'finished' && screen === 'complete');
if (SCENE === 'complete') return checks;
act('report-scores');
const score = scoreAttempt(examFor(attempt), attempt);
check('results show correct, incorrect, and omitted answers', score.correct === 1 && score.incorrect === 1 && score.omitted === 64);
check('results show published score', score.scaledScore === 200);
check('results have one row per question', document.querySelectorAll('.report-table tbody tr').length === 66);
document.querySelector('#result-filter').value = 'incorrect';
document.querySelector('#result-filter').dispatchEvent(new Event('change', { bubbles: true }));
check('incorrect-answer filter selects the missed question', document.querySelectorAll('.report-table tbody tr').length === 1);
act('review-question');
check('answer review is locked and displays both answers', document.querySelector('.answer-set').disabled && document.querySelector('.review-feedback').textContent.includes('Your answer: B') && document.querySelector('.review-feedback').textContent.includes('Correct answer: A'));
check('selected wrong answer keeps its red review highlight', getComputedStyle(document.querySelector('.answer-option.is-incorrect')).backgroundColor === 'rgb(249, 233, 229)');
check('unselected official answer keeps its green review highlight', getComputedStyle(document.querySelector('.answer-option.is-correct')).backgroundColor === 'rgb(232, 243, 234)');
act('show-results');
document.querySelector('#result-filter').value = 'all';
document.querySelector('#result-filter').dispatchEvent(new Event('change', { bubbles: true }));
if (SCENE === 'results') return checks;
act('library');
click('[data-action="prepare"][data-id="gr9367"]');
act('instruction-next'); act('instruction-next'); act('begin');
click('input[name="answer"][value="D"]');
act('help');
attempt.deadline = Date.now() - 1; updateTimer();
check('timeout closes an open dialog and locks answers', screen === 'complete' && !modal.open && attempt.status === 'finished' && attempt.finishReason === 'time-expired');
act('report-scores');
check('historical score uses its own conversion', scoreAttempt(examFor(attempt), attempt).scaledScore === 430);
act('review-all');
check('all review controls stay locked after timeout', document.querySelector('.answer-set').disabled);
check('selected correct answer keeps its green review highlight', getComputedStyle(document.querySelector('.answer-option.is-correct')).backgroundColor === 'rgb(232, 243, 234)');
check('no uncaught browser errors', browserErrors.length === 0);
return checks;
`;

const sceneOption = process.argv.find(value => value.startsWith('--scene='))?.slice(8);
const viewport = process.argv.find(value => value.startsWith('--viewport='))?.slice(11) || '1440,1000';
assert(/^\d{3,4},\d{3,4}$/.test(viewport), 'Viewport must be WIDTH,HEIGHT.');
const scenes = sceneOption ? [sceneOption] : process.argv.includes('--all') ? ['library', 'exam', 'review', 'complete', 'results', 'timeout', 'raw-only', 'unofficial'] : ['timeout', 'unofficial'];
for (const scene of scenes) {
  const profile = await mkdtemp(join(out, 'profile-'));
  await writeFile(join(profile, 'user.js'), [
    'user_pref("browser.dom.window.dump.enabled", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
  ].join('\n'));
  const code = `
    (() => {
      const browserErrors = [];
      window.addEventListener('error', event => browserErrors.push(event.message));
      const SCENE = ${JSON.stringify(scene)};
      const fixtures = { 'data/exams.json': ${exams}, 'research.json': ${research} };
      window.fetch = async path => new Response(JSON.stringify(fixtures[path]), {status: fixtures[path] ? 200 : 404});
      try {
        ${engine.replace(/^export /gm, '')}
        ${source.replace(/^import .*?;\n/, '').replace(/\ninit\(\);\s*$/, '\nexams = fixtures["data/exams.json"].exams.sort((a,b) => Number(b.year)-Number(a.year)); research = fixtures["research.json"]; loadSaved(); render(); setInterval(updateTimer,250);')}
        const checks = (() => { ${harness} })();
        const result = {scene: SCENE, passed: checks.length, checks};
        dump('GRE_SMOKE_PASS ' + JSON.stringify(result) + '\\n');
        document.documentElement.dataset.smokeResult = 'pass';
      } catch (error) {
        dump('GRE_SMOKE_FAIL ' + String(error) + ' ' + error.stack + '\\n');
        document.body.insertAdjacentHTML('afterbegin', '<pre style="position:fixed;z-index:99999;background:#fee;padding:20px">BROWSER TEST FAILED: ' + String(error) + '</pre>');
      }
    })();
  `;
  const html = index.replace(/<link[^>]+href="styles\.css"[^>]*>/, `<style>${css}</style>`)
    .replace(/<script[^>]+src="js\/app\.js"[^>]*><\/script>/, '')
    .replace('</body>', `<script>${code.replace(/<\/script/gi, '<\\/script')}</script></body>`)
    .replace('<head>', `<head><base href="${pathToFileURL(root + '/').href}">`);
  const htmlFile = join(out, `${scene}.html`), screenshot = join(out, `${scene}.png`);
  await writeFile(htmlFile, html);
  const child = spawn(browser, ['--headless', '--no-remote', '--profile', profile, '--window-size', viewport, '--screenshot', screenshot, pathToFileURL(htmlFile).href], {
    env: { ...process.env, GSETTINGS_BACKEND: 'memory' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const started = Date.now();
  while (Date.now() - started < 20000) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (output.includes('GRE_SMOKE_FAIL')) break;
    if (output.includes('GRE_SMOKE_PASS')) {
      try { if ((await stat(screenshot)).size > 0) break; } catch {}
    }
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  const pass = output.match(/GRE_SMOKE_PASS (\{[^\n]+\})/);
  if (!pass) {
    console.error(output.split('\n').filter(line => /GRE_SMOKE|Error|FAIL/.test(line)).join('\n'));
    throw new Error(`Browser smoke test failed or did not finish: ${scene}; inspect ${htmlFile}`);
  }
  console.log(pass[0].replace(/\\n.*$/, ''));
  console.log(`Screenshot: ${screenshot}`);
}
console.log(`Browser artifacts: ${out}`);
