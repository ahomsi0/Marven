# Replace `const <name> = [ ... ];` blocks in a .mjs with the built grids.
import sys, re
mjs, built = sys.argv[1], open(sys.argv[2]).read()
src = open(mjs).read()
for m in re.finditer(r'// @@(\S+)\n(\[.*?\n\])', built, re.S):
    name, arr = m.group(1), m.group(2)
    var = name.replace('.', '_')
    pat = re.compile(r'(const ' + re.escape(var) + r' = )\[.*?\n\];', re.S)
    if not pat.search(src): raise SystemExit(f'no const {var} in {mjs}')
    src = pat.sub(lambda mm: mm.group(1) + arr + ';', src)
open(mjs, 'w').write(src)
