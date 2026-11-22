// The right-click menu for a page. Labels come from the renderer in the app's
// language (setLabels); English is used until then. The template is built
// from Electron's context-menu params and plain actions, so it can be tested
// without a Menu.

const { isWebUrl } = require('./validate');

const DEFAULT_LABELS = {
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  openLinkInNewTab: 'Open link in new tab',
  copyLink: 'Copy link address',
  openImageInNewTab: 'Open image in new tab',
  saveImage: 'Save image',
  copyImage: 'Copy image',
  copyImageAddress: 'Copy image address',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  searchFor: 'Search {{engine}} for “{{query}}”',
  find: 'Find in page…',
};

const LABEL_MAX = 100;
const QUERY_PREVIEW = 30;

// Known keys only, each a short string; anything else keeps its default.
function cleanLabels(value) {
  const labels = { ...DEFAULT_LABELS };
  if (!value || typeof value !== 'object') return labels;
  for (const key of Object.keys(DEFAULT_LABELS)) {
    const v = value[key];
    if (typeof v === 'string' && v.trim()) labels[key] = v.slice(0, LABEL_MAX);
  }
  return labels;
}

function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => values[name] ?? '');
}

function preview(text) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > QUERY_PREVIEW ? `${oneLine.slice(0, QUERY_PREVIEW)}…` : oneLine;
}

/**
 * @param {Electron.ContextMenuParams} params
 * @param {{
 *   labels: typeof DEFAULT_LABELS,
 *   canGoBack: boolean,
 *   canGoForward: boolean,
 *   engineName: string,
 *   actions: {
 *     back: () => void, forward: () => void, reload: () => void,
 *     openTab: (url: string) => void, copyText: (text: string) => void,
 *     download: (url: string) => void, copyImageAt: (x: number, y: number) => void,
 *     edit: (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => void,
 *     search: (query: string) => void, find: () => void,
 *   },
 * }} context
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function contextMenuTemplate(params, { labels, canGoBack, canGoForward, engineName, actions }) {
  const groups = [];
  const flags = params.editFlags ?? {};
  const selection = (params.selectionText ?? '').trim();

  if (isWebUrl(params.linkURL ?? '')) {
    groups.push([
      { label: labels.openLinkInNewTab, click: () => actions.openTab(params.linkURL) },
      { label: labels.copyLink, click: () => actions.copyText(params.linkURL) },
    ]);
  }
  if (params.mediaType === 'image' && isWebUrl(params.srcURL ?? '')) {
    groups.push([
      { label: labels.openImageInNewTab, click: () => actions.openTab(params.srcURL) },
      { label: labels.saveImage, click: () => actions.download(params.srcURL) },
      { label: labels.copyImage, click: () => actions.copyImageAt(params.x, params.y) },
      { label: labels.copyImageAddress, click: () => actions.copyText(params.srcURL) },
    ]);
  }
  if (params.isEditable) {
    groups.push(
      [
        { label: labels.undo, enabled: !!flags.canUndo, click: () => actions.edit('undo') },
        { label: labels.redo, enabled: !!flags.canRedo, click: () => actions.edit('redo') },
      ],
      [
        { label: labels.cut, enabled: !!flags.canCut, click: () => actions.edit('cut') },
        { label: labels.copy, enabled: !!flags.canCopy, click: () => actions.edit('copy') },
        { label: labels.paste, enabled: !!flags.canPaste, click: () => actions.edit('paste') },
        { label: labels.selectAll, enabled: !!flags.canSelectAll, click: () => actions.edit('selectAll') },
      ],
    );
  } else if (selection) {
    groups.push([
      { label: labels.copy, click: () => actions.edit('copy') },
      { label: fill(labels.searchFor, { engine: engineName, query: preview(selection) }), click: () => actions.search(selection) },
    ]);
  }
  // Plain page area: navigation and find.
  if (groups.length === 0) {
    groups.push(
      [
        { label: labels.back, enabled: canGoBack, click: actions.back },
        { label: labels.forward, enabled: canGoForward, click: actions.forward },
        { label: labels.reload, click: actions.reload },
      ],
      [{ label: labels.find, click: actions.find }],
    );
  }

  return groups.flatMap((items, i) => (i === 0 ? items : [{ type: 'separator' }, ...items]));
}

module.exports = { DEFAULT_LABELS, cleanLabels, contextMenuTemplate };
