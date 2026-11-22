import { useEffect, useState } from 'react';

import type { StatusPayload } from '../lib/api.js';
import { fetchStatus } from '../lib/api.js';
import type { ScanSession } from '../lib/useScan.js';

/**
 * Settings & Environment: only facts the dashboard really probes - server
 * reachability, tool version, capability booleans (never key values), the SSE
 * channel, and this browser's WebGL support. Nothing simulated.
 */
export function SettingsScreen(props: { readonly session: ScanSession }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const webgl =
    typeof document !== 'undefined' &&
    (() => {
      try {
        const canvas = document.createElement('canvas');
        return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
      } catch {
        return false;
      }
    })();
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    let alive = true;
    fetchStatus()
      .then((payload) => {
        if (alive) {
          setStatus(payload);
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setStatusError(error instanceof Error ? error.message : 'unreachable');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  void props.session;

  return (
    <section className="panel">
      <h2>settings &amp; environment</h2>
      <dl className="details-grid mono">
        <dt>server</dt>
        <dd>{status !== null ? 'reachable' : (statusError ?? 'probing…')}</dd>
        {status !== null && (
          <>
            <dt>tool version</dt>
            <dd>{status.toolVersion}</dd>
            <dt>scan capability</dt>
            <dd>{status.capabilities.scan ? 'available' : 'unavailable'}</dd>
            <dt>AI provider key</dt>
            <dd>{status.capabilities.ai ? 'present (value never shown)' : 'absent'}</dd>
          </>
        )}
        <dt>event channel</dt>
        <dd>{typeof EventSource !== 'undefined' ? 'supported (SSE)' : 'unsupported'}</dd>
        <dt>webgl</dt>
        <dd>{webgl ? 'available - 3D scenes enabled' : 'unavailable - 2D fallbacks in use'}</dd>
        <dt>reduced motion</dt>
        <dd>{reducedMotion ? 'requested - animations and 3D are still' : 'not requested'}</dd>
        <dt>theme</dt>
        <dd>deep teal / ice white / soft peach (single theme, from design tokens)</dd>
      </dl>
    </section>
  );
}
