/**
 * The UI scan state machine (G4): one pure transition function shared by the dashboard
 * and the TUI, so both surfaces always agree on what the UI - and the Forge agent
 * character - is showing. Nothing here invents state: every transition is driven by a
 * real engine event.
 */

export const UI_STATES = [
  'idle',
  'scanning',
  'analyzing',
  'detected',
  'completed',
  'error',
  'cancelled',
] as const;

export type UiState = (typeof UI_STATES)[number];

export type ScanEvent =
  | { readonly type: 'scan-started'; readonly target: string; readonly startedAt: string }
  | {
      readonly type: 'query-progress';
      readonly done: number;
      readonly total: number;
      readonly pkg: string;
    }
  | { readonly type: 'ai-started' }
  | { readonly type: 'detected'; readonly severity: 'critical' | 'high' | 'medium' | 'low' }
  | { readonly type: 'scan-completed' }
  | { readonly type: 'scan-failed'; readonly message: string }
  | { readonly type: 'scan-cancelled' }
  | { readonly type: 'acknowledge' }
  | { readonly type: 'reset' };

/** The six Forge agent states from the approved design brief. */
export const AGENT_STATES = [
  'idle',
  'scanning',
  'analyzing',
  'detected',
  'completed',
  'error',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export interface UiScanState {
  readonly state: UiState;
  /** null outside an active run. */
  readonly target: string | null;
  /** `HH:MM:SS` from the real start time, formatted by the caller's clock; never invented. */
  readonly startedAt: string | null;
  readonly queriesDone: number;
  readonly queriesTotal: number;
  /** Last package identity carried by a real progress event; null before the first one. */
  readonly lastPackage: string | null;
  /** Worst severity seen this run; drives the DETECTED flare. null while clean/unknown. */
  readonly detectedSeverity: 'critical' | 'high' | 'medium' | 'low' | null;
  readonly errorMessage: string | null;
}

export const INITIAL_UI_STATE: UiScanState = {
  state: 'idle',
  target: null,
  startedAt: null,
  queriesDone: 0,
  queriesTotal: 0,
  lastPackage: null,
  detectedSeverity: null,
  errorMessage: null,
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export interface TransitionResult {
  readonly next: UiScanState;
  /** false when the event is not legal from the current state; next is unchanged. */
  readonly accepted: boolean;
}

/**
 * Legal transitions:
 *   idle      -> scanning (scan-started)
 *   scanning  -> scanning (query-progress), analyzing (ai-started), detected,
 *                completed, error, cancelled
 *   analyzing -> detected, completed, error, cancelled
 *   detected  -> scanning/analyzing (further progress), completed (acknowledge), error, cancelled
 *   completed/error/cancelled -> idle (reset), scanning (scan-started, a new run)
 */
export function transition(current: UiScanState, event: ScanEvent): TransitionResult {
  switch (event.type) {
    case 'scan-started':
      if (current.state === 'idle' || isTerminal(current.state)) {
        return accept({
          ...INITIAL_UI_STATE,
          state: 'scanning',
          target: event.target,
          startedAt: event.startedAt,
        });
      }
      return reject(current);

    case 'query-progress':
      if (isRunning(current.state)) {
        return accept({
          ...current,
          // Progress can arrive after a DETECTED flare; return to the running phase
          // that raised it so the flare settles (spec: animation stops when state leaves).
          state: current.state === 'detected' ? 'scanning' : current.state,
          queriesDone: event.done,
          queriesTotal: event.total,
          lastPackage: event.pkg,
        });
      }
      return reject(current);

    case 'ai-started':
      if (isRunning(current.state)) {
        return accept({ ...current, state: 'analyzing' });
      }
      return reject(current);

    case 'detected':
      // 'completed' included: on fast scans the SSE completed snapshot lands
      // before the response's findings, and detected is the truer end state.
      if (isRunning(current.state) || current.state === 'completed') {
        const previous = current.detectedSeverity;
        const worst =
          previous !== null &&
          SEVERITY_ORDER.indexOf(previous) < SEVERITY_ORDER.indexOf(event.severity)
            ? previous
            : event.severity;
        return accept({ ...current, state: 'detected', detectedSeverity: worst });
      }
      return reject(current);

    case 'scan-completed':
      // not from 'detected': a late completed must not hide the findings.
      if (current.state === 'scanning' || current.state === 'analyzing') {
        return accept({ ...current, state: 'completed' });
      }
      return reject(current);

    case 'scan-failed':
      if (isRunning(current.state)) {
        return accept({ ...current, state: 'error', errorMessage: event.message });
      }
      return reject(current);

    case 'scan-cancelled':
      if (isRunning(current.state)) {
        return accept({ ...current, state: 'cancelled' });
      }
      return reject(current);

    case 'acknowledge':
      // The user has seen the DETECTED result and moves on to the findings: the run
      // is over, so the Live Monitor releases the screen. Findings stay in the session.
      if (current.state === 'detected') {
        return accept({ ...current, state: 'completed' });
      }
      return reject(current);

    case 'reset':
      if (isTerminal(current.state)) {
        return accept(INITIAL_UI_STATE);
      }
      return reject(current);
  }
}

function isRunning(state: UiState): boolean {
  return state === 'scanning' || state === 'analyzing' || state === 'detected';
}

function isTerminal(state: UiState): boolean {
  return state === 'completed' || state === 'error' || state === 'cancelled';
}

function accept(next: UiScanState): TransitionResult {
  return { next, accepted: true };
}

function reject(current: UiScanState): TransitionResult {
  return { next: current, accepted: false };
}

/**
 * Maps a UI state onto one of the six approved Forge agent states. `cancelled` is an
 * explicit UI state (the Live Monitor shows it) but Forge himself returns to idle:
 * a cancelled scan is not an error and not a detection.
 */
export function agentStateFor(state: UiState): AgentState {
  switch (state) {
    case 'scanning':
      return 'scanning';
    case 'analyzing':
      return 'analyzing';
    case 'detected':
      return 'detected';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    case 'idle':
    case 'cancelled':
      return 'idle';
  }
}
