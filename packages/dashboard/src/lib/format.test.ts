import { describe, expect, it } from 'vitest';

import { transition, INITIAL_UI_STATE } from './core.js';

// The dashboard's state-machine driving is only as honest as its event mapping;
// these tests pin the SSE -> ScanEvent mapping rules the app relies on.
describe('dashboard session state machine use', () => {
  it('a launched run flows scanning -> completed with real counters', () => {
    let state = INITIAL_UI_STATE;
    state = transition(state, {
      type: 'scan-started',
      target: '/tmp/x',
      startedAt: '12:00:00',
    }).next;
    expect(state.state).toBe('scanning');
    state = transition(state, { type: 'query-progress', done: 3, total: 9, pkg: 'a@1.0.0' }).next;
    expect(state.queriesDone).toBe(3);
    expect(state.lastPackage).toBe('a@1.0.0');
    state = transition(state, { type: 'scan-completed' }).next;
    expect(state.state).toBe('completed');
  });

  it('cancel and error land in honest terminal states', () => {
    let state = transition(INITIAL_UI_STATE, {
      type: 'scan-started',
      target: '/tmp/x',
      startedAt: '12:00:00',
    }).next;
    state = transition(state, { type: 'scan-cancelled' }).next;
    expect(state.state).toBe('cancelled');
    state = transition(state, { type: 'reset' }).next;
    expect(state.state).toBe('idle');
    state = transition(state, {
      type: 'scan-started',
      target: '/tmp/y',
      startedAt: '12:01:00',
    }).next;
    state = transition(state, { type: 'scan-failed', message: 'boom' }).next;
    expect(state.state).toBe('error');
    expect(state.errorMessage).toBe('boom');
  });
});
