import { TUI_COLORS, type TuiColor } from '../colors.generated.js';
import type { RenderCapabilities } from './render3d.js';

/** Small ANSI helpers honoring the terminal's real capabilities (truecolor/256/16/mono). */

const ANSI16_CODES: Record<TuiColor['ansi16'], number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

export function fg(caps: RenderCapabilities, color: TuiColor, text: string): string {
  if (caps.color === 'mono') {
    return text;
  }
  if (caps.color === 'truecolor') {
    const r = Number.parseInt(color.hex.slice(1, 3), 16);
    const g = Number.parseInt(color.hex.slice(3, 5), 16);
    const b = Number.parseInt(color.hex.slice(5, 7), 16);
    return `\u001b[38;2;${r};${g};${b}m${text}\u001b[0m`;
  }
  if (caps.color === '256') {
    return `\u001b[38;5;${color.xterm256}m${text}\u001b[0m`;
  }
  return `\u001b[${ANSI16_CODES[color.ansi16]}m${text}\u001b[0m`;
}

export function bold(caps: RenderCapabilities, text: string): string {
  return caps.color === 'mono' ? text : `\u001b[1m${text}\u001b[0m`;
}

export function dim(caps: RenderCapabilities, text: string): string {
  return fg(caps, TUI_COLORS.textSecondary, text);
}

export const SEVERITY_COLORS = {
  critical: TUI_COLORS.severityCritical,
  high: TUI_COLORS.severityHigh,
  medium: TUI_COLORS.severityMedium,
  low: TUI_COLORS.severityLow,
} as const;

export function severityGlyph(
  caps: RenderCapabilities,
  severity: keyof typeof SEVERITY_COLORS,
): string {
  const glyph = caps.unicode
    ? { critical: '●', high: '▲', medium: '■', low: '○' }[severity]
    : { critical: 'C', high: 'H', medium: 'M', low: 'L' }[severity];
  return fg(caps, SEVERITY_COLORS[severity], glyph);
}

/** Length without ANSI escape sequences. */
export function visibleLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\u001b') {
      while (i < text.length && text[i] !== 'm') i++;
    } else {
      length++;
    }
  }
  return length;
}

/** Truncate to a visible width, keeping escape sequences intact. */
export function fitLine(text: string, width: number): string {
  let out = '';
  let visible = 0;
  for (let i = 0; i < text.length && visible < width; i++) {
    const ch = text[i] as string;
    if (ch === '\u001b') {
      let seq = ch;
      while (i + 1 < text.length && text[i + 1] !== 'm') {
        i++;
        seq += text[i];
      }
      if (i + 1 < text.length) {
        i++;
        seq += text[i];
      }
      out += seq;
    } else {
      out += ch;
      visible++;
    }
  }
  if (visibleLength(text) > width) {
    return out.trimEnd() + '\u001b[0m';
  }
  return out;
}

/** Pad with spaces to exactly a visible width. */
export function padLine(text: string, width: number): string {
  const missing = width - visibleLength(text);
  return missing > 0 ? text + ' '.repeat(missing) : text;
}

/** Truncate or pad to exactly a visible width. */
export function cell(text: string, width: number): string {
  return padLine(fitLine(text, width), width);
}

export function stripAnsi(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\u001b') {
      while (i < text.length && text[i] !== 'm') i++;
    } else {
      out += text[i];
    }
  }
  return out;
}
