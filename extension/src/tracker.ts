export type Browser = 'chrome' | 'edge';

export interface WebMsg {
  id: string;
  browser: Browser;
  url: string;
  title: string;
  started_at: string;
  ended_at: string;
}

export interface TrackerState {
  open: WebMsg | null;
  lastTick: number;
}

export const STALE_MS = 120_000;

const TRACKED = /^https?:\/\//i;

export function isTrackable(url: string | undefined): url is string {
  return url !== undefined && TRACKED.test(url);
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class WebTracker {
  private open: WebMsg | null;
  private lastTick: number;

  constructor(state?: TrackerState) {
    this.open = state?.open ?? null;
    this.lastTick = state?.lastTick ?? 0;
  }

  getState(): TrackerState {
    return { open: this.open ? { ...this.open } : null, lastTick: this.lastTick };
  }

  /** After a worker restart: close a stale restored session at its last ended_at. */
  resume(now: number): WebMsg[] {
    if (!this.open || now - this.lastTick <= STALE_MS) return [];
    const closed = { ...this.open };
    this.open = null;
    return [closed];
  }

  onActive(tabUrl: string | undefined, title: string, browser: Browser, now: number): WebMsg[] {
    if (!isTrackable(tabUrl)) return this.onWindowBlur(now);
    const cur = this.open;
    if (cur && cur.url === tabUrl && cur.browser === browser) {
      return [this.extend({ ...cur, title }, now)];
    }
    const out = this.onWindowBlur(now);
    this.lastTick = now;
    this.open = {
      id: crypto.randomUUID(), browser, url: tabUrl, title,
      started_at: iso(now), ended_at: iso(now),
    };
    return [...out, { ...this.open }];
  }

  onWindowBlur(now: number): WebMsg[] {
    if (!this.open) return [];
    const closed = this.extend(this.open, now);
    this.open = null;
    return [closed];
  }

  tick(now: number): WebMsg[] {
    return this.open ? [this.extend(this.open, now)] : [];
  }

  private extend(msg: WebMsg, now: number): WebMsg {
    const ended = Math.max(now, Date.parse(msg.ended_at));
    this.lastTick = now;
    this.open = { ...msg, ended_at: iso(ended) };
    return { ...this.open };
  }
}
