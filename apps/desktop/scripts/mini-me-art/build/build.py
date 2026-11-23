# Authoring DSL -> literal grids in art/directionX.mjs (between // @@layer markers).
# Spec lines:
#   ## name            start a layer
#   c: o S3 s16 t o     centered row (tokens = char[count])
#   13: o S3 ...        row starting at column 13
#   = <48 chars>        literal row
#   -                   empty row ;  -N  N empty rows
#   (rows missing at the end are filled with empty rows)
import re, sys
spec, size = sys.argv[1], int(sys.argv[2])
layers, cur = {}, None
def toks(s):
    out = ''
    for t in s.split():
        m = re.fullmatch(r'(.)(\d*)', t)
        if not m: raise SystemExit(f'bad token {t!r}')
        out += m.group(1) * int(m.group(2) or 1)
    return out
for ln, line in enumerate(open(spec), 1):
    line = line.rstrip('\n')
    if not line.strip() or line.startswith('#!'): continue
    if line.startswith('## '):
        cur = line[3:].strip(); layers[cur] = []; continue
    s = line.strip()
    rows = layers[cur]
    if re.fullmatch(r'-(\d*)', s):
        rows += ['.' * size] * int(s[1:] or 1); continue
    if s.startswith('= '):
        r = s[2:]
    else:
        pos, body = s.split(':', 1)
        c = toks(body)
        if pos.strip() == 'c':
            if (size - len(c)) % 2: raise SystemExit(f'{spec}:{ln} odd centered content len {len(c)}')
            p = (size - len(c)) // 2
        else:
            p = int(pos)
        r = '.' * p + c + '.' * (size - p - len(c))
    if len(r) != size: raise SystemExit(f'{spec}:{ln} len {len(r)}')
    rows.append(r)
for k, v in layers.items():
    if len(v) > size: raise SystemExit(f'{k}: {len(v)} rows')
    v += ['.' * size] * (size - len(v))
for k, v in layers.items():
    print(f'// @@{k}')
    print('[\n' + '\n'.join(f"  '{r}'," for r in v) + '\n]')
