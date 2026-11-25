import { ForgeVisual } from '../components/ForgeVisual.js';
import { agentStateFor, buildOverviewModel } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';

export function OverviewScreen(props: { readonly session: ScanSession }) {
  const { session } = props;

  if (session.reportLoad === 'loading') {
    return <div className="empty">loading report…</div>;
  }
  if (session.reportLoad === 'error') {
    return <div className="empty">the startup report could not be loaded</div>;
  }
  if (session.report === null) {
    return (
      <div className="empty">
        no report loaded yet
        <br />
        start a new scan to produce one
      </div>
    );
  }

  const model = buildOverviewModel(session.report);
  const agentState = agentStateFor(session.ui.state);

  return (
    <div className="grid-overview">
      <section className="panel panel-posture">
        <h2>posture</h2>
        <p className="mono posture-line">
          {model.posture.projectName} · {model.posture.ecosystem} · {model.posture.manifestPath}
        </p>
        <p className="muted mono posture-meta">
          generated {model.posture.generatedAt} · schema v{model.posture.schemaVersion}
        </p>
        {model.posture.unresolvedCount > 0 && (
          <div className="warn-list">
            <p>NOT FULLY SCANNED — {model.posture.unresolvedCount} requirement(s) unresolved:</p>
            <ul>
              {model.unresolved.map((entry) => (
                <li key={entry.requirement}>
                  {entry.requirement} — {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel panel-forge">
        <h2>agent</h2>
        <ForgeVisual
          state={agentState}
          detectedSeverity={session.ui.state === 'detected' ? session.ui.detectedSeverity : null}
        />
        <p className="mono muted">STATE: {session.ui.state.toUpperCase()}</p>
      </section>

      <ForgeSays model={model} />

      <div className="grid-cards">
        {model.statCards.map((card) => (
          <div
            key={card.label}
            className={`stat-card ${card.label === 'Critical' ? 'sev-critical' : ''} ${
              card.label === 'High' ? 'sev-high' : ''
            }`}>
            <div className="value">{card.value}</div>
            <div className="label">{card.label}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2>severity distribution (share of total)</h2>
        {model.distribution.every((row) => row.count === 0) ? (
          <p className="muted">no findings</p>
        ) : (
          model.distribution.map((row) => (
            <div key={row.severity} className="dist-row">
              <span>{row.severity}</span>
              <span className="dist-track">
                <DistFill severity={row.severity} share={row.sharePercent} />
              </span>
              <span>
                {row.count} · {row.sharePercent}%
              </span>
            </div>
          ))
        )}
        {model.meanPriorityScore !== null && (
          <p className="muted mono">mean priority score: {model.meanPriorityScore.toFixed(1)}</p>
        )}
      </section>

      <section className="panel">
        <h2>priority findings</h2>
        {model.priorityRows.length === 0 ? (
          <p className="muted">no findings</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>severity</th>
                <th>id</th>
                <th>package</th>
                <th>score</th>
                <th>fix</th>
              </tr>
            </thead>
            <tbody>
              {model.priorityRows.slice(0, 10).map((row) => (
                <tr key={row.findingKey}>
                  <td>
                    <span className={`badge ${row.severity}`}>{row.severity}</span>
                  </td>
                  <td>{row.cve ?? row.id}</td>
                  <td>
                    {row.packageName}@{row.installedVersion}
                  </td>
                  <td>{row.priorityScore}</td>
                  <td>{row.fixedVersion ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>top packages by findings</h2>
        {model.topPackages.length === 0 ? (
          <p className="muted">none</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>package</th>
                <th>findings</th>
                <th>worst</th>
              </tr>
            </thead>
            <tbody>
              {model.topPackages.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.findingCount}</td>
                  <td>
                    <span className={`badge ${row.worstSeverity}`}>{row.worstSeverity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Bar widths go through SVG-style scale, not inline styles: the track is an SVG. */
function DistFill(props: { readonly severity: string; readonly share: number }) {
  const width = Math.max(0, Math.min(100, props.share));
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="dist-svg">
      <rect x="0" y="0" width={width} height="10" className={`dist-fill ${props.severity}`} />
    </svg>
  );
}

/** Forge narrates the real report: every number and name below comes from it. */
function ForgeSays(props: { readonly model: ReturnType<typeof buildOverviewModel> }) {
  const { model } = props;
  const total = model.priorityRows.length;
  const worst = model.priorityRows[0];
  return (
    <div className="forge-says" role="status">
      <span className="who">Forge</span>
      {worst === undefined ? (
        <>No known vulnerabilities found in {model.posture.projectName}.</>
      ) : (
        <>
          <strong>{total}</strong> finding(s) in {model.posture.projectName}. Hit first:{' '}
          <strong>
            {worst.packageName}@{worst.installedVersion}
          </strong>{' '}
          ({worst.cve ?? worst.id}, {worst.severity}
          {worst.fixedVersion === null ? '' : `, fixed in ${worst.fixedVersion}`}).
        </>
      )}
    </div>
  );
}
