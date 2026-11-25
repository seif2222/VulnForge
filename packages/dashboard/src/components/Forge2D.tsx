import type { AgentState } from '../lib/core.js';

/**
 * Forge, the agent character, as an accessible SVG: the required non-WebGL
 * rendering (fallback for missing WebGL and for prefers-reduced-motion) and the
 * single Forge character everywhere (intro, dock, agent sensor, AI Agent page). Identity: white paper-and-ink shell, violet screen face with
 * round eyes and pink cheeks, antenna with ball, ear caps, chest screen. The six
 * approved states drive motion and accent color; reduced motion freezes all of it.
 */
export function Forge2D(props: {
  readonly state: AgentState;
  readonly size?: number;
  readonly detectedSeverity?: 'critical' | 'high' | 'medium' | 'low' | null;
}) {
  const size = props.size ?? 160;
  const severity = props.detectedSeverity ?? null;
  const stateClass =
    props.state === 'detected' && severity !== null ? `detected ${severity}` : props.state;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`Forge, state: ${props.state}`}
      className={`forge2d ${stateClass}`}>
      {/* hard offset shadow, like every Sakuga card */}
      <ellipse cx="64" cy="115" rx="26" ry="4" className="forge-ground" />
      {/* antenna */}
      <line x1="60" y1="14" x2="60" y2="28" className="forge-line" />
      <circle cx="60" cy="11" r="5" className="forge-accent-fill forge-antenna-ball forge-ink" />
      {/* ears */}
      <rect x="15" y="50" width="12" height="22" rx="5" className="forge-ear forge-ink" />
      <rect x="93" y="50" width="12" height="22" rx="5" className="forge-ear forge-ink" />
      {/* head */}
      <rect x="29" y="29" width="68" height="52" rx="18" className="forge-shadow" />
      <rect x="26" y="26" width="68" height="52" rx="18" className="forge-shell forge-ink" />
      {/* screen face */}
      <rect x="34" y="37" width="52" height="30" rx="12" className="forge-visor forge-ink" />
      <g className="forge-eyes">
        <rect x="43" y="45" width="9" height="12" rx="4.5" className="forge-eye" />
        <rect x="68" y="45" width="9" height="12" rx="4.5" className="forge-eye" />
      </g>
      <ellipse cx="41" cy="62" rx="3.4" ry="2" className="forge-cheek" />
      <ellipse cx="79" cy="62" rx="3.4" ry="2" className="forge-cheek" />
      {/* body */}
      <rect x="41" y="83" width="44" height="28" rx="11" className="forge-shadow" />
      <rect x="38" y="80" width="44" height="28" rx="11" className="forge-shell forge-ink" />
      {/* chest screen */}
      <rect
        x="49"
        y="87"
        width="22"
        height="13"
        rx="4"
        className="forge-chest forge-accent-fill forge-ink"
      />
    </svg>
  );
}
