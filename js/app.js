import { ANSWER_CHOICES, createAttempt, remainingSeconds, setAnswer, toggleMark, visitQuestion, finishAttempt, expireAttempt, scoreAttempt } from './engine.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const STORAGE_KEY = 'gre-math-practice-v1';
let exams = [], research = {}, attempts = [], attempt = null, selectedExam = null;
let screen = 'library', step = 0, reviewIndex = 0, reviewScope = 'all', filter = 'all', libraryTab = 'exams';
let storageOK = true, storageMessage = '', lastModalFocus = null, reviewSelected = 0;
let reviewSort = 'number';
const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  paper: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
  mark: '<path d="M6 3h12v18l-6-4-6 4z"/>', check: '<path d="m5 12 4 4L19 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01"/>',
  exit: '<path d="M10 3H4v18h6m3-14 5 5-5 5m-5-5h11"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.paper}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const examFor = (a) => exams.find(e => e.id === a?.examId);
const activeAttempt = () => attempts.find(a => a.status === 'active');
const isUnofficial = (exam) => exam.category === 'unofficial';
const hasScoreCurve = (exam) => Boolean(exam.scoring?.conversion?.length);
const categoryLabel = (exam) => isUnofficial(exam) ? 'Unofficial practice' : 'Official ETS exam';
const estimateLabel = (exam) => isUnofficial(exam) ? 'Publisher’s approximate estimate' : exam.scoring.method === 'quarter-penalty' ? 'Historical booklet estimate' : 'Booklet score estimate';
const scoreSummary = (exam, score) => !hasScoreCurve(exam) ? 'No published score curve' : score.scaledScore === null ? 'Outside published score table' : `${isUnofficial(exam) ? 'Publisher estimate' : 'Booklet estimate'} ${score.scaledScore}`;
function scoringExplanation(exam) {
  if (!hasScoreCurve(exam)) return 'This exam has an answer key but no published score curve. Results show your number correct and percentage correct. No scaled GRE score or percentile is estimated.';
  const method = exam.scoring.method === 'quarter-penalty'
    ? 'Correct answers minus one quarter of incorrect answers, rounded to the nearest whole number, are converted using this source’s table.'
    : 'The number of correct answers is converted using this source’s published table.';
  return `${method} ${isUnofficial(exam) ? 'This is the publisher’s approximate practice estimate, not an official ETS conversion or a current GRE score prediction.' : exam.scoring.method === 'quarter-penalty' ? 'This historical estimate uses a guessing penalty that the current exam does not use; your number correct is shown separately.' : 'The booklet estimate is a practice result, not an official test score.'}`;
}

