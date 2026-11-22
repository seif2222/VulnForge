import { buildAnalyticsModel, trendGeometry } from '../lib/analytics.js';
import type { ScanSession } from '../lib/useScan.js';

function shortStamp(iso: string): string {
  return iso.slice(5, 16).replace('T', ' ');
}

/**
 * Analytics: statistics and trends over the real vulnerability history of this
 * session's scans. Every number is computed from real scan reports. With one
 * scan the trend is one honest point and the screen says more scans will fill
 * it in - no curve is ever fabricated.
 */
export function AnalyticsScreen(props: { readonly session: ScanSession }) {
  const { session } = props;
  const model = buildAnalyticsModel(session.history, session.report);
  const geometry = trendGeometry(model.trend);
  const mixTotal = Math.max(
    1,
    model.mix.reduce((sum, row) => sum + row.count, 0),
  );
  const maxPackage = Math.max(1, ...model.topPackages.map((row) => row.findingCount));

  if (model.scanCount === 0) {
    return (
      <div className="grid-single">
        <section className="panel">
          <h2>analytics</h2>
          <p className="empty">no scan data yet - run a scan and real statistics appear here.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="grid-analytics">
      <div className="grid-cards">
        <div className="stat-card">
          <div className="value">{model.scanCount}</div>
          <div className="label">Scans Tracked</div>
        </div>
        <div className="stat-card">
          <div className="value">{model.latestFindings ?? '-'}</div>
          <div className="label">Latest Findings</div>
        </div>
        <div className="stat-card">
          <div className="value">
            {model.meanPriorityScore === null ? '-' : model.meanPriorityScore.toFixed(1)}
          </div>
          <div className="label">Mean Priority Score</div>
        </div>
        <div className="stat-card">
          <div className="value">{model.unresolvedCount ?? '-'}</div>
          <div className="label">Unresolved Requirements</div>
        </div>
      </div>

      <section className="panel">
        <h2>findings over time</h2>
        <svg
          className="trend-chart"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          role="img"
          aria-label="findings over time">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="trend-stop-top" />
              <stop offset="100%" className="trend-stop-bottom" />
            </linearGradient>
          </defs>
          {model.trend.length > 1 && (
            <>
              <path d={geometry.area} className="trend-area" />
              <polyline points={geometry.line} className="trend-line" />
            </>
          )}
          {geometry.dots.map((dot) => (
            <circle key={dot.at} cx={dot.x} cy={dot.y} r="0.9" className="trend-dot" />
          ))}
        </svg>
        <div className="trend-x mono">
          {model.trend.map((point) => (
            <span key={point.at}>
              {shortStamp(point.at)} · {point.total}
            </span>
          ))}
        </div>
        {model.trend.length < 2 && (
          <p className="muted mono">
            one real scan so far - trends fill in as you run more scans. Nothing here is
            extrapolated.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>severity mix across scans</h2>
        <svg className="dist-svg" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
          {(() => {
            let offset = 0;
            return model.mix.map((row) => {
              const width = (row.count / mixTotal) * 100;
              const element = (
                <rect
                  key={row.severity}
                  x={offset}
                  y={0}
                  width={width}
                  height={4}
                  className={`dist-fill ${row.severity}`}
                />
              );
              offset += width;
              return element;
            });
          })()}
        </svg>
        <div className="legend">
          {model.mix.map((row) => (
            <span key={row.severity} className="mono muted">
              <span className={`legend-swatch ${row.severity}`} aria-hidden="true" />
              {row.severity} {row.count}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>most vulnerable packages (latest report)</h2>
        {model.topPackages.length === 0 && (
          <p className="muted mono">no findings in the latest report.</p>
        )}
        {model.topPackages.map((row) => (
          <div key={row.id} className="dist-row">
            <span className="mono">{row.id}</span>
            <span className="dist-track">
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="dist-svg">
                <rect
                  x="0"
                  y="0"
                  width={(row.findingCount / maxPackage) * 100}
                  height="10"
                  className={`dist-fill ${row.worstSeverity}`}
                />
              </svg>
            </span>
            <span className="mono">{row.findingCount}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
