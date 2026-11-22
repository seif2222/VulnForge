// GENERATED from packages/core/src/design-tokens.ts — do not edit by hand
/** One color: truecolor hex, nearest xterm-256 index, nearest 16-color name. */
export interface TuiColor {
  readonly hex: string;
  readonly xterm256: number;
  readonly ansi16: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';
}

export const TUI_COLORS = {
  bgBase: { hex: '#0b0f14', xterm256: 233, ansi16: 'black' },
  bgRaised: { hex: '#11161d', xterm256: 233, ansi16: 'black' },
  bgOverlay: { hex: '#171e27', xterm256: 234, ansi16: 'black' },
  borderSubtle: { hex: '#212b36', xterm256: 236, ansi16: 'black' },
  borderStrong: { hex: '#32404f', xterm256: 238, ansi16: 'brightBlack' },
  textPrimary: { hex: '#e6edf3', xterm256: 255, ansi16: 'white' },
  textSecondary: { hex: '#9aa7b4', xterm256: 248, ansi16: 'brightMagenta' },
  textDisabled: { hex: '#5b6773', xterm256: 242, ansi16: 'brightBlack' },
  textInverse: { hex: '#0b0f14', xterm256: 233, ansi16: 'black' },
  accent: { hex: '#5ec8e3', xterm256: 116, ansi16: 'brightCyan' },
  accentStrong: { hex: '#8fdcf0', xterm256: 153, ansi16: 'white' },
  accentOn: { hex: '#06222c', xterm256: 234, ansi16: 'black' },
  accentTint: { hex: '#123240', xterm256: 236, ansi16: 'black' },
  severityCritical: { hex: '#ff6b6b', xterm256: 210, ansi16: 'brightRed' },
  severityHigh: { hex: '#f79756', xterm256: 216, ansi16: 'brightRed' },
  severityMedium: { hex: '#e8c352', xterm256: 222, ansi16: 'brightYellow' },
  severityLow: { hex: '#8b98a9', xterm256: 247, ansi16: 'brightBlack' },
  severityCriticalTint: { hex: '#3d1a1e', xterm256: 235, ansi16: 'black' },
  severityHighTint: { hex: '#3a2517', xterm256: 235, ansi16: 'black' },
  severityMediumTint: { hex: '#37301a', xterm256: 236, ansi16: 'black' },
  severityLowTint: { hex: '#232a33', xterm256: 235, ansi16: 'black' },
  success: { hex: '#4ec9a6', xterm256: 115, ansi16: 'brightGreen' },
  danger: { hex: '#ff6b6b', xterm256: 210, ansi16: 'brightRed' },
} as const satisfies Record<string, TuiColor>;

export const TUI_FRAME_MS = 83;
