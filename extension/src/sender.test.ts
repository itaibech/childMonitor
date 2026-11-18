import { describe, expect, it, vi } from 'vitest';
import { NativeSender, type NativePort } from './sender';
import type { WebMsg } from './tracker';

const msg = (n: number): WebMsg => ({
  id: String(n), browser: 'chrome', url: 'https://a.com/', title: '', started_at: 's', ended_at: 'e',
});

function fakePort(): NativePort & { sent: WebMsg[]; fireDisconnect: () => void } {
  let onDisc: () => void = () => undefined;
  const sent: WebMsg[] = [];
  return {
    sent,
    postMessage: (m) => { sent.push(m); },
    onDisconnect: (cb) => { onDisc = cb; },
    fireDisconnect: () => onDisc(),
  };
}

describe('NativeSender', () => {
  it('sends directly while connected', () => {
    const port = fakePort();
    const s = new NativeSender(() => port, vi.fn());
    s.send([msg(1), msg(2)]);
    expect(port.sent.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('queues while disconnected, reconnects after 5 s and flushes', () => {
    const ports = [fakePort(), fakePort()];
    const timers: Array<() => void> = [];
    const delays: number[] = [];
    let i = 0;
    const s = new NativeSender(() => ports[i++]!, (fn, ms) => { timers.push(fn); delays.push(ms); });
    ports[0]!.fireDisconnect();
    s.send([msg(1)]);
    expect(delays).toEqual([5000]);
    expect(ports[1]!.sent).toEqual([]);
    timers[0]!();
    expect(ports[1]!.sent.map((m) => m.id)).toEqual(['1']);
  });

  it('keeps at most 500 queued messages, dropping the oldest', () => {
    const ports = [fakePort(), fakePort()];
    const timers: Array<() => void> = [];
    let i = 0;
    const s = new NativeSender(() => ports[i++]!, (fn) => { timers.push(fn); });
    ports[0]!.fireDisconnect();
    s.send(Array.from({ length: 510 }, (_, n) => msg(n)));
    timers[0]!();
    expect(ports[1]!.sent).toHaveLength(500);
    expect(ports[1]!.sent[0]?.id).toBe('10');
  });

  it('retries when connect throws', () => {
    const timers: Array<() => void> = [];
    let calls = 0;
    const port = fakePort();
    const s = new NativeSender(() => { if (calls++ === 0) throw new Error('no host'); return port; },
      (fn) => { timers.push(fn); });
    s.send([msg(1)]);
    timers[0]!();
    expect(port.sent).toHaveLength(1);
  });
});
