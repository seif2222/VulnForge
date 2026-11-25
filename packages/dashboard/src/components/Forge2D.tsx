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
      <ellipse cx="60" cy="114" rx="24" ry="3.5" className="forge-ground" />
      {/* antenna */}
      <line x1="60" y1="16" x2="60" y2="28" className="forge-line" />
      <circle cx="60" cy="13" r="3.6" className="forge-accent-fill forge-antenna-ball forge-ink" />
      {/* ear caps */}
      <rect x="19" y="49" width="7" height="20" rx="3" className="forge-shell forge-ink" />
      <rect x="94" y="49" width="7" height="20" rx="3" className="forge-shell forge-ink" />
      {/* head */}
      <rect x="28" y="28" width="64" height="50" rx="13" className="forge-shell forge-ink" />
      {/* visor with two slim lights */}
      <rect x="35" y="38" width="50" height="28" rx="8" className="forge-visor forge-ink" />
      <g className="forge-eyes">
        <rect x="42" y="50" width="14" height="4.5" rx="2.2" className="forge-eye" />
        <rect x="64" y="50" width="14" height="4.5" rx="2.2" className="forge-eye" />
      </g>
      {/* body */}
      <rect x="40" y="82" width="40" height="27" rx="9" className="forge-shell forge-ink" />
      {/* status light */}
      <rect
        x="50"
        y="91"
        width="20"
        height="8"
        rx="3"
        className="forge-chest forge-accent-fill forge-ink"
      />
    </svg>
  );
}
