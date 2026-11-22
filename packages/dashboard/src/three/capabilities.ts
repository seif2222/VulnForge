import { useSyncExternalStore } from 'react';

/**
 * Runtime capability probes. The dashboard renders WebGL scenes only when the
 * browser can actually create a context, and honors prefers-reduced-motion by
 * falling back to the 2D renderings (which carry the same data).
 */
let webglCached: boolean | null = null;

export function isWebGLAvailable(): boolean {
  if (webglCached !== null) {
    return webglCached;
  }
  try {
    const canvas = document.createElement('canvas');
    webglCached = canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
  } catch {
    webglCached = false;
  }
  return webglCached;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Live subscription so an OS-level change mid-session switches the rendering. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(REDUCED_MOTION_QUERY);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    () => prefersReducedMotion(),
    () => false,
  );
}
