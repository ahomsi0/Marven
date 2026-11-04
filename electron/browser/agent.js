// Lets Marven's agent drive tabs of its own while the user watches. One run at
// a time (one agent stream). For each action the controller finds the run's
// tab, refuses what the agent may never do (sensitive or file fields, sign-in
// prompts), answers `needs_approval` when the user hasn't approved the site or
// a form submission yet, outlines the target, then acts with real input
// events. Any input of the user's in the run's tab or switching tabs pauses
// the run until Resume; hiding the panel (closing it, or an overlay such as
// Settings covering it) pauses it until the panel shows again. Either way the
// next action returns a fresh read instead of running. Works only through `deps` (the manager
// passes real tabs), so it can be tested with fakes.

const { MAX_ELEMENTS, cleanRead, cleanTarget, cleanFocused, cleanOutcome, formatRead } = require('./agentDom');
const { clickEvents, keyEvents } = require('./agentKeys');
const { hostOf, isWebUrl } = require('./validate');

const ACTION_TIMEOUT_MS = 20000;
// How long a load has to start after an action before we stop waiting for one.
const LOAD_START_MS = 1000;
const LOAD_TIMEOUT_MS = 15000;
const SETTLE_MS = 3000;
const POLL_MS = 100;
const TEXT_POLL_MS = 250;
const HIGHLIGHT_MS = 600;
const MAX_AGENT_TABS = 10;

const KIND = {
  browser_open: 'open', browser_history: 'history', browser_read: 'read', browser_screenshot: 'screenshot',
  browser_tabs: 'tabs', browser_wait: 'wait', browser_scroll: 'scroll', browser_click: 'click',
  browser_type: 'type', browser_press: 'press', browser_select: 'select',
};

const NO_TAB = 'No such agent tab. Use browser_tabs with action "list".';
// Returned from inside an action when the user took over mid-way; the caller
// waits for Resume outside the action's time limit.
const PAUSED = Symbol('paused');

const ok = (text, image) => (image ? { kind: 'ok', text, image } : { kind: 'ok', text });
const fail = (text) => ({ kind: 'error', text });

class ActionTimeout extends Error {}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ActionTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function targetError(code, ref) {
  switch (code) {
    case 'stale': return 'The page changed since the last read; read it again before acting.';
    case 'unknown': return `There is no element ${ref} in the last read.`;
    case 'not-select': return `Element ${ref} isn't a drop-down.`;
    default: return `Element ${ref} is no longer on the page; read it again.`;
  }
}

/**
 * @param {{
 *   tabs: {
 *     get: (id: string) => any,
 *     open: (conversationId: string, url: string) => any,
 *     owned: (conversationId: string) => any[],
 *     activate: (id: string) => void,
 *     close: (id: string) => void,
 *   },
 *   isShown: () => boolean,
 *   onChange: () => void,
 *   runInPage: (tab: any, request: object) => Promise<unknown>,
 *   sendInput: (tab: any, events: object[]) => void | Promise<void>,
 *   insertText: (tab: any, text: string) => void | Promise<void>,
 *   capture: (tab: any) => Promise<{ base64: string, mimeType: string, name: string } | null>,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 * }} deps
 */
