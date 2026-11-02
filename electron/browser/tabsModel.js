// The in-app browser's tab list as plain immutable data. The manager keeps
// one of these and swaps it on every change; the native views live elsewhere.

const { isWebUrl, cleanText } = require('./validate');

const CLOSED_LIMIT = 10;
const TITLE_LIMIT = 300;

function emptyState() {
  return { tabs: [], activeId: null, closed: [] };
}

function addTab(state, tab, { afterId = null, activate = true } = {}) {
  const tabs = [...state.tabs];
  const at = afterId ? tabs.findIndex((t) => t.id === afterId) : -1;
  if (at === -1) tabs.push(tab);
  else tabs.splice(at + 1, 0, tab);
  const activeId = activate || !state.activeId ? tab.id : state.activeId;
  return { ...state, tabs, activeId };
}

function closeTab(state, id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const closing = state.tabs[index];
  const tabs = state.tabs.filter((t) => t.id !== id);
  let { activeId } = state;
  if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null;
  const closed = [{ url: closing.url, title: closing.title, index }, ...state.closed].slice(0, CLOSED_LIMIT);
  return { ...state, tabs, activeId, closed };
}

function activateTab(state, id) {
  if (state.activeId === id || !state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

function moveTab(state, id, toIndex) {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from === -1) return state;
  const to = Math.max(0, Math.min(state.tabs.length - 1, toIndex));
  if (to === from) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...state, tabs };
}

function reopenClosed(state, makeId) {
  if (state.closed.length === 0) return state;
  const [entry, ...closed] = state.closed;
  const tab = { id: makeId(), url: entry.url, title: entry.title };
  const tabs = [...state.tabs];
  tabs.splice(Math.min(entry.index, tabs.length), 0, tab);
  return { ...state, tabs, activeId: tab.id, closed };
}

function updateTab(state, id, patch) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const clean = { ...patch };
  if ('title' in clean) clean.title = cleanText(clean.title, TITLE_LIMIT);
  if ('url' in clean && !isWebUrl(clean.url)) delete clean.url;
  const current = state.tabs[index];
  if (Object.keys(clean).every((key) => current[key] === clean[key])) return state;
  const tabs = [...state.tabs];
  tabs[index] = { ...tabs[index], ...clean };
  return { ...state, tabs };
}

function toSaved(state) {
  return {
    tabs: state.tabs.map(({ url, title }) => ({ url, title })),
    activeIndex: Math.max(0, state.tabs.findIndex((t) => t.id === state.activeId)),
  };
}

function fromSaved(saved, makeId) {
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.tabs)) return emptyState();
  const savedActive = saved.tabs[saved.activeIndex];
  let activeId = null;
  const tabs = [];
  for (const entry of saved.tabs) {
    if (!entry || !isWebUrl(entry.url)) continue;
    const tab = { id: makeId(), url: entry.url, title: cleanText(entry.title, TITLE_LIMIT) };
    if (entry === savedActive) activeId = tab.id;
    tabs.push(tab);
  }
  return { tabs, activeId: activeId ?? tabs[0]?.id ?? null, closed: [] };
}

module.exports = {
  CLOSED_LIMIT, emptyState, addTab, closeTab, activateTab, moveTab, reopenClosed, updateTab, toSaved, fromSaved,
};
