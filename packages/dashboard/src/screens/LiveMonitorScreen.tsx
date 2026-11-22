import { Forge2D } from '../components/Forge2D.js';
import { agentStateFor } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';

/**
 * Live Monitor: the in-scan view. Target, real start time, real OSV counters from
 * progress events, the agent sensor, and a real Cancel (aborts the engine via the
 * server). No invented scan IDs, no simulated activity.
 */
export function LiveMonitorScreen(props: { readonly session: ScanSession }) {
  const { session } = props;
  const { ui } = session;
  const agentState = agentStateFor(ui.state);

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
        <p className="mono muted">
          {ui.lastPackage === null ? 'waiting for the first query…' : `queried: ${ui.lastPackage}`}
        </p>
        {(ui.state === 'scanning' || ui.state === 'analyzing' || ui.state === 'detected') && (
          <div className="form-actions">
            <button type="button" className="primary" onClick={session.cancel}>
              cancel scan
            </button>
          </div>
        )}
      </section>
      <section className="panel panel-forge">
        <h2>agent sensor</h2>
        <Forge2D
          state={agentState}
          size={200}
          detectedSeverity={ui.state === 'detected' ? ui.detectedSeverity : null}
        />
        <p className="mono muted">STATE: {ui.state.toUpperCase()}</p>
      </section>
    </div>
  );
}
