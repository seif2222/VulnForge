// GENERATED from packages/core/src/design-tokens.ts — do not edit by hand
/** One color: truecolor hex, nearest xterm-256 index, nearest 16-color name. */
export interface TuiColor {
  readonly hex: string;
  readonly xterm256: number;
  readonly ansi16: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';
}

export const TUI_COLORS = {
  bgBase: { hex: '#07181d', xterm256: 233, ansi16: 'black' },
  bgRaised: { hex: '#0c242c', xterm256: 234, ansi16: 'black' },
  bgOverlay: { hex: '#11313b', xterm256: 235, ansi16: 'black' },
  borderSubtle: { hex: '#1d4a57', xterm256: 238, ansi16: 'brightBlack' },
  borderStrong: { hex: '#2f6675', xterm256: 240, ansi16: 'brightBlack' },
  textPrimary: { hex: '#f4f8f9', xterm256: 231, ansi16: 'brightWhite' },
  textSecondary: { hex: '#94aeb6', xterm256: 248, ansi16: 'white' },
  textDisabled: { hex: '#54707a', xterm256: 242, ansi16: 'brightBlack' },
  textInverse: { hex: '#0f3d47', xterm256: 236, ansi16: 'black' },
  accent: { hex: '#f59e7b', xterm256: 216, ansi16: 'brightRed' },
  accentStrong: { hex: '#fbc3a6', xterm256: 223, ansi16: 'white' },
  accentOn: { hex: '#0f3d47', xterm256: 236, ansi16: 'black' },
  accentTint: { hex: '#38271e', xterm256: 235, ansi16: 'black' },
  severityCritical: { hex: '#ff6b6b', xterm256: 210, ansi16: 'brightRed' },
  severityHigh: { hex: '#e8743b', xterm256: 209, ansi16: 'brightRed' },
  severityMedium: { hex: '#e8c352', xterm256: 222, ansi16: 'brightYellow' },
  severityLow: { hex: '#8fa3ad', xterm256: 247, ansi16: 'brightBlack' },
  severityCriticalTint: { hex: '#3e1a1e', xterm256: 235, ansi16: 'black' },
  severityHighTint: { hex: '#37251b', xterm256: 235, ansi16: 'black' },
  severityMediumTint: { hex: '#33301d', xterm256: 235, ansi16: 'black' },
  severityLowTint: { hex: '#1e282e', xterm256: 235, ansi16: 'black' },
  success: { hex: '#4ec9a6', xterm256: 115, ansi16: 'brightGreen' },
  danger: { hex: '#ff6b6b', xterm256: 210, ansi16: 'brightRed' },
} as const satisfies Record<string, TuiColor>;

export const TUI_FRAME_MS = 83;
