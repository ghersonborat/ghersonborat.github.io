# GRE Mathematics Practice Room

A complete static practice site for the GRE Mathematics Subject Test. There is no backend, account system, CDN, runtime dependency, or build framework. It works at a GitHub Pages project URL as well as a domain root.

## Run locally

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000**. You can also use `npm run serve`. Serve the files over HTTP; opening `index.html` directly can block the browser's data requests.

## GitHub Pages

Push this directory to a GitHub repository. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. The included `.github/workflows/pages.yml` tests and deploys pushes to `main`; it can also be run manually. Change its branch if your default branch has another name.

For other static hosts, run `python3 scripts/build_site.py` and publish `_site/`. You can also publish the root directly using GitHub Pages “Deploy from a branch”; `.nojekyll` is included. No server-side code is required. The deployment workflow is provided but has not been published to your account.

## Included exams

All **14 supplied PDFs** are accounted for by **13 distinct exams, totaling 857 questions**. The library has separate **Official ETS exams** and **Unofficial practice exams** categories, with quick links to each. Questions, diagrams, and choices come from the source books; original 65- or 66-question counts are preserved.

| Category | Exam | Questions | Scoring shown |
| --- | --- | --- | --- |
| Official ETS | GR3768 (2024 booklet) | 66 | Number correct + published ETS booklet conversion |
| Official ETS | GR1768 (2017 booklet) | 66 | Number correct + published ETS booklet conversion |
| Official ETS | GR0568 | 66 | Correct − incorrect ÷ 4 + historical booklet conversion |
| Official ETS | GR9768 | 66 | Correct − incorrect ÷ 4 + **rescaled 2001** booklet conversion |
| Official ETS | GR9367 | 66 | Correct − incorrect ÷ 4 + original-scale booklet conversion |
| Official ETS | GR8767 | 66 | Correct − incorrect ÷ 4 + original-scale booklet conversion |
| Unofficial | REA Practice Tests I–VI (six separate tests, `f.pdf`) | 66 each | Source answer keys + shared **publisher approximation**, clearly labeled as unofficial |
| Unofficial | Princeton Review Practice Test (2010 fourth edition) | 65 | Source answer key; **no published score curve**, so number correct and percentage only |

The REA book actually supplies a common approximate score table for its six tests. Those estimates are labeled as the publisher's approximation, never as ETS-equated scores. Its scanned copy contains handwritten marks, which are preserved and disclosed on the exam cards and before starting. Princeton Review has answer explanations but no test-specific conversion table; the site does not borrow another exam's curve or invent a scaled score.

The added ETS **Practice Book** repeats GR9768. The added **Practicing to Take the Mathematics Test, Third Edition** contains GR9367 and GR9767; GR9767 is the same question set later reissued as GR9768 with rescaled scoring. These documents are recorded as alternate sources rather than duplicate exam cards. Chapter drills and sample-question sections are not presented as additional full exams.

Earlier duplicate copies remain consolidated: `Practice 1.pdf` is GR1268, with the same questions as GR1768; `Practice 3.pdf`, `Practice 4.pdf`, and `Practice 5.pdf` repeat GR9367, GR8767, and GR9768 respectively. Alternate GR1268 and original-scale GR9767 conversions are retained in `alternateScoring`. Existing exam IDs and answer order are unchanged, preserving saved attempts.

The `67`/`68` ETS form suffix is not a question count. The complete document audit, source hashes, and document-to-exam mapping are recorded in `sourceDocuments` in the catalog and manifest.

## Testing experience

- Three untimed orientation/directions screens before the 170-minute clock starts.
- A single section, no calculator, no pause; Back/Next, Mark, Review, Help, and Hide Time controls.
- A sortable modal review table with answered, not answered, not encountered, and marked states. Select an item and choose Go to Question.
- Answers, marks, visits, and an absolute deadline saved in local browser storage. Refreshing, switching tabs, or closing the browser does not pause time.
- An automatic five-minute reminder and automatic submission at the deadline, including when returning after the deadline.
- End-section confirmation, followed by a simulated report/cancel-scores screen.
- Final correct/incorrect/unanswered counts, answer sheet, filters, missed-question review, and JSON export. Curves are used only where published; raw-only tests explicitly say “No published score curve.” Submitted answers are locked.
- Keyboard-accessible controls and dialogs, responsive layouts, and optional practice shortcuts (A–E, Alt+Left/Right, Alt+M, Alt+R).

