import { useState } from 'react';

import type { ScanSession } from '../lib/useScan.js';

/**
 * Start New Scan: target path, launch, honest blocked reasons. The server knows
 * the real preflight facts once the engine reads the target; the dashboard never
 * invents them.
 */
export function NewScanScreen(props: { readonly session: ScanSession }) {
  const [target, setTarget] = useState('');
  const { session } = props;
  const busy = ['scanning', 'analyzing', 'detected'].includes(session.ui.state);

  return (
    <div className="grid-single">
      <section className="panel">
        <h2>start new scan</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (target.trim() !== '' && !busy) {
              session.launch(target.trim());
            }
          }}>
          <label htmlFor="scan-target" className="muted mono">
            project path (absolute or relative to the server&apos;s cwd)
          </label>
          <input
            id="scan-target"
            className="text"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="/path/to/project"
            disabled={busy}
          />
          <div className="form-actions">
            <button type="submit" className="primary" disabled={busy || target.trim() === ''}>
              {busy ? 'scan running…' : 'launch scan'}
            </button>
          </div>
        </form>
        {busy && (
          <p className="muted mono">
            one scan at a time: {session.ui.target} is running. Cancel it from the Live Monitor.
          </p>
        )}
        {session.ui.state === 'error' && (
          <p className="warn-list">last scan failed: {session.ui.errorMessage}</p>
        )}
        {session.ui.state === 'cancelled' && <p className="muted mono">last scan was cancelled.</p>}
      </section>
    </div>
  );
}
