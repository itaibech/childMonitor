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
  lastActivityAt: number;
  focused: boolean;
  idle: boolean;
}

export const MAX_URL = 2000;
export const MAX_TITLE = 300;

export const STALE_MS = 120_000;

const TRACKED = /^https?:\/\//i;

export function isTrackable(url: string | undefined): url is string {
  return url !== undefined && TRACKED.test(url);
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class WebTracker {
  private open: WebMsg | null;
  private lastTick: number;
  private lastActivityAt: number;
  private focused: boolean;
  private idle: boolean;

  constructor(state?: Partial<TrackerState>) {
    this.open = state?.open ?? null;
    this.lastTick = state?.lastTick ?? 0;
    this.lastActivityAt = state?.lastActivityAt ?? this.lastTick;
    this.focused = state?.focused ?? true;
    this.idle = state?.idle ?? false;
  }

  getState(): TrackerState {
    return {
      open: this.open ? { ...this.open } : null, lastTick: this.lastTick,
      lastActivityAt: this.lastActivityAt, focused: this.focused, idle: this.idle,
    };
  }

  /** After a worker restart: close a stale restored session at its last ended_at. */
  resume(now: number): WebMsg[] {
    if (!this.open || now - this.lastTick <= STALE_MS) return [];
    const closed = { ...this.open };
    this.open = null;
    return [closed];
  }

  onActive(tabUrl: string | undefined, title: string, browser: Browser, now: number): WebMsg[] {
    if (!this.focused || this.idle) return [];
    this.lastActivityAt = now;
    if (!isTrackable(tabUrl)) return this.close(now);
    const url = tabUrl.slice(0, MAX_URL);
    const cur = this.open;
    const t = title.slice(0, MAX_TITLE);
    if (cur && cur.url === url && cur.browser === browser) {
      return [this.extendTo({ ...cur, title: t }, now, now)];
    }
    const out = this.close(now);
    this.lastTick = now;
    this.open = {
      id: crypto.randomUUID(), browser, url, title: t,
      started_at: iso(now), ended_at: iso(now),
    };
    return [...out, { ...this.open }];
  }

  onWindowBlur(now: number): WebMsg[] {
    this.focused = false;
    return this.close(now);
  }

  onFocus(now: number): void {
    this.focused = true;
    this.lastActivityAt = now;
  }

  /** idleSeconds: detection interval for 'idle'; 0 for 'locked'. */
  onIdle(now: number, idleSeconds: number): WebMsg[] {
    this.idle = true;
    if (!this.open) return [];
    const end = Math.min(now, Math.max(Date.parse(this.open.ended_at), now - idleSeconds * 1000));
    return this.close(end, now);
  }

  onIdleActive(now: number): void {
    this.idle = false;
    this.lastActivityAt = now;
  }

  tick(now: number, active = true): WebMsg[] {
    if (!this.open) return [];
    if (active) this.lastActivityAt = now;
    return [this.extendTo(this.open, active ? now : Math.min(now, this.lastActivityAt), now)];
  }

  private close(endMs: number, now = endMs): WebMsg[] {
    if (!this.open) return [];
    const closed = this.extendTo(this.open, endMs, now);
    this.open = null;
    return [closed];
  }

  private extendTo(msg: WebMsg, endMs: number, now: number): WebMsg {
    const ended = Math.max(endMs, Date.parse(msg.ended_at));
    this.lastTick = now;
    this.open = { ...msg, ended_at: iso(ended) };
    return { ...this.open };
  }
}
