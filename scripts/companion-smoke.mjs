/**
 * Offline Firefox-family browser checks of the actual companion UI.
 * HTTP and debugging ports are unavailable in some build environments. This
 * harness supplies JSON fixtures and an explicit cookie double; native cookie
 * behavior and real HTTP delivery are outside its scope. No production changes.
 * node scripts/companion-smoke.mjs /path/to/waterfox [--mobile] [--scene=home]
 */
import { readFile, writeFile, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = process.argv[2];
assert(browser, 'Provide a Firefox-family browser executable.');
const out = await mkdtemp(join(tmpdir(), 'gre-companion-smoke-'));
const scene = process.argv.find(value => value.startsWith('--scene='))?.slice(8) || 'quiz';
const viewport = process.argv.find(value => value.startsWith('--viewport='))?.slice(11) || (process.argv.includes('--mobile') ? '390,844' : '1440,1050');
assert(/^\d{3,4},\d{3,4}$/.test(viewport), 'Viewport must be WIDTH,HEIGHT.');
const [width, height] = viewport.split(',');
const [html, css, bookCss, progress, appSource, catalogText] = await Promise.all([
  'companion.html', 'styles.css', 'companion.css', 'js/companion-progress.js', 'js/companion.js', 'data/companion.json',
].map(file => readFile(join(root, file), 'utf8')));
const catalogFixture = JSON.parse(catalogText);
const fixtures = {'data/companion.json': catalogFixture};
for (const id of ['001', '002', '029', '030', '316']) {
  fixtures[`data/companion/${id}.json`] = JSON.parse(await readFile(join(root, `data/companion/${id}.json`), 'utf8'));
}
const harness = String.raw`
const checks = [];
const check = (name, condition) => { if (!condition) throw Error(name); checks.push(name); };
const click = selector => { const el = document.querySelector(selector); if (!el) throw Error('Missing: ' + selector); el.click(); };
const go = async hash => { history.replaceState(null, '', location.href.split('#')[0] + hash); await route(); };
const first = () => document.querySelector('[data-problem="001.1"]');
check('all chapters and concepts are navigable', document.querySelectorAll('.chapter-group').length === 11 && document.querySelectorAll('.entry-link').length === 316);
check('the introduction does not write cookies', cookieWrites.length === 0);
check('mobile drawer starts closed and desktop sidebar starts open', sidebarOpen === !mobile.matches);
if (SCENE === 'home') return checks;
await go('#entry-001');
check('entry includes full exposition and all six quizzes', !!document.querySelector('.entry h1') && document.querySelectorAll('.quiz-card').length === 6 && document.querySelector('#definition-heading').nextElementSibling.querySelector('img'));
check('answers and solutions are hidden before submission', !document.querySelector('.quiz-feedback') && document.querySelector('[type="submit"]').disabled);
check('visiting an entry leaves cookies untouched', cookieWrites.length === 0);
if (SCENE === 'entry') return checks;
click('#contents-toggle');
if (!sidebarOpen) click('#contents-toggle');
search.value = 'eigenvalue'; search.dispatchEvent(new Event('input', {bubbles:true}));
check('search includes concept terms', document.querySelectorAll('.entry-link').length > 0 && document.querySelectorAll('.entry-link').length < 30 && chapterNav.textContent.toLowerCase().includes('eigen'));
search.value = 'zzznomatches'; search.dispatchEvent(new Event('input', {bubbles:true}));
check('empty search has feedback', chapterNav.textContent.includes('No concepts found'));
search.value = ''; search.dispatchEvent(new Event('input', {bubbles:true}));
setSidebar(!mobile.matches);
click('[data-quiz="001.1"] input[value="A"]');
check('selecting an answer leaves cookies untouched', cookieWrites.length === 0);
click('[data-quiz="001.1"] [type="submit"]');
check('wrong answer immediately shows correct choice and worked solution', first().querySelector('.feedback-verdict').textContent.includes('Not quite.') && first().querySelector('.feedback-verdict').textContent.includes('C') && !!first().querySelector('.quiz-feedback img'));
check('wrong attempts count as completed problems', completed.size === 1 && first().querySelector('.completion-badge').textContent.includes('Completed'));
check('the submitted choices are locked', first().querySelector('fieldset').disabled);
check('a single compact completion cookie is written', cookieWrites.length === 1 && cookieWrites[0].includes(COMPLETION_COOKIE) && cookieWrites[0].length < 600);
check('unsubmitted neighboring quizzes stay hidden and incomplete', !document.querySelector('[data-problem="001.2"] .quiz-feedback') && !completed.has('001.2'));
check('progress updates in sidebar and entry', document.querySelector('#total-progress').textContent === '1 / 1,647' && document.querySelector('#entry-progress').textContent === '1 / 6 completed');
click('[data-retry="001.1"]');
check('retry hides the solution without losing completion', !first().querySelector('.quiz-feedback') && completed.has('001.1') && !first().querySelector('fieldset').disabled);
click('[data-quiz="001.1"] input[value="C"]'); click('[data-quiz="001.1"] [type="submit"]');
check('correct answer receives immediate feedback without double counting', first().querySelector('.feedback-verdict strong').textContent === 'Correct.' && completed.size === 1);
// Reset transient application state and run the same startup path as a reload.
drafts.clear(); completed = new Set(); currentEntry = null; currentId = null;
await init();
check('startup restores completed quizzes from the cookie alone', completed.size === 1 && first().querySelector('.completion-badge').textContent.includes('Completed'));
check('startup does not retain selected answers or displayed solutions', !first().querySelector('input:checked') && !first().querySelector('.quiz-feedback'));
click('[data-review="001.1"]');
check('a previously completed problem can reveal its solution again', first().querySelector('.feedback-verdict').textContent.includes('Previously completed') && !!first().querySelector('.quiz-feedback img'));
await go('#problem-002-6');
check('a direct problem link loads its correct concept', currentEntry.id === '002' && !!document.querySelector('#problem-002-6'));
await go('#entry-030');
check('navigation opens the appropriate chapter', document.querySelector('[data-chapter="chapter-2"]').open && document.querySelector('[href="#entry-030"]').getAttribute('aria-current') === 'page');
await go('#problem-316-5');
check('the final concept and final problem are available', currentEntry.id === '316' && currentEntry.problems.at(-1).id === '316.5');
await go('#entry-999');
check('unknown links give a recoverable error', !!document.querySelector('.load-error a[href="#contents"]'));
await go('#entry-001');
blockedCookies = true;
click('[data-quiz="001.2"] input[value="C"]'); click('[data-quiz="001.2"] [type="submit"]');
check('blocked cookies are disclosed without breaking feedback', !document.querySelector('#cookie-status').hidden && !!document.querySelector('[data-problem="001.2"] .quiz-feedback'));
blockedCookies = false; document.querySelector('#cookie-status').hidden = true;
await go('#entry-002'); await go('#entry-001');
check('all displayed images resolve', (await Promise.all([...document.querySelectorAll('img')].map(img => { img.loading = 'eager'; return img.decode().then(() => true, () => false); }))).every(Boolean));
check('the page never overflows horizontally', document.documentElement.scrollWidth <= innerWidth);
check('no uncaught browser errors', browserErrors.length === 0);
if (SCENE === 'mobile-nav') { setSidebar(true); } else { window.scrollTo(0, 380); }
return checks;
`;
const code = `
(async () => {
  const browserErrors = [], cookieWrites = [];
  let cookieValue = '', blockedCookies = false;
  window.addEventListener('error', e => browserErrors.push(e.message));
  Object.defineProperty(document, 'cookie', {configurable:true, get:() => cookieValue, set:value => {cookieWrites.push(value); if (!blockedCookies) cookieValue = value.split(';')[0];}});
  const SCENE = ${JSON.stringify(scene)};
  const expectedMobile = ${Number(width) <= 800};
  const fixtures = ${JSON.stringify(fixtures)};
  window.fetch = async path => new Response(JSON.stringify(fixtures[path]), {status:fixtures[path] ? 200 : 404});
  try {
    ${progress.replace(/^export /gm, '')}
    ${appSource.replace(/^import .*?;\n/, '').replace(/\ninit\(\);\s*$/, '\nawait init();')}
    if (mobile.matches !== expectedMobile) throw Error('Unexpected browser viewport: ' + innerWidth + 'x' + innerHeight);
    const checks = await (async () => { ${harness} })();
    const snapshot = document.documentElement.cloneNode(true);
    snapshot.querySelectorAll('script').forEach(script => script.remove());
    snapshot.querySelectorAll('img').forEach(img => img.loading = 'eager');
    dump('COMPANION_SNAPSHOT ' + JSON.stringify('<!doctype html>' + snapshot.outerHTML) + '\\n');
    dump('COMPANION_PASS ' + JSON.stringify({scene: SCENE, viewport:[innerWidth,innerHeight], passed: checks.length, checks}) + '\\n');
  } catch (error) {
    dump('COMPANION_FAIL ' + String(error) + ' ' + error.stack + '\\n');
    document.body.insertAdjacentHTML('afterbegin', '<pre style="position:fixed;inset:0;z-index:100;background:#fee;padding:20px">' + String(error) + '</pre>');
  }
})();`;
const profile = join(out, 'profile');
await (await import('node:fs/promises')).mkdir(profile);
await writeFile(join(profile, 'user.js'), [
  'user_pref("browser.dom.window.dump.enabled", true);',
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.startup.homepage_override.mstone", "ignore");',
  'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);',
].join('\n'));
const testHtml = html.replace(/<link[^>]+href="styles.css"[^>]*>/, `<style>${css}</style>`)
  .replace(/<link[^>]+href="companion.css"[^>]*>/, `<style>${bookCss}</style>`)
  .replace(/<script[^>]+src="js\/companion.js"[^>]*><\/script>/, '')
  .replace('<head>', `<head><base href="${pathToFileURL(root + '/').href}">`)
  .replace('</body>', `<script>${code.replace(/<\/script/gi, '<\\/script')}</script></body>`);
const file = join(out, 'test.html'), screenshot = join(out, 'screenshot.png');
await writeFile(file, testHtml);
const child = spawn(browser, ['--headless', '--no-remote', '--profile', profile, '--width', width, '--height', height, pathToFileURL(file).href], {
  env: {...process.env, GSETTINGS_BACKEND:'memory', MOZ_HEADLESS_WIDTH:width, MOZ_HEADLESS_HEIGHT:height}, detached:true, stdio:['ignore','pipe','pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
const start = Date.now();
while (Date.now() - start < 25000) {
  await new Promise(resolve => setTimeout(resolve, 200));
  if (output.includes('COMPANION_FAIL')) break;
  if (output.includes('COMPANION_PASS')) break;
}
try { process.kill(-child.pid, 'SIGTERM'); } catch {}
const pass = output.match(/COMPANION_PASS (\{[^\n]+\})/);
if (!pass) { console.error(output); throw Error(`Companion browser checks failed; inspect ${file}`); }
console.log(pass[0].replace(/\\n.*$/, ''));
const snapshot = output.match(/COMPANION_SNAPSHOT (.+)\n/);
assert(snapshot, 'The browser did not return its rendered snapshot.');
const snapshotFile = join(out, 'snapshot.html');
await writeFile(snapshotFile, JSON.parse(snapshot[1]));
const screenshotProfile = await mkdtemp(join(out, 'screenshot-profile-'));
const capture = spawn(browser, ['--headless', '--no-remote', '--profile', screenshotProfile, '--window-size', viewport, '--screenshot', screenshot, pathToFileURL(snapshotFile).href], {
  env:{...process.env,GSETTINGS_BACKEND:'memory'},detached:true,stdio:'ignore',
});
const captureStart = Date.now();
let captured = false;
while (Date.now() - captureStart < 15000) {
  await new Promise(resolve => setTimeout(resolve, 200));
  try { if ((await stat(screenshot)).size) { captured = true; break; } } catch {}
}
try { process.kill(-capture.pid, 'SIGTERM'); } catch {}
assert(captured, `Screenshot was not saved; inspect ${snapshotFile}`);
console.log(`Screenshot: ${screenshot}`);
