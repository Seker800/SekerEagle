export function retryRefreshDelay(failures: number) {
  return Math.min(60_000, 5_000 * 2 ** Math.min(4, Math.max(0, failures - 1)));
}

export function scheduledRefreshDelay(nextAt: number | undefined): number | false {
  return nextAt !== undefined && Number.isFinite(nextAt)
    ? Math.max(5000, nextAt - Date.now())
    : false;
}

export function createProgressRefreshSchedule() {
  let lastSignature: string | undefined;
  let changedAt = 0;
  return (input: {
    visible: boolean;
    active: boolean;
    signature: string;
    now?: number;
    failures?: number;
    status?: number;
  }): number | false => {
    if (!input.visible || input.status === 401 || input.status === 403) return false;
    if (input.failures) return retryRefreshDelay(input.failures);
    const now = input.now ?? Date.now();
    if (input.signature !== lastSignature) {
      lastSignature = input.signature;
      changedAt = now;
    }
    if (!input.active) return false;
    return now - changedAt >= 30_000 ? 10_000 : 5_000;
  };
}
