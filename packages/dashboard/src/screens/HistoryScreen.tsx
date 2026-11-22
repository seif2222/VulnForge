import type { ScanSession } from '../lib/useScan.js';

/**
 * Scan History: session runs this dashboard process performed, plus the report
 * file loaded at startup. Real tallies only; no KPIs the engine does not keep.
 */
export function HistoryScreen(props: {
  readonly session: ScanSession;
  readonly onOpen: () => void;
}) {
  const { history } = props.session;

  return (
    <section className="panel">
      <h2>scan history</h2>
      <p className="muted mono">
        Latest 50 reports saved on this computer. Reopen any report below.
      </p>
      {props.session.historyWarning && (
        <p role="alert" className="warn-list">
          {props.session.historyWarning}
        </p>
      )}
      {history.length === 0 ? (
        <p className="muted mono">no saved scans yet</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>project</th>
              <th>generated</th>
              <th>source</th>
              <th>total</th>
              <th>critical</th>
              <th>high</th>
              <th>medium</th>
              <th>low</th>
              <th>report</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry, index) => (
              <tr key={`${entry.generatedAt}-${index}`}>
                <td>{entry.projectName}</td>
                <td>{entry.generatedAt}</td>
                <td>{entry.source === 'session' ? 'session' : (entry.path ?? 'file')}</td>
                <td>{entry.totalVulnerabilities}</td>
                <td>{entry.bySeverity.critical}</td>
                <td>{entry.bySeverity.high}</td>
                <td>{entry.bySeverity.medium}</td>
                <td>{entry.bySeverity.low}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      props.session.openHistory(index);
                      props.onOpen();
                    }}>
                    open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
