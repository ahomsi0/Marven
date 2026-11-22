const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const build = pkg.build || {};
const errors = [];
const warnings = [];
const allowUnsignedRelease = process.env.ALLOW_UNSIGNED_RELEASE === "true";

if (build.publish?.provider !== "github") errors.push("GitHub publishing is not configured.");
if (!build.mac?.entitlements || !fs.existsSync(path.join(__dirname, "..", build.mac.entitlements))) {
  errors.push("macOS entitlements file is missing.");
}
if (process.env.CI === "true" && process.env.GITHUB_REF?.startsWith("refs/tags/v")) {
  if (process.platform === "darwin" && !process.env.CSC_LINK && !process.env.CSC_NAME) {
    const message = "macOS release will be unsigned because CSC_LINK/CSC_NAME is not configured.";
    if (allowUnsignedRelease) warnings.push(message);
    else errors.push("macOS release builds require CSC_LINK or CSC_NAME for Developer ID signing.");
  }
  if (process.platform === "win32" && !process.env.WIN_CSC_LINK) {
    const message = "Windows release will be unsigned because WIN_CSC_LINK is not configured.";
    if (allowUnsignedRelease) warnings.push(message);
    else errors.push("Windows release builds require WIN_CSC_LINK for code signing.");
  }
}

if (errors.length) {
  console.error("Release configuration is incomplete:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
console.log("Release configuration checks passed.");
