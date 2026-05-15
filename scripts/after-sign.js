const { execSync } = require("child_process");
const path = require("path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productName}.app`
  );

  console.log(`[after-sign] Ad-hoc signing ${appPath}`);
  try {
    execSync(
      `codesign --sign - --force --deep --preserve-metadata=entitlements "${appPath}"`,
      { stdio: "inherit" }
    );
    console.log("[after-sign] Done.");
  } catch (err) {
    console.error("[after-sign] Failed:", err.message);
  }
};
