/**
 * Software 3D renderer for the terminal (prototype for G3, hardened in G4/G5).
 * Pure TypeScript, no native deps. Pipeline: model -> rotation -> projection
 * -> z-buffer -> Lambert shading -> character grid.
 *
 * The model is Forge, the VulnForge robot: rounded glossy head with a dark
 * visor and cyan striped eyes, antenna with a blue ball, blue side ears, and
 * a small body with a chest screen. Direction comes from the owner's own
 * reference image (see docs/proposal/design-brief.md); this rendering still
 * awaits his G3 gate approval.
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
// normals facing -z, and the visor lives on the -z face), so the key
// light must come from the viewer's side too.
const LIGHT: Vec3 = { x: -0.45, y: 0.75, z: -0.5 };

function lambert(normal: Vec3): number {
  const dot = normal.x * LIGHT.x + normal.y * LIGHT.y + normal.z * LIGHT.z;
  return Math.max(0, dot);
}

/** Two-tone toon shading: smooth gradients turn to mush at terminal size. */
function toon(normal: Vec3): number {
  return lambert(normal) > 0.5 ? 1 : 0.66;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
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

interface RobotPalette {
  readonly body: string;
  readonly visor: string;
  readonly eyeLit: string;
  readonly eyeDim: string;
  readonly trim: string;
  readonly glow: string;
}

function robotPalette(state: OrbState): RobotPalette {
  const eye =
    state === 'COMPLETED'
      ? TUI_COLORS.success.hex
      : state === 'ERROR'
        ? TUI_COLORS.danger.hex
        : state === 'DETECTED'
          ? TUI_COLORS.severityCritical.hex
          : TUI_COLORS.accent.hex;
  return {
    body: TUI_COLORS.textPrimary.hex, // glossy white shell
    visor: TUI_COLORS.bgOverlay.hex, // dark glass face
    eyeLit: mix(eye, TUI_COLORS.textPrimary.hex, 0.2),
    eyeDim: mix(eye, TUI_COLORS.bgBase.hex, 0.7),
    trim: TUI_COLORS.accent.hex, // ears, antenna, chest mark
    glow: TUI_COLORS.accentTint.hex,
  };
}

/** Orthographic render of the Forge robot into an RGB pixel grid.
 *  SDF raymarching (one ray per pixel, fixed direction): exact coverage,
 *  no sampling gaps, cheap at terminal resolutions. */
export function renderForgePixels(
  state: OrbState,
  width: number,
  height: number,
  t: number,
): (string | null)[][] {
  const p = robotPalette(state);

  // per-state motion
  const spin =
    state === 'SCANNING' ? t * 0.8 : state === 'ANALYZING' ? -t * 0.4 : 0.25 * Math.sin(t * 0.7);
  const tilt = state === 'ANALYZING' ? 0.22 : 0.12;
  const bob =
    state === 'IDLE'
      ? 0.05 * Math.sin((t * 2 * Math.PI) / 3.6)
      : state === 'COMPLETED'
        ? 0.09 * Math.abs(Math.sin(t * 3))
        : 0;
  const shake =
    state === 'DETECTED'
      ? 0.05 * Math.sin(t * 28)
      : state === 'ERROR'
        ? 0.03 * Math.sin(t * 18)
        : 0;
  const wiggle = state === 'SCANNING' ? 0.08 * Math.sin(t * 6) : 0;

  const HEAD: Vec3 = { x: 0, y: 0.55, z: 0 };
  const BODY: Vec3 = { x: 0, y: -0.68, z: 0 };

  const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const len = (x: number, y: number, z: number): number => Math.hypot(x, y, z);

  function sdRoundBox(q: Vec3, bx: number, by: number, bz: number, r: number): number {
    const ax = Math.abs(q.x) - bx;
    const ay = Math.abs(q.y) - by;
    const az = Math.abs(q.z) - bz;
    const mx = Math.max(ax, 0);
    const my = Math.max(ay, 0);
    const mz = Math.max(az, 0);
    return len(mx, my, mz) + Math.min(Math.max(ax, Math.max(ay, az)), 0) - r;
  }
  function sdEllipsoid(q: Vec3, rx: number, ry: number, rz: number): number {
    const k0 = len(q.x / rx, q.y / ry, q.z / rz);
    const k1 = len(q.x / (rx * rx), q.y / (ry * ry), q.z / (rz * rz));
    return (k0 * (k0 - 1)) / Math.max(k1, 1e-9);
  }

  const HEAD_B = { x: 0.6, y: 0.46, z: 0.42, r: 0.2 };
  const BODY_B = { x: 0.34, y: 0.2, z: 0.26, r: 0.16 };

  type Part = 'head' | 'body' | 'ear' | 'arm' | 'antenna' | 'ball';

  /** Scene SDF in robot-local space; returns distance and which part. */
  function scene(q: Vec3): { d: number; part: Part } {
    let d = sdRoundBox(sub(q, HEAD), HEAD_B.x, HEAD_B.y, HEAD_B.z, HEAD_B.r);
    let part: Part = 'head';
    const tryPart = (nd: number, np: Part): void => {
      if (nd < d) {
        d = nd;
        part = np;
      }
    };
    tryPart(sdRoundBox(sub(q, BODY), BODY_B.x, BODY_B.y, BODY_B.z, BODY_B.r), 'body');
    for (const side of [-1, 1]) {
      tryPart(sdEllipsoid(sub(q, { x: side * 0.8, y: 0.58, z: 0 }), 0.15, 0.28, 0.2), 'ear');
      tryPart(sdEllipsoid(sub(q, { x: side * 0.62, y: -0.72, z: 0 }), 0.13, 0.28, 0.15), 'arm');
    }
    // antenna stalk (y 1.1 .. 1.3) and ball
    const stalk =
      len(
        Math.max(len(q.x - wiggle * (q.y - 1.12) * 0.4, 0, 0) - 0.035, 0),
        Math.max(Math.abs(q.y - 1.22) - 0.12, 0),
        0,
      ) - 0.005;
    tryPart(stalk, 'antenna');
    tryPart(len(q.x - wiggle, q.y - 1.4, q.z) - 0.1, 'ball');
    return { d, part };
  }

  function normalAt(q: Vec3): Vec3 {
    const e = 0.002;
    const dx = scene({ x: q.x + e, y: q.y, z: q.z }).d - scene({ x: q.x - e, y: q.y, z: q.z }).d;
    const dy = scene({ x: q.x, y: q.y + e, z: q.z }).d - scene({ x: q.x, y: q.y - e, z: q.z }).d;
    const dz = scene({ x: q.x, y: q.y, z: q.z + e }).d - scene({ x: q.x, y: q.y, z: q.z - e }).d;
    return normalize({ x: dx, y: dy, z: dz });
  }

  function shadePart(part: Part, q: Vec3, n: Vec3): string {
    const shade = toon(n);
    switch (part) {
      case 'head': {
        const local = sub(q, HEAD);
        const bodyCol = mix(TUI_COLORS.bgRaised.hex, p.body, 0.72 + 0.28 * shade);
        if (local.z > -0.34) return bodyCol; // visor only on the front face
        const inVisor = Math.abs(local.x) < 0.48 && local.y > -0.22 && local.y < 0.28;
        if (!inVisor) return bodyCol;
        const eyeX = Math.abs(Math.abs(local.x) - 0.26) < 0.13;
        const eyeY = local.y > -0.14 && local.y < 0.22;
        if (eyeX && eyeY) {
          const scroll = state === 'SCANNING' ? t * 3 : 0;
          const stripe = Math.floor((local.y + scroll) / 0.07) % 2 === 0;
          return stripe ? p.eyeLit : p.eyeDim;
        }
        return mix(p.visor, TUI_COLORS.accent.hex, 0.08);
      }
      case 'body': {
        const local = sub(q, BODY);
        const shell = mix(TUI_COLORS.bgRaised.hex, p.body, 0.72 + 0.28 * shade);
        if (local.z > -0.22) return shell;
        const inChest = Math.abs(local.x) < 0.2 && Math.abs(local.y) < 0.13;
        if (!inChest) return shell;
        const mark = Math.abs(local.x) + Math.abs(local.y) * 1.6 < 0.09;
        return mark ? p.trim : mix(p.visor, TUI_COLORS.accent.hex, 0.08);
      }
      case 'ear':
        return mix(p.trim, TUI_COLORS.accentStrong.hex, 0.45 + 0.5 * shade);
      case 'arm':
        return mix(TUI_COLORS.bgRaised.hex, p.body, 0.55 + 0.45 * shade);
      case 'antenna':
        return p.trim;
      case 'ball':
        return mix(p.trim, TUI_COLORS.accentStrong.hex, 0.4 + 0.5 * shade);
    }
  }

  const grid: (string | null)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null),
  );

  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) * 0.3;
  const aspect = 0.5; // terminal pixels are ~2x taller than wide

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      // world-space ray: origin at z=-3, marching toward +z (viewer at -z)
      const wx = (px - cx) / (scale / aspect) - shake;
      const wy = (cy - py) / scale - bob; // world +y is up, rows grow down
      // un-rotate into model space (inverse of rotate(., spin, tilt))
      const o1 = rotate({ x: wx, y: wy, z: -3 }, 0, -tilt);
      const o = rotate(o1, -spin, 0);
      const d1 = rotate({ x: 0, y: 0, z: 1 }, 0, -tilt);
      const dir = rotate(d1, -spin, 0);

      let dist = 0;
      let hit: { d: number; part: Part } | null = null;
      for (let step = 0; step < 90; step += 1) {
        const q = {
          x: o.x + dir.x * dist,
          y: o.y + dir.y * dist,
          z: o.z + dir.z * dist,
        };
        const s = scene(q);
        if (s.d < 0.004) {
          hit = s;
          break;
        }
        dist += s.d;
        if (dist > 8) break;
      }
      if (hit !== null) {
        const q = {
          x: o.x + dir.x * dist,
          y: o.y + dir.y * dist,
          z: o.z + dir.z * dist,
        };
        const n = normalAt(q);
        const row = grid[py];
        if (row !== undefined) row[px] = shadePart(hit.part, q, n);
      }
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

/** The pure frame function: the Forge robot in any state, any t. */
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
