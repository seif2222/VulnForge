import { TUI_COLORS, type TuiColor } from '../colors.generated.js';
import { bg, fg } from './theme.js';
import type { OrbState, RenderCapabilities } from './render3d.js';

/**
 * The Paper Cockpit Forge as terminal art: white shell, dark visor with two slim
 * violet lights, violet ears, and a status light colored by the real scan state.
 * Flat shapes on purpose: they survive any terminal and any font.
 */

export const FORGE_ART_WIDTH = 21;

function statusColor(state: OrbState): TuiColor {
  switch (state) {
    case 'COMPLETED':
      return TUI_COLORS.success;
    case 'ERROR':
      return TUI_COLORS.danger;
    case 'DETECTED':
      return TUI_COLORS.severityCritical;
    default:
      return TUI_COLORS.accent;
  }
}

function center(text: string, width: number): string {
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(left) + text + ' '.repeat(Math.max(0, width - left - text.length));
}

export function forgeArt(state: OrbState, caps: RenderCapabilities, t: number): string[] {
  const W = FORGE_ART_WIDTH;
  const light = statusColor(state);
  const blinking = state === 'SCANNING' || state === 'ANALYZING';
  const lit = !blinking || Math.floor(t * 2) % 2 === 0;

  if (caps.color === 'mono' || !caps.unicode) {
    const dot = state === 'ERROR' ? 'x' : state === 'COMPLETED' ? 'v' : 'o';
    return [
      center(dot, W),
      center('|', W),
      '  +-------------+  ',
      ' [| .--------. |] ',
      ' [| | ||  || | |] ',
      '  | `--------` |  ',
      '  +-------------+  ',
      '     +-------+     ',
      '     | forge |     ',
      '     +-------+     ',
    ].map((row) => row.padEnd(W).slice(0, W));
  }

  const white = TUI_COLORS.textPrimary;
  const visor = TUI_COLORS.bgOverlay;
  const violet = TUI_COLORS.accent;
  const sp = (n: number): string => ' '.repeat(n);
  const shell = (n: number): string => bg(caps, white, sp(n));
  const glass = (text: string): string => bg(caps, visor, text);
  const eye = (): string => bg(caps, visor, fg(caps, violet, '█'));
  const ear = (): string => bg(caps, violet, ' ');

  const lamp = fg(caps, light, lit ? '●' : '○');
  const antenna = sp(10) + lamp + sp(10);
  const stem = sp(10) + fg(caps, TUI_COLORS.textSecondary, '│') + sp(10);

  const top =
    sp(2) + fg(caps, white, '▄') + fg(caps, white, '█'.repeat(15)) + fg(caps, white, '▄') + sp(2);
  const visorTop = sp(1) + ear() + shell(1) + glass(sp(13)) + shell(1) + ear() + sp(1);
  const visorEyes =
    ear() +
    sp(1) +
    shell(1) +
    glass(sp(3)) +
    eye() +
    glass(sp(5)) +
    eye() +
    glass(sp(3)) +
    shell(1) +
    sp(1) +
    ear();
  const visorBottom = sp(1) + ear() + shell(1) + glass(sp(13)) + shell(1) + ear() + sp(1);
  const jaw =
    sp(2) + fg(caps, white, '▀') + fg(caps, white, '█'.repeat(15)) + fg(caps, white, '▀') + sp(2);
  const neck = sp(8) + shell(5) + sp(8);
  const chest =
    sp(5) +
    shell(1) +
    bg(caps, white, fg(caps, light, '●')) +
    shell(7) +
    bg(caps, white, fg(caps, violet, '▮')) +
    shell(1) +
    sp(5);
  const belly = sp(5) + fg(caps, white, '▀'.repeat(11)) + sp(5);

  return [antenna, stem, top, visorTop, visorEyes, visorBottom, jaw, neck, chest, belly];
}
