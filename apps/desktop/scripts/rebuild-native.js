const { rebuild } = require('@electron/rebuild');
const path = require('path');

// Skip the Electron-targeted rebuild when explicitly requested. Useful for:
//   - CI test workflows that need the prebuilt Node ABI binary so `npm test`
//     can `dlopen` better-sqlite3 against the system Node, not Electron's.
//   - Anyone running `npm test` from a fresh install without an Electron build.
//
// The release workflow (build.yml) does NOT set this — there the rebuild
// against Electron's Node ABI is correct.
if (process.env.MARVEN_SKIP_ELECTRON_REBUILD === '1') {
  console.log('MARVEN_SKIP_ELECTRON_REBUILD=1 — leaving prebuilt Node binary in place');
  process.exit(0);
}

rebuild({
  buildPath: path.resolve(__dirname, '..'),
  electronVersion: require('../package.json').devDependencies.electron.replace(/^[^\d]*/, ''),
  onlyModules: ['better-sqlite3'],
})
  .then(() => console.log('rebuild ok'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
