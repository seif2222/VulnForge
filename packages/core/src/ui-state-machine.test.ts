import { describe, expect, it } from 'vitest';

import {
  INITIAL_UI_STATE,
  agentStateFor,
  transition,
  type UiScanState,
} from './ui-state-machine.js';

const started = transition(INITIAL_UI_STATE, {
  type: 'scan-started',
  target: '/repo/demo',
  startedAt: '02:14:07',
});

describe('ui state machine', () => {
  it('starts idle with no invented identifiers', () => {
    expect(INITIAL_UI_STATE.state).toBe('idle');
    expect(INITIAL_UI_STATE.target).toBeNull();
    expect(INITIAL_UI_STATE.startedAt).toBeNull();
  });

  it('enters scanning on scan-started and keeps the real identity', () => {
    expect(started.accepted).toBe(true);
    expect(started.next.state).toBe('scanning');
    expect(started.next.target).toBe('/repo/demo');
    expect(started.next.startedAt).toBe('02:14:07');
  });

  it('tracks real query counters with package identity, never a percentage', () => {
    const progressed = transition(started.next, {
      type: 'query-progress',
      done: 2,
      total: 3,
      pkg: 'minimist@1.2.5',
    });
    expect(progressed.accepted).toBe(true);
    expect(progressed.next.queriesDone).toBe(2);
    expect(progressed.next.queriesTotal).toBe(3);
    expect(progressed.next.lastPackage).toBe('minimist@1.2.5');
  });

  it('moves scanning -> analyzing on ai-started', () => {
    const analyzing = transition(started.next, { type: 'ai-started' });
    expect(analyzing.accepted).toBe(true);
    expect(analyzing.next.state).toBe('analyzing');
  });

  it('a fast scan may complete before the findings land: detected still wins', () => {
    // SSE 'completed' can beat the response body on cached scans; the report's
    // findings then upgrade the end state instead of being swallowed.
    const completed = transition(started.next, { type: 'scan-completed' });
    const detected = transition(completed.next, { type: 'detected', severity: 'medium' });
    expect(detected.accepted).toBe(true);
    expect(detected.next.state).toBe('detected');
    expect(detected.next.detectedSeverity).toBe('medium');
    // and a late 'completed' must never hide the findings again
    const late = transition(detected.next, { type: 'scan-completed' });
    expect(late.accepted).toBe(false);
    expect(late.next.state).toBe('detected');
  });

  it('flares detected and keeps the worst severity seen', () => {
    const high = transition(started.next, { type: 'detected', severity: 'high' });
    expect(high.next.state).toBe('detected');
    expect(high.next.detectedSeverity).toBe('high');
    const critical = transition(high.next, { type: 'detected', severity: 'critical' });
    expect(critical.next.detectedSeverity).toBe('critical');
    const medium = transition(critical.next, { type: 'detected', severity: 'medium' });
    expect(medium.next.detectedSeverity).toBe('critical');
  });

  it('settles back to scanning when further progress arrives after a flare', () => {
    const detected = transition(started.next, { type: 'detected', severity: 'low' });
    const progressed = transition(detected.next, {
      type: 'query-progress',
      done: 3,
      total: 3,
      pkg: 'qs@5.2.0',
    });
    expect(progressed.next.state).toBe('scanning');
  });

  it('completes only from a running state', () => {
    const completed = transition(started.next, { type: 'scan-completed' });
    expect(completed.accepted).toBe(true);
    expect(completed.next.state).toBe('completed');
    const illegal = transition(INITIAL_UI_STATE, { type: 'scan-completed' });
    expect(illegal.accepted).toBe(false);
    expect(illegal.next).toBe(INITIAL_UI_STATE);
  });

  it('records failures with the real error message', () => {
    const failed = transition(started.next, { type: 'scan-failed', message: 'osv.dev down' });
    expect(failed.next.state).toBe('error');
    expect(failed.next.errorMessage).toBe('osv.dev down');
  });

  it('has an explicit cancelled state, distinct from error', () => {
    const cancelled = transition(started.next, { type: 'scan-cancelled' });
    expect(cancelled.next.state).toBe('cancelled');
    expect(cancelled.next.errorMessage).toBeNull();
  });

  it('allows a new run from any terminal state and reset back to idle', () => {
    const completed = transition(started.next, { type: 'scan-completed' });
    const rerun = transition(completed.next, {
      type: 'scan-started',
      target: '/repo/other',
      startedAt: '03:00:00',
    });
    expect(rerun.accepted).toBe(true);
    expect(rerun.next.state).toBe('scanning');
    const reset = transition(completed.next, { type: 'reset' });
    expect(reset.accepted).toBe(true);
    expect(reset.next).toEqual(INITIAL_UI_STATE);
  });

  it('rejects events that are not legal from the current state', () => {
    const cases: [UiScanState, Parameters<typeof transition>[1]][] = [
      [INITIAL_UI_STATE, { type: 'query-progress', done: 1, total: 2, pkg: 'a@1' }],
      [INITIAL_UI_STATE, { type: 'scan-cancelled' }],
      [started.next, { type: 'reset' }],
      [started.next, { type: 'scan-started', target: '/x', startedAt: '00:00:01' }],
    ];
    for (const [state, event] of cases) {
      const result = transition(state, event);
      expect(result.accepted).toBe(false);
      expect(result.next).toBe(state);
    }
  });

  it('maps UI states onto the six approved Forge agent states', () => {
    expect(agentStateFor('idle')).toBe('idle');
    expect(agentStateFor('scanning')).toBe('scanning');
    expect(agentStateFor('analyzing')).toBe('analyzing');
    expect(agentStateFor('detected')).toBe('detected');
    expect(agentStateFor('completed')).toBe('completed');
    expect(agentStateFor('error')).toBe('error');
    // A cancelled scan is not an error: Forge returns to idle.
    expect(agentStateFor('cancelled')).toBe('idle');
  });
});
