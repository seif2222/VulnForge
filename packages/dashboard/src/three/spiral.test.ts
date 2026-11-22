import { describe, expect, it } from 'vitest';

import { spiralPosition } from './spiral.js';

describe('spiral layout', () => {
  it('is deterministic: the same index always lands on the same spot', () => {
    expect(spiralPosition(42)).toEqual(spiralPosition(42));
  });

  it('spreads the first hundred packages without collisions', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const { x, y, z } = spiralPosition(index);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('grows outward so later packages do not pile onto the center', () => {
    const radius = (index: number): number => {
      const { x, z } = spiralPosition(index);
      return Math.sqrt(x * x + z * z);
    };
    expect(radius(80)).toBeGreaterThan(radius(8));
    expect(radius(8)).toBeGreaterThan(radius(0));
  });
});
