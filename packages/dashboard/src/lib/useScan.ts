import { useCallback, useEffect, useRef, useState } from 'react';

import type { Report, ScanHistoryEntry, UiScanState } from './core.js';
import { INITIAL_UI_STATE, historyEntryFromReport, transition } from './core.js';
import type { ScanProgress, StructurePayload } from './api.js';
import {
  fetchHistory,
  fetchStartupReport,
  fetchStructure,
  launchScan,
  subscribeScanEvents,
} from './api.js';

export interface ScanSession {
  readonly ui: UiScanState;
  readonly report: Report | null;
  readonly reportLoad: 'loading' | 'ready' | 'empty' | 'error';
  readonly history: readonly ScanHistoryEntry[];
  readonly historyWarning: string | null;
  readonly openHistory: (index: number) => void;
  /** Every package the engine queried, in real arrival order (from SSE progress). */
  readonly scannedPackages: readonly string[];
  /** The real file/folder structure of the scan target; null until fetched. */
  readonly structure: StructurePayload | null;
  /** True when the structure could not be listed for the target (said plainly in the UI). */
  readonly structureUnavailable: boolean;
  readonly launch: (projectPath: string, aiExplanations: boolean) => void;
  readonly cancel: () => void;
  readonly acknowledge: () => void;
  readonly reset: () => void;
}

function worstSeverity(report: Report): 'critical' | 'high' | 'medium' | 'low' | null {
  for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
    if ((report.stats.bySeverity[severity] ?? 0) > 0) {
      return severity;
    }
  }
  return null;
}

/**
 * The dashboard's single scan session: drives the shared state machine from the
 * server's real SSE events, keeps the newest report, and records session history.
 * Cancel is real: aborting the fetch disconnects the client and the server
 * aborts the engine.
 */
export function useScan(): ScanSession {
  const [ui, setUi] = useState<UiScanState>(INITIAL_UI_STATE);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoad, setReportLoad] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [history, setHistory] = useState<readonly ScanHistoryEntry[]>([]);
  const [savedReports, setSavedReports] = useState<readonly Report[]>([]);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const refreshHistory = useCallback(async () => {
    try {
      const saved = await fetchHistory();
      setSavedReports(saved.reports);
      setHistory(
        saved.reports.map((r) => historyEntryFromReport(r, saved.path ?? 'server memory')),
      );
      setHistoryWarning(saved.warning);
      return saved.reports;
    } catch {
      setHistoryWarning('Saved history could not be loaded. Current results are still available.');
      return [];
    }
  }, []);
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  const [scannedPackages, setScannedPackages] = useState<readonly string[]>([]);
  const [structure, setStructure] = useState<StructurePayload | null>(null);
  const [structureUnavailable, setStructureUnavailable] = useState(false);
  const structureSeq = useRef(0);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    fetchStartupReport()
      .then((loaded) => {
        if (!alive) {
          return;
        }
        if (loaded === null) {
          void fetchHistory()
            .then((saved) => {
              if (!alive) return;
              const latest = saved.reports[0];
              if (latest !== undefined) {
                setReport(latest);
                setReportLoad('ready');
              } else setReportLoad('empty');
            })
            .catch(() => {
              if (alive) setReportLoad('empty');
            });
          return;
        }
        const loadedReport = loaded as Report;
        setReport(loadedReport);

        setReportLoad('ready');
      })
      .catch(() => {
        if (alive) {
          setReportLoad('error');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeScanEvents(
      (event) => {
        if (event.state === 'error') {
          setUi(
            (current) =>
              transition(current, { type: 'scan-failed', message: event.message ?? 'scan failed' })
                .next,
          );
        } else if (event.state === 'cancelled') {
          setUi((current) => transition(current, { type: 'scan-cancelled' }).next);
        } else if (event.state === 'analyzing') {
          setUi((current) => transition(current, { type: 'ai-started' }).next);
        }
        // POST response owns completion: it carries the finished report.
        // 'scanning' and 'idle' snapshots need no transition: launch and reset own those.
      },
      (progress: ScanProgress) => {
        if (progress.pkg === null) {
          return;
        }
        setScannedPackages((current) =>
          current[current.length - 1] === progress.pkg ? current : [...current, progress.pkg ?? ''],
        );
        setUi(
          (current) =>
            transition(current, {
              type: 'query-progress',
              done: progress.done,
              total: progress.total,
              pkg: progress.pkg ?? '',
            }).next,
        );
      },
    );
    return unsubscribe;
  }, []);

  const launch = useCallback(
    (projectPath: string, aiExplanations: boolean) => {
      const startedAt = new Date().toTimeString().slice(0, 8);
      setScannedPackages([]);
      setStructure(null);
      setStructureUnavailable(false);
      const seq = (structureSeq.current += 1);
      fetchStructure(projectPath)
        .then((listed) => {
          if (seq !== structureSeq.current) {
            return; // a newer launch owns the structure state
          }
          if (listed === null) {
            setStructureUnavailable(true);
          } else {
            setStructure(listed);
          }
        })
        .catch(() => {
          if (seq === structureSeq.current) {
            setStructureUnavailable(true);
          }
        });
      setUi(
        (current) =>
          transition(current, { type: 'scan-started', target: projectPath, startedAt }).next,
      );
      const scan = launchScan(projectPath, aiExplanations);
      cancelRef.current = scan.cancel;
      scan.response
        .then((result) => {
          const finished = result as Report;
          cancelRef.current = null;
          setReport(finished);
          setReportLoad('ready');
          void refreshHistory();
          const worst = worstSeverity(finished);
          setUi(
            (current) =>
              transition(
                current,
                worst === null ? { type: 'scan-completed' } : { type: 'detected', severity: worst },
              ).next,
          );
        })
        .catch((error: unknown) => {
          cancelRef.current = null;
          if (error instanceof DOMException && error.name === 'AbortError') {
            return; // the SSE cancelled event owns the state
          }
          const message = error instanceof Error ? error.message : 'scan failed';
          setUi((current) => transition(current, { type: 'scan-failed', message }).next);
        });
    },
    [refreshHistory],
  );

  const cancel = useCallback(() => {
    cancelRef.current?.();
  }, []);

  const acknowledge = useCallback(() => {
    setUi((current) => transition(current, { type: 'acknowledge' }).next);
  }, []);

  const reset = useCallback(() => {
    setScannedPackages([]);
    setStructure(null);
    setStructureUnavailable(false);
    structureSeq.current += 1;
    setUi((current) => transition(current, { type: 'reset' }).next);
  }, []);

  const openHistory = useCallback(
    (index: number) => {
      const saved = savedReports[index];
      if (saved === undefined) return;
      setReport(saved);
      setReportLoad('ready');
    },
    [savedReports],
  );

  return {
    ui,
    report,
    reportLoad,
    history,
    historyWarning,
    openHistory,
    scannedPackages,
    structure,
    structureUnavailable,
    launch,
    cancel,
    acknowledge,
    reset,
  };
}
