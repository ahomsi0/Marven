import re,sys
def toks(s):
    out=''
    for t in s.split():
        m=re.fullmatch(r'(.)(\d*)',t); out+=m.group(1)*int(m.group(2) or 1)
    return out
for f in sys.argv[1:]:
    for i,l in enumerate(open(f),1):
        if l.startswith('c:') and len(toks(l[2:]))%2: print(f,i,len(toks(l[2:])),l.strip())
