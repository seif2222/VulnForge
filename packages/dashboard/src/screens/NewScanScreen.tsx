import { useEffect, useState } from 'react';

import { SakugaButton, SakugaCheckbox } from '../components/Sakuga.js';
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
  const publicDemo = status?.capabilities.publicDemo === true;
  const [manifestName, setManifestName] = useState('package.json');
  const [manifestText, setManifestText] = useState('');

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

  if (publicDemo) {
    const launchPasted = (): void => {
      if (manifestText.trim() !== '' && !busy) {
        session.launch(`pasted ${manifestName}`, false, {
          manifestName,
          manifestContent: manifestText,
        });
      }
    };
    return (
      <div className="grid-single">
        <section className="panel">
          <h2>try vulnforge</h2>
          <p className="muted mono">
            Public demo. Paste or upload a dependency file. It is scanned against the real osv.dev
            database and discarded right after. Nothing is stored. Forge explanations are off here
            (no AI model runs online). Limit: 8 scans per 10 minutes per visitor.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              launchPasted();
            }}>
            <label htmlFor="manifest-name" className="muted mono">
              file type
            </label>
            <select
              id="manifest-name"
              className="text"
              value={manifestName}
              onChange={(event) => setManifestName(event.target.value)}
              disabled={busy}>
              <option value="package.json">package.json (npm)</option>
              <option value="package-lock.json">package-lock.json (npm, exact versions)</option>
              <option value="requirements.txt">requirements.txt (Python)</option>
            </select>
            <label htmlFor="manifest-file" className="muted mono">
              upload a file (or paste below)
            </label>
            <input
              id="manifest-file"
              className="text"
              type="file"
              accept=".json,.txt"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file === undefined) return;
                if (file.name === 'package-lock.json' || file.name === 'requirements.txt') {
                  setManifestName(file.name);
                } else if (file.name === 'package.json') {
                  setManifestName('package.json');
                }
                void file.text().then(setManifestText);
              }}
            />
            <label htmlFor="manifest-text" className="muted mono">
              file contents
            </label>
            <textarea
              id="manifest-text"
              className="text mono"
              rows={12}
              value={manifestText}
              onChange={(event) => setManifestText(event.target.value)}
              placeholder='{"dependencies": {"lodash": "4.17.15"}}'
              disabled={busy}
            />
            <div className="form-actions">
              <SakugaButton
                type="button"
                disabled={busy}
                onClick={() => {
                  setManifestName('package.json');
                  setManifestText(
                    JSON.stringify(
                      {
                        name: 'demo-project',
                        dependencies: { lodash: '4.17.15', minimist: '1.2.0' },
                      },
                      null,
                      2,
                    ),
                  );
                }}>
                load a sample
              </SakugaButton>
              <SakugaButton type="submit" disabled={busy || manifestText.trim() === ''}>
                {busy ? 'scan running…' : 'launch scan'}
              </SakugaButton>
            </div>
          </form>
          {busy && <p className="muted mono">scan running: {session.ui.target}</p>}
          {session.ui.state === 'error' && (
            <p className="warn-list">last scan failed: {session.ui.errorMessage}</p>
          )}
        </section>
      </div>
    );
  }

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
            <div className="checkbox-row">
              <SakugaCheckbox
                name="scan-ai"
                checked={aiExplanations}
                onChange={setAiExplanations}
                disabled={busy}>
                ask Forge to explain each finding (AI suggestion, not evidence)
              </SakugaCheckbox>
            </div>
          )}
          <div className="form-actions">
            <SakugaButton type="submit" disabled={busy || target.trim() === ''}>
              {busy ? 'scan running…' : 'launch scan'}
            </SakugaButton>
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