const reviewIndices = () => examFor(attempt).questions.map((q,i) => i).filter(i => reviewScope === 'all' || attempt.answers[i] !== examFor(attempt).questions[i].answer);
const reviewNeighbor = (direction) => { const indices = reviewIndices(); return indices[indices.indexOf(reviewIndex) + direction]; };
const formatTime = (seconds) => [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(n => String(n).padStart(2,'0')).join(':');
const prettyDate = (date) => new Date(date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const announce = (message) => { document.querySelector('#announcer').textContent = message; };

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { attempts = []; return; }
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.attempts)) throw new Error('Unsupported saved data');
    const valid = saved.attempts.filter(a => {
      const e = examFor(a), n = e?.questions.length;
      return e && typeof a.id === 'string' && ['active','finished'].includes(a.status)
        && Number.isFinite(a.startedAt) && Number.isFinite(a.deadline) && a.deadline > a.startedAt
        && Number.isInteger(a.current) && a.current >= 0 && a.current < n
        && Array.isArray(a.answers) && a.answers.length === n && a.answers.every(v => v === null || ANSWER_CHOICES.includes(v))
        && Array.isArray(a.marked) && a.marked.length === n && a.marked.every(v => typeof v === 'boolean')
        && Array.isArray(a.visited) && a.visited.length === n && a.visited.every(v => typeof v === 'boolean')
        && (a.status === 'active' || Number.isFinite(a.finishedAt));
    });
    attempts = valid;
    if (valid.length !== saved.attempts.length) storageMessage = 'Some saved practice data could not be read. Valid attempts have been kept.';
    let changed = false;
    for (const a of attempts) if (expireAttempt(a)) changed = true;
    if (changed) save();
  } catch {
    storageMessage = 'Saved practice data is unavailable in this browser. You can still take an exam.';
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({version:1,attempts})); }
  catch { storageOK = false; storageMessage = 'Browser storage is unavailable. Keep this tab open; answers cannot be restored after closing or refreshing it.'; }
  if (!storageOK && !document.querySelector('.storage-alert')) {
    const alert = document.createElement('div'); alert.className = 'storage-alert'; alert.setAttribute('role','alert'); alert.textContent = storageMessage; app.prepend(alert);
  }
}
function header() {
  return `<header class="site-header"><a href="#" class="wordmark" data-action="library" aria-label="Practice Room home">∑ <span>THE PRACTICE ROOM</span></a><nav class="site-nav" aria-label="Main"><button class="text-button ${libraryTab === 'exams' ? 'active' : ''}" data-action="library">Exam library</button><button class="text-button ${libraryTab === 'history' ? 'active' : ''}" data-action="history">My attempts</button><span class="nav-tag">MATHEMATICS</span></nav></header>`;
}
function footer() {
  return `<footer class="site-footer"><span>Independent practice. Not affiliated with or endorsed by ETS.</span><button class="text-button" data-action="sources">Sources, scoring &amp; interface notes ↗</button><span>Made for a little more confidence.</span></footer>`;
}
function render() {
  document.body.classList.toggle('testing', ['instructions','exam','review','complete'].includes(screen));
  if (screen === 'library') renderLibrary();
  else if (screen === 'instructions') renderInstructions();
  else if (screen === 'exam' || screen === 'review') renderQuestion();
  else if (screen === 'complete') renderComplete();
  else if (screen === 'results') renderResults();
  if (storageMessage) app.insertAdjacentHTML('afterbegin', `<div class="storage-alert" role="status">${esc(storageMessage)}</div>`);
}
function renderExamCard(e, completed, featured = false) {
  const latest = completed.find(a => a.examId === e.id);
  const unofficial = isUnofficial(e);
  const badge = unofficial ? 'Unofficial' : featured ? 'Latest ETS release' : e.scoring.method === 'quarter-penalty' ? 'ETS archive' : 'Official ETS';
  const scoring = !hasScoreCurve(e) ? 'Answer key only · No published score curve' : unofficial ? 'Answer key + publisher’s approximate score curve' : e.scoring.method === 'quarter-penalty' ? 'Historical booklet scoring' : 'Published score curve · No guessing penalty';
  return `<article class="exam-card ${featured ? 'featured' : ''}" data-exam-id="${esc(e.id)}" data-category="${unofficial ? 'unofficial' : 'official'}"><div class="card-top"><span class="form-label">${esc(e.form || e.id.toUpperCase())}</span><span class="pill ${unofficial ? 'unofficial' : e.scoring.method === 'quarter-penalty' ? 'archive' : ''}">${badge}</span></div><h3>${esc(e.title)}</h3><p class="card-publisher">${esc(e.publisher || 'Educational Testing Service')}</p><p class="card-description ${hasScoreCurve(e) ? '' : 'no-curve'}">${scoring}</p>${e.sourceAnnotations ? '<p class="source-annotation">Scanned source includes handwritten marks</p>' : ''}<div class="card-meta"><span>${icon('paper')}${e.questions.length} questions</span><span>${icon('clock')}${Math.round(e.durationSeconds / 60)} minutes</span></div><div class="card-actions"><button class="button ${featured ? 'primary' : ''}" data-action="prepare" data-id="${esc(e.id)}">Begin exam ${icon('arrow')}</button><button class="button icon-only" data-action="exam-info" data-id="${esc(e.id)}" aria-label="About ${esc(e.title)}">${icon('help')}</button></div>${latest ? `<p class="card-history">Last attempt: ${scoreAttempt(e,latest).correct}/${e.questions.length} correct</p>` : ''}</article>`;
}
function renderExamCategory(category, completed) {
  const group = exams.filter(e => (isUnofficial(e) ? 'unofficial' : 'official') === category);
  if (!group.length) return '';
  const official = category === 'official';
  return `<section class="exam-category" data-category="${category}" aria-labelledby="${category}-title"><div class="library-heading"><h2 id="${category}-title">${official ? 'Official ETS exams' : 'Unofficial practice exams'} <span class="count-badge">${group.length} EXAMS</span></h2><p>${official ? 'Released ETS questions and answer keys' : 'Third-party practice · Scoring labeled for each exam'}</p></div>${official ? '' : '<p class="category-description">These tests were written by independent publishers. Exams without a published score curve report raw results only; any publisher-provided curve is labeled as an approximate estimate.</p>'}<div class="exam-grid">${group.map((e,i) => renderExamCard(e,completed,official && i === 0)).join('')}</div></section>`;
}
function renderLibrary() {
  const active = activeAttempt();
  const completed = attempts.filter(a => a.status === 'finished').sort((a,b) => b.finishedAt - a.finishedAt);
  const categoryLinks = `<nav class="category-links" aria-label="Exam categories"><a href="#official-title">Official ETS <span>${exams.filter(e=>!isUnofficial(e)).length}</span></a><a href="#unofficial-title">Unofficial practice <span>${exams.filter(isUnofficial).length}</span></a></nav>`;
  const history = `<section class="history-section"><div class="library-heading"><h2>My attempts <span class="count-badge">${completed.length}</span></h2><p>Saved in this browser</p></div>${completed.length ? completed.map(a => { const e = examFor(a), score = scoreAttempt(e,a); return `<div class="history-row"><p><strong>${esc(e.title)}</strong><small>${categoryLabel(e)} · ${prettyDate(a.finishedAt)} · ${score.correct}/${score.total} correct · ${scoreSummary(e,score)}${a.scoreDecision === 'cancel' ? ' · Score canceled in simulation' : ''}</small></p><button class="button" data-action="results" data-id="${esc(a.id)}">View results ${icon('arrow')}</button></div>`; }).join('') : '<div class="empty-state">Your completed exams will appear here. Choose an exam to make a start.</div>'}</section>`;
  app.innerHTML = `${header()}<main class="library"><section class="hero"><div><p class="eyebrow">GRE Mathematics Subject Test</p><h1>A familiar exam.<br>A more <em>prepared you.</em></h1><p class="intro">Settle into the real rhythm of test day. Choose from official ETS exams and clearly labeled unofficial practice in a focused testing environment.</p></div><div class="exam-facts"><div class="fact">${icon('clock')}<div><strong>2 hours, 50 minutes</strong><span>One continuous timed session</span></div></div><div class="fact">${icon('paper')}<div><strong>Official &amp; unofficial exams</strong><span>Distinct categories, original source questions</span></div></div><div class="fact">${icon('mark')}<div><strong>Mark. Review. Return.</strong><span>Practice the test-day workflow</span></div></div></div></section>
  ${active ? `<div class="resume-banner"><p><strong>Your exam is in progress</strong>${esc(examFor(active).title)} · <span id="resume-time">${formatTime(remainingSeconds(active))}</span> remaining. The clock keeps running.</p><button class="button primary" data-action="resume">Resume exam ${icon('arrow')}</button></div>` : ''}
  ${libraryTab === 'history' ? history : `${categoryLinks}${renderExamCategory('official',completed)}${renderExamCategory('unofficial',completed)}<aside class="info-strip"><div class="info-item">${icon('expand')}<div><h3>A space to focus</h3><p>Real timing, a familiar test interface, and no calculator. Have your scratch paper ready.</p></div></div><div class="info-item">${icon('check')}<div><h3>Learn from every answer</h3><p>Compare your choices with the source’s answer key. Score estimates appear only when a published curve is available.</p></div></div><div class="info-item">${icon('lock')}<div><h3>Your practice stays yours</h3><p>Progress is saved in this browser. No account, no upload, and no sign-in required.</p></div></div></aside>`}</main>${footer()}`;
}
function tool(label, action, symbol, extra='') { return `<button class="tool-button ${action === 'next' ? 'next' : action === 'back' ? 'back' : ''}" data-action="${action}" ${extra}><span>${label}</span>${icon(symbol)}</button>`; }
function shell(content, mode = 'instructions') {
  const review = mode === 'review', running = mode === 'exam';
  const e = running || review ? examFor(attempt) : selectedExam;
  const idx = review ? reviewIndex : attempt?.current || 0;
  const tools = running || review
    ? `${tool(review ? 'Results' : 'Exit Section', review ? 'show-results' : 'exit-section','exit')}${tool('Mark','mark','mark',review ? 'disabled' : `aria-pressed="${Boolean(attempt.marked[idx])}"`)}${tool('Review','review-list','grid')}${tool('Help','help','help')}${tool('Back','back','back',(review ? reviewNeighbor(-1) === undefined : idx === 0) ? 'disabled' : '')}${tool('Next','next','arrow',review && reviewNeighbor(1) === undefined ? 'disabled' : '')}`
    : `${tool('Exit','library','exit')}${tool('Help','help','help')}`;
  return `<main class="test-shell"><header class="test-toolbar"><div class="test-brand"><strong>GRE Mathematics</strong><small>${isUnofficial(e || {}) ? 'UNOFFICIAL PRACTICE EXAM' : 'OFFICIAL ETS QUESTIONS · PRACTICE'}</small></div>${tools}</header><div class="test-status"><span>${running ? `Section 1 of 1 | Question ${idx+1} of ${e.questions.length}` : review ? `Answer Review${reviewScope === 'missed' ? ' (Missed)' : ''} | Question ${idx+1} of ${e.questions.length}` : mode === 'complete' ? 'Test Complete' : 'Mathematics Test | Instructions'}</span>${running ? `<div class="timer-group"><span id="timer" class="timer-value ${remainingSeconds(attempt) <= 300 ? 'urgent' : ''}" ${attempt.hideTime ? 'hidden' : ''}>${formatTime(remainingSeconds(attempt))}</span><button class="time-toggle" data-action="toggle-time">${icon('eye')}<span id="time-label">${attempt.hideTime ? 'Show' : 'Hide'} Time</span></button></div>` : `<span>${esc(e?.form || '')}</span>`}</div>${running && attempt.warningShown && !attempt.warningDismissed ? '<div class="timer-warning" role="alert">Five minutes or less remain. <button data-action="dismiss-warning">Dismiss</button></div>' : ''}<div class="exam-content">${content}</div><footer class="test-bottom"><span>GRE MATHEMATICS SUBJECT TEST · PRACTICE SIMULATION</span><span>${review ? 'Answers locked · Review mode' : running ? 'Answers saved automatically · Timer continues while away' : mode === 'complete' ? 'Test complete · Answers locked' : 'The test clock has not started'}</span></footer></main>`;
}
function renderInstructions() {
  const e = selectedExam;
  let content;
  if (step === 0) content = `<h1>Welcome to the Mathematics Test</h1><p>You are about to take <strong>${esc(e.title)} (${esc(e.form)})</strong>.</p><p class="exam-origin"><strong>${categoryLabel(e)}</strong> · ${esc(e.publisher || 'Educational Testing Service')}${!hasScoreCurve(e) ? ' · No published score curve' : isUnofficial(e) ? ' · Publisher’s approximate score curve' : ''}</p><p>This practice session contains ${e.questions.length} questions and allows <strong>2 hours and 50 minutes</strong>.</p><p>There is one continuous section. You may work on questions in any order, skip a question, and change an answer while time remains.</p><div class="instruction-box"><p><strong>Before you begin</strong></p><ul><li>Set aside 170 uninterrupted minutes and prepare your scratch paper.</li><li>No calculator is provided or permitted in the standard Subject Test.</li><li>Use a desktop or laptop for the closest testing experience.</li></ul></div><p>The next screen explains the controls. These directions are not timed.</p>${e.sourceAnnotations ? '<p class="source-annotation">This source scan includes some handwritten marks. They are preserved with the original printed questions.</p>' : ''}`;
  else if (step === 1) content = `<h1>Using the testing interface</h1><ul><li><strong>Next / Back:</strong> move between questions. You can leave an answer blank.</li><li><strong>Mark:</strong> flag any question to revisit. A marked answer still counts.</li><li><strong>Review:</strong> open the question list showing answered, unanswered, unseen, and marked items. Select a question, then choose <strong>Go to Question</strong>.</li><li><strong>Hide Time:</strong> hide the countdown. This practice app shows it again in the last five minutes.</li><li><strong>Help:</strong> reopen directions. The clock continues while any dialog is open.</li><li><strong>Exit Section:</strong> finish early after confirmation. Submitted answers are locked.</li></ul><div class="instruction-box"><p><strong>Practice conveniences:</strong> answers are saved locally, and refreshing or closing the page does not pause the clock. This is an ETS-style reconstruction; the original printed questions are preserved as images.</p></div>`;
  else content = `<h1>Mathematics Test Directions</h1><p>Each question has five answer choices. Select the <strong>one best answer</strong> by clicking its letter below the original question.</p><p>All questions have equal weight. Current GRE scoring counts correct answers without deducting points for incorrect answers, so try to answer every question.</p><div class="instruction-box"><p><strong>${hasScoreCurve(e) ? 'Scoring for this exam' : 'Raw results only · No published score curve'}</strong></p><p>${scoringExplanation(e)}</p></div><p>The timer starts when you select <strong>Begin Test</strong>. There are no scheduled breaks and no pause control.</p>`;
  app.innerHTML = shell(`<section class="instructions"><p class="instruction-steps">BEFORE YOU BEGIN · ${step+1} OF 3</p>${content}<div class="instruction-actions">${step > 0 ? '<button class="button" data-action="instruction-back">Back</button>' : ''}<button class="button primary" data-action="${step === 2 ? 'begin' : 'instruction-next'}">${step === 2 ? 'Begin Test' : 'Continue'} ${icon('arrow')}</button></div></section>`);
}
function renderQuestion() {
  const e = examFor(attempt), reviewing = screen === 'review', idx = reviewing ? reviewIndex : attempt.current;
  const q = e.questions[idx], selected = attempt.answers[idx];
  const result = reviewing ? scoreAttempt(e,attempt).results[idx] : null;
  const feedback = reviewing ? `<div class="review-feedback ${result.isCorrect ? 'correct' : ''}"><p><strong>${result.status === 'correct' ? 'Correct' : result.status === 'incorrect' ? 'Incorrect' : 'Unanswered'}</strong><br>Your answer: <strong>${selected || '—'}</strong> &nbsp; Correct answer: <strong>${esc(q.answer)}</strong>${attempt.marked[idx] ? ' &nbsp; · Marked for review' : ''}</p><button class="button" data-action="show-results">Back to results</button></div>` : '';
  const images = q.images || [q.image];
  const content = `<section class="question-layout" aria-label="Question ${idx+1}">${feedback}<div class="question-image-container"><div>${images.map((src,i) => `<img class="question-image" src="${esc(src)}" alt="${esc(q.text || q.alt || `Original question ${idx+1} and answer choices A through E from ${e.form}${images.length > 1 ? `, part ${i+1}` : ''}`)}" ${i > 0 ? 'loading="lazy"' : 'fetchpriority="high"'} ${q.displayWidth ? `style="width:${q.displayWidth}px"` : ''}>`).join('')}</div></div><fieldset class="answer-set" ${reviewing ? 'disabled' : ''}><legend>${reviewing ? 'Answer-key choice shown in green' : 'Select one answer.'}</legend>${ANSWER_CHOICES.map(letter => `<label class="answer-option ${reviewing && letter === q.answer ? 'is-correct' : reviewing && letter === selected ? 'is-incorrect' : ''}"><input type="radio" name="answer" value="${letter}" ${selected === letter ? 'checked' : ''} aria-label="Answer ${letter}${reviewing && letter === q.answer ? ', correct answer' : ''}"><span>${letter}</span></label>`).join('')}</fieldset>${!reviewing ? `<div class="question-tools"><button class="clear-answer" data-action="clear" ${selected === null ? 'disabled' : ''}>Clear answer</button><span class="marked-note" id="marked-note">${attempt.marked[idx] ? `${icon('mark')} Marked for review` : ''}</span></div>` : ''}<p class="scan-disclosure">Original ${esc(e.form)} question · ${q.sourcePage ? `PDF page ${q.sourcePage} · ` : ''}${reviewing ? `<a href="${esc(e.sourceFile)}#page=${q.sourcePage || 1}" target="_blank" rel="noopener">Open source booklet</a>` : 'Select your answer using the letters above.'}</p></section>`;
  app.innerHTML = shell(content, reviewing ? 'review' : 'exam');
  for (const img of document.querySelectorAll('.question-image')) img.addEventListener('error', () => {
    if (!img.parentElement.querySelector('.image-error')) img.insertAdjacentHTML('afterend', `<p class="image-error">This question image could not load. <a href="${esc(e.sourceFile)}#page=${q.sourcePage || 1}" target="_blank" rel="noopener">Open the source PDF at this question</a>.</p>`);
  });
  const next = e.questions[idx+1]; if (next?.image) { const preload = new Image(); preload.src = next.image; }
}
function renderComplete() {
  selectedExam = examFor(attempt);
  app.innerHTML = shell(`<section class="instructions"><p class="instruction-steps">END OF TEST</p><h1>${attempt.finishReason === 'time-expired' ? 'Time has expired.' : 'Your test is complete.'}</h1><p>Your answers have been saved and can no longer be changed.</p><p>The GRE asks you to report or cancel scores at the end of the test. Make that choice below to finish the practice workflow.</p><div class="instruction-box"><p><strong>For this practice session</strong></p><p>Neither choice sends anything to ETS or to a school. Your local attempt and question review are kept either way. Official test results are not normally accompanied by an answer-by-answer review.</p></div><div class="instruction-actions"><button class="button" data-action="cancel-scores">Cancel Scores</button><button class="button primary" data-action="report-scores">Report Scores ${icon('arrow')}</button></div></section>`, 'complete');
}
function renderResults() {
  const e = examFor(attempt), s = scoreAttempt(e,attempt);
  const historical = e.scoring.method === 'quarter-penalty';
  const curve = hasScoreCurve(e);
  const rows = s.results.filter(r => filter === 'all' || (filter === 'marked' ? r.marked : filter === 'missed' ? !r.isCorrect : r.status === filter));
  const elapsed = Math.min(e.durationSeconds, Math.max(0, Math.round((attempt.finishedAt-attempt.startedAt)/1000)));
  app.innerHTML = `${header()}<main class="report"><div class="report-top"><div><p class="eyebrow">Your practice, in perspective</p><h1>Every answer is a next step.</h1><p class="report-meta">${esc(e.title)} · ${esc(e.form)} · ${prettyDate(attempt.finishedAt)}<br>${categoryLabel(e)} · ${esc(e.publisher || 'Educational Testing Service')}<br>${attempt.finishReason === 'time-expired' ? 'Time expired' : 'Submitted'} · ${formatTime(elapsed)} used${attempt.scoreDecision === 'cancel' ? ' · Scores canceled in simulation; practice review retained' : ''}</p></div><button class="button" data-action="export">${icon('download')} Export results</button></div><div class="report-grid"><div class="score-cell main-score"><small>${curve ? estimateLabel(e) : 'Raw practice result'}</small><strong>${curve ? (s.scaledScore ?? '—') : `${s.correct} / ${s.total}`}</strong><span>${!curve ? 'No published score curve' : s.scaledScore === null ? 'Outside the published conversion table' : isUnofficial(e) ? 'Publisher approximation · Not ETS-equated' : `${esc(e.form)} published conversion`}</span></div><div class="score-cell"><small>Correct</small><strong>${s.correct}<span style="display:inline;font-size:18px"> / ${s.total}</span></strong><span>${Math.round(s.accuracy*100)}% of all questions</span></div><div class="score-cell"><small>Incorrect</small><strong>${s.incorrect}</strong><span>Review the answer key below</span></div><div class="score-cell"><small>Unanswered</small><strong>${s.omitted}</strong><span>${s.omitted ? 'Include these in your next review' : 'Every question attempted'}</span></div></div><p class="scoring-note"><strong>Number correct: ${s.currentRaw}/${s.total} (${Math.round(s.accuracy*100)}%).</strong> ${!curve ? 'No published score curve is available for this exam. Your result is a raw practice score; no scaled GRE score or percentile has been estimated.' : `${historical ? `Booklet raw score: ${s.correct} − (${s.incorrect} × ¼) = ${s.historicalRaw}; rounded to ${s.roundedRaw} for this source’s table.` : `This booklet maps ${s.roundedRaw} correct answers using its published score table.`} ${isUnofficial(e) ? 'This unofficial test uses the publisher’s approximate conversion, not an ETS-equated score or a current GRE score prediction.' : historical ? 'The historical estimate uses a guessing penalty that the current exam does not use.' : 'This is a booklet practice estimate, not an official score.'} ${s.scaledScore === null ? 'The booklet supplies no scaled score for this raw score; no value has been invented or extrapolated.' : ''}`} ${['gr8767','gr9367'].includes(e.id) ? 'This pre-October-2001 score uses the older scale and is not comparable with later Mathematics scores.' : ''} <button class="text-button" data-action="scoring">View scoring details ↗</button></p><div class="report-actions"><button class="button primary" data-action="review-missed" ${s.incorrect+s.omitted ? '' : 'disabled'}>Review missed questions ${icon('arrow')}</button><button class="button" data-action="review-all">Review all answers</button><button class="button" data-action="library">Back to exam library</button></div><div class="table-heading"><h2>Your answer sheet</h2><label class="review-filter">Show <select id="result-filter" aria-label="Filter results"><option value="all">All questions</option><option value="missed">Incorrect &amp; unanswered</option><option value="incorrect">Incorrect</option><option value="omitted">Unanswered</option><option value="correct">Correct</option><option value="marked">Marked</option></select></label></div><table class="report-table"><thead><tr><th scope="col">Question</th><th scope="col">Your answer</th><th scope="col">Correct answer</th><th scope="col">Result</th><th scope="col"><span class="sr-only">Review question</span></th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.number}${r.marked ? ' ⚑' : ''}</td><td>${r.selection || '—'}</td><td>${r.correctAnswer}</td><td class="result-${r.status}">${r.status === 'omitted' ? 'Unanswered' : r.status === 'correct' ? 'Correct' : 'Incorrect'}</td><td><button class="text-button" data-action="review-question" data-index="${r.index}">Review <span aria-hidden="true">↗</span><span class="sr-only"> question ${r.number}</span></button></td></tr>`).join('') || '<tr><td colspan="5">No questions match this filter.</td></tr>'}</tbody></table></main>${footer()}`;
  document.querySelector('#result-filter').value = filter;
}
function openModal(title,body,buttons='',className='') {
  lastModalFocus = document.activeElement;
  modal.className = className;
  modal.innerHTML = `<header class="modal-header"><h2 id="dialog-title">${title}</h2><button class="modal-close" data-action="close" aria-label="Close dialog">×</button></header><div class="modal-body">${body}</div><footer class="modal-footer">${buttons || '<button class="button" data-action="close">Close</button>'}</footer>`;
  modal.setAttribute('aria-labelledby','dialog-title');
  if (!modal.open) modal.showModal();
}
function closeModal() { modal.close(); if (lastModalFocus?.isConnected) lastModalFocus.focus(); }
function openReview() {
  reviewSelected = screen === 'review' ? reviewIndex : attempt.current;
  reviewSort = 'number'; renderReviewModal();
}
function renderReviewModal() {
  const finished = screen === 'review';
  const e = examFor(attempt);
  const statuses = attempt.answers.map((a,i) => a ? 'Answered' : attempt.visited[i] ? 'Not Answered' : 'Not Encountered');
  const indices = e.questions.map((_,i) => i).sort((a,b) => reviewSort === 'status' ? statuses[a].localeCompare(statuses[b]) || a-b : reviewSort === 'marked' ? Number(attempt.marked[b])-Number(attempt.marked[a]) || a-b : a-b);
  const body = `<p class="review-description">Select a question, then choose <strong>Go to Question</strong>. ${finished ? 'This test is complete; answers cannot be changed.' : 'You can return to any question while time remains.'}</p><div class="review-legend"><span>${attempt.answers.filter(Boolean).length} answered</span><span>${attempt.answers.filter(a => !a).length} unanswered</span><span>${attempt.marked.filter(Boolean).length} marked</span></div><div class="review-table-container"><table class="review-table"><thead><tr><th scope="col"><button class="text-button" data-action="sort-review" data-sort="number">Number ↕</button></th><th scope="col"><button class="text-button" data-action="sort-review" data-sort="status">Status ↕</button></th><th scope="col"><button class="text-button" data-action="sort-review" data-sort="marked">Marked ↕</button></th></tr></thead><tbody>${indices.map(i => `<tr data-review-row="${i}" class="${i === reviewSelected ? 'selected' : ''}"><td><label><input type="radio" name="review-question" value="${i}" ${i === reviewSelected ? 'checked' : ''} aria-label="Question ${i+1}, ${statuses[i]}${attempt.marked[i] ? ', marked' : ''}"> &nbsp;${i+1}</label></td><td>${statuses[i]}</td><td class="mark-cell">${attempt.marked[i] ? '<span aria-label="Marked">✓</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  openModal('Review', body, '<button class="button" data-action="close">Return</button><button class="button primary" data-action="goto-question">Go to Question</button>', 'review-dialog');
  setTimeout(() => modal.querySelector('.selected')?.scrollIntoView({block:'nearest'}),0);
}
function openHelp() {
  openModal('Mathematics Test Help', `<p>Choose one answer from A through E. Use <strong>Back</strong> and <strong>Next</strong> to navigate, <strong>Mark</strong> to flag a question, and <strong>Review</strong> to see every question and its status.</p><p>You have 170 minutes for one continuous section. There is no calculator and no pause. The timer continues in Help, Review, other tabs, and after a refresh.</p><p>Current GRE scoring does not penalize wrong answers. Forms with published curves also show a labeled booklet or publisher estimate after submission. Tests without a curve show raw results only.</p><p><strong>Practice keyboard shortcuts:</strong> A–E select an answer; Alt + Left/Right moves between questions; Alt + M marks; Alt + R opens Review. Escape closes dialogs.</p><p>Original question images preserve notation and figures. Use your browser’s zoom controls if needed. Immediate answer review and local saving are practice features.</p>`);
}
function openSources() {
  openModal('Sources & interface notes', `<p>This independent practice room follows ETS’s published Mathematics Subject Test timing and navigation. Its visual shell is reconstructed from the supplied GRE General Test screenshot and ETS’s review-screen example; an exact current Subject Test interface has not been publicly verified.</p><p>One 170-minute session, five choices per question, no calculator, marking, revisiting, and no wrong-answer penalty follow current ETS guidance. Original PDF questions preserve the printed layout; the letter-selection row, local saving, five-minute reminder, and post-test analysis are practice conveniences.</p><h3>Official references</h3><ul class="source-list">${(research.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul><p>Official ETS exams and unofficial publisher tests are kept in separate library categories. Unofficial tests with no published score curve report number correct and percentage only. Any publisher-provided conversion is labeled as an approximation.</p><h3>Included source files</h3><table class="source-table"><thead><tr><th>Exam</th><th>Source and duplicate copies</th></tr></thead><tbody>${exams.map(e => `<tr><td>${esc(e.form)}<br>${categoryLabel(e)}<br>${hasScoreCurve(e) ? isUnofficial(e) ? 'Publisher curve' : 'Booklet curve' : 'No score curve'}</td><td><a href="${esc(e.sourceFile)}" target="_blank" rel="noopener">${esc(e.sourceFile)}</a>${e.duplicateFiles?.length ? `<br>Same questions: ${e.duplicateFiles.map(esc).join(', ')}` : ''}</td></tr>`).join('')}</tbody></table><p>Each exam uses only the conversion supplied by its source. Shared publisher curves are labeled as approximate. Historical penalty estimates are shown separately from current-rule raw scores. Pre-October-2001 scores use the older, noncomparable scale. No current percentiles are inferred.</p><p>Exam content belongs to its original rights holders. Research checked ${esc(research.checkedOn || '2026-09-29')}.</p>`);
}
function openExamInfo(e) {
  openModal(`${esc(e.title)} · ${esc(e.form)}`, `<p><strong>${categoryLabel(e)}</strong> · ${esc(e.publisher || 'Educational Testing Service')}</p><p>${e.questions.length} original multiple-choice questions, with a ${Math.round(e.durationSeconds / 60)}-minute test limit.</p><p><strong>${hasScoreCurve(e) ? 'Scoring' : 'No published score curve'}:</strong> ${scoringExplanation(e)}</p>${e.scoring.notes ? `<p>${esc(e.scoring.notes)}</p>` : ''}${e.editionNotes ? `<p>${esc(e.editionNotes)}</p>` : ''}${e.duplicateNotes ? `<p>${esc(e.duplicateNotes)}</p>` : ''}<p><a href="${esc(e.sourceFile)}" target="_blank" rel="noopener">Open source PDF (includes answers)</a></p>${e.duplicateFiles?.length ? `<p>Duplicate question sets consolidated: ${e.duplicateFiles.map(esc).join(', ')}.</p>` : ''}${e.scoring.keyImage ? `<p><a href="${esc(e.scoring.keyImage)}" target="_blank" rel="noopener">Source answer key</a>${e.scoring.conversionImage && hasScoreCurve(e) ? ` · <a href="${esc(e.scoring.conversionImage)}" target="_blank" rel="noopener">${isUnofficial(e) ? 'Publisher’s approximate score curve' : 'Published score conversion'}</a>` : ''}</p>` : ''}`);
}
function finish(reason='submitted') {
  finishAttempt(attempt,reason); save(); if (modal.open) closeModal(); screen = 'complete'; window.scrollTo(0,0); render(); announce(reason === 'time-expired' ? 'Time has expired. Your answers have been submitted.' : 'Test submitted.');
}
function assertStillRunning() {
  if (screen !== 'exam' || !attempt) return true;
  if (expireAttempt(attempt)) { save(); if (modal.open) closeModal(); screen='complete'; render(); return false; }
  return attempt.status === 'active';
}
function navigate(index) {
  const e = examFor(attempt);
  if (index < 0 || index >= e.questions.length) return;
  if (screen === 'review') reviewIndex = index;
  else { if (!assertStillRunning()) return; visitQuestion(attempt,index); save(); }
  render(); window.scrollTo(0,0); announce(`Question ${index+1} of ${e.questions.length}`);
}
function exportResults() {
  const e = examFor(attempt), score = scoreAttempt(e,attempt);
  const blob = new Blob([JSON.stringify({exam:e.form,title:e.title,category:e.category,publisher:e.publisher,hasPublishedScoreCurve:hasScoreCurve(e),attempt,score,disclaimer:!hasScoreCurve(e)?'Raw practice result only; no published score curve.':isUnofficial(e)?'Unofficial publisher approximation; not an ETS-equated score.':'Practice booklet estimate; not an official GRE score.'},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href=url; link.download=`${e.id}-results-${new Date(attempt.finishedAt).toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function handleAction(action, target) {
  if (!assertStillRunning()) return;
  switch(action) {
    case 'library': libraryTab='exams'; screen='library'; closeModal(); render(); window.scrollTo(0,0); break;
    case 'history': libraryTab='history'; screen='library'; render(); break;
    case 'prepare': {
      const active = activeAttempt();
      if (active) { openModal('An exam is already in progress', '<p>Your current exam is still timed. Resume it and submit that attempt before beginning another exam.</p>', '<button class="button" data-action="close">Return</button><button class="button primary" data-action="resume">Resume exam</button>'); return; }
      selectedExam = exams.find(e=>e.id===target.dataset.id); step=0; screen='instructions'; render(); window.scrollTo(0,0); break;
    }
    case 'exam-info': openExamInfo(exams.find(e=>e.id===target.dataset.id)); break;
    case 'instruction-next': step=Math.min(2,step+1); render(); window.scrollTo(0,0); break;
    case 'instruction-back': step=Math.max(0,step-1); render(); break;
    case 'begin': if(activeAttempt()){handleAction('resume',target);break;} attempt=createAttempt(selectedExam); attempts.push(attempt); save(); screen='exam'; render(); window.scrollTo(0,0); break;
    case 'resume': attempt=activeAttempt(); closeModal(); if(attempt){screen='exam'; if(expireAttempt(attempt)){save();screen='complete';}render();window.scrollTo(0,0);} else {screen='library';render();} break;
    case 'back': {const next=screen==='review'?reviewNeighbor(-1):attempt.current-1;if(next!==undefined)navigate(next);break;}
    case 'next': {if(screen==='review'){const next=reviewNeighbor(1);if(next!==undefined)navigate(next);}else if(attempt.current===examFor(attempt).questions.length-1){openReview();}else navigate(attempt.current+1);break;}
    case 'mark': if(screen==='exam'){toggleMark(attempt,attempt.current); save(); const button=app.querySelector('[data-action="mark"]');button.setAttribute('aria-pressed',attempt.marked[attempt.current]);document.querySelector('#marked-note').innerHTML=attempt.marked[attempt.current]?`${icon('mark')} Marked for review`:''; announce(attempt.marked[attempt.current]?'Question marked for review.':'Question unmarked.');}break;
    case 'clear': setAnswer(attempt,attempt.current,null); save(); render(); break;
    case 'toggle-time': attempt.hideTime=!attempt.hideTime; save(); updateTimer(); break;
    case 'dismiss-warning': attempt.warningDismissed=true; save(); document.querySelector('.timer-warning')?.remove(); break;
    case 'review-list': openReview();break;
    case 'sort-review': reviewSort=target.dataset.sort;renderReviewModal();break;
    case 'goto-question': closeModal();if(screen==='review'&&!reviewIndices().includes(reviewSelected))reviewScope='all';navigate(reviewSelected);break;
    case 'help': openHelp();break;
    case 'close': closeModal();break;
    case 'sources': openSources();break;
    case 'scoring': openExamInfo(examFor(attempt));break;
    case 'exit-section': {const omitted=attempt.answers.filter(a=>!a).length;openModal('End this section?',`<p>You have <strong>${omitted} unanswered question${omitted===1?'':'s'}</strong> and ${attempt.marked.filter(Boolean).length} marked for review.</p><p>If you end the section, you cannot return to change your answers. The clock continues until you confirm.</p>`, '<button class="button" data-action="close">Return to Test</button><button class="button danger" data-action="confirm-finish">End Section</button>');break;}
    case 'confirm-finish': finish();break;
    case 'report-scores': attempt.scoreDecision='report';save();screen='results';filter='all';render();break;
    case 'cancel-scores': openModal('Cancel scores?', '<p>This simulates the end-of-test choice. Your saved practice attempt and answer review will remain available, labeled as canceled in the simulation.</p>','<button class="button" data-action="close">Return</button><button class="button danger" data-action="confirm-cancel">Cancel Scores</button>');break;
    case 'confirm-cancel': attempt.scoreDecision='cancel';save();closeModal();screen='results';filter='all';render();break;
    case 'results': attempt=attempts.find(a=>a.id===target.dataset.id);screen='results';filter='all';render();window.scrollTo(0,0);break;
    case 'show-results': screen='results';render();window.scrollTo(0,0);break;
    case 'review-all': reviewScope='all';reviewIndex=0;screen='review';render();window.scrollTo(0,0);break;
    case 'review-missed': {const r=scoreAttempt(examFor(attempt),attempt).results.find(r=>!r.isCorrect);if(r){reviewScope='missed';reviewIndex=r.index;screen='review';render();window.scrollTo(0,0);}break;}
    case 'review-question': reviewScope='all';reviewIndex=Number(target.dataset.index);screen='review';render();window.scrollTo(0,0);break;
    case 'export': exportResults();break;
  }
}
function updateTimer() {
  const active=activeAttempt(); if(!active)return;
  if(expireAttempt(active)) {
    save(); if(attempt?.id===active.id && screen==='exam'){if(modal.open)closeModal();screen='complete';render();announce('Time has expired. Answers are now locked.');}else if(screen==='library')render();return;
  }
  const secs=remainingSeconds(active);
  const timer=document.querySelector('#timer'), resume=document.querySelector('#resume-time');
  if(resume)resume.textContent=formatTime(secs);
  if(timer){timer.textContent=formatTime(secs);timer.classList.toggle('urgent',secs<=300);timer.hidden=Boolean(active.hideTime);document.querySelector('#time-label').textContent=timer.hidden?'Show Time':'Hide Time';}
  if(secs<=300&&!active.warningShown){active.warningShown=true;active.hideTime=false;save();if(timer){timer.hidden=false;document.querySelector('#time-label').textContent='Hide Time';}if(screen==='exam'){const status=document.querySelector('.test-status');status?.insertAdjacentHTML('afterend','<div class="timer-warning" role="alert">Five minutes or less remain. <button data-action="dismiss-warning">Dismiss</button></div>');announce('Five minutes or less remain.');}}
}
function guardAction(action) {
  try { action(); } catch(error) {
    if(error.code === 'ATTEMPT_CLOSED') { save(); if(modal.open)closeModal(); screen='complete';render(); }
    else { console.error(error); openModal('Unable to complete that action','<p>Your existing answers have been kept. Please return to the test and try again.</p>'); }
  }
}
document.addEventListener('click', event => {
  const row=event.target.closest('[data-review-row]');
  if(row){reviewSelected=Number(row.dataset.reviewRow);modal.querySelectorAll('[data-review-row]').forEach(r=>r.classList.toggle('selected',r===row));row.querySelector('input').checked=true;}
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;event.preventDefault();
  guardAction(()=>handleAction(target.dataset.action,target));
});
document.addEventListener('change',event=>guardAction(()=>{
  if(event.target.name==='answer'&&screen==='exam'&&assertStillRunning()){setAnswer(attempt,attempt.current,event.target.value);save();document.querySelector('[data-action="clear"]').disabled=false;}
  if(event.target.name==='review-question'){reviewSelected=Number(event.target.value);modal.querySelectorAll('[data-review-row]').forEach(r=>r.classList.toggle('selected',Number(r.dataset.reviewRow)===reviewSelected));}
  if(event.target.id==='result-filter'){filter=event.target.value;renderResults();document.querySelector('#result-filter').focus();}
}));
document.addEventListener('keydown',event=>guardAction(()=>{
  if(modal.open||!['exam','review'].includes(screen)||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(event.altKey){const action={ArrowRight:'next',ArrowLeft:'back',m:'mark',r:'review-list'}[event.key];if(action){event.preventDefault();handleAction(action,{});}return;}
  if(screen==='exam'&&ANSWER_CHOICES.includes(event.key.toUpperCase())&&!['SELECT','TEXTAREA'].includes(event.target.tagName)&&assertStillRunning()){event.preventDefault();setAnswer(attempt,attempt.current,event.key.toUpperCase());save();render();document.querySelector(`input[value="${event.key.toUpperCase()}"]`)?.focus();}
}));
document.addEventListener('visibilitychange',updateTimer);
window.addEventListener('pageshow',updateTimer);
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY && event.key!==null)return;const id=attempt?.id;loadSaved();
  if(id){const fresh=attempts.find(a=>a.id===id);if(fresh)attempt=fresh;else{attempt=null;screen='library';if(modal.open)closeModal();}}
  if(screen==='exam'&&attempt?.status==='finished'){screen='complete';if(modal.open)closeModal();}
  if(!modal.open)render();
});

async function init(){
  try{
    const [dataResponse,researchResponse]=await Promise.all([fetch('data/exams.json'),fetch('research.json').catch(()=>null)]);
    if(!dataResponse.ok)throw new Error('The exam library could not be loaded.');
    const data=await dataResponse.json();exams=data.exams.sort((a,b)=>Number(b.year)-Number(a.year));
    if(!exams.length||exams.some(e=>!e.questions?.length))throw new Error('The exam library is empty or incomplete.');
    research=researchResponse?.ok?await researchResponse.json().catch(()=>({})):{};
    loadSaved();render();setInterval(updateTimer,250);
  }catch(error){app.innerHTML=`<main class="loading"><span class="wordmark">∑ <span>THE PRACTICE ROOM</span></span><h1 style="margin-top:35px">The library couldn’t open.</h1><p>${esc(error.message)}</p><p>Serve this directory over HTTP, for example with <code>python3 -m http.server 8000</code>, then visit <a href="http://localhost:8000">localhost:8000</a>. Opening index.html directly may block local data files.</p><button class="button" onclick="location.reload()">Try again</button></main>`;}
}
init();
