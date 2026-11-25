import type { AgentState, Severity } from '../lib/core.js';
import { Forge2D } from './Forge2D.js';

/**
 * The one Forge character. It is the same drawn SVG on every screen so the
 * agent looks like part of the interface; motion is CSS and is frozen under
 * prefers-reduced-motion.
 */
export function ForgeVisual(props: {
  readonly state: AgentState;
  readonly size?: number;
  readonly detectedSeverity?: Severity | null;
}) {
  const sizeProps = props.size === undefined ? {} : { size: props.size };
  return (
    <Forge2D state={props.state} {...sizeProps} detectedSeverity={props.detectedSeverity ?? null} />
  );
}
