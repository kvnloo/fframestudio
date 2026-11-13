"""Pairwise UI/UX critic for the Sound Atlas hill climb (ported from StreetIQ design/hillclimb/critic.py).
python3 critic.py OUT_DIR --pair NAME PARENT.png CANDIDATE.png [--pair ...] [--layers task,layout,text,art] [--model claude-opus-5-5]
Each layer is a separate fresh hermes one-shot (no history, vision only), run in both orders (A/B swapped).
Writes OUT_DIR/verdicts.jsonl and OUT_DIR/summary.json. Raw verdicts are kept; aggregation is in code."""
import argparse, json, os, re, subprocess, hashlib, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
R = json.loads((HERE / 'rubric.json').read_text())

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()[:16]

def sheet(a, b, out):
    A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    h = 1400; A = A.resize((round(A.width * h / A.height), h)); B = B.resize((round(B.width * h / B.height), h))
    s = Image.new('RGB', (A.width + B.width + 60, h + 70), '#ffffff'); d = ImageDraw.Draw(s)
    try: f = ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', 44)
    except OSError: f = ImageFont.load_default()
    s.paste(A, (0, 70)); s.paste(B, (A.width + 60, 70)); d.text((A.width // 2 - 20, 10), 'A', fill='black', font=f); d.text((A.width + 60 + B.width // 2 - 20, 10), 'B', fill='black', font=f)
    s.save(out)

def prompt(layer):
    L = R['layers'][layer]
    crit = '\n'.join(f'- {k}: {v}' for k, v in L['criteria'].items())
    jobs = '\n'.join(f'- {k}: {v}' for k, v in R['jobs'].items())
    return f"""You are a fresh {L['who']} with no history. The attached image shows two phone screens of the same app side by side, labelled A (left) and B (right).
Product: {R['product']}. User: {R['icp']}
Their jobs:
{jobs}
Judge ONLY this layer ({layer}); ignore everything outside it. Criteria, each scored 0-3 for A and for B:
{crit}
If something cannot be read at this resolution, say "unknown" rather than guessing. Do not reward polish that hides a missing function.
Return JSON only, no prose:
{{"layer":"{layer}","A":{{{', '.join(f'"{k}":0' for k in L['criteria'])}}},"B":{{{', '.join(f'"{k}":0' for k in L['criteria'])}}},"preference":"A|B|tie","top_issue_A":"...","top_issue_B":"..."}}"""

def ask(img, layer, model, timeout=240):
    t = time.time()
    p = subprocess.run(['hermes', 'chat', '--oneshot', '-Q', '--provider', 'anthropic', '-m', model, '--image', str(img), '-q', prompt(layer)],
                       capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    m = re.search(r'\{.*\}', p.stdout, re.S)
    try: v = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError: v = None
    return v, round(time.time() - t, 1), p.returncode

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--pair', nargs=3, action='append', metavar=('NAME', 'PARENT', 'CANDIDATE'), required=True)
    ap.add_argument('--layers', default=','.join(R['layers'])); ap.add_argument('--model', default=R['models']['critic'].split()[1])
    a = ap.parse_args(); out = Path(a.out); out.mkdir(parents=True, exist_ok=True); log = (out / 'verdicts.jsonl').open('a')
    done = {(j['pair'], j['layer'], j['order']) for j in map(json.loads, open(out / 'verdicts.jsonl')) if j.get('verdict') is not None} if (out / 'verdicts.jsonl').stat().st_size else set()  # resumable
    for name, parent, cand in a.pair:
        for order, (x, y) in {'PC': (parent, cand), 'CP': (cand, parent)}.items():
            img = out / f'{name}-{order}.png'; sheet(x, y, img)
            for layer in a.layers.split(','):
                if (name, layer, order) in done: continue
                v, secs, rc = ask(img, layer, a.model)
                cand_side = 'B' if order == 'PC' else 'A'
                pref = (v or {}).get('preference')
                rec = dict(pair=name, layer=layer, order=order, model=a.model, rc=rc, secs=secs, sheet=str(img), parent=sha(parent), candidate=sha(cand),
                           verdict=v, winner=None if pref not in ('A', 'B') else ('candidate' if pref == cand_side else 'parent'))
                if rec['verdict'] is None: print(name, layer, order, 'NO VERDICT (rc', rec['rc'], ') - not logged, so a rerun retries it', flush=True); continue
                log.write(json.dumps(rec) + '\n'); log.flush(); print(name, layer, order, rec['winner'], secs, flush=True)
    rows = list(map(json.loads, open(out / 'verdicts.jsonl'))); summ = {}
    for r in rows:
        k = f"{r['pair']}/{r['layer']}"; summ.setdefault(k, {'orders': {}, 'cand_mean': None})
        summ[k]['orders'][r['order']] = r['winner']
        v = r['verdict'] or {}; cs = 'B' if r['order'] == 'PC' else 'A'; ps = 'A' if cs == 'B' else 'B'
        nums = lambda s: [x for x in (v.get(s) or {}).values() if isinstance(x, (int, float))]
        summ[k].setdefault('cand', []).extend(nums(cs)); summ[k].setdefault('par', []).extend(nums(ps))
    for k, s in summ.items():
        o = s['orders']; s['call'] = 'candidate' if o.get('PC') == o.get('CP') == 'candidate' else 'parent' if o.get('PC') == o.get('CP') == 'parent' else 'split/tie'
        s['cand_mean'] = round(sum(s['cand']) / len(s['cand']), 2) if s['cand'] else None; s['par_mean'] = round(sum(s['par']) / len(s['par']), 2) if s['par'] else None
        del s['cand'], s['par']
    (out / 'summary.json').write_text(json.dumps(summ, indent=1)); print(json.dumps(summ, indent=1))

if __name__ == '__main__': main()
