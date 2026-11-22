// GENERATED from packages/core/src/design-tokens.ts — do not edit by hand
/** One color: truecolor hex, nearest xterm-256 index, nearest 16-color name. */
export interface TuiColor {
  readonly hex: string;
  readonly xterm256: number;
  readonly ansi16: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';
}

export const TUI_COLORS = {
  bgBase: { hex: '#0b0a14', xterm256: 233, ansi16: 'black' },
  bgRaised: { hex: '#15131f', xterm256: 234, ansi16: 'black' },
  bgOverlay: { hex: '#1e1c2b', xterm256: 235, ansi16: 'black' },
  borderSubtle: { hex: '#262537', xterm256: 236, ansi16: 'black' },
  borderStrong: { hex: '#3a3852', xterm256: 238, ansi16: 'brightBlack' },
  textPrimary: { hex: '#f2f0fa', xterm256: 255, ansi16: 'brightWhite' },
  textSecondary: { hex: '#9b97ad', xterm256: 247, ansi16: 'brightBlack' },
  textDisabled: { hex: '#716e88', xterm256: 243, ansi16: 'brightBlack' },
  textInverse: { hex: '#0b0a14', xterm256: 233, ansi16: 'black' },
  accent: { hex: '#7f63ff', xterm256: 105, ansi16: 'brightBlue' },
  accentStrong: { hex: '#9a82ff', xterm256: 147, ansi16: 'brightMagenta' },
  accentOn: { hex: '#0b0a14', xterm256: 233, ansi16: 'black' },
  accentTint: { hex: '#221a3d', xterm256: 235, ansi16: 'black' },
  severityCritical: { hex: '#f2506e', xterm256: 210, ansi16: 'brightRed' },
  severityHigh: { hex: '#f5974b', xterm256: 215, ansi16: 'brightRed' },
  severityMedium: { hex: '#f2c14e', xterm256: 222, ansi16: 'brightYellow' },
  severityLow: { hex: '#8f8ca6', xterm256: 246, ansi16: 'brightBlack' },
  severityCriticalTint: { hex: '#361521', xterm256: 235, ansi16: 'black' },
  severityHighTint: { hex: '#35230f', xterm256: 235, ansi16: 'black' },
  severityMediumTint: { hex: '#33290f', xterm256: 235, ansi16: 'black' },
  severityLowTint: { hex: '#23222e', xterm256: 235, ansi16: 'black' },
  success: { hex: '#3ecf9a', xterm256: 79, ansi16: 'brightGreen' },
  danger: { hex: '#f2506e', xterm256: 210, ansi16: 'brightRed' },
} as const satisfies Record<string, TuiColor>;

export const TUI_FRAME_MS = 83;
