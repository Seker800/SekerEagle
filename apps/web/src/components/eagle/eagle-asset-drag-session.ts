import type { DesktopAssetDragBridge } from './eagle-asset-drag';
import { t } from '../../i18n';

interface DragSelection {
  ids: string[];
  key: string;
}

interface PreparedDrag {
  key: string;
  token: string;
}

export type DesktopAssetDragStatus =
  | { phase: 'preparing'; completed: number; total: number }
  | { phase: 'cancelled'; total: number }
  | null;

const OUTBOUND_DRAG_SAFETY_TIMEOUT_MS = 30_000;

function createSelection(assetIds: string[]): DragSelection {
  return { ids: [...assetIds], key: assetIds.join('\u0000') };
}

export class DesktopAssetDragSession {
  private readonly bridge: DesktopAssetDragBridge;
  private readonly onError: (error: unknown) => void;
  private readonly onStatus: (status: DesktopAssetDragStatus) => void;
  private readonly unsubscribeProgress: (() => void) | null;
  private desired: DragSelection | null = null;
  private prepared: PreparedDrag | null = null;
  private gesture: DragSelection | null = null;
  private worker: Promise<void> | null = null;
  private preparing: DragSelection | null = null;
  private outbound = false;
  private nativeDragStarted = false;
  private generation = 0;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    bridge: DesktopAssetDragBridge,
    onError: (error: unknown) => void = () => undefined,
    onStatus: (status: DesktopAssetDragStatus) => void = () => undefined,
  ) {
    this.bridge = bridge;
    this.onError = onError;
    this.onStatus = onStatus;
    this.unsubscribeProgress =
      bridge.onAssetDragPreparationProgress?.((progress) => {
        if (!this.preparing || this.gesture?.key !== this.preparing.key) return;
        this.onStatus({ phase: 'preparing', ...progress });
      }) ?? null;
  }

  prime(assetIds: string[]): Promise<void> {
    const selection = createSelection(assetIds);
    if (this.prepared?.key === selection.key) return Promise.resolve();
    if (this.prepared) {
      this.bridge.discardPreparedAssetDrag?.(this.prepared.token);
      this.prepared = null;
    }
    if (this.preparing && this.preparing.key !== selection.key) {
      this.generation += 1;
      this.bridge.cancelAssetDragPreparation?.();
      this.preparing = null;
    }
    this.desired = selection;
    this.ensureWorker();
    return this.worker!;
  }

  begin(assetIds: string[]): void {
    const selection = createSelection(assetIds);
    this.gesture = selection;
    this.outbound = true;
    this.nativeDragStarted = false;
    this.armSafetyTimeout();
    if (!this.startIfReady(selection)) {
      this.onStatus({ phase: 'preparing', completed: 0, total: selection.ids.length });
      void this.prime(assetIds);
    }
  }

  end(reason: 'complete' | 'cancelled' = 'complete'): void {
    const pendingTotal = this.gesture?.ids.length ?? this.preparing?.ids.length ?? 0;
    if (!this.nativeDragStarted) {
      this.bridge.cancelAssetDragPreparation?.();
      if (this.prepared) this.bridge.discardPreparedAssetDrag?.(this.prepared.token);
      this.prepared = null;
    }
    this.generation += 1;
    this.desired = null;
    this.preparing = null;
    this.gesture = null;
    this.outbound = false;
    this.nativeDragStarted = false;
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    this.onStatus(
      reason === 'cancelled' && pendingTotal > 0
        ? { phase: 'cancelled', total: pendingTotal }
        : null,
    );
  }

  reset(): void {
    this.end();
    this.unsubscribeProgress?.();
  }

  isOutboundDrag(): boolean {
    return this.outbound;
  }

  hasNativeDragStarted(): boolean {
    return this.nativeDragStarted;
  }

  async whenSettled(): Promise<void> {
    while (this.worker) await this.worker;
  }

  private async prepareLatest(generation: number): Promise<void> {
    while (generation === this.generation && this.desired) {
      const target = this.desired;
      this.desired = null;
      this.preparing = target;
      try {
        const { token } = await this.bridge.prepareAssetDrag(target.ids);
        if (generation !== this.generation) {
          this.bridge.discardPreparedAssetDrag?.(token);
          return;
        }
        this.prepared = { key: target.key, token };
        if (this.gesture?.key === target.key) this.startIfReady(target);
      } catch (error) {
        if (generation !== this.generation) return;
        if (this.gesture?.key === target.key) {
          this.end();
          this.onError(error);
        }
      } finally {
        if (this.preparing?.key === target.key) this.preparing = null;
      }
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;
    const generation = this.generation;
    this.worker = this.prepareLatest(generation).finally(() => {
      this.worker = null;
      if (this.desired) this.ensureWorker();
    });
  }

  private startIfReady(selection: DragSelection): boolean {
    if (this.nativeDragStarted || this.prepared?.key !== selection.key) return false;
    try {
      this.bridge.startPreparedAssetDrag(this.prepared.token);
      this.prepared = null;
      this.nativeDragStarted = true;
      this.onStatus(null);
      return true;
    } catch (error) {
      this.end();
      this.onError(error);
      return false;
    }
  }

  private armSafetyTimeout(): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = setTimeout(() => {
      this.end();
      this.onError(new Error(t('原文件准备超时，请重新拖动。')));
    }, OUTBOUND_DRAG_SAFETY_TIMEOUT_MS);
  }
}
