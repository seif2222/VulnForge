import type { ScanSession } from '../lib/useScan.js';

/**
 * Reports: the loaded report's real metadata and severity summary, with a JSON
 * download of exactly the bytes the engine produced (client-side blob of the
 * report object the server already validated).
 */
export function ReportsScreen(props: { readonly session: ScanSession }) {
  const { report } = props.session;

  if (report === null) {
    return <div className="empty">no report loaded — run a scan first</div>;
  }

  const download = (): void => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `vulnforge-report-${report.meta.projectName}-${report.meta.generatedAt.replace(/:/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <h2>reports</h2>
      <dl className="details-grid mono">
        <dt>project</dt>
        <dd>{report.meta.projectName}</dd>
        <dt>ecosystem</dt>
        <dd>{report.meta.ecosystem}</dd>
        <dt>manifest</dt>
        <dd>{report.meta.manifestPath}</dd>
        <dt>generated</dt>
        <dd>{report.meta.generatedAt}</dd>
        <dt>schema</dt>
        <dd>v{report.schemaVersion}</dd>
        <dt>tool</dt>
        <dd>
          {report.meta.tool.name} {report.meta.tool.version}
        </dd>
        <dt>packages</dt>
        <dd>
          {report.stats.totalPackages} ({report.stats.directPackages} direct,{' '}
          {report.stats.transitivePackages} transitive)
        </dd>
        <dt>findings</dt>
        <dd>
          {report.stats.totalVulnerabilities} · critical {report.stats.bySeverity.critical} · high{' '}
          {report.stats.bySeverity.high} · medium {report.stats.bySeverity.medium} · low{' '}
          {report.stats.bySeverity.low}
        </dd>
        {report.meta.workspace !== undefined && (
          <>
            <dt>workspace</dt>
            <dd>{report.meta.workspace.scannedManifests.join(', ')}</dd>
          </>
        )}
      </dl>
      <div className="form-actions">
        <button type="button" className="primary" onClick={download}>
          download report JSON
        </button>
      </div>
    </section>
  );
}
