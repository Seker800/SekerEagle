import { getDesktopOriginalFileDownloadBridge } from './media-resolver';
import { getLocale } from '../i18n';
import { saveOriginalFile, type OriginalFileTarget } from './original-file-export';
import {
  streamOriginalToFile,
  uniqueOriginalFileNames,
  type OriginalFileWriter,
} from './original-download-stream';

type State = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled' | 'browser';
interface QueueItem {
  id: number;
  target: OriginalFileTarget;
  fileName: string;
  state: State;
  received: number;
  total?: number;
}
interface Directory {
  getDirectoryHandle(name: string, options: { create: true }): Promise<Directory>;
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<{ createWritable(): Promise<OriginalFileWriter> }>;
  removeEntry(name: string): Promise<void>;
}
const directoryPicker = () =>
  (
    globalThis as typeof globalThis & {
      showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<Directory>;
    }
  ).showDirectoryPicker;

// The workspace owns this store, so a public mode switch does not cancel a save.
// Privacy/session revocation clears it and invalidates every pending continuation.
export class OriginalDownloadQueue {
  #snapshot: { items: readonly QueueItem[]; running: boolean } = { items: [], running: false };
  #listeners = new Set<() => void>();
  #controller?: AbortController;
  #nextId = 0;
  epoch = 0;
  constructor(private readonly retain?: () => () => void) {}
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(items: readonly QueueItem[], running = this.#snapshot.running) {
    this.#snapshot = { items, running };
    this.#listeners.forEach((listener) => listener());
  }
  #update(id: number, patch: Partial<QueueItem>) {
    this.#publish(
      this.#snapshot.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  enqueue(targets: readonly OriginalFileTarget[]) {
    const all = [...this.#snapshot.items.map((item) => item.target), ...targets];
    const names = uniqueOriginalFileNames(all.map((target) => target.originalName));
    this.#publish([
      ...this.#snapshot.items,
      ...targets.map((target, index): QueueItem => ({
        id: ++this.#nextId,
        target,
        fileName: names[this.#snapshot.items.length + index],
        state: 'queued',
        received: 0,
      })),
    ]);
  }
  canSaveToDirectory() {
    return (
      !!directoryPicker() ||
      (!!getDesktopOriginalFileDownloadBridge() &&
        this.#snapshot.items.every((item) => item.target.libraryMode !== 'PHOTO'))
    );
  }
  cancel() {
    this.#controller?.abort();
  }
  clear() {
    this.epoch++;
    this.cancel();
    this.#publish([], false);
  }
  async handToBrowser(id: number) {
    const item = this.#snapshot.items.find((entry) => entry.id === id);
    if (!item || this.#snapshot.running) return;
    await saveOriginalFile(item.target, { desktopBridge: null });
    this.#update(id, { state: 'browser' });
  }
  async saveToDirectory() {
    if (this.#snapshot.running) return;
    const pending = this.#snapshot.items.filter((item) =>
      ['queued', 'failed', 'cancelled'].includes(item.state),
    );
    if (!pending.length) return;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.#controller = controller;
    const release = this.retain?.();
    this.#publish(this.#snapshot.items, true);
    try {
      const desktop = getDesktopOriginalFileDownloadBridge();
      if (desktop && pending.every((item) => item.target.libraryMode !== 'PHOTO')) {
        const result = await desktop.downloadOriginalFiles(
          pending.map((item) => item.target.id),
          getLocale(),
        );
        if (epoch !== this.epoch) return;
        if (result.downloaded !== pending.length && result.downloaded !== 0)
          throw new Error('Incomplete download');
        if (result.downloaded)
          pending.forEach((item) => this.#update(item.id, { state: 'completed' }));
        return;
      }
      const picker = directoryPicker();
      if (!picker) return;
      const parent = await picker({ mode: 'readwrite' });
      if (epoch !== this.epoch || controller.signal.aborted) return;
      const folder = await parent.getDirectoryHandle(`SekerEagle-${crypto.randomUUID()}`, {
        create: true,
      });
      for (const item of pending) {
        if (epoch !== this.epoch) return;
        if (controller.signal.aborted) {
          this.#update(item.id, { state: 'cancelled' });
          continue;
        }
        this.#update(item.id, { state: 'downloading', received: 0 });
        let lastProgress = 0;
        try {
          const file = await folder.getFileHandle(item.fileName, { create: true });
          const output = await file.createWritable();
          await streamOriginalToFile(item.target, output, controller.signal, (received, total) => {
            if (epoch !== this.epoch) return;
            const now = performance.now();
            if (now - lastProgress >= 100 || received === total) {
              lastProgress = now;
              this.#update(item.id, { received, total });
            }
          });
          if (epoch === this.epoch) this.#update(item.id, { state: 'completed' });
        } catch {
          await folder.removeEntry(item.fileName).catch(() => undefined);
          if (epoch === this.epoch)
            this.#update(item.id, { state: controller.signal.aborted ? 'cancelled' : 'failed' });
        }
      }
    } catch (error) {
      if (epoch === this.epoch && !(error instanceof DOMException && error.name === 'AbortError')) {
        pending.forEach((item) => this.#update(item.id, { state: 'failed' }));
      }
    } finally {
      if (epoch === this.epoch) {
        this.#controller = undefined;
        this.#publish(this.#snapshot.items, false);
      }
      release?.();
    }
  }
}
