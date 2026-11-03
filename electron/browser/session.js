// The browser's Electron session: its own persistent partition, no
// permissions beyond clipboard writes and fullscreen, a plain Chrome user agent, downloads
// routed to downloads.js and requests filtered by the ad blocker. The filter
// lists are only fetched when loadBlocker() is first called.

const { session } = require('electron');
const { createBlocker } = require('./blocker');
const { createDownloads } = require('./downloads');
const { isAllowedPermission } = require('./validate');

const PARTITION = 'persist:marven-browser';

/**
 * Sets up `ses` for browsing. Split from createBrowserSession so tests can
 * pass a fake session.
 * @param {Electron.Session} ses
 * @param {{ dir: string, isDisabledFor: (host: string) => boolean, onBlocked: (webContentsId: number) => void, onDownloadsChange: () => void }} options
 */
function setupSession(ses, { dir, isDisabledFor, onBlocked, onDownloadsChange }) {
  // Drop the app-name and Electron tokens so sites see a plain Chrome UA.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|marven)\/\S+/gi, ''));
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isAllowedPermission(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => isAllowedPermission(permission));
  const downloads = createDownloads({ onChange: onDownloadsChange });
  ses.on('will-download', (event, item, webContents) => downloads.handle(event, item, webContents));
  const blocker = createBlocker({ dir, isDisabledFor, onBlocked });
  blocker.attach(ses);

  let blockerLoading = false;
  function loadBlocker() {
    if (blockerLoading) return;
    blockerLoading = true;
    void blocker.load();
  }

  return { ses, downloads, loadBlocker };
}

/**
 * @param {{ dir: string, isDisabledFor: (host: string) => boolean, onBlocked: (webContentsId: number) => void, onDownloadsChange: () => void }} options
 */
function createBrowserSession(options) {
  return setupSession(session.fromPartition(PARTITION), options);
}

module.exports = { PARTITION, setupSession, createBrowserSession };
