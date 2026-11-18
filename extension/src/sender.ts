import type { WebMsg } from './tracker';

export interface NativePort {
  postMessage(msg: WebMsg): void;
  onDisconnect(cb: () => void): void;
}

export type Connect = () => NativePort;
export type Schedule = (fn: () => void, ms: number) => void;

export const RECONNECT_MS = 5000;
export const MAX_QUEUE = 500;

export class NativeSender {
  private port: NativePort | null = null;
  private queue: WebMsg[] = [];
  private retryPending = false;

  constructor(private readonly connect: Connect, private readonly schedule: Schedule) {
    this.open();
  }

  send(msgs: WebMsg[]): void {
    this.queue.push(...msgs);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.flush();
  }

  private flush(): void {
    const port = this.port;
    if (!port) return;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!next) break;
      try { port.postMessage(next); } catch { this.lost(); return; }
      this.queue.shift();
    }
  }

  private open(): void {
    this.retryPending = false;
    try {
      const port = this.connect();
      port.onDisconnect(() => { if (this.port === port) this.lost(); });
      this.port = port;
      this.flush();
    } catch {
      this.lost();
    }
  }

  private lost(): void {
    this.port = null;
    if (this.retryPending) return;
    this.retryPending = true;
    this.schedule(() => this.open(), RECONNECT_MS);
  }
}
