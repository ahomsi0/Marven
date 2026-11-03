// Search engines the in-app browser can use. The renderer reads the same list
// (searchEngines.json) for onboarding and Settings.

const ENGINES = require('./searchEngines.json');

const DEFAULT_ENGINE_ID = 'brave';

/** The engine with this id, or the default one for anything unknown. */
function searchEngine(id) {
  return ENGINES.find((e) => e.id === id) ?? ENGINES.find((e) => e.id === DEFAULT_ENGINE_ID);
}

module.exports = { ENGINES, DEFAULT_ENGINE_ID, searchEngine };
