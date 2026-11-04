// IPC for the in-app browser. Only the main frame of Marven's own window may
// call these, and every argument is checked before it reaches the manager.

const { ipcMain } = require('electron');
const { isWebUrl, cleanBounds, cleanText, isId, isHost, cleanAgentAction } = require('./validate');

const COMMANDS = new Set(['back', 'forward', 'reload', 'stop', 'retry']);

function registerBrowserIpc(manager, getWindow) {
  const fromApp = (event) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
    const frame = event.senderFrame;
    return !!frame && frame === win.webContents.mainFrame;
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => (fromApp(event) ? fn(...args) : null));
  const on = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    if (fromApp(event)) fn(...args);
  });

  handle('browser-show', (bounds) => {
    const b = cleanBounds(bounds);
    if (!b) return false;
    manager.show(b);
    return true;
  });
  on('browser-bounds', (bounds) => {
    const b = cleanBounds(bounds);
    if (b) manager.setBounds(b);
  });
  on('browser-hide', () => manager.hide());
  handle('browser-freeze', () => manager.freeze());
  on('browser-unfreeze', () => manager.unfreeze());
  on('browser-focus', (focused) => manager.setPanelFocused(focused === true));
  handle('browser-get-snapshot', () => manager.snapshot());

  handle('browser-new-tab', (url) => manager.newTab(isWebUrl(url) ? url : undefined));
  on('browser-close-tab', (id) => { if (isId(id)) manager.closeTab(id); });
  on('browser-activate-tab', (id) => { if (isId(id)) manager.activateTab(id); });
  on('browser-move-tab', (id, toIndex) => { if (isId(id) && Number.isInteger(toIndex)) manager.moveTab(id, toIndex); });
  on('browser-reopen-tab', () => manager.reopenClosedTab());
  handle('browser-navigate', (id, url) => (isId(id) && isWebUrl(url) ? manager.navigate(id, url) : false));
  on('browser-command', (id, name) => { if (isId(id) && COMMANDS.has(name)) manager.command(id, name); });
  // No id (undefined/null) means the active tab.
  handle('browser-extract-page', (id) => (id == null || isId(id) ? manager.extractPage(id ?? null) : null));
  on('browser-find', (id, text, options) => {
    if (!isId(id) || typeof text !== 'string') return;
    const o = options && typeof options === 'object' ? options : {};
    manager.find(id, cleanText(text, 500), { forward: o.forward !== false, again: o.again === true });
  });
  on('browser-stop-find', (id) => { if (isId(id)) manager.stopFind(id); });
  // A sign-in answer for the server's prompt; no username cancels it.
  on('browser-auth', (id, username, password) => {
    if (!isId(id)) return;
    if (typeof username === 'string' && username && typeof password === 'string') {
      manager.answerAuth(id, username.slice(0, 1000), password.slice(0, 1000));
    } else {
      manager.answerAuth(id, null, null);
    }
  });
  on('browser-menu-labels', (labels) => manager.setMenuLabels(labels));

  // Marven's agent (relayed by the renderer from the agent stream). The action
  // came from a model: cleanAgentAction refuses anything it doesn't know.
  handle('browser-agent-run', (runId, conversationId, action) => {
    if (!isId(runId) || !isId(conversationId)) return { kind: 'error', text: 'Bad browser request.' };
    const clean = cleanAgentAction(action);
    if (!clean) return { kind: 'error', text: 'Those browser tool arguments are not valid. Check the tool description and try again.' };
    return manager.agentRun(runId, conversationId, clean);
  });
  on('browser-agent-resume', () => manager.agentResume());
  on('browser-agent-take-over', () => manager.agentTakeOver());
  on('browser-agent-end', (runId) => { if (isId(runId)) manager.agentEnd(runId); });

  handle('browser-toggle-bookmark', (url, title) => (isWebUrl(url) ? manager.toggleBookmark(url, cleanText(title, 300)) : false));
  handle('browser-remove-bookmark', (id) => { if (isId(id)) manager.removeBookmark(id); });
  handle('browser-bookmarks', (query) => manager.listBookmarks(cleanText(query, 200)));
  handle('browser-is-bookmarked', (url) => isWebUrl(url) && manager.isBookmarked(url));
  handle('browser-suggest', (query) => manager.suggest(cleanText(query, 200)));
  on('browser-set-blocking', (host, enabled) => {
    if (isHost(host) && typeof enabled === 'boolean') manager.setBlocking(host, enabled);
  });

  on('browser-cancel-download', (id) => { if (isId(id)) manager.cancelDownload(id); });
  on('browser-show-download', (id) => { if (isId(id)) manager.showDownload(id); });
  handle('browser-clear-data', () => manager.clearBrowsingData());
}

module.exports = { registerBrowserIpc };
