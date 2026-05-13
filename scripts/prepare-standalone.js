/**
 * Copies .next/static and public into .next/standalone so electron-builder
 * can package them as a self-contained Next.js server.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(
  path.join(root, ".next/static"),
  path.join(root, ".next/standalone/.next/static")
);

copyDir(
  path.join(root, "public"),
  path.join(root, ".next/standalone/public")
);

console.log("✓ Standalone server prepared");
