"""Summarise TLC output: verdict, state counts, and a compact trace."""
import re, sys
name = sys.argv[1]
text = sys.stdin.read()
NOFACT = '[k |-> <<"-", "-">>, at |-> -1, trueAt |-> -1, by |-> "-"]'
errs = re.findall(r'^Error: (?!The behavior)(.*)$', text, re.M)
counts = re.search(r'([\d,]+) states generated, ([\d,]+) distinct states found', text)
print(f"== {name}: " + ("; ".join(errs) if errs else "no error"))
if counts: print(f"   {counts.group(1)} states generated, {counts.group(2)} distinct")
if 'Model checking completed. No error has been found.' in text: print("   PASS")
states = re.split(r'^State \d+: ', text, flags=re.M)[1:]
SHOW = ['clock', 'sess', 'pc', 'lockHolder', 'lastSuccessAt', 'failedAt', 'decided',
        'startedAt', 'overlapped', 'failSince', 'outcome', 'resp', 'genAge', 'cacheAge']
prev = {}
for i, st in enumerate(states, 1):
    head, _, body = st.partition('\n')
    act = re.sub(r' line.*', '', head).strip('<> ')
    cur = {}
    for m in re.finditer(r'^/\\ (\w+) = (.*?)(?=^/\\ |\Z)', body, re.M | re.S):
        cur[m.group(1)] = ' '.join(m.group(2).split()).replace(NOFACT, 'NoFact')
    diff = {k: v for k, v in cur.items() if prev.get(k) != v and k in SHOW}
    if i == 1: diff = {'sess': cur.get('sess')}
    print(f"  {i:2} {act}: " + "; ".join(f"{k}={v}" for k, v in diff.items()))
    prev = cur
