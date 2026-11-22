import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import { ForgeVisual } from '../components/ForgeVisual.js';
import { agentStateFor } from '../lib/core.js';
import { findingRows, rowForPackage } from '../lib/structure-map.js';
import type { ScanSession } from '../lib/useScan.js';
import { isWebGLAvailable, usePrefersReducedMotion } from '../three/capabilities.js';

const ScanFieldSceneLazy = lazy(() =>
  import('../three/ScanFieldScene.js').then((module) => ({ default: module.ScanFieldScene })),
);

/**
 * Live Monitor: the in-scan view. Target, real start time, real OSV counters from
 * progress events, the agent sensor, and a real Cancel (aborts the engine via the
 * server). The 3D scan field lights one slot per real package query as progress
 * events arrive; the counters carry the same numbers as text. No invented scan
 * IDs, no simulated activity.
 */
export function LiveMonitorScreen(props: { readonly session: ScanSession }) {
  const { session } = props;
  const { ui } = session;
  const agentState = agentStateFor(ui.state);
  const reducedMotion = usePrefersReducedMotion();
  const scanning = ui.state === 'scanning' || ui.state === 'analyzing' || ui.state === 'detected';
  const showField = scanning && !reducedMotion && isWebGLAvailable() && ui.queriesTotal > 0;

  return (
    <div className="grid-live">
      <section className="panel">
        <h2>live monitor</h2>
        <p className="mono posture-line">{ui.target ?? '—'}</p>
        <p className="muted mono">
          {ui.startedAt === null ? '' : `started ${ui.startedAt} · `}state {ui.state}
        </p>
        <div className="live-counters">
          <div className="stat-card">
            <div className="value">{ui.queriesDone}</div>
            <div className="label">OSV queries done</div>
          </div>
          <div className="stat-card">
            <div className="value">{ui.queriesTotal}</div>
            <div className="label">OSV queries total</div>
          </div>
        </div>
        {showField && (
          <Suspense fallback={null}>
            <ScanFieldSceneLazy packages={session.scannedPackages} total={ui.queriesTotal} />
          </Suspense>
        )}
        <p className="mono muted">
          {ui.lastPackage === null ? 'waiting for the first query…' : `queried: ${ui.lastPackage}`}
        </p>
        {(ui.state === 'scanning' || ui.state === 'analyzing') && (
          <div className="form-actions">
            <button type="button" className="primary" onClick={session.cancel}>
              cancel scan
            </button>
          </div>
        )}
      </section>
      <section className="panel panel-forge">
        <h2>agent sensor</h2>
        <ForgeVisual
          state={agentState}
          size={200}
          detectedSeverity={ui.state === 'detected' ? ui.detectedSeverity : null}
        />
        <p className="mono muted">STATE: {ui.state.toUpperCase()}</p>
      </section>
      <StructurePanel session={session} />
    </div>
  );
}

/** Tiny Forge glyph that marks the structure row being scanned. */
function ForgeMarker() {
  return (
    <span className="struct-forge" role="img" aria-label="Forge is scanning here">
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true">
        <rect x="3" y="6" width="10" height="7" rx="2.4" />
        <path d="M8 6V3.2" />
        <circle cx="8" cy="2.3" r="0.9" />
        <path d="M6 9.6v.2M10 9.6v.2" />
      </svg>
    </span>
  );
}

/**
 * The real project structure around a scan: while the engine runs, Forge's
 * marker sits on the row of the package being queried (its installed
 * directory, or the manifest that declares it). When the report lands, the
 * panel replays the real recorded visit order at a watchable pace - scans of
 * small projects finish in a blink, so the traversal you see is the true
 * order the engine visited, not a simulation - then finding rows light up in
 * their worst severity. When the tree cannot be listed the panel says so and
 * the counters above still carry the real progress.
 */
