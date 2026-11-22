import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { WebGLRenderer } from 'three';

/**
 * Shared WebGL lifecycle for every dashboard scene. Enforces the spec's
 * non-negotiables in one place:
 *  - pixelRatio capped at 2
 *  - the render loop pauses when the tab is hidden or the canvas is offscreen
 *  - full GPU disposal on unmount
 *  - context-loss recovery: the scene is rebuilt on webglcontextrestored
 *  - a deterministic clock is injectable (tests and reproducible motion);
 *    production uses performance.now
 * The canvas never gets inline styles (CSP): setSize uses updateStyle=false.
 */
export type SceneClock = () => number;

export interface ThreeSceneHandle {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

export interface SceneInstance {
  /** Advance and render the scene. Times come from the injected clock. */
  readonly tick: (elapsedMs: number, deltaMs: number) => void;
  readonly resize?: (width: number, height: number) => void;
  /** Free every geometry, material and texture the scene allocated. */
  readonly dispose: () => void;
}

const DEFAULT_CLOCK: SceneClock = () => performance.now();

export function useThreeScene(options: {
  readonly init: (handle: ThreeSceneHandle) => SceneInstance;
  /** Rebuild the scene when this value changes (compare with Object.is). */
  readonly resetKey: unknown;
  readonly clock?: SceneClock;
  readonly alpha?: boolean;
  readonly clearColor?: number;
}): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(options.init);
  initRef.current = options.init;
  const clockRef = useRef<SceneClock>(options.clock ?? DEFAULT_CLOCK);
  clockRef.current = options.clock ?? DEFAULT_CLOCK;
  const alpha = options.alpha ?? false;
  const clearColor = options.clearColor;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-canvas';
    container.appendChild(canvas);

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (clearColor !== undefined) {
      renderer.setClearColor(clearColor, 1);
    }
    renderer.setSize(container.clientWidth, container.clientHeight, false);

    let instance = initRef.current({
      renderer,
      canvas,
      width: container.clientWidth,
      height: container.clientHeight,
    });

    let raf = 0;
    let running = false;
    let visible = !document.hidden;
    let inView = true;
    let last = clockRef.current();

    const frame = (): void => {
      if (!running) {
        return;
      }
      const now = clockRef.current();
      // Clamp long gaps (tab was throttled) so motion never jumps.
      const delta = Math.min(100, Math.max(0, now - last));
      last = now;
      instance.tick(now, delta);
      raf = requestAnimationFrame(frame);
    };
    const start = (): void => {
      if (!running && visible && inView) {
        running = true;
        last = clockRef.current();
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = (): void => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = (): void => {
      visible = !document.hidden;
      if (visible) {
        start();
      } else {
        stop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const intersection = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      if (inView) {
        start();
      } else {
        stop();
      }
    });
    intersection.observe(container);

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) {
        return;
      }
      renderer.setSize(width, height, false);
      instance.resize?.(width, height);
    });
    resizeObserver.observe(container);

    // Context loss: preventDefault allows restoration; rebuild the scene on it.
    const onLost = (event: Event): void => {
      event.preventDefault();
      stop();
    };
    const onRestored = (): void => {
      instance.dispose();
      renderer.setSize(container.clientWidth, container.clientHeight, false);
      instance = initRef.current({
        renderer,
        canvas,
        width: container.clientWidth,
        height: container.clientHeight,
      });
      start();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      intersection.disconnect();
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      instance.dispose();
      renderer.dispose();
      canvas.remove();
    };
    // initRef/clockRef are live refs; resetKey/alpha/clearColor own re-creation.
  }, [options.resetKey, alpha, clearColor]);

  return containerRef;
}
