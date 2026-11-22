import { SeverityDonut } from '../components/SeverityDonut.js';
import { useMemo, useState } from 'react';

import type { FindingRow, Severity } from '../lib/core.js';
import { SEVERITIES, buildFindingsModel } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';

type SortKey = 'severity' | 'score' | 'package' | 'id';

/**
 * Findings Explorer: the real finding rows from the current report with severity
 * filter, search, and sort, plus a details panel where engine evidence stays
 * visibly separate from AI suggestion text.
 */
export function FindingsScreen(props: { readonly session: ScanSession }) {
  const { report } = props.session;
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [selected, setSelected] = useState<string | null>(null);

  const model = useMemo(() => (report === null ? null : buildFindingsModel(report)), [report]);

  const rows = useMemo(() => {
    if (model === null) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    const filtered = model.rows.filter(
      (row) =>
        (severity === 'all' || row.severity === severity) &&
        (needle === '' ||
          row.id.toLowerCase().includes(needle) ||
          row.packageName.toLowerCase().includes(needle) ||
          (row.cve?.toLowerCase().includes(needle) ?? false)),
    );
    const byKey: Record<SortKey, (a: FindingRow, b: FindingRow) => number> = {
      severity: (a, b) =>
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        b.priorityScore - a.priorityScore,
      score: (a, b) => b.priorityScore - a.priorityScore,
      package: (a, b) => a.packageName.localeCompare(b.packageName),
      id: (a, b) => a.id.localeCompare(b.id),
    };
    return [...filtered].sort(byKey[sortKey]);
  }, [model, severity, query, sortKey]);

  if (report === null || model === null) {
    return <div className="empty">no report loaded — run a scan first</div>;
  }

  const selectedRow = rows.find((row) => row.findingKey === selected) ?? null;
  const suggestion =
    selectedRow === null
      ? null
      : (report.suggestions.find((entry) => entry.findingKey === selectedRow.findingKey) ?? null);

  return (
    <div className="results-page">
      <SeverityDonut report={report} />
      {props.session.historyWarning && (
        <p role="alert" className="warn-list">
          {props.session.historyWarning}
        </p>
      )}
      <div className="grid-findings">
        <section className="panel">
          <h2>findings explorer</h2>
          <div className="findings-controls">
            <select
              className="text select"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Severity | 'all')}
              aria-label="severity filter">
              <option value="all">all severities ({model.rows.length})</option>
              {SEVERITIES.map((level) => (
                <option key={level} value={level}>
                  {level} ({model.counts[level] ?? 0})
                </option>
              ))}
            </select>
            <input
              className="text"
              placeholder="search id, CVE or package"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="search findings"
            />
            <select
              className="text select"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              aria-label="sort by">
              <option value="severity">sort: severity</option>
              <option value="score">sort: priority score</option>
              <option value="package">sort: package</option>
              <option value="id">sort: id</option>
            </select>
          </div>
          {rows.length === 0 ? (
            <p className="muted mono">no findings match</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>severity</th>
                  <th>id</th>
                  <th>package</th>
                  <th>installed</th>
                  <th>fix</th>
                  <th>score</th>
                  <th>flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.findingKey}
                    className={row.findingKey === selected ? 'row-selected' : ''}
                    onClick={() => setSelected(row.findingKey)}>
                    <td>
                      <span className={`badge ${row.severity}`}>{row.severity}</span>
                    </td>
                    <td>{row.cve ?? row.id}</td>
                    <td>{row.packageName}</td>
                    <td>{row.installedVersion}</td>
                    <td>{row.fixedVersion ?? '—'}</td>
                    <td>{row.priorityScore}</td>
                    <td className="muted">
                      {row.flags.isDirect ? 'direct' : 'transitive'}
                      {row.ignored ? ' · ignored' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {model.ignoredCount > 0 && (
            <p className="muted mono">{model.ignoredCount} finding(s) suppressed by ignore rules</p>
          )}
        </section>

        <section className="panel">
          <h2>finding details</h2>
          {selectedRow === null ? (
            <p className="muted">select a finding</p>
          ) : (
            <FindingDetails session={props.session} row={selectedRow} suggestion={suggestion} />
          )}
        </section>
      </div>
    </div>
  );
}

function FindingDetails(props: {
  readonly session: ScanSession;
  readonly row: FindingRow;
  readonly suggestion: {
    readonly rationale: string;
    readonly saferVersion: string | null;
    readonly alternativePackage: string | null;
  } | null;
}) {
  const { row, session } = props;
  const vulnerability = session.report?.vulnerabilities.find(
    (entry) => entry.findingKey === row.findingKey,
  );
  return (
    <div className="details">
      <h3 className="mono details-title">{row.id}</h3>
      <dl className="details-grid mono">
        <dt>package</dt>
        <dd>
          {row.packageName}@{row.installedVersion}
        </dd>
        <dt>severity</dt>
        <dd>
          <span className={`badge ${row.severity}`}>{row.severity}</span>
        </dd>
        {row.cve !== null && (
          <>
            <dt>CVE</dt>
            <dd>{row.cve}</dd>
          </>
        )}
        {row.cvssScore !== null && (
          <>
            <dt>cvss</dt>
            <dd>{row.cvssScore}</dd>
          </>
        )}
        <dt>priority score</dt>
        <dd>{row.priorityScore}</dd>
        <dt>fixed version</dt>
        <dd>{row.fixedVersion ?? 'none known'}</dd>
        <dt>dependency</dt>
        <dd>{row.flags.isDirect ? 'direct' : 'transitive'}</dd>
        <dt>reachable</dt>
        <dd>
          {row.flags.isReachable === null ? 'undetermined' : row.flags.isReachable ? 'yes' : 'no'}
        </dd>
        {vulnerability !== undefined && (
          <>
            <dt>affected range</dt>
            <dd>{vulnerability.affectedRange}</dd>
          </>
        )}
      </dl>
      {vulnerability !== undefined && vulnerability.summary !== '' && (
        <section>
          <h4 className="details-section">advisory (engine evidence)</h4>
          <p className="muted">{vulnerability.summary}</p>
        </section>
      )}
      {props.suggestion !== null && (
        <section className="ai-block">
          <h4 className="details-section">Forge suggestion (AI, not evidence)</h4>
          {props.suggestion.saferVersion !== null && (
            <p>safer version: {props.suggestion.saferVersion}</p>
          )}
          {props.suggestion.alternativePackage !== null && (
            <p>alternative package: {props.suggestion.alternativePackage}</p>
          )}
          <p>{props.suggestion.rationale}</p>
        </section>
      )}
    </div>
  );
}
