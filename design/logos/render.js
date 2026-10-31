// Render the logo concept SVGs to 512px PNGs and build one contact sheet.
// Usage: node design/logos/render.js [out.png] [concept ...]
// The first argument is the output file only if it ends in .png.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIR = __dirname;
const CELL = 512;
const GAP = 48;
const LABEL_H = 44;

const args = process.argv.slice(2);
const OUT = args[0] && args[0].endsWith(".png") ? args.shift() : "contact-sheet.png";
const CONCEPTS = args.length > 0
  ? args
  : [
      "m-spark",
      "orbit",
      "terminal-spark",
      "prism-hex",
      "raven",
      "bracket-orb",
    ];

const escapeXml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

(async () => {
  const pngs = [];
  for (const name of CONCEPTS) {
    const svg = fs.readFileSync(path.join(DIR, `${name}.svg`));
    const out = path.join(DIR, `${name}.png`);
    await sharp(svg, { density: 96 })
      .resize(CELL, CELL)
      .png()
      .toFile(out);
    pngs.push({ name, file: out });
    console.log("rendered", name);
  }

  const cols = 3;
  const rows = Math.ceil(pngs.length / cols);
  const W = GAP + cols * CELL + (cols - 1) * GAP + GAP;
  const H = GAP + rows * (CELL + LABEL_H) + (rows - 1) * GAP + GAP;

  const composites = [];
  pngs.forEach(({ name, file }, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = GAP + col * (CELL + GAP);
    const top = GAP + row * (CELL + LABEL_H + GAP);

    const label = Buffer.from(
      `<svg width="${CELL}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
         <text x="${CELL / 2}" y="38" font-family="-apple-system, Helvetica, Arial, sans-serif"
               font-size="26" fill="#9fb0c8" text-anchor="middle">${escapeXml(name)}</text>
       </svg>`,
    );

    composites.push({ input: file, left, top });
    composites.push({ input: label, left, top: top + CELL });
  });

  await sharp({
    create: { width: W, height: H, channels: 4, background: "#0b0e14" },
  })
    .composite(composites)
    .png()
    .toFile(path.join(DIR, OUT));

  console.log("contact sheet →", path.join(DIR, OUT));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