function StructurePanel(props: { readonly session: ScanSession }) {
  const { session } = props;
  const { ui } = session;
  const reducedMotion = usePrefersReducedMotion();
  const live = ui.state === 'scanning' || ui.state === 'analyzing';
  const finished = !live && session.report !== null;
  const entries = useMemo(() => session.structure?.entries ?? [], [session.structure]);

  // The real visit order, deduped to consecutive distinct rows.
  const visitOrder = useMemo(() => {
    const rows: number[] = [];
    for (const pkg of session.scannedPackages) {
      const row = rowForPackage(entries, pkg);
      if (row !== -1 && rows[rows.length - 1] !== row) {
        rows.push(row);
      }
    }
    return rows;
  }, [entries, session.scannedPackages]);

  // Post-scan replay of the real visit order: -1 = not replaying.
  const [replayIndex, setReplayIndex] = useState(-1);
  useEffect(() => {
    if (!finished || visitOrder.length < 2 || reducedMotion) {
      setReplayIndex(-1);
      return;
    }
    setReplayIndex(0);
    const timer = setInterval(() => {
      setReplayIndex((step) => {
        if (step === -1) {
          clearInterval(timer);
          return -1;
        }
        if (step >= visitOrder.length - 1) {
          clearInterval(timer);
          // hold on the last row briefly, then hand over to the findings
          setTimeout(() => setReplayIndex(-1), 450);
          return visitOrder.length - 1;
        }
        return step + 1;
      });
    }, 160);
    return () => clearInterval(timer);
  }, [finished, visitOrder, reducedMotion]);

  const liveRow =
    live && ui.lastPackage !== null && entries.length > 0
      ? rowForPackage(entries, ui.lastPackage)
      : -1;
  const activeRow = replayIndex >= 0 ? visitOrder[replayIndex] : liveRow;
  const showFindings = finished && replayIndex === -1;

  const doneRows = useMemo(() => {
    const done = new Set<number>();
    if (replayIndex >= 0) {
      for (let i = 0; i < replayIndex; i += 1) {
        done.add(visitOrder[i]);
      }
      return done;
    }
    for (const pkg of session.scannedPackages) {
      if (pkg === ui.lastPackage) {
        continue;
      }
      const index = rowForPackage(entries, pkg);
      if (index !== -1) {
        done.add(index);
      }
    }
    return done;
  }, [entries, session.scannedPackages, ui.lastPackage, replayIndex, visitOrder]);

  const findings = useMemo(
    () =>
      showFindings && session.report !== null && entries.length > 0
        ? findingRows(entries, session.report)
        : new Map<number, never>(),
    [showFindings, session.report, entries],
  );

  return (
    <section className="panel struct-panel">
      <h2>project structure</h2>
      {session.structureUnavailable && (
        <p className="muted mono">
          structure unavailable for this path - the live progress above is still real.
        </p>
      )}
      {session.structure === null && !session.structureUnavailable && (
        <p className="muted mono">reading the project tree…</p>
      )}
      {session.structure !== null && (
        <>
          {session.structure.truncated && (
            <p className="muted mono">
              listing capped at 400 entries - scan progress still tracks every package.
            </p>
          )}
          {replayIndex >= 0 && (
            <p className="muted mono">
              scan finished in a blink - replaying the engine&apos;s real visit order.
            </p>
          )}
          <div className="struct-list" role="list" aria-label="project structure">
            {entries.map((entry, index) => {
              const finding = findings.get(index);
              const classes = [
                'struct-row',
                `depth-${Math.min(entry.depth, 5)}`,
                index === activeRow ? 'active' : '',
                doneRows.has(index) ? 'done' : '',
                finding !== undefined ? `finding ${finding}` : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={entry.path}
                  role="listitem"
                  className={classes}
                  ref={
                    index === activeRow
                      ? (node) => node?.scrollIntoView({ block: 'nearest' })
                      : undefined
                  }>
                  <span className="struct-glyph" aria-hidden="true">
                    {entry.kind === 'dir' ? '▸' : '·'}
                  </span>
                  <span className="struct-name">{entry.name}</span>
                  {index === activeRow && <ForgeMarker />}
                  {finding !== undefined && <span className={`badge ${finding}`}>{finding}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
