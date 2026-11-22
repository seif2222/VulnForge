/**
 * The ONE design token source for VulnForge. The only non-generated file in the
 * product allowed to contain design hex values. Two emitters turn this into the
 * dashboard CSS-variables file and the TUI color-table module.
 *
 * Design intent (full rationale in docs/proposal/design-brief.md): a calm,
 * precise security operations workspace. Dark-first. One accent. Severity is
 * always badge + glyph + text, never color alone; low severity is slate, never
 * "ok green".
 */

export interface DesignTokens {
  readonly color: {
    readonly bg: {
      readonly base: string;
      readonly raised: string;
      readonly overlay: string;
    };
    readonly border: {
      readonly subtle: string;
      readonly strong: string;
    };
    readonly text: {
      readonly primary: string;
      readonly secondary: string;
      readonly disabled: string;
      readonly inverse: string;
    };
    readonly accent: {
      readonly default: string;
      readonly strong: string;
      readonly onAccent: string;
      readonly tint: string;
    };
    readonly severity: {
      readonly critical: string;
      readonly high: string;
      readonly medium: string;
      readonly low: string;
      readonly tint: {
        readonly critical: string;
        readonly high: string;
        readonly medium: string;
        readonly low: string;
      };
    };
    readonly success: string;
    readonly danger: string;
  };
  /** Severity glyphs: badge + glyph + text, never color alone. */
  readonly glyph: {
    readonly critical: string;
    readonly high: string;
    readonly medium: string;
    readonly low: string;
  };
  readonly font: {
    /** Monospace-led stack; the dashboard bundles JetBrains Mono (offline). */
    readonly mono: string;
    readonly sans: string;
  };
  readonly space: {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
  };
  readonly radius: {
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
  };
  /** Motion timings are tokens. CSS keyframes animate transform/opacity only. */
  readonly motion: {
    readonly fastMs: number;
    readonly baseMs: number;
    readonly slowMs: number;
    readonly easing: string;
    /** TUI frame budget: 12 fps, per the software-renderer comfort rules. */
    readonly tuiFrameMs: number;
  };
}

export const DESIGN_TOKENS: DesignTokens = {
  color: {
    bg: {
      base: '#0b0f14',
      raised: '#11161d',
      overlay: '#171e27',
    },
    border: {
      subtle: '#212b36',
      strong: '#32404f',
    },
    text: {
      primary: '#e6edf3',
      secondary: '#9aa7b4',
      disabled: '#5b6773',
      inverse: '#0b0f14',
    },
    accent: {
      default: '#5ec8e3',
      strong: '#8fdcf0',
      onAccent: '#06222c',
      tint: '#123240',
    },
    severity: {
      critical: '#ff6b6b',
      high: '#f79756',
      medium: '#e8c352',
      // low is slate: informational, never "ok green"
      low: '#8b98a9',
      tint: {
        critical: '#3d1a1e',
        high: '#3a2517',
        medium: '#37301a',
        low: '#232a33',
      },
    },
    success: '#4ec9a6',
    danger: '#ff6b6b',
  },
  glyph: {
    critical: '●',
    high: '▲',
    medium: '■',
    low: '○',
  },
  font: {
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    sans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
  },
  motion: {
    fastMs: 120,
    baseMs: 200,
    slowMs: 360,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    tuiFrameMs: 83,
  },
};

/** The severity order used by every surface. */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;
