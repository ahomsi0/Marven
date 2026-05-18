// Restore the executable bit on node-pty's spawn-helper binaries.
//
// node-pty ships a tiny `spawn-helper` per Unix platform that posix_spawnp's
// the real shell. Some npm versions extract the tarball without preserving
// the executable bit, which makes pty.spawn() fail with the opaque error
// "posix_spawnp failed." — bricking the terminal in both dev and packaged
// builds. This script runs as a postinstall and is a no-op when the bit is
// already set.
const fs   = require("fs");
const path = require("path");

const PREBUILDS = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
if (!fs.existsSync(PREBUILDS)) process.exit(0);

for (const platform of fs.readdirSync(PREBUILDS)) {
  if (platform.startsWith("win32")) continue;
  const helper = path.join(PREBUILDS, platform, "spawn-helper");
  if (!fs.existsSync(helper)) continue;
  try {
    fs.chmodSync(helper, 0o755);
  } catch (err) {
    console.warn(`[fix-node-pty-perms] could not chmod ${helper}: ${err.message}`);
  }
}
