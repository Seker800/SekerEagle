import type { DesktopAssetDragBridge } from './eagle-asset-drag';

interface DragSelection {
  ids: string[];
  key: string;
}

interface PreparedDrag {
  key: string;
  token: string;
}

const OUTBOUND_DRAG_SAFETY_TIMEOUT_MS = 30_000;

function createSelection(assetIds: string[]): DragSelection {
  return { ids: [...assetIds], key: assetIds.join('\u0000') };
}

export class DesktopAssetDragSession {
  private readonly bridge: DesktopAssetDragBridge;
  private readonly onError: (error: unknown) => void;
  private desired: DragSelection | null = null;
  private prepared: PreparedDrag | null = null;
  private gesture: DragSelection | null = null;
  private worker: Promise<void> | null = null;
  private outbound = false;
  private nativeDragStarted = false;
  private generation = 0;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bridge: DesktopAssetDragBridge, onError: (error: unknown) => void = () => undefined) {
    this.bridge = bridge;
    this.onError = onError;
  }

  prime(assetIds: string[]): Promise<void> {
    const selection = createSelection(assetIds);
    if (this.prepared?.key === selection.key) return Promise.resolve();
    this.desired = selection;
    if (!this.worker) {
      const generation = this.generation;
      this.worker = this.prepareLatest(generation).finally(() => {
        this.worker = null;
      });
    }
    return this.worker;
  }

  begin(assetIds: string[]): void {
    const selection = createSelection(assetIds);
    this.gesture = selection;
    this.outbound = true;
    this.nativeDragStarted = false;
    this.armSafetyTimeout();
    if (!this.startIfReady(selection)) void this.prime(assetIds);
  }

  end(): void {
    this.gesture = null;
    this.outbound = false;
    this.nativeDragStarted = false;
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
  }

  reset(): void {
    this.generation += 1;
    this.desired = null;
    this.prepared = null;
    this.end();
  }

  isOutboundDrag(): boolean {
    return this.outbound;
  }

  hasNativeDragStarted(): boolean {
    return this.nativeDragStarted;
  }

  whenSettled(): Promise<void> {
    return this.worker ?? Promise.resolve();
  }

  private async prepareLatest(generation: number): Promise<void> {
    while (generation === this.generation && this.desired) {
      const target = this.desired;
      this.desired = null;
      try {
        const { token } = await this.bridge.prepareAssetDrag(target.ids);
        if (generation !== this.generation) return;
        this.prepared = { key: target.key, token };
        if (this.gesture?.key === target.key) this.startIfReady(target);
      } catch (error) {
        if (generation !== this.generation) return;
        if (this.gesture?.key === target.key) {
          this.end();
          this.onError(error);
        }
      }
    }
  }

  private startIfReady(selection: DragSelection): boolean {
    if (this.nativeDragStarted || this.prepared?.key !== selection.key) return false;
    try {
      this.bridge.startPreparedAssetDrag(this.prepared.token);
      this.nativeDragStarted = true;
      return true;
    } catch (error) {
      this.end();
      this.onError(error);
      return false;
    }
  }

  private armSafetyTimeout(): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = setTimeout(() => this.end(), OUTBOUND_DRAG_SAFETY_TIMEOUT_MS);
  }
}
