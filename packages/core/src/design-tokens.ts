/**
 * The ONE design token source for VulnForge. The only non-generated file in the
 * product allowed to contain design hex values. Two emitters turn this into the
 * dashboard CSS-variables file and the TUI color-table module.
 *
 * Design intent (full rationale in docs/proposal/design-brief.md): a calm,
 * precise security operations workspace. Dark-first. One accent. Severity is
 * always badge + glyph + text, never color alone; low severity is slate, never
 * "ok green".
 *
 * Palette (chosen by the project owner, 2026-11-22, from the ChainX reference
 * dashboard he sent and asked to be applied in full detail): deep navy-violet
 * surfaces, a vibrant violet accent, soft rounded cards, big bold stat
 * numbers. Severity stays clearly distinct from the violet accent; low
 * severity is slate, never "ok green".
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
      base: '#0b0a14',
      raised: '#15131f',
      overlay: '#1e1c2b',
    },
    border: {
      subtle: '#262537',
      strong: '#3a3852',
    },
    text: {
      primary: '#f2f0fa',
      secondary: '#9b97ad',
      disabled: '#716e88',
      inverse: '#0b0a14',
    },
    accent: {
      default: '#7f63ff',
      strong: '#9a82ff',
      onAccent: '#0b0a14',
      tint: '#221a3d',
    },
    severity: {
      critical: '#f2506e',
      // warm orange: stays clearly distinct from the violet accent
      high: '#f5974b',
      medium: '#f2c14e',
      // low is slate: informational, never "ok green"
      low: '#8f8ca6',
      tint: {
        critical: '#361521',
        high: '#35230f',
        medium: '#33290f',
        low: '#23222e',
      },
    },
    success: '#3ecf9a',
    danger: '#f2506e',
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
    sm: 6,
    md: 12,
    lg: 18,
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
