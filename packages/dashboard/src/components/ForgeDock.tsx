import { Forge2D } from './Forge2D.js';
import { agentStateFor } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';

/**
 * Forge's dock: a persistent character plus one line about what the engine is
 * really doing. Every word comes from the scan session or the loaded report.
 */
export function ForgeDock(props: { readonly session: ScanSession }) {
  const { session } = props;
  const { ui, report } = session;
  const scanning = ui.state === 'scanning' || ui.state === 'analyzing' || ui.state === 'detected';

  return (
    <aside className="forge-dock" aria-label="Forge status">
      <div className="dock-bubble" role="status">
        <span className="who">Forge</span>
        {scanning ? (
          <>
            Scanning <strong>{ui.target ?? 'project'}</strong>: <strong>{ui.queriesDone}</strong> of{' '}
            <strong>{ui.queriesTotal}</strong> packages checked
            {ui.lastPackage === null ? '' : `, now ${ui.lastPackage}`}.
          </>
        ) : ui.state === 'error' ? (
          <>The last scan failed: {ui.errorMessage}</>
        ) : report === null ? (
          <>
            No report yet. Give me a project path in <strong>Start New Scan</strong>.
          </>
        ) : (
          <>
            <strong>{String(report.stats.totalVulnerabilities)}</strong>
            {' findings in the loaded report.'}
          </>
        )}
      </div>
      <div className="dock-face">
        <Forge2D state={agentStateFor(ui.state)} size={84} />
      </div>
    </aside>
  );
}
