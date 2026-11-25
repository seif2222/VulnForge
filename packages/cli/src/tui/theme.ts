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
    return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`;
  }
  if (caps.color === '256') {
    return `\u001b[38;5;${color.xterm256}m${text}\u001b[39m`;
  }
  return `\u001b[${ANSI16_CODES[color.ansi16]}m${text}\u001b[39m`;
}

export function bold(caps: RenderCapabilities, text: string): string {
  return caps.color === 'mono' ? text : `\u001b[1m${text}\u001b[22m`;
}

/**
 * Secondary text. Never a faint/dim attribute and never the 16-color "bright black"
 * (invisible on many Windows palettes): a light lavender-gray that stays readable on
 * the dark base in truecolor, 256 and plain 16-color terminals.
 */
function mixHex(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export const TEXT_MUTED: TuiColor = {
  hex: mixHex(TUI_COLORS.textPrimary.hex, TUI_COLORS.textSecondary.hex, 0.3),
  xterm256: 252,
  ansi16: 'white',
};
/** Violet for text on the dark base: brighter than the bar violet so it keeps contrast. */
export const ACCENT_TEXT: TuiColor = { ...TUI_COLORS.accentStrong, ansi16: 'brightMagenta' };

export function dim(caps: RenderCapabilities, text: string): string {
  return fg(caps, TEXT_MUTED, text);
}

/** SGR that paints the dark base on every color terminal, so contrast never depends on the user's theme. */
export function baseBg(caps: RenderCapabilities): string {
  if (caps.color === 'truecolor') {
    const hex = TUI_COLORS.bgBase.hex;
    return `\u001b[48;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
  }
  if (caps.color === '256') {
    return `\u001b[48;5;${TUI_COLORS.bgBase.xterm256}m`;
  }
  if (caps.color === '16') {
    return '\u001b[40m';
  }
  return '';
}

export const SEVERITY_COLORS = {
  critical: TUI_COLORS.severityCritical,
  high: { ...TUI_COLORS.severityHigh, ansi16: 'yellow' } as TuiColor,
  medium: TUI_COLORS.severityMedium,
  low: {
    hex: mixHex(TUI_COLORS.textPrimary.hex, TUI_COLORS.severityLow.hex, 0.4),
    xterm256: 249,
    ansi16: 'white',
  } as TuiColor,
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
    return out.trimEnd() + '\u001b[39m\u001b[22m';
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

/** Background color, same capability ladder as `fg`. Mono terminals get no background. */
export function bg(caps: RenderCapabilities, color: TuiColor, text: string): string {
  if (caps.color === 'mono') {
    return text;
  }
  if (caps.color === 'truecolor') {
    const r = Number.parseInt(color.hex.slice(1, 3), 16);
    const g = Number.parseInt(color.hex.slice(3, 5), 16);
    const b = Number.parseInt(color.hex.slice(5, 7), 16);
    return `\u001b[48;2;${r};${g};${b}m${text}\u001b[49m`;
  }
  if (caps.color === '256') {
    return `\u001b[48;5;${color.xterm256}m${text}\u001b[49m`;
  }
  const code = ANSI16_CODES[color.ansi16];
  return `\u001b[${code + 10}m${text}\u001b[49m`;
}

/** Section heading in the dashboard's style: a violet bar, then the title in caps. */
export function heading(caps: RenderCapabilities, title: string, note = ''): string {
  const bar = fg(caps, TUI_COLORS.accent, caps.unicode ? '▌' : '|');
  const text = bold(caps, title.toUpperCase());
  return ` ${bar} ${text}${note === '' ? '' : `  ${dim(caps, note)}`}`;
}

/** Severity pill: tinted label in the severity color, readable in mono as [HIGH]. */
export function severityPill(
  caps: RenderCapabilities,
  severity: keyof typeof SEVERITY_COLORS,
  label: string,
): string {
  if (caps.color === 'mono') {
    return `[${label.toUpperCase()}]`;
  }
  const tint = {
    critical: TUI_COLORS.severityCriticalTint,
    high: TUI_COLORS.severityHighTint,
    medium: TUI_COLORS.severityMediumTint,
    low: TUI_COLORS.severityLowTint,
  }[severity];
  return bg(
    caps,
    tint,
    bold(caps, fg(caps, SEVERITY_COLORS[severity], ` ${label.toUpperCase()} `)),
  );
}

/** Block progress bar on real counts. */
export function progressBar(
  caps: RenderCapabilities,
  done: number,
  total: number,
  width: number,
  color: TuiColor = TUI_COLORS.accent,
): string {
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, done / total));
  const filled = Math.round(ratio * width);
  const on = caps.unicode ? '█' : '#';
  const off = caps.unicode ? '░' : '.';
  return fg(caps, color, on.repeat(filled)) + dim(caps, off.repeat(width - filled));
}
