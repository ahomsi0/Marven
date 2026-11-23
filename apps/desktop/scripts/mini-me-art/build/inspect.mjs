// node inspect.mjs B body | node inspect.mjs B hair.short.front
const [, , key, layer] = process.argv;
const dir = (await import(`../art/direction${key}.mjs`)).default;
let g = dir.layers;
for (const p of layer.split('.')) g = g[p];
const n = dir.size;
const tens = [...Array(n)].map((_, i) => (i >= 10 ? Math.floor(i / 10) : ' ')).join('');
const ones = [...Array(n)].map((_, i) => i % 10).join('');
console.log('    ' + tens + '\n    ' + ones);
g.forEach((r, y) => {
  const m = [...r].map((c) => (c === '.' ? 0 : 1));
  const asym = m.some((v, x) => v !== m[n - 1 - x]) ? ' *asym' : '';
  console.log(String(y).padStart(3) + ' ' + r + ' ' + r.length + asym);
});
