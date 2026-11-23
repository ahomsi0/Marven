// Converts the generated art/anim{A,B,C}.mjs into the JSON the app imports
// (lib/companion/art/*.json). Run build/anim.mjs first.
//
//   node scripts/mini-me-art/build/anim.mjs && node scripts/mini-me-art/to-json.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../lib/companion/art');
const FILES = { A: 'detailed.json', B: 'chibi.json', C: 'chibiLarge.json' };

for (const [key, file] of Object.entries(FILES)) {
  const anim = (await import(path.join(HERE, 'art', `anim${key}.mjs`))).default;
  // One grid row per line keeps diffs readable.
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(anim, null, 1) + '\n');
  console.log(file, anim.size, Object.values(anim.frames).reduce((n, f) => n + f.length, 0), 'frames');
}
