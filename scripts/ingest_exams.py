#!/usr/bin/env python3
"""Rebuild the static question library from reviewed source PDFs.

Dependencies: Python 3, Pillow, numpy, and Ghostscript (gs). No network is used.
Run python3 scripts/ingest_exams.py, or add --check to validate committed assets.
The reviewed exam_manifest.json stores 144-dpi pixel crop coordinates. Questions
may have same-page rects or multi-page segments. Answer-key segments preserve
original answer headings when a book gives its key across solution pages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts' / 'exam_manifest.json'


def validate(catalog: dict) -> None:
    source = json.loads(MANIFEST.read_text())
    reviewed = {exam['id']: exam for exam in source['exams']}
    assert len(catalog['exams']) == len(reviewed) == catalog['uniqueExamCount']
    assert {exam['id'] for exam in catalog['exams']} == set(reviewed)
    paths = set()
    for exam in catalog['exams']:
        questions = exam['questions']
        original = reviewed[exam['id']]
        count = exam['questionCount']
        assert len(questions) == count == len(original['answers']), exam['id']
        assert exam['durationSeconds'] == 170 * 60
        assert exam['category'] in ('official', 'unofficial')
        assert [q['number'] for q in questions] == list(range(1, count + 1))
        assert exam['scoring']['conversion'] == original['scoring']['conversion']
        assert exam['scoring']['method'] == original['scoring']['method']
        assert ''.join(q['answer'] for q in questions) == original['answers']
        if exam['scoring']['conversion']:
            assert exam['scoring'].get('conversionImage'), exam['id']
        else:
            assert not exam['scoring'].get('conversionImage'), exam['id']
        for q in questions:
            assert len(q['answer']) == 1 and q['answer'] in 'ABCDE', (exam['id'], q['number'])
            assert q['image'] not in paths, q['image']
            paths.add(q['image'])
            with Image.open(ROOT / q['image']) as image:
                assert image.width >= 300 and image.height >= 40, q['image']
                assert image.size == (q['imageWidth'], q['imageHeight'])
        assert (ROOT / exam['sourceFile']).is_file()
        for filename in exam.get('duplicateFiles', []):
            assert (ROOT / filename).is_file()
        for asset in ('keyImage', 'conversionImage'):
            if exam['scoring'].get(asset):
                assert (ROOT / exam['scoring'][asset]).is_file()
        assert exam['scoring'].get('keyImage'), exam['id']
    assert len(paths) == catalog['questionTotal']
    documents = catalog.get('sourceDocuments', [])
    if documents:
        names = [doc['sourceFile'] for doc in documents]
        assert len(names) == len(set(names)) == catalog['sourceFileCount']
        assert set(names) == {p.name for p in ROOT.glob('*.pdf')}
        for doc in documents:
            assert doc['examIds'] and set(doc['examIds']) <= set(reviewed)
    print(f'Validated {len(catalog["exams"])} exams, {len(paths)} questions, source coverage, and published scoring data.')


def trim_vertical(image: Image.Image) -> Image.Image:
    """Keep mathematical hairlines while removing broad empty top/bottom areas."""
    ink = (np.asarray(image.convert('L')) < 210).sum(axis=1)
    rows = np.flatnonzero(ink > 5)
    if len(rows):
        image = image.crop((0, max(0, int(rows[0])-14), image.width,
                            min(image.height, int(rows[-1])+15)))
    return image


def segments_for(question: dict) -> list[dict]:
    return question.get('segments') or [
        {'sourcePage': question['sourcePage'], 'rect': rect}
        for rect in question['rects']
    ]


def combine_segments(segments: list[dict], render: Path, *, gap=20) -> Image.Image:
    strips = []
    for segment in segments:
        with Image.open(render / f'p{segment["sourcePage"]:03d}.png') as page:
            strips.append(trim_vertical(page.crop(tuple(segment['rect']))))
    assert strips, 'Empty crop definition'
    result = Image.new('L', (max(im.width for im in strips), sum(im.height for im in strips)+gap*(len(strips)-1)), 255)
    y = 0
    for strip in strips:
        result.paste(strip, (0, y))
        y += strip.height + gap
    return ImageOps.expand(result, border=12, fill='white')


def render_pages(gs: str, pdf: Path, pages: set[int], destination: Path, dpi: int) -> None:
    """Render only needed contiguous page ranges, including books hundreds of pages long."""
    ordered = sorted(pages)
    assert ordered and ordered[0] > 0
    batches = []
    for number in ordered:
        if not batches or number != batches[-1][-1] + 1:
            batches.append([number])
        else:
            batches[-1].append(number)
    for index, batch in enumerate(batches):
        prefix = f'batch{index}-'
        subprocess.run([
            gs, '-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pnggray',
            f'-r{dpi}', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
            f'-dFirstPage={batch[0]}', f'-dLastPage={batch[-1]}',
            f'-sOutputFile={destination}/{prefix}%03d.png', str(pdf),
        ], check=True)
        rendered = sorted(destination.glob(f'{prefix}*.png'))
        assert len(rendered) == len(batch), f'Missing pages from {pdf.name}'
        for number, image in zip(batch, rendered):
            image.rename(destination / f'p{number:03d}.png')


def generate() -> dict:
    source = json.loads(MANIFEST.read_text())
    gs = shutil.which('gs')
    if not gs:
        raise SystemExit('Ghostscript (gs) is required to rebuild the image library.')
    documents = source.get('sourceDocuments', [])
    catalog = {
        'schemaVersion': 2,
        'questionTotal': sum(entry['questionCount'] for entry in source['exams']),
        'sourceFileCount': len(documents),
        'uniqueExamCount': len(source['exams']),
        'sourceDocuments': documents,
        'deduplicationNotes': source.get('deduplicationNotes', 'Repeated question sets are consolidated across editions and multi-exam books.'),
        'imageNotes': 'Questions are image crops of the supplied official and unofficial books. Older scans retain their original quality. These images do not provide a full mathematical screen-reader transcription.',
        'exams': [],
    }
    with tempfile.TemporaryDirectory(prefix='gre-ingest-') as scratch:
        for entry in source['exams']:
            file = ROOT / entry['sourceFile']
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            assert digest == entry['sourceSha256'], f'Source changed; review crop map before regenerating: {file.name}'
            render = Path(scratch) / entry['id']
            render.mkdir()
            pages = {s['sourcePage'] for q in entry['questions'] for s in segments_for(q)}
            pages.update(s['sourcePage'] for s in entry.get('keySegments', []))
            pages.update(entry.get('keyPages', []))
            for field in ('keyPage', 'scalePage'):
                if entry.get(field):
                    pages.add(entry[field])
            render_pages(gs, file, pages, render, source['renderDpi'])
            output = ROOT / 'assets' / 'questions' / entry['id']
            output.mkdir(parents=True, exist_ok=True)
            exam = {k: v for k, v in entry.items()
                    if k not in ('answers', 'questions', 'keyPage', 'keyPages', 'keySegments', 'scalePage')}
            exam['questions'] = []
            for number, (q, answer) in enumerate(zip(entry['questions'], entry['answers']), 1):
                segments = segments_for(q)
                result = combine_segments(segments, render)
                path = output / f'q{number:02d}.webp'
                result.save(path, 'WEBP', lossless=True, method=6)
                question = {
                    'number': number, 'image': str(path.relative_to(ROOT)),
                    'imageWidth': result.width, 'imageHeight': result.height,
                    'answer': answer, 'sourcePage': segments[0]['sourcePage'],
                    'alt': f'{entry["form"]}, question {number}, including the original answer choices. The source PDF is available from the test library.',
                }
                if len({s['sourcePage'] for s in segments}) > 1:
                    question['sourcePages'] = sorted({s['sourcePage'] for s in segments})
                if q.get('answerSourcePage'):
                    question['answerSourcePage'] = q['answerSourcePage']
                exam['questions'].append(question)
            sources = ROOT / 'assets' / 'sources'
            sources.mkdir(exist_ok=True)
            key_path = sources / f'{entry["id"]}-key.webp'
            if entry.get('keySegments'):
                combine_segments(entry['keySegments'], render, gap=12).save(key_path, 'WEBP', lossless=True, method=6)
            else:
                with Image.open(render / f'p{entry["keyPage"]:03d}.png') as image:
                    image.save(key_path, 'WEBP', lossless=True, method=6)
            exam['scoring']['keyImage'] = str(key_path.relative_to(ROOT))
            if entry.get('scalePage') and entry['scoring']['conversion']:
                path = sources / f'{entry["id"]}-scale.webp'
                with Image.open(render / f'p{entry["scalePage"]:03d}.png') as image:
                    image.save(path, 'WEBP', lossless=True, method=6)
                exam['scoring']['conversionImage'] = str(path.relative_to(ROOT))
            else:
                exam['scoring'].pop('conversionImage', None)
            # Alternate editions may use a different source PDF and score scale.
            for index, alternate in enumerate(exam.get('alternateScoring', [])):
                if not alternate.get('keyImage') or not alternate.get('conversionImage'):
                    continue
                evidence_pages = alternate['sourcePages']
                assert len(evidence_pages) == 2, 'Alternate key/curve evidence needs two source pages'
                alternate_render = Path(scratch) / f'{entry["id"]}-alternate-{index}'
                alternate_render.mkdir()
                render_pages(gs, ROOT / alternate['sourceFile'], set(evidence_pages), alternate_render, source['renderDpi'])
                for field, page_number in zip(('keyImage', 'conversionImage'), evidence_pages):
                    with Image.open(alternate_render / f'p{page_number:03d}.png') as image:
                        image.save(ROOT / alternate[field], 'WEBP', lossless=True, method=6)
            catalog['exams'].append(exam)
            print(f'{entry["form"]}: {len(exam["questions"])} question images; {entry["category"]}; {"published curve" if entry["scoring"]["conversion"] else "raw results only"}')
    (ROOT / 'data' / 'exams.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
    validate(catalog)
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check committed assets/data without rebuilding.')
    args = parser.parse_args()
    if args.check:
        validate(json.loads((ROOT / 'data' / 'exams.json').read_text()))
    else:
        generate()


if __name__ == '__main__':
    main()
