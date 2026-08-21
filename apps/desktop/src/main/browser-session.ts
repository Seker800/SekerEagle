const REFRESH_PATH = '/api/auth/refresh';

type SessionFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Gives main-process requests the same refresh-cookie recovery semantics as the web client.
 * One instance is shared by identity checks and media reads so concurrent 401s cannot create
 * a refresh storm.
 */
export class DesktopBrowserSession {
  private readonly fetchRequest: SessionFetch;
  private readonly serverUrl: () => string;
  private refreshInFlight: { origin: string; promise: Promise<boolean> } | null = null;

  constructor(fetchRequest: SessionFetch, serverUrl: () => string) {
    this.fetchRequest = fetchRequest;
    this.serverUrl = serverUrl;
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const origin = new URL(this.serverUrl()).origin;
    const url = new URL(path, `${origin}/`).toString();
    const requestInit = { ...init, credentials: 'include' as const };
    const response = await this.fetchRequest(url, requestInit);
    if (response.status !== 401 || new URL(url).pathname === REFRESH_PATH) return response;
    if (!(await this.refresh(origin))) return response;
    return this.fetchRequest(url, requestInit);
  }

  private async refresh(origin: string): Promise<boolean> {
    if (this.refreshInFlight && this.refreshInFlight.origin !== origin) {
      await this.refreshInFlight.promise;
      this.refreshInFlight = null;
    }
    if (!this.refreshInFlight) {
      const promise = this.fetchRequest(new URL(REFRESH_PATH, `${origin}/`).toString(), {
        method: 'POST',
        credentials: 'include',
      })
        .then(({ ok }) => ok)
        .catch(() => false)
        .finally(() => {
          if (this.refreshInFlight?.promise === promise) this.refreshInFlight = null;
        });
      this.refreshInFlight = { origin, promise };
    }
    return this.refreshInFlight.promise;
  }
}
