#!/usr/bin/env python3
"""Extract the complete companion with Ghostscript and Pillow (no network).

The PDF's own numbered headings pair every problem with its answer/solution.
Images preserve mathematical typesetting; text supports search and transcripts.
Run --check to verify committed data without rendering or extra dependencies.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'GRE_Mathematics_Companion.pdf'
CATALOG = ROOT / 'data/companion.json'
DPI = 144
BODY_TOP, BODY_BOTTOM = 50, 744


def clean(text):
    return text.replace('Ï', 'fi').replace('\u00ad', '').strip()


def line_text(spans):
    result, end = '', 0
    for span in sorted(spans, key=lambda s: s['x']):
        if span['x'] - end > 1.5:
            result += ' '
        result += span['text']
        end = span['end']
    return clean(result)


def read_pages(xml):
    pages = []
    for raw in re.findall(r'<page>.*?</page>', xml, re.S):
        rows = defaultdict(list)
        raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', raw)
        raw = re.sub(r'&#x([0-9a-fA-F]+);', lambda m: '\ufffd' if int(m[1], 16) < 32 else m[0], raw)
        raw = re.sub(r'&#(\d+);', lambda m: '\ufffd' if int(m[1]) < 32 else m[0], raw)
        for span in ET.fromstring(raw):
            x, y, end, _ = map(int, span.attrib['bbox'].split())
            rows[y].append(dict(x=x, end=end, text=''.join(c.attrib['c'] for c in span),
                                size=float(span.attrib['size']), font=span.attrib['font']))
        pages.append([dict(y=y, text=line_text(spans), spans=spans) for y, spans in sorted(rows.items())])
    return pages


def segments(pages, start, end):
    """Crop only the body, including continuations across page boundaries."""
    result = []
    for p in range(start[0], end[0] + 1):
        top = start[1] if p == start[0] else BODY_TOP
        bottom = end[1] if p == end[0] else BODY_BOTTOM
        rows = [r for r in pages[p - 1] if top <= r['y'] < bottom]
        if not rows:
            continue
        # Keep space for superscripts, tall radicals, fraction bars and descenders.
        top = max(top, min(r['y'] - max(s['size'] for s in r['spans']) - 3 for r in rows))
        bottom = min(bottom, max(r['y'] for r in rows) + 10)
        result.append({'page': p, 'rect': [52, round(top, 2), 560, round(bottom, 2)],
                       'text': '\n'.join(r['text'] for r in rows)})
    assert result, (start, end)
    return result


def extract(pages):
    entries, problems, solutions, events = [], {}, {}, []
    for p, rows in enumerate(pages, 1):
        if 26 <= p <= 625:
            titles = [r for r in rows if any(s['size'] > 20 for s in r['spans'])]
            if titles:
                title = ' '.join(r['text'] for r in titles)
                number, title = title.split(' ', 1)
                assert re.fullmatch(r'\d{3}', number), (p, title)
                definition = next(r for r in rows if r['text'] == 'Definition and key ideas')
                term_rows = [r['text'] for r in rows if titles[-1]['y'] < r['y'] < definition['y']]
                terms = ' '.join(term_rows)
                reference, terms = terms.split('In this entry:', 1)
                first_problem = next(r for r in rows if r['text'].startswith('Problem '))
                entries.append({'id': number, 'title': title, 'chapterTitle': rows[1]['text'],
                                'section': rows[2]['text'], 'terms': clean(terms),
                                'reference': reference.split('Find in compact glossary')[0].strip(),
                                'sourcePage': p, 'exposition': segments(pages, (p, definition['y'] + 4),
                                                                       (p, first_problem['y'] - 16)),
                                'problems': []})
            for r in rows:
                match = re.match(r'Problem (\d{3}\.\d+)\b', r['text'])
                if match:
                    key = match[1]
                    assert key not in problems
                    problems[key] = (p, r['y'])
        if p >= 659:
            for r in rows:
                match = re.match(r'Solution (\d{3}\.\d+)\s*•\s*Answer ([A-E])\b', r['text'])
                if match:
                    assert match[1] not in solutions
                    solutions[match[1]] = {'start': (p, r['y']), 'answer': match[2]}
                    events.append((p, r['y'], match[1]))
                elif BODY_TOP < r['y'] < BODY_BOTTOM and any('LMSans10' in s['font'] and s['size'] >= 10.9 for s in r['spans']):
                    events.append((p, r['y'], None))
    assert len(pages) == 909 and len(entries) == 316
    assert len(problems) == len(solutions) == 1647
    assert problems.keys() == solutions.keys(), 'Missing problem or solution'
    ordered = list(problems.items())
    events.sort()
    solution_ends = {key: (events[i + 1][0], events[i + 1][1] - 16) if i + 1 < len(events)
                     else (909, BODY_BOTTOM) for i, (_, _, key) in enumerate(events) if key}
    entry_map = {e['id']: e for e in entries}
    for i, (key, (p, y)) in enumerate(ordered):
        next_item = ordered[i + 1] if i + 1 < len(ordered) else None
        if next_item and next_item[0].split('.')[0] == key.split('.')[0]:
            end = (next_item[1][0], next_item[1][1] - 16)
        else:
            end = ((next_item[1][0] - 1) if next_item else 625, BODY_BOTTOM)
        solution = solutions[key]
        problem = {'id': key, 'index': i, 'answer': solution['answer'],
                   'question': segments(pages, (p, y + 3), end),
                   'solution': segments(pages, (solution['start'][0], solution['start'][1] + 3), solution_ends[key])}
        entry_map[key.split('.')[0]]['problems'].append(problem)
    assert all(len(e['problems']) >= 5 for e in entries)
    return entries


def generate(xml_path=None):
    from PIL import Image, ImageChops
    gs = shutil.which('gs')
    if not gs:
        raise SystemExit('Ghostscript is required to rebuild the companion.')
    with tempfile.TemporaryDirectory(prefix='gre-companion-') as work:
        work = Path(work)
        if not xml_path:
            xml_path = work / 'text.xml'
            subprocess.run([gs, '-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=txtwrite', '-dTextFormat=0',
                            f'-sOutputFile={xml_path}', str(SOURCE)], check=True)
        entries = extract(read_pages(Path(xml_path).read_text()))
        crops = defaultdict(list)
        for entry in entries:
            groups = [('exposition', entry['exposition'])]
            for problem in entry['problems']:
                groups.extend([(f'q{problem["id"]}', problem['question']),
                               (f's{problem["id"]}', problem['solution'])])
            for name, segments_ in groups:
                for i, segment in enumerate(segments_, 1):
                    segment['image'] = f'assets/companion/{entry["id"]}/{name}-{i}.webp'
                    crops[segment['page']].append(segment)
        page_numbers = sorted(crops)
        for offset in range(0, len(page_numbers), 24):
            batch = page_numbers[offset:offset + 24]
            subprocess.run([gs, '-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pnggray',
                            f'-r{DPI}', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
                            f'-dFirstPage={batch[0]}', f'-dLastPage={batch[-1]}',
                            f'-sOutputFile={work}/p%04d.png', str(SOURCE)], check=True)
            for p in range(batch[0], batch[-1] + 1):
                file = work / f'p{p - batch[0] + 1:04d}.png'
                if p in crops:
                    with Image.open(file) as image:
                        for segment in crops[p]:
                            cropped = image.crop(tuple(round(v * DPI / 72) for v in segment['rect']))
                            # Trim vertical whitespace only. Keep a consistent horizontal math scale.
                            bounds = ImageChops.difference(cropped, Image.new('L', cropped.size, 255)).point(lambda v: 255 if v > 45 else 0).getbbox()
                            assert bounds, segment
                            cropped = cropped.crop((0, max(0, bounds[1] - 8), cropped.width, min(cropped.height, bounds[3] + 8)))
                            target = ROOT / segment['image']
                            target.parent.mkdir(parents=True, exist_ok=True)
                            cropped.save(target, 'WEBP', quality=88, method=6)
                            segment['width'], segment['height'] = cropped.size
                file.unlink()
            print(f'Rendered {min(offset + 24, len(page_numbers))}/{len(page_numbers)} source pages', flush=True)
        chapters = []
        for entry in entries:
            if not chapters or chapters[-1]['title'] != entry['chapterTitle']:
                chapters.append({'id': f'chapter-{len(chapters) + 1}', 'title': entry['chapterTitle'], 'entries': []})
            entry['chapterId'] = chapters[-1]['id']
            chapters[-1]['entries'].append(entry['id'])
            out = ROOT / f'data/companion/{entry["id"]}.json'
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(entry, ensure_ascii=False, separators=(',', ':')) + '\n')
        catalog = {'version': 1, 'title': 'GRE Mathematics Companion', 'sourceFile': SOURCE.name,
                   'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'sourcePages': 909,
                   'entryCount': len(entries), 'problemCount': sum(len(e['problems']) for e in entries),
                   'chapters': chapters, 'entries': [{k: v for k, v in e.items() if k not in ('exposition', 'problems')} |
                       {'problemIds': [p['id'] for p in e['problems']], 'dataFile': f'data/companion/{e["id"]}.json'} for e in entries]}
        CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
        validate()


def validate():
    catalog = json.loads(CATALOG.read_text())
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == catalog['sourceSha256']
    assert len(catalog['entries']) == catalog['entryCount'] == 316
    ids, indices = set(), []
    for summary in catalog['entries']:
        entry = json.loads((ROOT / summary['dataFile']).read_text())
        assert [q['id'] for q in entry['problems']] == summary['problemIds']
        assert len(entry['problems']) >= 5
        for group in [entry['exposition']] + [q[kind] for q in entry['problems'] for kind in ('question', 'solution')]:
            assert group
            for segment in group:
                assert (ROOT / segment['image']).stat().st_size > 100
                assert segment['width'] > 0 and segment['height'] > 0 and segment['text']
        for q in entry['problems']:
            assert q['id'] not in ids and q['answer'] in 'ABCDE'
            ids.add(q['id'])
            indices.append(q['index'])
    assert len(ids) == catalog['problemCount'] == 1647
    assert indices == list(range(1647))
    print('Validated 316 entries, 1,647 paired problems and solutions, source hash, and all assets.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--xml', type=Path, help='Reuse Ghostscript txtwrite TextFormat=0 extraction')
    args = parser.parse_args()
    validate() if args.check else generate(args.xml)
