import { useEffect, useState } from 'react';

import type { StatusPayload } from '../lib/api.js';
import { fetchStatus } from '../lib/api.js';
import type { ScanSession } from '../lib/useScan.js';

/**
 * Start New Scan: target path, launch, honest blocked reasons. The server knows
 * the real preflight facts once the engine reads the target; the dashboard never
 * invents them. The Forge explanations checkbox appears only when the server
 * reports an AI provider is actually configured (capabilities.ai).
 */
export function NewScanScreen(props: { readonly session: ScanSession }) {
  const [target, setTarget] = useState('');
  const [aiExplanations, setAiExplanations] = useState(true);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const { session } = props;
  const busy = ['scanning', 'analyzing', 'detected'].includes(session.ui.state);
  const aiAvailable = status?.capabilities.ai === true;

  useEffect(() => {
    let alive = true;
    fetchStatus()
      .then((payload) => {
        if (alive) {
          setStatus(payload);
        }
      })
      .catch(() => {
        // No status means no checkbox: the scan works without it either way.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="grid-single">
      <section className="panel">
        <h2>start new scan</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (target.trim() !== '' && !busy) {
              session.launch(target.trim(), aiAvailable && aiExplanations);
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
          {aiAvailable && (
            <label htmlFor="scan-ai" className="checkbox-row">
              <input
                id="scan-ai"
                type="checkbox"
                checked={aiExplanations}
                onChange={(event) => setAiExplanations(event.target.checked)}
                disabled={busy}
              />
              <span className="muted mono">
                ask Forge to explain each finding (AI suggestion, not evidence)
              </span>
            </label>
          )}
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
