const { rebuild } = require('@electron/rebuild');
const path = require('path');

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
