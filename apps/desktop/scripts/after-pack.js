/**
 * afterPack hook — copies the full Next.js standalone server (including
 * node_modules and .next) into the packaged app after electron-builder runs.
 * electron-builder strips node_modules from extraResources; this bypasses that.
 */
const fs   = require("fs");
const path = require("path");

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

module.exports = async (context) => {
  const root = path.join(__dirname, "..");
  const standalone = path.join(root, ".next/standalone");
  const staticDir  = path.join(root, ".next/static");

  // Resolve the Resources directory for this platform's output
  let resourcesPath;
  if (context.electronPlatformName === "darwin") {
    resourcesPath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`, "Contents", "Resources");
  } else {
    resourcesPath = path.join(context.appOutDir, "resources");
  }

  const dest = path.join(resourcesPath, "nextjs-server");

  console.log(`[after-pack] Copying standalone server → ${dest}`);
  copyDir(standalone, dest);
  copyDir(staticDir, path.join(dest, ".next", "static"));
  console.log("[after-pack] Done.");
};
