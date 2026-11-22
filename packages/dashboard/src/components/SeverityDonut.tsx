import type { Report } from '../lib/core.js';

export const LEVELS = ['critical', 'high', 'medium', 'low'] as const;
export function severitySlices(counts: Report['stats']['bySeverity']) {
  const total = LEVELS.reduce((sum, level) => sum + counts[level], 0);
  let offset = 0;
  return LEVELS.map((level) => {
    const share = total === 0 ? 0 : (counts[level] / total) * 100;
    const slice = { level, count: counts[level], share, offset };
    offset += share;
    return slice;
  });
}

export function SeverityDonut({ report }: { readonly report: Report }) {
  const slices = severitySlices(report.stats.bySeverity);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  return (
    <section className="panel severity-summary">
      <h2>findings by severity</h2>
      <div className="severity-donut-layout">
        <svg
          viewBox="0 0 160 160"
          className="severity-donut"
          role="img"
          aria-label={
            total === 0
              ? 'No findings. Severity percentages are not applicable.'
              : slices.map((s) => `${s.level}: ${s.share.toFixed(1)}%`).join(', ')
          }>
          <circle cx="80" cy="80" r="58" className="donut-track" />
          {slices
            .filter((s) => s.count > 0)
            .map((s) => (
              <circle
                key={s.level}
                cx="80"
                cy="80"
                r="58"
                pathLength="100"
                fill="none"
                strokeWidth="17"
                strokeDasharray={`${s.share} ${100 - s.share}`}
                strokeDashoffset={-s.offset}
                transform="rotate(-90 80 80)"
                className={`donut-segment ${s.level}`}
              />
            ))}
          <text x="80" y="77" textAnchor="middle" className="donut-total">
            {total}
          </text>
          <text x="80" y="96" textAnchor="middle" className="donut-caption">
            findings
          </text>
        </svg>
        <div className="severity-legend">
          {slices.map((s) => (
            <div className="severity-legend-row" key={s.level}>
              <span className={`badge ${s.level}`}>{s.level}</span>
              <span className="mono">{s.count}</span>
              <span className="mono">{total === 0 ? 'N/A' : `${s.share.toFixed(1)}%`}</span>
            </div>
          ))}
          <p className="muted mono">
            {total === 0
              ? 'No findings in this report. Percentages are not applicable.'
              : 'Share of findings, not a scan-progress percentage.'}
          </p>
        </div>
      </div>
    </section>
  );
}
