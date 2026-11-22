import type { Report } from './core.js';
/** Typed client for the G4 dashboard server. Every field maps to a real endpoint. */

export interface StatusPayload {
  readonly ok: boolean;
  readonly capabilities: { readonly ai: boolean; readonly scan: boolean };
  readonly toolVersion: string;
}

export type ScanStateName =
  'idle' | 'scanning' | 'analyzing' | 'detected' | 'completed' | 'error' | 'cancelled';

export interface ScanProgress {
  readonly done: number;
  readonly total: number;
  readonly pkg: string | null;
}

export interface ScanStateEvent {
  readonly state: ScanStateName;
  readonly runId?: string;
  readonly message?: string;
  readonly progress?: ScanProgress | null;
}

export async function fetchStatus(signal?: AbortSignal): Promise<StatusPayload> {
  const res = await fetch('/api/status', { signal: signal ?? null });
  if (!res.ok) {
    throw new Error(`status failed: HTTP ${res.status}`);
  }
  return (await res.json()) as StatusPayload;
}

export async function fetchStartupReport(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch('/report.json', { signal: signal ?? null });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`report failed: HTTP ${res.status}`);
  }
  return (await res.json()) as unknown;
}

export interface ScanLaunch {
  readonly response: Promise<unknown>;
  /** Aborting cancels the engine for real: the server aborts on client disconnect. */
  readonly cancel: () => void;
}

export function launchScan(projectPath: string, aiExplanations: boolean): ScanLaunch {
  const controller = new AbortController();
  const response = fetch('/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath, aiExplanations }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const code = typeof body['error'] === 'string' ? body['error'] : `http-${res.status}`;
      const message = typeof body['message'] === 'string' ? body['message'] : code;
      throw new Error(`${message} [${code}]`);
    }
    return (await res.json()) as unknown;
  });
  return { response, cancel: () => controller.abort() };
}

/** Subscribes to the persistent SSE channel. Returns an unsubscribe function. */
export function subscribeScanEvents(
  onState: (event: ScanStateEvent) => void,
  onProgress: (progress: ScanProgress) => void,
): () => void {
  const source = new EventSource('/api/scan/events');
  source.addEventListener('state', (event) => {
    onState(JSON.parse(event.data as string) as ScanStateEvent);
  });
  source.addEventListener('progress', (event) => {
    onProgress(JSON.parse(event.data as string) as ScanProgress);
  });
  return () => source.close();
}

export interface StructureEntryPayload {
  readonly path: string;
  readonly name: string;
  readonly kind: 'dir' | 'file';
  readonly depth: number;
}

export interface StructurePayload {
  readonly root: string;
  readonly entries: readonly StructureEntryPayload[];
  readonly truncated: boolean;
}

/** The real project tree for the live-scan structure view; null when unavailable. */
export async function fetchStructure(
  projectPath: string,
  signal?: AbortSignal,
): Promise<StructurePayload | null> {
  const res = await fetch(`/api/structure?path=${encodeURIComponent(projectPath)}`, {
    signal: signal ?? null,
  });
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as StructurePayload;
}

export async function fetchHistory(): Promise<{
  reports: Report[];
  warning: string | null;
  path: string | null;
}> {
  const res = await fetch('/api/history');
  if (!res.ok) throw new Error('Saved history could not be loaded');
  return (await res.json()) as { reports: Report[]; warning: string | null; path: string | null };
}
