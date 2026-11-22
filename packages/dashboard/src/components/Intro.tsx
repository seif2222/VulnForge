import { useEffect, useState } from 'react';

import { usePrefersReducedMotion } from '../three/capabilities.js';

const SKY_W = 1000;
const SKY_H = 600;
const SKY_CX = SKY_W / 2;
const SKY_CY = SKY_H / 2;
/** Concentric portal rings behind the entrance, smallest to widest. */
const RING_RADII = [110, 180, 260, 350, 450] as const;
const GREETING = "Hello, I'm Forge. Let's start.";
/** Typing starts once the emergence animation has landed (1100ms at 150ms delay). */
const TYPE_START_MS = 1300;
const TYPE_CHAR_MS = 42;

/**
 * Intro screen matching the owner's reference (a gradient orb emerging from
 * glowing concentric rings): Forge zooms out of the dark center of a ring
 * portal with a violet-blue-pink glow halo blooming behind him, then hovers
 * over his pad while the greeting types itself. The robot is pure CSS (no
 * WebGL), so it renders identically on every machine; reduced motion freezes
 * the entrance, the rings and the typing. The server CSP allows no inline
 * styles - everything here is classes and SVG attributes.
 */
export function Intro(props: { readonly onStart: () => void }) {
  const reduced = usePrefersReducedMotion();
  const [typed, setTyped] = useState(reduced ? GREETING : '');

  useEffect(() => {
    if (reduced) {
      setTyped(GREETING);
      return;
    }
    let index = 0;
    let timer = 0;
    const tick = (): void => {
      index += 1;
      setTyped(GREETING.slice(0, index));
      if (index < GREETING.length) {
        timer = window.setTimeout(tick, TYPE_CHAR_MS);
      }
    };
    timer = window.setTimeout(tick, TYPE_START_MS);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <div className="intro">
      <svg
        className="intro-sky"
        viewBox={`0 0 ${SKY_W} ${SKY_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true">
        {RING_RADII.map((r, index) => (
          <circle
            key={r}
            cx={SKY_CX}
            cy={SKY_CY}
            r={r}
            className={`sky-ring sky-ring-${index + 1}`}
          />
        ))}
      </svg>
      <div className="intro-forge" role="img" aria-label="Forge, greeting">
        <div className="intro-forge-glow" aria-hidden="true" />
        <div className="intro-forge-antenna" />
        <div className="intro-forge-head">
          <div className="intro-forge-ear intro-forge-ear-left" />
          <div className="intro-forge-ear intro-forge-ear-right" />
          <div className="intro-forge-visor">
            <span className="intro-forge-eye" />
            <span className="intro-forge-eye" />
          </div>
        </div>
        <div className="intro-forge-torso">
          <div className="intro-forge-chest" />
        </div>
      </div>
      <div className="intro-forge-pad" aria-hidden="true" />
      <h1 className="intro-title">
        <span className="intro-typed">{typed}</span>
        {!reduced && typed !== '' && (
          <span className="intro-caret" aria-hidden="true">
            ▍
          </span>
        )}
      </h1>
      <p className="intro-sub">vulnforge dependency vulnerability scanner</p>
      <button type="button" className="intro-start" onClick={props.onStart} autoFocus>
        start
      </button>
    </div>
  );
}
