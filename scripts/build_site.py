#!/usr/bin/env python3
"""Stage only public website files for a GitHub Pages deployment. No dependencies."""
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '_site'
DEST.mkdir(exist_ok=True)
for name in ('index.html', 'styles.css', 'companion.html', 'companion.css', 'research.json', '.nojekyll'):
    shutil.copy2(ROOT / name, DEST / name)
for name in ('js', 'assets', 'data'):
    shutil.copytree(ROOT / name, DEST / name, dirs_exist_ok=True)
# Include the supplied originals for source links, auditability and duplicate editions.
for source in ROOT.glob('*.pdf'):
    shutil.copy2(source, DEST / source.name)
exams = json.loads((ROOT / 'data' / 'exams.json').read_text())['exams']
for exam in exams:
    assert (DEST / exam['sourceFile']).is_file()
    for q in exam['questions']:
        assert (DEST / q['image']).is_file()
print(f'Staged {len(exams)} exams and {sum(len(e["questions"]) for e in exams)} questions in {DEST}')
companion = json.loads((ROOT / 'data/companion.json').read_text())
assert (DEST / companion['sourceFile']).is_file()
for summary in companion['entries']:
    entry = json.loads((DEST / summary['dataFile']).read_text())
    for group in [entry['exposition']] + [q[kind] for q in entry['problems'] for kind in ('question', 'solution')]:
        for segment in group:
            assert (DEST / segment['image']).is_file()
print(f'Staged {companion["entryCount"]} companion concepts and {companion["problemCount"]} quizzes')
