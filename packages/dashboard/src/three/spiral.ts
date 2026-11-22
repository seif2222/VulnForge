/**
 * Deterministic layout for the live scan field: package i lands on a
 * golden-angle spiral so nodes never line up in spokes, in layered bands for
 * depth. Pure presentation math — the packages and their order are real
 * progress events; only their placement comes from here.
 */
export interface SpiralPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BAND_COUNT = 7;
const BAND_SPACING = 12;
const RADIUS_STEP = 14;

export function spiralPosition(index: number): SpiralPosition {
  const angle = index * GOLDEN_ANGLE;
  const radius = RADIUS_STEP * Math.sqrt(index + 1);
  const band = (index % BAND_COUNT) - Math.floor(BAND_COUNT / 2);
  return {
    x: Math.cos(angle) * radius,
    y: band * BAND_SPACING,
    z: Math.sin(angle) * radius,
  };
}
