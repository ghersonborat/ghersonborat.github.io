import { readCompletion, saveCompletion } from './companion-progress.js';

const content = document.querySelector('#book-content');
const chapterNav = document.querySelector('#chapter-nav');
const search = document.querySelector('#concept-search');
const sidebar = document.querySelector('#book-sidebar');
const toggle = document.querySelector('#contents-toggle');
const mobile = matchMedia('(max-width: 800px)');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = number => number.toLocaleString();
const problemAnchor = id => `problem-${id.replace('.', '-')}`;
const problemLink = id => `#${problemAnchor(id)}`;
const announce = text => { document.querySelector('#book-announcer').textContent = text; };
let catalog, problemIds = [], completed = new Set(), currentEntry = null, currentId = null, routeVersion = 0;
const drafts = new Map(), entries = new Map();
let openChapters = new Set(), sidebarOpen = !mobile.matches;

function setSidebar(open, focus = false) {
  sidebarOpen = open;
  document.body.classList.toggle('sidebar-hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
  document.querySelector('#sidebar-backdrop').hidden = !open || !mobile.matches;
  // A mobile drawer must not leave obscured content in the keyboard tab order.
  document.querySelector('#reading').inert = open && mobile.matches;
  if (open && mobile.matches) {
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
  } else {
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
  }
  if (focus) (open ? search : toggle).focus();
}

function completedCount(ids) { return ids.filter(id => completed.has(id)).length; }

function renderProgress() {
  document.querySelector('#total-progress').textContent = `${count(completed.size)} / ${count(problemIds.length)}`;
  document.querySelector('#completion-progress').value = completed.size;
  document.querySelector('#completion-progress').max = problemIds.length;
  for (const summary of catalog.entries) {
    const done = completedCount(summary.problemIds);
    const badge = document.querySelector(`[data-entry-progress="${summary.id}"]`);
    if (badge) {
      badge.textContent = done ? `${done}/${summary.problemIds.length}` : '';
      badge.setAttribute('aria-label', `${done} of ${summary.problemIds.length} quizzes completed`);
    }
  }
  for (const chapter of catalog.chapters) {
    const ids = catalog.entries.filter(entry => entry.chapterId === chapter.id).flatMap(entry => entry.problemIds);
    const badge = document.querySelector(`[data-chapter-progress="${chapter.id}"]`);
    if (badge) badge.textContent = `${completedCount(ids)}/${ids.length}`;
  }
  const progress = document.querySelector('#entry-progress');
  if (progress && currentEntry) progress.textContent = `${completedCount(currentEntry.problems.map(q => q.id))} / ${currentEntry.problems.length} completed`;
  for (const badge of document.querySelectorAll('[data-problem-completed]')) {
    badge.textContent = completed.has(badge.dataset.problemCompleted) ? '✓ Completed' : '';
  }
}

function normalize(text) { return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(); }

function renderSidebar() {
  const query = normalize(search.value.trim());
  const terms = query.split(/\s+/).filter(Boolean);
  const matches = catalog.entries.filter(entry => terms.every(term => normalize(`${entry.id} ${entry.title} ${entry.terms} ${entry.section} ${entry.chapterTitle}`).includes(term)));
  const activeChapter = catalog.entries.find(entry => entry.id === currentId)?.chapterId;
  chapterNav.innerHTML = catalog.chapters.map(chapter => {
    const chapterEntries = matches.filter(entry => entry.chapterId === chapter.id);
    if (!chapterEntries.length) return '';
    let previousSection = '';
    return `<details class="chapter-group" data-chapter="${chapter.id}" ${query || openChapters.has(chapter.id) || chapter.id === activeChapter ? 'open' : ''}><summary><span class="chapter-name">${esc(chapter.title.replace('Supplement. Breadth beyond the book', 'Breadth supplement'))}</span><span class="chapter-count" data-chapter-progress="${chapter.id}" aria-label="Chapter quiz completion"></span></summary><ol>${chapterEntries.map(entry => {
      const section = entry.section !== previousSection ? `<li class="chapter-section">${esc(entry.section)}</li>` : '';
      previousSection = entry.section;
      return `${section}<li><a class="entry-link" href="#entry-${entry.id}" ${entry.id === currentId ? 'aria-current="page"' : ''}><span class="entry-number">${entry.id}</span><span class="entry-name">${esc(entry.title)}</span><span class="entry-count" data-entry-progress="${entry.id}"></span></a></li>`;
    }).join('')}</ol></details>`;
  }).join('') || '<p class="sidebar-loading">No concepts found. Try another term.</p>';
  const status = document.querySelector('#search-status');
  status.hidden = !query;
  status.textContent = `${matches.length} concept${matches.length === 1 ? '' : 's'} found`;
  renderProgress();
}

function readerFooter() {
  return '<footer class="reader-footer">From the supplied GRE Mathematics Companion · Readability edition, 6 October 2026.<br>Independent study material. Not affiliated with or endorsed by ETS or The Princeton Review.</footer>';
}

function renderHome() {
  const next = problemIds.find(id => !completed.has(id));
  document.title = 'GRE Mathematics Companion · The Practice Room';
  content.innerHTML = `<section class="welcome"><p class="eyebrow">A companion to your practice</p><h1>Big ideas.<br>One concept <em>at a time.</em></h1><p class="welcome-intro">Build the understanding behind each answer. Explore the definitions, work through a few problems, and learn from a complete solution while the question is still fresh.</p><div class="welcome-stats"><div><strong>316</strong><span>concepts to explore</span></div><div><strong>1,647</strong><span>quizzes with solutions</span></div><div><strong>11</strong><span>chapters &amp; supplement</span></div></div><div class="welcome-actions"><a class="button primary" href="#entry-001">Start with precalculus <span aria-hidden="true">→</span></a><a class="button" href="${next ? problemLink(next) : '#entry-001'}">${completed.size && next ? 'Next unfinished quiz' : next ? 'Jump into practice' : 'Revisit the concepts'} <span aria-hidden="true">↗</span></a></div><h2 class="section-heading">Explore the companion</h2><div class="chapter-cards">${catalog.chapters.map((chapter, i) => {
    const chapterEntries = catalog.entries.filter(entry => entry.chapterId === chapter.id);
    const quizzes = chapterEntries.reduce((total, entry) => total + entry.problemIds.length, 0);
    return `<a class="chapter-card" href="#entry-${chapter.entries[0]}"><span>${i === 10 ? '+' : String(i + 1).padStart(2, '0')}</span><div><strong>${esc(chapter.title.replace(/^\d+\. /, '').replace('Supplement. Breadth beyond the book', 'Breadth supplement'))}</strong><small>${chapterEntries.length} concepts · ${quizzes} quizzes</small></div></a>`;
  }).join('')}</div><div class="welcome-note"><strong>A little practice, with immediate feedback.</strong><br>Select an answer and check it to reveal the correct choice and the original worked solution. Completed quizzes stay marked in this browser for up to a year. Your cookie records only which problems you have completed; reading pages and draft answers are never saved.</div></section>${readerFooter()}`;
}

function fragments(segments, label, eager = false) {
  return segments.map((segment, i) => `<figure class="source-fragment" tabindex="0" aria-label="${esc(label)}${segments.length > 1 ? `, part ${i + 1}` : ''}; scroll horizontally on a small screen"><img src="${esc(segment.image)}" width="${segment.width}" height="${segment.height}" loading="${eager && i === 0 ? 'eager' : 'lazy'}" alt="${esc(label)}${segments.length > 1 ? `, part ${i + 1}` : ''}. A text transcript follows." decoding="async"></figure>`).join('');
}

function transcript(segments) {
  return `<details class="text-transcript"><summary>Text transcript</summary><p class="transcript-note">Extracted from the PDF. Use the typeset version above for exact mathematical notation.</p><div class="transcript-body">${esc(segments.map(s => s.text).join('\n\n'))}</div></details>`;
}

function quizHTML(problem, i) {
  const draft = drafts.get(problem.id) || {};
  const revealed = draft.submitted || draft.review;
  const correct = draft.choice === problem.answer;
  return `<article class="quiz-card" id="${problemAnchor(problem.id)}" data-problem="${problem.id}"><div class="quiz-heading"><h3><a href="${problemLink(problem.id)}">Problem ${problem.id}</a><span class="quiz-number">${i + 1} of ${currentEntry.problems.length}</span></h3><span class="completion-badge" data-problem-completed="${problem.id}">${completed.has(problem.id) ? '✓ Completed' : ''}</span></div>${fragments(problem.question, `Problem ${problem.id}, question and answer choices`)}${transcript(problem.question)}<form data-quiz="${problem.id}"><fieldset class="quiz-choices" ${revealed ? 'disabled' : ''}><legend>${revealed ? 'Answer choices' : 'Choose your answer'}</legend>${['A','B','C','D','E'].map(choice => {
    const isAnswer = revealed && choice === problem.answer;
    const isWrong = draft.submitted && choice === draft.choice && !correct;
    return `<label class="quiz-choice ${isAnswer ? 'is-correct' : isWrong ? 'is-incorrect' : ''}"><input type="radio" name="choice-${problem.id}" value="${choice}" required ${draft.choice === choice ? 'checked' : ''}><span>${choice}</span>${isAnswer || isWrong ? `<span class="choice-verdict" aria-label="${isAnswer ? 'Correct answer' : 'Incorrect selection'}">${isAnswer ? '✓' : '×'}</span>` : ''}</label>`;
  }).join('')}</fieldset><div class="quiz-actions">${revealed ? `<button type="button" class="button" data-retry="${problem.id}">Try again</button>` : `<button class="button primary" type="submit" ${draft.choice ? '' : 'disabled'}>Check answer <span aria-hidden="true">→</span></button>${completed.has(problem.id) ? `<button type="button" class="text-button" data-review="${problem.id}">Review solution</button>` : '<span class="submit-hint">The worked solution appears after you answer.</span>'}`}</div></form>${revealed ? `<section class="quiz-feedback" tabindex="-1" aria-label="Feedback for problem ${problem.id}"><p class="feedback-verdict ${draft.submitted && !correct ? 'incorrect' : ''}">${draft.submitted ? correct ? '<strong>Correct.</strong>' : `<strong>Not quite.</strong> You chose ${draft.choice}.` : '<strong>Previously completed.</strong>'} The correct answer is <strong>${problem.answer}</strong>.</p><h4>Worked solution</h4>${fragments(problem.solution, `Worked solution to problem ${problem.id}`, true)}${transcript(problem.solution)}<p class="solution-source"><a href="${catalog.sourceFile}#page=${problem.solution[0].page}" target="_blank" rel="noopener">Solution in the original PDF · p. ${problem.solution[0].page} ↗</a></p></section>` : ''}</article>`;
}

function renderEntry(entry) {
  document.title = `${entry.title} · GRE Mathematics Companion`;
  const i = catalog.entries.findIndex(summary => summary.id === entry.id);
  const previous = catalog.entries[i - 1], next = catalog.entries[i + 1];
  content.innerHTML = `<article class="entry"><header class="entry-header"><p class="entry-breadcrumb">${esc(entry.chapterTitle)} <span>/</span> Concept ${entry.id}</p><h1 tabindex="-1">${esc(entry.title)}</h1><div class="entry-meta"><span>${esc(entry.section)}</span><a href="${catalog.sourceFile}#page=${entry.sourcePage}" target="_blank" rel="noopener">PDF p. ${entry.sourcePage} ↗</a><a class="quiz-shortcut" href="${problemLink(entry.problems[0].id)}">${entry.problems.length} quizzes ↓</a></div></header><p class="entry-terms"><strong>In this entry</strong> &nbsp; ${esc(entry.terms)}</p><section aria-labelledby="definition-heading"><h2 id="definition-heading" class="section-heading">Definition and key ideas</h2>${fragments(entry.exposition, `Definition and key ideas: ${entry.title}`, true)}${transcript(entry.exposition)}</section><section class="quiz-section" aria-labelledby="quiz-heading"><div class="quiz-section-heading"><h2 id="quiz-heading" class="section-heading">Put it into practice</h2><span id="entry-progress" class="entry-progress"></span></div><p class="quiz-intro">Take your time. Check an answer to see the correct choice and a worked solution.</p>${entry.problems.map(quizHTML).join('')}</section><nav class="entry-pagination" aria-label="Previous and next concepts">${previous ? `<a href="#entry-${previous.id}" rel="prev"><small>← Previous concept</small>${esc(previous.title)}</a>` : '<span></span>'}${next ? `<a href="#entry-${next.id}" rel="next"><small>Next concept →</small>${esc(next.title)}</a>` : '<a href="#contents"><small>Back to contents →</small>Explore another chapter</a>'}</nav></article>${readerFooter()}`;
  renderProgress();
}

function showError(message, retry = true) {
  content.innerHTML = `<section class="load-error"><h1>The companion couldn’t open.</h1><p>${esc(message)}</p><p><a href="GRE_Mathematics_Companion.pdf">Read the original PDF ↗</a></p>${retry ? '<button class="button" id="retry-load">Try again</button>' : '<a class="button" href="#contents">Back to contents</a>'}</section>`;
}

async function route() {
  const version = ++routeVersion;
  let hash;
  try { hash = decodeURIComponent(location.hash); } catch { hash = '#invalid'; }
  if (hash === '#reading') { document.querySelector('#reading').focus(); return; }
  const entryMatch = hash.match(/^#entry-(\d{3})$/);
  const problemMatch = hash.match(/^#problem-(\d{3})-(\d+)$/);
  const id = entryMatch?.[1] || problemMatch?.[1];
  if (mobile.matches) setSidebar(false);
  if (!hash || hash === '#contents') {
    currentId = null; currentEntry = null;
    renderSidebar(); renderHome(); window.scrollTo(0, 0);
    return;
  }
  const summary = catalog.entries.find(entry => entry.id === id);
  const problemId = problemMatch ? `${id}.${problemMatch[2]}` : null;
  if (!summary || (problemId && !summary.problemIds.includes(problemId))) {
    currentId = null; currentEntry = null;
    renderSidebar(); showError('That concept or problem could not be found.', false); return;
  }
  const sameEntry = currentEntry?.id === id;
  currentId = id;
  renderSidebar();
  chapterNav.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest'});
  if (!sameEntry) {
    currentEntry = null;
    content.innerHTML = '<p class="book-loading">Opening the concept…</p>';
    try {
      let entry = entries.get(id);
      if (!entry) {
        const response = await fetch(summary.dataFile);
        if (!response.ok) throw new Error('The concept could not be loaded. Please try again.');
        entry = await response.json();
        if (entry.id !== id || !entry.exposition?.length || !entry.problems?.length) throw new Error('This concept’s content is incomplete.');
        entries.set(id, entry);
      }
      if (version !== routeVersion) return;
      currentEntry = entry;
      renderEntry(entry);
    } catch (error) {
      if (version === routeVersion) showError(error.message);
      return;
    }
  }
  if (problemId) {
    const target = document.getElementById(problemAnchor(problemId));
    target.scrollIntoView({block:'start'});
    target.querySelector('a').focus({preventScroll:true});
  } else {
    window.scrollTo(0, 0);
    content.querySelector('h1')?.focus({preventScroll:true});
  }
  announce(`${summary.title}. ${summary.problemIds.length} quizzes.`);
}

function replaceQuiz(id, focusFeedback = false) {
  const i = currentEntry.problems.findIndex(q => q.id === id);
  const card = document.getElementById(problemAnchor(id));
  card.outerHTML = quizHTML(currentEntry.problems[i], i);
  renderProgress();
  const updated = document.getElementById(problemAnchor(id));
  if (focusFeedback) {
    updated.querySelector('.quiz-feedback').focus({preventScroll:true});
    updated.querySelector('.quiz-feedback').scrollIntoView({block:'nearest'});
  } else {
    updated.querySelector('input').focus({preventScroll:true});
    updated.scrollIntoView({block:'start'});
  }
}

search.addEventListener('input', () => { if (catalog) renderSidebar(); });
chapterNav.addEventListener('toggle', event => {
  const group = event.target.closest('[data-chapter]');
  if (!group || search.value) return;
  if (group.open) openChapters.add(group.dataset.chapter); else openChapters.delete(group.dataset.chapter);
}, true);
toggle.addEventListener('click', () => setSidebar(!sidebarOpen, true));
document.querySelector('#sidebar-backdrop').addEventListener('click', () => setSidebar(false, true));
mobile.addEventListener('change', () => setSidebar(!mobile.matches));
document.addEventListener('click', event => {
  const retry = event.target.closest('[data-retry]'), review = event.target.closest('[data-review]');
  if (retry) { drafts.delete(retry.dataset.retry); replaceQuiz(retry.dataset.retry); }
  if (review) { drafts.set(review.dataset.review, {review:true}); replaceQuiz(review.dataset.review, true); }
  if (event.target.closest('#retry-load')) { if (catalog) route(); else init(); }
  // Clicking the already-selected hash should still scroll and close the drawer.
  const link = event.target.closest('a[href^="#"]');
  if (link && link.getAttribute('href') === location.hash) { event.preventDefault(); route(); }
});
content.addEventListener('change', event => {
  const form = event.target.closest('form[data-quiz]');
  if (!form || event.target.type !== 'radio') return;
  drafts.set(form.dataset.quiz, {choice: event.target.value});
  form.querySelector('[type="submit"]').disabled = false;
});
content.addEventListener('submit', event => {
  const form = event.target.closest('form[data-quiz]');
  if (!form || !currentEntry) return;
  event.preventDefault();
  const problem = currentEntry.problems.find(q => q.id === form.dataset.quiz);
  const draft = drafts.get(problem?.id);
  if (!problem || !draft || draft.submitted || !/^[A-E]$/.test(draft.choice)) return;
  draft.submitted = true;
  completed.add(problem.id);
  const saved = saveCompletion(document, location, problemIds, completed);
  const status = document.querySelector('#cookie-status');
  status.hidden = saved;
  status.textContent = 'Cookies are unavailable. You can keep practicing, but completed quizzes will only be remembered while this tab stays open.';
  replaceQuiz(problem.id, true);
  announce(`${draft.choice === problem.answer ? 'Correct.' : 'Not quite.'} The correct answer is ${problem.answer}. The worked solution is now available.`);
});
content.addEventListener('error', event => {
  if (event.target.tagName !== 'IMG') return;
  const figure = event.target.closest('figure');
  if (figure && !figure.querySelector('.fragment-error')) figure.insertAdjacentHTML('beforeend', '<p class="fragment-error">This part of the page could not load. Try refreshing, use the text transcript, or open the original PDF.</p>');
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sidebarOpen && mobile.matches) { event.preventDefault(); setSidebar(false, true); return; }
  if (event.key === 'Tab' && sidebarOpen && mobile.matches) {
    const controls = [...sidebar.querySelectorAll('a, input, summary')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
      event.preventDefault(); first?.focus();
    }
  }
  if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === '/') { event.preventDefault(); setSidebar(true, true); }
  if (currentId && ['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.target.closest('.source-fragment, .text-transcript, #book-sidebar')) {
    const i = catalog.entries.findIndex(entry => entry.id === currentId);
    const next = catalog.entries[i + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) { event.preventDefault(); location.hash = `entry-${next.id}`; }
  }
});
function syncProgress() {
  if (!catalog) return;
  try { for (const id of readCompletion(document.cookie, problemIds)) completed.add(id); } catch {}
  renderProgress();
}
window.addEventListener('focus', syncProgress);
window.addEventListener('pageshow', syncProgress);
window.addEventListener('hashchange', () => { if (catalog) route(); });
setSidebar(sidebarOpen);

async function init() {
  try {
    const response = await fetch('data/companion.json');
    if (!response.ok) throw new Error('Please serve this website over HTTP and try again.');
    catalog = await response.json();
    problemIds = catalog.entries.flatMap(entry => entry.problemIds);
    if (catalog.version !== 1 || problemIds.length !== catalog.problemCount) throw new Error('The companion catalog is incomplete.');
    try { completed = readCompletion(document.cookie, problemIds); } catch { completed = new Set(); }
    await route();
  } catch (error) { showError(error.message); }
}
init();
