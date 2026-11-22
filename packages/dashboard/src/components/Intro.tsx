import { useEffect, useMemo, useState } from 'react';

/** A deterministic pseudo-random from an index, so the sky renders identically every load. */
function seeded(index: number, salt: number): number {
  let value = (index + 1) * 1103515245 + salt * 12345;
  value = (value >>> 16) & 0x7fff;
  return value / 0x7fff;
}

interface ShootingStar {
  readonly key: number;
  readonly x: number;
  readonly y: number;
}

const SKY_W = 1000;
const SKY_H = 600;

/**
 * Intro screen from the approved design: a night sky with shooting stars and
 * Forge's hello. Rendered as SVG attributes, never inline styles: the server CSP
 * allows no style attribute. Star positions are deterministic.
 */
export function Intro(props: { readonly onStart: () => void }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 110 }, (_, index) => ({
        cx: seeded(index, 1) * SKY_W,
        cy: seeded(index, 2) * SKY_H,
        r: 0.6 + seeded(index, 4) * 1.1,
        opacity: 0.2 + seeded(index, 3) * 0.7,
      })),
    [],
  );
  const [shots, setShots] = useState<readonly ShootingStar[]>([]);

  useEffect(() => {
    let count = 0;
    let timer = 0;
    const spawn = (): void => {
      count += 1;
      const star: ShootingStar = {
        key: count,
        x: 520 + seeded(count, 7) * 460,
        y: 20 + seeded(count, 11) * 260,
      };
      setShots((current) => [...current.slice(-3), star]);
      timer = window.setTimeout(spawn, 1500 + seeded(count, 13) * 2800);
    };
    timer = window.setTimeout(spawn, 800);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="intro">
      <svg
        className="intro-sky"
        viewBox={`0 0 ${SKY_W} ${SKY_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true">
        {stars.map((star, index) => (
          <circle
            key={index}
            cx={star.cx}
            cy={star.cy}
            r={star.r}
            className="sky-star"
            opacity={star.opacity}
          />
        ))}
        {shots.map((shot) => (
          <line
            key={shot.key}
            x1={shot.x}
            y1={shot.y}
            x2={shot.x + 130}
            y2={shot.y - 60}
            className="sky-shooting-star"
          />
        ))}
      </svg>
      <h1 className="intro-title">
        Hello, I&apos;m <span className="accent">Forge</span>.
        <br />
        Let&apos;s start.
      </h1>
      <p className="intro-sub">vulnforge dependency vulnerability scanner</p>
      <button type="button" className="intro-start" onClick={props.onStart} autoFocus>
        start
      </button>
    </div>
  );
}
