import { useEffect } from 'react';

import './../vendor/sakuga/button.js';

/**
 * One animation on every click, drawn with the Sakuga effects layer (the same
 * canvas the vendored controls use) plus a CSS press on the element itself.
 * Decoration only: it never changes what a click does, and it is skipped when
 * the user prefers reduced motion.
 */

interface SakugaFx {
  readonly puff: (x: number, y: number, o?: object) => void;
  readonly burst: (x: number, y: number, o?: object) => void;
  readonly ticks: (x: number, y: number, o?: object) => void;
  readonly kira: (x: number, y: number, o?: object) => void;
  readonly shards: (x: number, y: number, o?: object) => void;
  readonly lines: (x: number, y: number, o?: object) => void;
}

const INTERACTIVE =
  "button, [role='tab'], tr, select, input, label, a, .stat-card, .panel, .dist-row, summary";

export function ClickFX() {
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onClick = (event: MouseEvent): void => {
      if (motion.matches || !(event.target instanceof Element)) return;
      if (event.target.closest('sakuga-button, sakuga-checkbox') !== null) return;
      const target = event.target.closest(INTERACTIVE);
      if (target === null || target.tagName === 'SAKUGA-BUTTON') return;
      const fx = (window as unknown as { SakugaFX?: SakugaFx }).SakugaFX;
      const { clientX: x, clientY: y } = event;

      target.classList.remove('fx-hit');
      void (target as HTMLElement).offsetWidth;
      target.classList.add('fx-hit');
      window.setTimeout(() => target.classList.remove('fx-hit'), 560);

      if (fx === undefined) return;
      if (target.getAttribute('role') === 'tab') {
        fx.burst(x, y, { r: 30, spikes: 9, life: 0.28 });
        fx.ticks(x, y, { n: 3, r: 14, len: 10, dir: -1.57, life: 0.4 });
      } else if (target.tagName === 'TR') {
        fx.ticks(x, y, { n: 3, r: 10, len: 12, dir: -1.57, life: 0.35 });
        fx.kira(x, y, { r: 8, life: 0.5 });
      } else if (['SELECT', 'INPUT', 'LABEL'].includes(target.tagName)) {
        fx.kira(x, y, { r: 9, life: 0.55 });
        fx.puff(x, y, { n: 3, size: 7, life: 0.5 });
      } else if (target.matches('.stat-card, .panel, .dist-row')) {
        fx.puff(x, y, { n: 4, size: 8, life: 0.55 });
        fx.lines(x, y, { n: 4, len: 18, spread: 40, life: 0.25 });
      } else {
        fx.burst(x, y, { r: 26, spikes: 9, life: 0.26 });
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