Progress belongs to this browser and origin. It does not sync between devices. Clearing browser data removes attempts. If storage is blocked or full, a visible message explains that the open tab must be retained. As with any client-only timer, the app uses the device's clock; it is not intended as a proctored or tamper-proof assessment.

## Fidelity and scoring

Current ETS rules are one continuous **170-minute** Mathematics test with approximately 66 questions, no calculator or scheduled breaks, marking/review, and **no incorrect-answer penalty**. The site reports the current-rule number correct for every exam. Unofficial tests are third-party practice material; any available publisher curve is an approximation. Tests without a curve report raw results only.

Older official forms also show their historical estimate, explicitly labeled: `correct − incorrect / 4`, rounded to the nearest integer before that form's published conversion. A raw score outside a published table produces no invented scaled score. GR8767 and GR9367 use the old scale and cannot be compared with post-2001 Mathematics scores. GR9768 uses its supplied **rescaled** booklet table despite the older question-form date. No current percentile or universal score conversion is fabricated.

The charcoal exam toolbar follows the supplied screenshot; the review layout follows ETS's public example. Both visual references are from the **General GRE**. No complete public walkthrough of the current Mathematics Subject Test interface was verified, so this is an **ETS-style reconstruction**, not a claim of pixel-identical live software. Source citations and details are accessible from the site footer and recorded in `research.json` (checked September 29, 2026).

PDF question images preserve mathematical typography and older scan quality. They do **not** provide a full screen-reader transcription of the mathematics. The separate A–E selection row, arbitrary question jumps, local recovery, keyboard shortcuts, five-minute reminder behavior, and immediate answer analysis are practice conveniences. Reporting/canceling in this app never contacts ETS or any school.

## Validation and maintenance

```sh
npm test
python3 scripts/ingest_exams.py --check
python3 scripts/build_site.py
```

Node.js 18+ runs the tests without installing packages. The committed assets are ready to serve.

An optional browser smoke test uses a locally installed Firefox-family browser without extra packages:

```sh
node scripts/browser-smoke.mjs /path/to/firefox-or-waterfox --all
```

It bundles the actual app, scoring engine, styles, and catalog into temporary offline HTML, checks the exam flow through DOM interactions, and saves screenshots of the official and unofficial exam flows. JSON initialization is synchronous in this harness; it verifies the interface and state transitions, not HTTP delivery. The scenarios check navigation, marks, saved state, scoring, locked review, answer highlighting, timeout handling, category separation, raw-only results, and publisher-curve labels. Use `--scene=exam --viewport=390,844` for a smaller viewport. Browser profiles and screenshots are written only to a temporary directory.

After adding reviewed import fragments, `python3 scripts/merge_imports.py` merges them without duplicating existing question sets. Rebuilding question images is optional and requires Python 3, Pillow, NumPy, and Ghostscript:

```sh
python3 scripts/ingest_exams.py
```

`scripts/exam_manifest.json` contains the reviewed source hashes, crop coordinates, keys, and exact conversion tables. The ingestion script joins questions that span pages, repeats shared directions where needed, and supports answer-key headings spread across solution pages. It writes `data/exams.json`, `assets/questions/`, and original answer-key/conversion-page images in `assets/sources/`. `data/research-keys.json` independently verifies the oldest ETS keys and tables; `data/rea-verified-keys.json` records independent verification of all six REA answer keys. `data/import-ets-audit.json` records the added ETS books’ duplicate forms and alternate scoring. Original PDFs are kept untouched.

Original exam content belongs to ETS, the respective publishers, and their rights holders. This independent study tool is not affiliated with or endorsed by ETS. Official and unofficial materials are identified separately throughout the library, instructions, answer review, results, and exports.
