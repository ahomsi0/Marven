const { execFileSync, spawnSync } = require("child_process");
const path = require("path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productName}.app`
  );

  // electron-builder performs the real Developer ID signing when CSC_* secrets
  // are present. Never overwrite that signature with an ad-hoc signature.
  const inspected = spawnSync("codesign", ["-dv", "--verbose=2", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const details = `${inspected.stdout || ""}\n${inspected.stderr || ""}`;
  if (inspected.status === 0 && !details.includes("Signature=adhoc")) {
    console.log(`[after-sign] Preserving existing application signature for ${appPath}`);
    return;
  }

  if (process.env.CI === "true" && process.env.GITHUB_REF?.startsWith("refs/tags/v")) {
    throw new Error("Tagged macOS releases must be Developer ID signed; refusing an ad-hoc release artifact.");
  }

  console.log(`[after-sign] Ad-hoc signing local development artifact ${appPath}`);
  try {
    execFileSync("codesign", ["--sign", "-", "--force", "--deep", "--preserve-metadata=entitlements", appPath], { stdio: "inherit" });
    console.log("[after-sign] Done.");
  } catch (err) {
    console.error("[after-sign] Failed:", err.message);
  }
};
