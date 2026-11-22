/**
 * Software 3D renderer for the terminal (prototype for G3, hardened in G4/G5).
 * Pure TypeScript, no native deps. Pipeline: model -> rotation -> projection
 * -> z-buffer -> Lambert shading -> character grid.
 *
 * Every frame function is pure: (state, width, height, capabilities, t) ->
 * string[]. Golden frames at fixed t are deterministic.
 */

import { TUI_COLORS } from '../colors.generated.js';

export const ORB_STATES = [
  'IDLE',
  'SCANNING',
  'ANALYZING',
  'DETECTED',
  'COMPLETED',
  'ERROR',
] as const;

export type OrbState = (typeof ORB_STATES)[number];

export interface RenderCapabilities {
  readonly color: 'truecolor' | '256' | '16' | 'mono';
  readonly unicode: boolean;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function rotate(point: Vec3, ay: number, ax: number): Vec3 {
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const x1 = point.x * cy + point.z * sy;
  const z1 = -point.x * sy + point.z * cy;
  const y2 = point.y * cx - z1 * sx;
  const z2 = point.y * sx + z1 * cx;
  return { x: x1, y: y2, z: z2 };
}

// Viewer sits at -z (the z-buffer keeps the smallest z, culling keeps
// normals facing -z, and the pupils live on the -z face), so the key
// light must come from the viewer's side too.
const LIGHT: Vec3 = { x: -0.45, y: 0.75, z: -0.5 };

function lambert(normal: Vec3): number {
  const dot = normal.x * LIGHT.x + normal.y * LIGHT.y + normal.z * LIGHT.z;
  return Math.max(0, dot);
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const m = ca.map((v, i) => Math.round(v + ((cb[i] as number) - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The Forge lens: a squashed sphere plus an equatorial ring and two pupils. */
function lensColor(point: Vec3, normal: Vec3, stateColor: string): string {
  const shade = lambert(normal);
  const base = mix(TUI_COLORS.bgRaised.hex, stateColor, 0.25 + 0.75 * shade);
  // two small dark pupils on the face (-z side) give the lens its identity
  const pupil =
    normal.z < -0.55 &&
    ((Math.abs(point.x - 0.32) < 0.13 && Math.abs(point.y - 0.12) < 0.13) ||
      (Math.abs(point.x + 0.32) < 0.13 && Math.abs(point.y - 0.12) < 0.13));
  return pupil ? TUI_COLORS.bgBase.hex : base;
}

/** Orthographic render of the Forge character into an RGB pixel grid. */
export function renderForgePixels(
  state: OrbState,
  width: number,
  height: number,
  t: number,
): (string | null)[][] {
  const stateColor =
    state === 'COMPLETED'
      ? TUI_COLORS.success.hex
      : state === 'ERROR'
        ? TUI_COLORS.danger.hex
        : state === 'DETECTED'
          ? TUI_COLORS.severityCritical.hex
          : TUI_COLORS.accent.hex;

  const spin = state === 'SCANNING' ? t * 1.4 : state === 'ANALYZING' ? -t * 0.6 : t * 0.25;
  const breathe = state === 'IDLE' ? 1 + 0.03 * Math.sin((t * 2 * Math.PI) / 3.6) : 1;
  const tilt = state === 'SCANNING' ? 0.35 : 0.15;

  const grid: (string | null)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null),
  );
  // Nearest-to-viewer = smallest z, so the buffer starts at +Infinity.
  const zbuf: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => Infinity),
  );

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36 * breathe;
  // terminal pixels are ~2x taller than wide
  const aspect = 0.5;

  const LAT = 48;
  const LON = 96;
  for (let i = 0; i < LAT; i += 1) {
    for (let j = 0; j < LON; j += 1) {
      const theta = (i / LAT) * Math.PI;
      const phi = (j / LON) * 2 * Math.PI;
      const unit: Vec3 = {
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.cos(theta) * 0.82, // the lens squash
        z: Math.sin(theta) * Math.sin(phi),
      };
      const point = rotate(unit, spin, tilt);
      const normal = rotate({ x: unit.x, y: unit.y / 0.82, z: unit.z }, spin, tilt);
      if (normal.z >= 0) continue; // back face
      const px = Math.round(cx + (point.x * radius) / aspect);
      const py = Math.round(cy + point.y * radius);
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const zrow = zbuf[py];
      const grow = grid[py];
      if (zrow !== undefined && grow !== undefined && point.z < (zrow[px] ?? Infinity)) {
        zrow[px] = point.z;
        grow[px] = lensColor(point, normal, stateColor);
      }
    }
  }

  // equatorial ring, pulse while scanning
  const ringPulse = state === 'SCANNING' ? 1 + 0.12 * Math.sin(t * 4) : 1;
  const ringRadius = 1.35 * ringPulse;
  const SEGMENTS = 120;
  for (let s = 0; s < SEGMENTS; s += 1) {
    const a = (s / SEGMENTS) * 2 * Math.PI;
    const point = rotate(
      { x: Math.cos(a) * ringRadius, y: 0, z: Math.sin(a) * ringRadius },
      spin,
      0.9,
    );
    const px = Math.round(cx + (point.x * radius) / aspect);
    const py = Math.round(cy + point.y * radius);
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const grow = grid[py];
    if (grow !== undefined) {
      grow[px] = mix(stateColor, TUI_COLORS.textPrimary.hex, 0.4);
    }
  }

  return grid;
}

const ASCII_RAMP = ' .:-=+*#%@';

/**
 * Rasterizes the pixel grid to terminal rows.
 * - unicode + color: half-block '▀' (fg = top pixel, bg = bottom pixel)
 * - mono or no unicode: ASCII luminance ramp
 */
export function rasterize(pixels: (string | null)[][], capabilities: RenderCapabilities): string[] {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const rows: string[] = [];

  if (capabilities.color === 'mono' || !capabilities.unicode) {
    for (let y = 0; y < height; y += 1) {
      let row = '';
      for (let x = 0; x < width; x += 1) {
        const cell = pixels[y]?.[x] ?? null;
        if (cell === null) {
          row += ' ';
        } else {
          const [r, g, b] = hexToRgb(cell);
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          row += ASCII_RAMP[Math.min(9, Math.floor(lum * 10))];
        }
      }
      rows.push(row);
    }
    return rows;
  }

  const sgr = (hex: string, foreground: boolean): string => {
    const [r, g, b] = hexToRgb(hex);
    // Token colors map to xterm256/ansi16 via the generated table; mixed
    // shades are emitted as truecolor (256/16 terminals dither them down).
    return `\u001b[${foreground ? 38 : 48};2;${r};${g};${b}m`;
  };

  for (let y = 0; y < height; y += 2) {
    let row = '';
    for (let x = 0; x < width; x += 1) {
      const top = pixels[y]?.[x] ?? null;
      const bottom = pixels[y + 1]?.[x] ?? null;
      if (top === null && bottom === null) {
        row += ' ';
      } else if (top !== null && bottom !== null) {
        row += `${sgr(top, true)}${sgr(bottom, false)}▀\u001b[0m`;
      } else if (top !== null) {
        row += `${sgr(top, true)}▀\u001b[0m`;
      } else if (bottom !== null) {
        row += `${sgr(bottom, true)}▄\u001b[0m`;
      } else {
        row += ' ';
      }
    }
    rows.push(row);
  }
  return rows;
}

/** The pure frame function: the Forge character in any state, any t. */
export function forgeFrame(
  state: OrbState,
  width: number,
  height: number,
  capabilities: RenderCapabilities,
  t: number,
): string[] {
  return rasterize(renderForgePixels(state, width, height * 2, t), capabilities);
}

/** Live Monitor scan visual: package nodes light as their queries complete. */
export function scanConstellationFrame(
  nodes: readonly { readonly name: string; readonly lit: boolean }[],
  width: number,
  height: number,
  capabilities: RenderCapabilities,
  t: number,
): string[] {
  // Cell grid, not a string grid: an ANSI-styled glyph is one visible cell,
  // so labels never splice into escape sequences.
  const cells: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ' '),
  );
  const cx = width / 2;
  const cy = height / 2;
  const radiusX = Math.max(2, width / 2 - 6);
  const radiusY = Math.max(1, height / 2 - 2);
  const spin = t * 0.5;
  const taken = new Set<string>();

  const putCell = (x: number, y: number, cell: string): void => {
    if (y < 0 || y >= height || x < 0 || x >= width) return;
    const row = cells[y];
    if (row !== undefined) row[x] = cell;
  };
  const putText = (x: number, y: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      putCell(x + i, y, text[i] as string);
    }
  };

  const [ar, ag, ab] = hexToRgb(TUI_COLORS.accent.hex);
  const litGlyph = `\u001b[38;2;${ar};${ag};${ab}m●\u001b[0m`;

  nodes.forEach((node, index) => {
    const angle = spin + (index / nodes.length) * 2 * Math.PI;
    const x = Math.round(cx + Math.cos(angle) * radiusX);
    let y = Math.round(cy + Math.sin(angle) * radiusY);
    // Shift down until the anchor cell is free so labels never overwrite nodes.
    while (taken.has(`${x},${y}`) && y + 1 < height) y += 1;
    taken.add(`${x},${y}`);
    const color = capabilities.color !== 'mono';
    putCell(x, y, node.lit ? (color ? litGlyph : '●') : '○');
    const name = node.name;
    if (x + 2 + name.length <= width) {
      putText(x + 2, y, name);
    } else {
      putText(Math.max(0, x - 1 - name.length), y, name); // flip left near the right edge
    }
  });
  return cells.map((row) => row.join(''));
}
