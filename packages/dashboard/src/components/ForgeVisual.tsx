import { Suspense, lazy } from 'react';

import type { AgentState, Severity } from '../lib/core.js';
import { isWebGLAvailable, usePrefersReducedMotion } from '../three/capabilities.js';
import { Forge2D } from './Forge2D.js';

const ForgeSceneLazy = lazy(() =>
  import('../three/ForgeScene.js').then((module) => ({ default: module.ForgeScene })),
);

/**
 * The Forge character with its required fallbacks: WebGL when the browser
 * supports it and the user allows motion, the accessible SVG otherwise
 * (missing WebGL, prefers-reduced-motion, or while the 3D chunk loads — the
 * three.js bundle is lazy so it never blocks the first paint).
 */
export function ForgeVisual(props: {
  readonly state: AgentState;
  readonly size?: number;
  readonly detectedSeverity?: Severity | null;
}) {
  const reducedMotion = usePrefersReducedMotion();
  // exactOptionalPropertyTypes: only pass size when the caller gave one.
  const sizeProps = props.size === undefined ? {} : { size: props.size };
  if (reducedMotion || !isWebGLAvailable()) {
    return (
      <Forge2D
        state={props.state}
        {...sizeProps}
        detectedSeverity={props.detectedSeverity ?? null}
      />
    );
  }
  return (
    <Suspense
      fallback={
        <Forge2D
          state={props.state}
          {...sizeProps}
          detectedSeverity={props.detectedSeverity ?? null}
        />
      }>
      <ForgeSceneLazy state={props.state} detectedSeverity={props.detectedSeverity ?? null} />
    </Suspense>
  );
}