function createAgentController(deps) {
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  // { id, conversationId, state: 'acting' | 'paused' | 'waiting-user', reason, tabId, action, gate, downloadBlocked }
  let run = null;

  const header = (tab) => `[tab ${tab.id}] ${tab.title || '(untitled)'} — ${tab.url}`;
  const owns = (r, tab) => !!tab && tab.agent?.conversationId === r.conversationId;
  const ownedTab = (r, id) => {
    const tab = id ? deps.tabs.get(id) : null;
    return owns(r, tab) ? tab : null;
  };
  const loadError = (tab) => fail(`${header(tab)}\nThe page failed to load (${tab.error.kind}): ${tab.error.description}`);

  function setAction(r, kind, target) {
    r.action = { kind, target: String(target ?? '').slice(0, 80) };
    deps.onChange();
  }

  async function until(check, timeoutMs, every = POLL_MS) {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (await check()) return true;
      if (now() >= deadline) return false;
      await sleep(every);
    }
  }

  // Waits for a load the last action started, if one starts soon.
  async function waitForLoad(tab, timeoutMs) {
    const navigation = tab.navigation;
    const started = await until(() => tab.loading || !!tab.error || tab.navigation !== navigation, LOAD_START_MS);
    if (!started) return true;
    return until(() => !tab.loading, timeoutMs);
  }

  async function settle(tab, navigation) {
    await waitForLoad(tab, SETTLE_MS);
    return tab.navigation !== navigation
      ? 'The page navigated; read it again before acting.'
      : 'Done. Read the page again to see the result.';
  }

  async function readText(tab, { offset = 0, find = '' } = {}) {
    const read = cleanRead(await deps.runInPage(tab, { op: 'read', nav: tab.navigation, maxElements: MAX_ELEMENTS }), isWebUrl);
    if (!read) return `${header(tab)}\n(This page has nothing to read yet.)`;
    return formatRead(read, { header: header(tab), offset, find });
  }

  // ── Pausing ────────────────────────────────────────────────────────────

  function pause(reason) {
    if (!run) return;
    run.state = reason === 'sign-in' ? 'waiting-user' : 'paused';
    run.reason = reason;
    if (!run.gate) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      run.gate = { promise, release };
    }
    deps.onChange();
  }

  function resume() {
    if (!run || run.state === 'acting') return;
    const gate = run.gate;
    run.state = 'acting';
    run.reason = null;
    run.gate = null;
    gate?.release('resumed');
    deps.onChange();
  }

  function end(runId) {
    if (!run || run.id !== runId) return;
    run.gate?.release('ended');
    run = null;
    deps.onChange();
  }

  async function waitAndHandBack(r) {
    const outcome = await r.gate.promise;
    if (outcome === 'ended' || run !== r) return fail('Stopped.');
    const tab = ownedTab(r, r.tabId);
    if (!tab) return ok('The user took over and handed back. The agent tab is gone; use browser_tabs with action "list".');
    return ok(`The user took over and handed back. The page may have changed; here it is now:\n${await readText(tab)}`);
  }

  // ── Actions ────────────────────────────────────────────────────────────

  async function perform(runId, conversationId, action) {
    if (!run || run.id !== runId) {
      if (run) end(run.id);
      run = { id: runId, conversationId, state: 'acting', reason: null, tabId: null, action: null, gate: null, downloadBlocked: false };
    }
    const r = run;
    if (r.gate) return waitAndHandBack(r);
    r.downloadBlocked = false;
    try {
      const result = await withTimeout(dispatch(r, action), ACTION_TIMEOUT_MS);
      if (result === PAUSED) return await waitAndHandBack(r);
      if (r.downloadBlocked && result.kind === 'ok') {
        result.text += '\nA download started and was blocked: the agent may not download files. Ask the user to download it.';
      }
      return result;
    } catch (err) {
      if (err instanceof ActionTimeout) return fail("The page didn't respond in time. It may be showing a dialog; ask the user to look at the browser.");
      return fail(`The browser action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (run === r) {
        r.action = null;
        deps.onChange();
      }
    }
  }

  async function dispatch(r, action) {
    const { tool, args } = action;
    if (tool === 'browser_open') return open(r, args);
    if (tool === 'browser_tabs') return tabsAction(r, args);
    const tab = ownedTab(r, args.tab);
    if (!tab) return fail(NO_TAB);
    r.tabId = tab.id;
    deps.tabs.activate(tab.id);
    tab.ensureView();
    if (tool === 'browser_history') {
      setAction(r, 'history', args.action);
      tab.command(args.action);
      await waitForLoad(tab, LOAD_TIMEOUT_MS);
      return tab.error ? loadError(tab) : ok(`${header(tab)}\nDone.`);
    }
    if (tab.error) return loadError(tab);
    switch (tool) {
      case 'browser_read':
        setAction(r, 'read', hostOf(tab.url));
        return ok(await readText(tab, args));
      case 'browser_screenshot': return screenshot(r, tab, action);
      case 'browser_wait': return wait(r, tab, args);
      case 'browser_scroll': return scroll(r, tab, args);
      case 'browser_press': return press(r, tab, action);
      default: return actOnElement(r, tab, action);
    }
  }

  async function open(r, args) {
    let tab;
    if (args.tab) {
      tab = ownedTab(r, args.tab);
      if (!tab) return fail(NO_TAB);
      tab.load(args.url);
      deps.tabs.activate(tab.id);
      tab.ensureView();
    } else {
      if (deps.tabs.owned(r.conversationId).length >= MAX_AGENT_TABS) return fail(`Close a tab first (${MAX_AGENT_TABS} agent tabs at most).`);
      tab = deps.tabs.open(r.conversationId, args.url);
      if (!tab) return fail('The browser has too many tabs open; close some first.');
    }
    r.tabId = tab.id;
    setAction(r, 'open', hostOf(args.url));
    const loaded = await waitForLoad(tab, LOAD_TIMEOUT_MS);
    if (tab.error) return loadError(tab);
    return ok(`${header(tab)}\n${loaded ? 'Loaded.' : 'Still loading.'} Use browser_read to see the page.`);
  }

  function tabsAction(r, args) {
    setAction(r, 'tabs', args.action);
    if (args.action === 'list') {
      const owned = deps.tabs.owned(r.conversationId);
      if (!owned.length) return ok('No agent tabs yet. Use browser_open.');
      return ok(owned.map((t) => `${header(t)}${t.id === r.tabId ? ' (current)' : ''}`).join('\n'));
    }
    const tab = ownedTab(r, args.tab);
    if (!tab) return fail(NO_TAB);
    if (args.action === 'switch') {
      r.tabId = tab.id;
      deps.tabs.activate(tab.id);
      return ok(`${header(tab)}\nSwitched.`);
    }
    deps.tabs.close(tab.id);
    if (r.tabId === tab.id) r.tabId = null;
    return ok(`Closed tab ${tab.id}.`);
  }

  async function screenshot(r, tab, action) {
    setAction(r, 'screenshot', hostOf(tab.url));
    if (!action.canSeeImages) return ok(`${header(tab)}\nThis model can't see images; use browser_read instead.`);
    if (!deps.isShown()) return fail('The browser panel is closed, so there is nothing to capture. Ask the user to open it.');
    const image = await deps.capture(tab);
    return image ? ok(`${header(tab)}\nScreenshot attached below.`, image) : fail('The screenshot failed.');
  }

  async function wait(r, tab, args) {
    const seconds = Math.round(args.timeoutMs / 1000);
    if (args.for === 'load') {
      setAction(r, 'wait', hostOf(tab.url));
      const done = await until(() => !tab.loading, args.timeoutMs);
      return ok(`${header(tab)}\n${done ? 'Loaded.' : `Still loading after ${seconds}s.`}`);
    }
    setAction(r, 'wait', args.text);
    const found = await until(
      async () => cleanOutcome(await deps.runInPage(tab, { op: 'hasText', text: args.text })).found,
      args.timeoutMs,
      TEXT_POLL_MS,
    );
    return ok(`${header(tab)}\n${found ? 'The text is on the page.' : `Not found after ${seconds}s.`}`);
  }

  async function scroll(r, tab, args) {
    setAction(r, 'scroll', args.direction ?? `element ${args.ref}`);
    const out = cleanOutcome(await deps.runInPage(tab, { op: 'scroll', nav: tab.navigation, ref: args.ref ?? null, direction: args.direction ?? 'down' }));
    if (out.error) return fail(targetError(out.error, args.ref));
    return ok(`${header(tab)}\nScrolled to ${out.scrollY}px of ${Math.max(0, out.scrollHeight - out.viewportHeight)}px.`);
  }

  // A form submission always needs its own approval; anything else needs the
  // site approved. Approving a submit approves the site for that call too.
  function approvalFor(action, host, kind, target, submitting, fields) {
    if (submitting && !(action.approvedSubmit && action.approvedHosts.includes(host))) {
      return { kind: 'needs_approval', approval: { kind: 'submit', host, action: kind, target, fields } };
    }
    if (!action.approvedHosts.includes(host)) {
      return { kind: 'needs_approval', approval: { kind: 'site', host, action: kind, target } };
    }
    return null;
  }

  async function actOnElement(r, tab, action) {
    const { tool, args } = action;
    const kind = KIND[tool];
    if (tab.auth) return fail('A sign-in prompt is open on this tab; the user has to answer it.');
    const first = cleanTarget(await deps.runInPage(tab, { op: 'target', nav: tab.navigation, ref: args.ref, scroll: true }));
    if (first.error) return fail(targetError(first.error, args.ref));
    const { info } = first;
    if (info.sensitive) return fail(`Element ${args.ref} is a sensitive field (a password, payment detail or one-time code). Ask the user to fill it in.`);
    if (info.file) return fail(`Element ${args.ref} is a file upload. Ask the user to choose the file.`);
    if (info.disabled) return fail(`Element ${args.ref} is disabled.`);
    if (tool === 'browser_type' && !info.editable) return fail(`Element ${args.ref} isn't a text field.`);
    if (first.covered) return fail(`Element ${args.ref} is covered by ${JSON.stringify(first.covered)}. Close it or scroll first.`);
    const submitting = tool === 'browser_click' ? info.submits : tool === 'browser_type' && args.submit && first.entersSubmit;
    const target = info.name || info.role;
    const approval = approvalFor(action, hostOf(tab.url), kind, target, submitting, first.fields);
    if (approval) return approval;

    setAction(r, kind, target);
    await deps.runInPage(tab, { op: 'highlight', nav: tab.navigation, ref: args.ref, ms: HIGHLIGHT_MS });
    await sleep(HIGHLIGHT_MS);
    if (r.gate) return PAUSED;
    const navigation = tab.navigation;

    if (tool === 'browser_select') {
      const chosen = cleanOutcome(await deps.runInPage(tab, { op: 'select', nav: tab.navigation, ref: args.ref, option: args.option }));
      if (chosen.error === 'no-option') return fail(`No option ${JSON.stringify(args.option)}. Options: ${chosen.options.map((o) => JSON.stringify(o)).join(', ')}`);
      if (chosen.error) return fail(targetError(chosen.error, args.ref));
      return ok(`${header(tab)}\nSelected ${JSON.stringify(chosen.selected)}.`);
    }
    if (tool === 'browser_click') {
      // The page may have moved during the outline: find the centre again.
      const again = cleanTarget(await deps.runInPage(tab, { op: 'target', nav: tab.navigation, ref: args.ref, scroll: false }));
      if (again.error) return fail(targetError(again.error, args.ref));
      if (again.covered) return fail(`Element ${args.ref} is covered by ${JSON.stringify(again.covered)}. Close it or scroll first.`);
      await deps.sendInput(tab, clickEvents(again.x, again.y));
      return ok(`${header(tab)}\nClicked ${JSON.stringify(target)}. ${await settle(tab, navigation)}`);
    }
    const focused = cleanOutcome(await deps.runInPage(tab, { op: 'focus', nav: tab.navigation, ref: args.ref }));
    if (focused.error) return fail(targetError(focused.error, args.ref));
    if (!focused.ok) return fail(`Element ${args.ref} didn't take the focus.`);
    await deps.insertText(tab, args.text);
    if (args.submit) await deps.sendInput(tab, keyEvents('Enter'));
    return ok(`${header(tab)}\nTyped ${args.text.length} characters into ${JSON.stringify(target)}. ${await settle(tab, navigation)}`);
  }

  async function press(r, tab, action) {
    const { key } = action.args;
    if (tab.auth) return fail('A sign-in prompt is open on this tab; the user has to answer it.');
    const focused = cleanFocused(await deps.runInPage(tab, { op: 'focused' }));
    if (focused.sensitive) return fail('The focus is in a sensitive field (a password, payment detail or one-time code). Ask the user to finish it.');
    const approval = approvalFor(action, hostOf(tab.url), 'press', key, key === 'Enter' && focused.entersSubmit, focused.fields);
    if (approval) return approval;
    setAction(r, 'press', key);
    const navigation = tab.navigation;
    await deps.sendInput(tab, keyEvents(key));
    return ok(`${header(tab)}\nPressed ${key}. ${await settle(tab, navigation)}`);
  }

  // ── What the user does ─────────────────────────────────────────────────

  return {
    perform,
    resume,
    end,
    /** The renderer went away (reload, crash): nothing will end the run otherwise. */
    reset: () => { if (run) end(run.id); },
    takeOver: () => pause('user'),
    onUserInput: (tab) => { if (run && run.state === 'acting' && owns(run, tab)) pause('user'); },
    onUserActivate: (id) => { if (run && run.tabId && id !== run.tabId) pause('user'); },
    onUserClose: (id) => { if (run && owns(run, deps.tabs.get(id))) pause('user'); },
    // A hidden page can't take input reliably, so the run waits while the
    // panel is closed or covered, and carries on when it shows again.
    onHide: () => { if (run && run.state === 'acting') pause('hidden'); },
    onShow: () => { if (run && run.reason === 'hidden') resume(); },
    onTabUpdate: (tab) => {
      if (!run || !owns(run, tab)) return;
      if (tab.auth && run.reason !== 'sign-in') pause('sign-in');
      else if (!tab.auth && run.reason === 'sign-in') resume();
    },
    blocksDownloadFrom: (tab) => {
      if (!run || run.state !== 'acting' || !owns(run, tab)) return false;
      run.downloadBlocked = true;
      return true;
    },
    activity: () => (run
      ? { tabId: run.tabId, state: run.state, action: run.action, ...(run.reason ? { reason: run.reason } : {}) }
      : null),
  };
}

module.exports = { createAgentController };
