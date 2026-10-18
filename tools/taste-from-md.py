#!/usr/bin/env python3
"""Propose an aggregate profile from a TASTE.md-style document, then review JSON.

Stage 1: taste-from-md.py input.md --out candidate.json
Stage 2: taste-from-md.py --review candidate.json --out approved.json --approve
The review command prints ONLY aggregate JSON and requires interactive approval.
Never copies source prose, citations, URLs or personal identifiers into output.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess

KEYS = ['palette', 'typography', 'framing', 'motion', 'pacing', 'transition', 'density', 'soundtrack']


def candidate(text):
    signals = {k: {'value': None, 'evidenceCount': 0, 'confidence': 0} for k in KEYS}
    # Conservative lexical proposals, not evidence-count estimation. Every proposal
    # has one document of evidence and low confidence until a human corrects it.
    colours = list(dict.fromkeys(re.findall(r'(?<!\w)#[0-9a-fA-F]{6}\b', text)))[:5]
    if colours:
        signals['palette'] = {'value': colours, 'evidenceCount': 1, 'confidence': 0.25}
    for font in ['IBM Plex Mono', 'Archivo Black', 'Instrument Serif', 'Instrument Sans']:
        if font.lower() in text.lower():
            signals['typography'] = {'value': font, 'evidenceCount': 1, 'confidence': 0.25}
            break
    # Contextual motion, tempo, genre and negation cannot be safely inferred by regex.
    return {'schema': 'fframestudio.taste-profile/1',
            'revision': hashlib.sha256(json.dumps(signals, sort_keys=True).encode()).hexdigest(),
            'signals': signals, 'provenance': {'sourceCount': 1, 'itemCount': 1}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', nargs='?', type=Path)
    parser.add_argument('--review', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--approve', action='store_true')
    args = parser.parse_args()
    if bool(args.input) == bool(args.review):
        parser.error('Choose an input document OR --review candidate.json')
    if args.out.exists():
        parser.error('Output exists; choose a new file to avoid overwriting private data')
    if args.review:
        profile = json.loads(args.review.read_text())
        # Use the application's actual validator, never a second looser schema.
        module = (Path(__file__).resolve().parents[1] / 'web/src/taste/profile.js').as_uri()
        subprocess.run(['node', '--input-type=module', '-e',
                        f"import {{parseProfile}} from '{module}'; let s=''; for await (const c of process.stdin) s+=c; parseProfile(s);"],
                       input=json.dumps(profile), text=True, check=True, capture_output=True)
        print(json.dumps(profile, indent=2))
        if not args.approve or input('Review counts, uncertainty and every dial. Type APPROVE to export: ') != 'APPROVE':
            parser.error('Human review required; nothing exported')
    else:
        if args.approve:
            parser.error('Approval is a separate --review step')
        profile = candidate(args.input.read_text())
        print('Candidate only. Inspect/edit aggregate counts and dials, then run --review with --approve.')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(profile, indent=2) + '\n')
    args.out.chmod(0o600)


if __name__ == '__main__':
    main()
