import { describe, expect, it } from 'vitest';
import { WebTracker } from './tracker';

const T0 = Date.UTC(2026, 10, 18, 15, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

describe('WebTracker', () => {
  it('switching tab closes previous and opens new', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'chrome', T0);
    const out = t.onActive('https://b.com/', 'B', 'chrome', T0 + 5000);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: a?.id, url: 'https://a.com/', ended_at: iso(T0 + 5000) });
    expect(out[1]).toMatchObject({ url: 'https://b.com/', started_at: iso(T0 + 5000) });
    expect(out[1]?.id).not.toBe(a?.id);
    expect(out[1]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('same url re-activation keeps the session', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'edge', T0);
    const out = t.onActive('https://a.com/', 'A2', 'edge', T0 + 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: a?.id, title: 'A2', browser: 'edge' });
  });

  it('internal pages are ignored', () => {
    const t = new WebTracker();
    for (const u of ['chrome://settings', 'edge://flags', 'chrome-extension://x/y.html', 'about:blank',
      'file:///c:/a.txt', 'data:text/html,hi', 'blob:https://a.com/1', undefined]) {
      expect(t.onActive(u, 't', 'chrome', T0)).toEqual([]);
    }
    expect(t.tick(T0 + 60000)).toEqual([]);
  });

  it('navigating to an internal page closes the open session', () => {
    const t = new WebTracker();
    t.onActive('https://a.com/', 'A', 'chrome', T0);
    const out = t.onActive('chrome://newtab', '', 'chrome', T0 + 3000);
    expect(out).toHaveLength(1);
    expect(out[0]?.ended_at).toBe(iso(T0 + 3000));
    expect(t.tick(T0 + 60000)).toEqual([]);
  });

  it('blur closes session', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'chrome', T0);
    const out = t.onWindowBlur(T0 + 7000);
    expect(out).toEqual([{ ...a, ended_at: iso(T0 + 7000) }]);
    expect(t.onWindowBlur(T0 + 8000)).toEqual([]);
    expect(t.tick(T0 + 60000)).toEqual([]);
  });

  it('tick re-emits same id with later ended_at', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'chrome', T0);
    const out = t.tick(T0 + 60000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: a?.id, started_at: a?.started_at, ended_at: iso(T0 + 60000) });
  });

  it('ended_at never decreases when the clock goes backwards', () => {
    const t = new WebTracker();
    t.onActive('https://a.com/', 'A', 'chrome', T0);
    t.tick(T0 + 60000);
    expect(t.tick(T0 + 1000)[0]?.ended_at).toBe(iso(T0 + 60000));
  });

  it('state survives a worker restart', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'chrome', T0);
    const t2 = new WebTracker(JSON.parse(JSON.stringify(t.getState())));
    expect(t2.resume(T0 + 60000)).toEqual([]);
    expect(t2.tick(T0 + 61000)[0]?.id).toBe(a?.id);
  });

  it('stale restored session is closed at its last ended_at', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'chrome', T0);
    t.tick(T0 + 60000);
    const t2 = new WebTracker(t.getState());
    const out = t2.resume(T0 + 60000 + 121000);
    expect(out).toEqual([{ ...a, ended_at: iso(T0 + 60000) }]);
    expect(t2.tick(T0 + 300000)).toEqual([]);
  });

  it('tick while not active only extends to last activity; idle close keeps it', () => {
    const t = new WebTracker();
    const [a] = t.onActive('https://a.com/', 'A', 'chrome', T0);
    t.onActive('https://a.com/', 'A', 'chrome', T0 + 30000);
    const tk = t.tick(T0 + 60000, false);
    expect(tk[0]).toMatchObject({ id: a?.id, ended_at: iso(T0 + 30000) });
    const closed = t.onIdle(T0 + 150000, 120);
    expect(closed[0]?.ended_at).toBe(iso(T0 + 30000));
    expect(t.tick(T0 + 200000, false)).toEqual([]);
  });

  it('idle close without prior tick ends at now minus detection interval; locked at now', () => {
    const t = new WebTracker();
    t.onActive('https://a.com/', 'A', 'chrome', T0);
    t.tick(T0 + 60000);
    expect(t.onIdle(T0 + 300000, 120)[0]?.ended_at).toBe(iso(T0 + 180000));
    const l = new WebTracker();
    l.onActive('https://a.com/', 'A', 'chrome', T0);
    expect(l.onIdle(T0 + 50000, 0)[0]?.ended_at).toBe(iso(T0 + 50000));
  });

  it('does not open sessions while blurred', () => {
    const t = new WebTracker();
    t.onWindowBlur(T0);
    expect(t.onActive('https://a.com/', 'A', 'chrome', T0 + 1000)).toEqual([]);
    t.onFocus(T0 + 2000);
    expect(t.onActive('https://a.com/', 'A', 'chrome', T0 + 2000)).toHaveLength(1);
  });

  it('does not open sessions while idle until active again', () => {
    const t = new WebTracker();
    t.onIdle(T0, 0);
    expect(t.onActive('https://a.com/', 'A', 'chrome', T0 + 1000)).toEqual([]);
    t.onIdleActive(T0 + 2000);
    expect(t.onActive('https://a.com/', 'A', 'chrome', T0 + 2000)).toHaveLength(1);
  });

  it('idle to active while unfocused still does not open', () => {
    const t = new WebTracker();
    t.onWindowBlur(T0);
    t.onIdle(T0 + 1000, 0);
    t.onIdleActive(T0 + 2000);
    expect(t.onActive('https://a.com/', 'A', 'chrome', T0 + 2000)).toEqual([]);
  });

  it('flags survive state round trip', () => {
    const t = new WebTracker();
    t.onWindowBlur(T0);
    const t2 = new WebTracker(JSON.parse(JSON.stringify(t.getState())));
    expect(t2.onActive('https://a.com/', 'A', 'chrome', T0 + 1)).toEqual([]);
  });

  it('truncates url and title and compares truncated url', () => {
    const t = new WebTracker();
    const long = 'https://a.com/' + 'x'.repeat(3000);
    const [a] = t.onActive(long, 'y'.repeat(500), 'chrome', T0);
    expect(a?.url).toHaveLength(2000);
    expect(a?.title).toHaveLength(300);
    const out = t.onActive(long + 'z', 'T', 'chrome', T0 + 1000);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(a?.id);
  });
});
