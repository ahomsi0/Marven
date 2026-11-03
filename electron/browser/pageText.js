// "Ask Marven about this page": pull a page's readable text and the user's
// selection. `EXTRACT_SCRIPT` is a fixed string (nothing from the page or the
// renderer is ever spliced into it) that the manager runs in an isolated world
// of the tab, so the page's own scripts can't tamper with what it sees. The
// result is untrusted page data and is checked again by `cleanExtract`.
// Nothing here imports Electron.

const MAX_TEXT = 20000;
const MAX_SELECTION = 5000;
const MAX_TITLE = 300;
const TRUNCATED_NOTE = '\n\n[truncated]';

// Runs inside the page (serialized below), so it must be self-contained and
// only use DOM APIs.
function extractInPage() {
  var MAX_TEXT = 20000;
  var MAX_SELECTION = 5000;
  var NOTE = '\n\n[truncated]';
  var DROP = 'script, style, noscript, template, svg, canvas, iframe, object, embed, nav, footer, aside, '
    + '[role="navigation"], [role="contentinfo"], [aria-hidden="true"], [hidden]';
  var BLOCK = /^(P|DIV|LI|UL|OL|DL|DT|DD|H[1-6]|SECTION|ARTICLE|MAIN|HEADER|BLOCKQUOTE|PRE|TABLE|TR|FIGCAPTION|FIGURE|HR|ADDRESS|DETAILS|SUMMARY)$/;

  function textLength(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').length;
  }

  // The biggest article/main region, if it holds a real amount of text.
  var root = null;
  var best = 0;
  var candidates = document.querySelectorAll('article, main, [role="main"]');
  for (var i = 0; i < candidates.length; i++) {
    var len = textLength(candidates[i]);
    if (len > best) {
      best = len;
      root = candidates[i];
    }
  }
  if (!root || best < 200) root = document.body;

  var text = '';
  if (root) {
    var clone = root.cloneNode(true);
    var drop = clone.querySelectorAll(DROP);
    for (var j = 0; j < drop.length; j++) drop[j].remove();
    // textContent has no layout, so mark block boundaries as line breaks.
    var all = clone.querySelectorAll('*');
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (el.tagName === 'BR') el.replaceWith(document.createTextNode('\n'));
      else if (BLOCK.test(el.tagName)) el.appendChild(document.createTextNode('\n'));
      else if (el.tagName === 'TD' || el.tagName === 'TH') el.appendChild(document.createTextNode(' '));
    }
    text = (clone.textContent || '')
      .replace(/[ \t\f\v ]+/g, ' ')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - NOTE.length) + NOTE;

  var selection = '';
  try {
    var sel = window.getSelection();
    selection = sel ? String(sel.toString()).trim().slice(0, MAX_SELECTION) : '';
  } catch (e) {
    selection = '';
  }

  return { url: String(location.href), title: String(document.title || ''), selection: selection, text: text };
}

const EXTRACT_SCRIPT = `(${extractInPage.toString()})()`;

/**
 * Checks what came back from the page. Returns `{ url, title, selection, text }`
 * with every field a capped string, or null if it isn't usable.
 */
function cleanExtract(raw, isWebUrl) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v : '');
  const url = str(raw.url);
  if (!isWebUrl(url)) return null;
  let text = str(raw.text).trim();
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - TRUNCATED_NOTE.length) + TRUNCATED_NOTE;
  const selection = str(raw.selection).trim().slice(0, MAX_SELECTION);
  if (!text && !selection) return null;
  return { url, title: str(raw.title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE), selection, text };
}

module.exports = { EXTRACT_SCRIPT, extractInPage, cleanExtract, MAX_TEXT, MAX_SELECTION };
