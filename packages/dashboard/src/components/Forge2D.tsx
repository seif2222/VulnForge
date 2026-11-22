import type { AgentState } from '../lib/core.js';

/**
 * Forge, the agent character, as an accessible SVG: the required non-WebGL
 * rendering (fallback for missing WebGL and for prefers-reduced-motion) and the
 * identity reference for the 3D version. Identity: ice-white glossy shell, dark
 * visor with striped eyes, antenna with ball, ear discs, chest screen. The six
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
      {/* antenna */}
      <line x1="60" y1="14" x2="60" y2="26" className="forge-line" />
      <circle cx="60" cy="12" r="4" className="forge-accent-fill forge-antenna-ball" />
      {/* ears */}
      <rect x="18" y="52" width="8" height="18" rx="3" className="forge-shell-dim" />
      <rect x="94" y="52" width="8" height="18" rx="3" className="forge-shell-dim" />
      {/* head */}
      <rect x="26" y="26" width="68" height="52" rx="16" className="forge-shell" />
      {/* visor */}
      <rect x="34" y="40" width="52" height="24" rx="10" className="forge-visor" />
      {/* striped eyes */}
      <g className="forge-eyes">
        <rect x="44" y="47" width="10" height="2.6" rx="1.3" className="forge-eye" />
        <rect x="44" y="52.5" width="10" height="2.6" rx="1.3" className="forge-eye" />
        <rect x="66" y="47" width="10" height="2.6" rx="1.3" className="forge-eye" />
        <rect x="66" y="52.5" width="10" height="2.6" rx="1.3" className="forge-eye" />
      </g>
      {/* body */}
      <rect x="38" y="80" width="44" height="30" rx="10" className="forge-shell" />
      {/* chest screen */}
      <rect x="50" y="88" width="20" height="12" rx="3" className="forge-chest forge-accent-fill" />
    </svg>
  );
}
