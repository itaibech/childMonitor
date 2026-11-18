import { NativeSender, type NativePort } from './sender';
import { WebTracker, type Browser, type TrackerState, type WebMsg } from './tracker';

const HOST = 'com.itaibech.childmonitor';
const STATE_KEY = 'tracker';
const TICK_ALARM = 'tick';
const IDLE_SECONDS = 120;

const browser: Browser = navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome';

function connect(): NativePort {
  const port = chrome.runtime.connectNative(HOST);
  return {
    postMessage: (m) => port.postMessage(m),
    onDisconnect: (cb) => port.onDisconnect.addListener(cb),
  };
}

const sender = new NativeSender(connect, (fn, ms) => { setTimeout(fn, ms); });

async function loadTracker(): Promise<{ tracker: WebTracker; resumed: WebMsg[] }> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  const tracker = new WebTracker(stored[STATE_KEY] as Partial<TrackerState> | undefined);
  return { tracker, resumed: tracker.resume(Date.now()) };
}

// Serialise every event: load state, act, persist, send.
let chain: Promise<void> = Promise.resolve();

function run(action: (t: WebTracker) => Promise<WebMsg[]> | WebMsg[]): void {
  chain = chain.then(async () => {
    const { tracker, resumed } = await loadTracker();
    // After a stale close, restart tracking (gated by the tracker's focus/idle flags).
    const restart = resumed.length > 0 ? await refreshActive(tracker) : [];
    const out = await action(tracker);
    await chrome.storage.session.set({ [STATE_KEY]: tracker.getState() });
    sender.send([...resumed, ...restart, ...out]);
  }).catch(() => undefined);
}

function trackTab(tracker: WebTracker, tab: chrome.tabs.Tab | undefined): WebMsg[] {
  return tracker.onActive(tab?.url, tab?.title ?? '', browser, Date.now());
}

async function activeTabOf(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
  const query = windowId === undefined
    ? { active: true, lastFocusedWindow: true }
    : { active: true, windowId };
  const [tab] = await chrome.tabs.query(query);
  return tab;
}

async function refreshActive(tracker: WebTracker, windowId?: number): Promise<WebMsg[]> {
  return trackTab(tracker, await activeTabOf(windowId));
}

chrome.tabs.onActivated.addListener((info) => {
  run(async (t) => trackTab(t, await chrome.tabs.get(info.tabId)));
});

function onNavigated(d: { frameId: number }): void {
  if (d.frameId === 0) run((t) => refreshActive(t));
}
chrome.webNavigation.onCompleted.addListener(onNavigated);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigated);

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    run((t) => t.onWindowBlur(Date.now()));
    return;
  }
  run((t) => {
    t.onFocus(Date.now());
    return refreshActive(t, windowId);
  });
});

chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'active') {
    run((t) => {
      t.onIdleActive(Date.now());
      return refreshActive(t);
    });
  } else {
    run((t) => t.onIdle(Date.now(), state === 'idle' ? IDLE_SECONDS : 0));
  }
});

async function ensureAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(TICK_ALARM))) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
}
void ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  run(async (t) => t.tick(Date.now(), (await chrome.idle.queryState(15)) === 'active'));
});

// Only on real startup; a wake-up must not reopen a session closed by idle/blur.
async function startupRefresh(t: WebTracker): Promise<WebMsg[]> {
  const now = Date.now();
  const idle = await chrome.idle.queryState(IDLE_SECONDS);
  const win = await chrome.windows.getLastFocused();
  if (idle === 'active') t.onIdleActive(now);
  else t.onIdle(now, 0);
  if (win.focused) t.onFocus(now);
  else t.onWindowBlur(now);
  return refreshActive(t);
}
chrome.runtime.onStartup.addListener(() => run(startupRefresh));
chrome.runtime.onInstalled.addListener(() => run(startupRefresh));
