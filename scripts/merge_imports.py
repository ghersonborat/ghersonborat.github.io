#!/usr/bin/env python3
"""Merge reviewed document imports into the catalog without duplicating question sets.

Run after generating the import-f and import-princeton manifest/catalog fragments.
Existing IDs and answer order are retained so saved browser attempts stay valid.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text())


def write(path, value):
    (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    manifest = read('scripts/exam_manifest.json')
    catalog = read('data/exams.json')
    manifests = {entry['id']: entry for entry in manifest['exams']}
    exams = {entry['id']: entry for entry in catalog['exams']}
    for stem in ('f', 'princeton'):
        imported_manifest = read(f'scripts/import-{stem}.json')['exams']
        imported_catalog = read(f'data/import-{stem}.json')['exams']
        assert {e['id'] for e in imported_manifest} == {e['id'] for e in imported_catalog}
        for entry in imported_manifest:
            if entry['id'] in manifests:
                assert manifests[entry['id']]['answers'] == entry['answers']
            manifests[entry['id']] = entry
        for entry in imported_catalog:
            if entry['id'] in exams:
                assert [q['answer'] for q in exams[entry['id']]['questions']] == [q['answer'] for q in entry['questions']]
            exams[entry['id']] = entry
    audit = read('data/import-ets-audit.json')
    for document in audit['sources']:
        for match in document['matches']:
            for collection in (manifests, exams):
                entry = collection[match['examId']]
                entry['duplicateFiles'] = sorted(set(entry.get('duplicateFiles', []) + [document['sourceFile']]))
                entry.setdefault('duplicateSources', [])
                entry['duplicateSources'] = [item for item in entry['duplicateSources'] if item['sourceFile'] != document['sourceFile']]
                entry['duplicateSources'].append({'sourceFile': document['sourceFile'], **match})
    for alternative in audit.get('alternateScoring', []):
        for collection in (manifests, exams):
            entry = collection[alternative['examId']]
            scoring = alternative['scoring']
            previous = entry.setdefault('alternateScoring', [])
            entry['alternateScoring'] = [s for s in previous if (s['form'], s['sourceFile']) != (scoring['form'], scoring['sourceFile'])] + [scoring]
    for collection in (manifests, exams):
        for entry in collection.values():
            entry.setdefault('category', 'official')
            entry.setdefault('publisher', 'Educational Testing Service')
            entry.setdefault('duplicateFiles', [])
            entry['scoring']['curveType'] = ('none' if not entry['scoring']['conversion'] else
                'publisher-approximation' if entry['category'] == 'unofficial' else 'ets-booklet')
            if entry['id'] == 'gr9768':
                entry['duplicateNotes'] = 'Includes the GR9767 questions from the ETS Third Edition book. The same 66 questions and answer key were reissued as GR9768 with a rescaled conversion; the older GR9767 table is retained in alternateScoring.'
    documents = []
    for filename in sorted(ROOT.glob('*.pdf')):
        linked = [e['id'] for e in exams.values() if filename.name == e['sourceFile'] or filename.name in e['duplicateFiles']]
        assert linked, f'Unaccounted source document: {filename.name}'
        checked = next((doc for doc in audit['sources'] if doc['sourceFile'] == filename.name), {})
        categories = {exams[identifier]['category'] for identifier in linked}
        documents.append({
            **checked, 'sourceFile': filename.name,
            'sourceSha256': hashlib.sha256(filename.read_bytes()).hexdigest(),
            'category': categories.pop() if len(categories) == 1 else 'mixed',
            'examIds': linked,
            'disposition': checked.get('disposition', 'primary-source' if any(e['sourceFile'] == filename.name for e in exams.values()) else 'duplicate-question-set'),
        })
    order = lambda entry: (entry['category'] != 'official', -(entry.get('year') or 0), entry['id'])
    manifest['exams'] = sorted(manifests.values(), key=order)
    catalog['exams'] = sorted(exams.values(), key=order)
    notes = ('Every supplied PDF is accounted for. Whole question sets are consolidated across editions and multi-test books. '
             'GR1268/GR1768 and GR9767/GR9768 retain alternate published conversions without duplicate library entries. '
             'Official ETS exams and unofficial publisher practice tests are separate categories.')
    for target in (manifest, catalog):
        target['schemaVersion'] = 2
        target['sourceDocuments'] = documents
        target['deduplicationNotes'] = notes
    catalog['uniqueExamCount'] = len(exams)
    catalog['questionTotal'] = sum(e['questionCount'] for e in exams.values())
    catalog['sourceFileCount'] = len(documents)
    catalog['imageNotes'] = 'Questions are image crops from the supplied official and unofficial books. Older scans retain their original quality. Mathematical screen-reader transcriptions are not included.'
    write('scripts/exam_manifest.json', manifest)
    write('data/exams.json', catalog)
    print(f'Merged {len(documents)} documents into {len(exams)} unique exams / {catalog["questionTotal"]} questions.')


if __name__ == '__main__':
    main()
