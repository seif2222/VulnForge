import { describe, expect, it } from 'vitest';

import { dispatch, initialModel, type EnvFacts, type TuiKey } from './model.js';

/** The TUI reducer, tested without a terminal: keys in, model + effects out. */

const ENV: EnvFacts = {
  nodeVersion: 'v22.0.0',
  platform: 'linux x64',
  cwd: '/tmp/project',
  cacheDir: '/tmp/cache',
  aiConfigured: false,
  toolVersion: '0.0.0-test',
};

const start = () => initialModel(ENV);

const char = (value: string): TuiKey => ({ type: 'char', value });

function typeText(model: ReturnType<typeof start>, text: string): ReturnType<typeof start> {
  let next = model;
  for (const ch of text) {
    next = dispatch(next, { type: 'key', key: char(ch) }).model;
  }
  return next;
}

const preflightOk = {
  type: 'preflight' as const,
  facts: {
    target: '/tmp/project/demo',
    exists: true,
    manifest: 'package-lock.json',
    ecosystem: 'npm',
    lockfile: 'package-lock.json',
    ignoreFile: null,
    ecosystems: ['npm'],
  },
};

// Shaped like the owner's vuln-ai-project: npm and Python side by side.
const preflightMixed = {
  type: 'preflight' as const,
  facts: {
    target: '/tmp/project/vuln-ai-project',
    exists: true,
    manifest: 'package.json',
    ecosystem: 'npm',
    lockfile: null,
    ignoreFile: null,
    ecosystems: ['npm', 'pypi'],
  },
};

describe('tui model reducer', () => {
  it('starts on the overview tab, idle, not quitting', () => {
    const model = start();
    expect(model.tab).toBe(1);
    expect(model.scan.state).toBe('idle');
    expect(model.quit).toBe(false);
    expect(model.liveOpen).toBe(false);
  });

  it('digit keys switch tabs', () => {
    const model = dispatch(start(), { type: 'key', key: char('3') }).model;
    expect(model.tab).toBe(3);
  });

  it('s focuses the scan input on tab 2', () => {
    const model = dispatch(start(), { type: 'key', key: char('s') }).model;
    expect(model.tab).toBe(2);
    expect(model.inputFocused).toBe(true);
  });

  it('typing edits the input while focused; escape blurs', () => {
    let model = dispatch(start(), { type: 'key', key: char('s') }).model;
    model = typeText(model, '../demo');
    expect(model.input).toBe('../demo');
    model = dispatch(model, { type: 'key', key: { type: 'backspace' } }).model;
    expect(model.input).toBe('../dem');
    // Digits are path characters while the input owns keys, never tab switches.
    model = typeText(model, '3');
    expect(model.input).toBe('../dem3');
    expect(model.tab).toBe(2);
    model = dispatch(model, { type: 'key', key: { type: 'escape' } }).model;
    expect(model.inputFocused).toBe(false);
    // After blur, digits switch tabs again.
    model = dispatch(model, { type: 'key', key: char('4') }).model;
    expect(model.tab).toBe(4);
    expect(model.input).toBe('../dem3');
  });

  it('enter on an empty input does nothing', () => {
    const model = dispatch(start(), { type: 'key', key: char('s') }).model;
    const result = dispatch(model, { type: 'key', key: { type: 'enter' } });
    expect(result.effects).toEqual([]);
    expect(result.model.scan.state).toBe('idle');
  });

  it('enter with a path probes first, and a good probe launches the run', () => {
    let model = dispatch(start(), { type: 'key', key: char('s') }).model;
    model = typeText(model, 'demo');
    const probed = dispatch(model, { type: 'key', key: { type: 'enter' } });
    expect(probed.model.inputFocused).toBe(false);
    expect(probed.effects).toEqual([{ type: 'probe', path: 'demo' }]);

    const launched = dispatch(probed.model, preflightOk);
    expect(launched.model.scan.state).toBe('scanning');
    expect(launched.model.scan.target).toBe('/tmp/project/demo');
    expect(launched.model.liveOpen).toBe(true);
    expect(launched.effects).toEqual([{ type: 'run-scan', path: '/tmp/project/demo' }]);
  });

  it('a failed preflight blocks the launch and keeps the facts visible', () => {
    let model = dispatch(start(), { type: 'key', key: char('s') }).model;
    model = typeText(model, 'nowhere');
    const probed = dispatch(model, { type: 'key', key: { type: 'enter' } });
    const blocked = dispatch(probed.model, {
      type: 'preflight',
      facts: {
        target: '/tmp/project/nowhere',
        exists: false,
        manifest: null,
        ecosystem: null,
        lockfile: null,
        ignoreFile: null,
        ecosystems: [],
      },
    });
    expect(blocked.effects).toEqual([]);
    expect(blocked.model.scan.state).toBe('idle');
    expect(blocked.model.preflight?.exists).toBe(false);
    expect(blocked.model.tab).toBe(2);
  });

  it('opens an ecosystem picker instead of auto-running a mixed project', () => {
    const result = dispatch(start(), preflightMixed);
    expect(result.effects).toEqual([]);
    expect(result.model.ecosystemChoice).toEqual({
      target: '/tmp/project/vuln-ai-project',
      options: ['npm', 'pypi'],
    });
    expect(result.model.tab).toBe(2);
    expect(result.model.scan.state).toBe('idle');
  });

  it('a digit in the picker launches the chosen ecosystem; escape cancels', () => {
    const cancelled = dispatch(dispatch(start(), preflightMixed).model, {
      type: 'key',
      key: { type: 'escape' },
    });
    expect(cancelled.model.ecosystemChoice).toBeNull();
    expect(cancelled.effects).toEqual([]);

    const picked = dispatch(dispatch(start(), preflightMixed).model, {
      type: 'key',
      key: char('2'),
    });
    expect(picked.model.ecosystemChoice).toBeNull();
    expect(picked.model.scan.state).toBe('scanning');
    expect(picked.model.liveOpen).toBe(true);
    expect(picked.effects).toEqual([
      { type: 'run-scan', path: '/tmp/project/vuln-ai-project', ecosystem: 'pypi' },
    ]);
  });

  it('a paste into the focused input inserts the text as-is', () => {
    let model = dispatch(start(), { type: 'key', key: char('s') }).model;
    model = dispatch(model, {
      type: 'key',
      key: { type: 'paste', text: 'E:\\Pref\\deps 1' },
    }).model;
    expect(model.input).toBe('E:\\Pref\\deps 1');
  });

  it('a paste from any tab routes to the scan input and focuses it', () => {
    const model = dispatch(start(), {
      type: 'key',
      key: { type: 'paste', text: 'E:\\Pref\\depscan' },
    }).model;
    expect(model.tab).toBe(2);
    expect(model.inputFocused).toBe(true);
    expect(model.input).toBe('E:\\Pref\\depscan');
  });

  it('paste strips line breaks and control characters', () => {
    const model = dispatch(start(), {
      type: 'key',
      key: { type: 'paste', text: 'E:\\Pref\r\ndeps\tcan' },
    }).model;
    expect(model.input).toBe('E:\\Prefdepscan');
  });

  it('a raw Ctrl+V asks for the OS clipboard; the answer lands in the input', () => {
    const requested = dispatch(start(), { type: 'key', key: { type: 'paste-request' } });
    expect(requested.effects).toEqual([{ type: 'read-clipboard' }]);
    expect(requested.model.tab).toBe(2);
    expect(requested.model.inputFocused).toBe(true);
    const pasted = dispatch(requested.model, { type: 'clipboard-text', text: 'E:\\Pref\\depscan' });
    expect(pasted.model.input).toBe('E:\\Pref\\depscan');
  });

  it('query progress feeds counters, the package trail and the event log', () => {
    let model = dispatch(start(), preflightOk).model;
    model = dispatch(model, {
      type: 'scan-event',
      event: { type: 'query-progress', done: 3, total: 12, pkg: 'left-pad@1.0.0' },
    }).model;
    expect(model.scan.queriesDone).toBe(3);
    expect(model.scan.queriesTotal).toBe(12);
    expect(model.scan.lastPackage).toBe('left-pad@1.0.0');
    expect(model.queriedPackages).toEqual(['left-pad@1.0.0']);
    expect(model.eventLog.some((line) => line.includes('left-pad@1.0.0'))).toBe(true);
  });

  it('a completed run stores the report and a session history entry', () => {
    let model = dispatch(start(), preflightOk).model;
    model = dispatch(model, { type: 'scan-event', event: { type: 'scan-completed' } }).model;
    const report = { stats: { totalVulnerabilities: 7 } };
    const doneModel = dispatch(model, {
      type: 'scan-report',
      report: report as never,
      target: '/tmp/project/demo',
    }).model;
    expect(doneModel.report).toBe(report);
    expect(doneModel.reportSource).toBe('/tmp/project/demo');
    expect(doneModel.liveOpen).toBe(false);
    expect(doneModel.tab).toBe(1);
    expect(doneModel.sessionRuns).toHaveLength(1);
    expect(doneModel.sessionRuns[0]).toMatchObject({
      target: '/tmp/project/demo',
      outcome: 'completed',
      findings: 7,
    });
  });

  it('a failed run lands in the error state with the engine message in the log', () => {
    let model = dispatch(start(), preflightOk).model;
    model = dispatch(model, {
      type: 'scan-event',
      event: { type: 'scan-failed', message: 'osv.dev unreachable' },
    }).model;
    expect(model.scan.state).toBe('error');
    expect(model.scan.errorMessage).toBe('osv.dev unreachable');
    expect(model.eventLog.some((line) => line.includes('osv.dev unreachable'))).toBe(true);
  });

  it('c or q during a run cancels instead of quitting', () => {
    const running = dispatch(start(), preflightOk).model;
    const cancelled = dispatch(running, { type: 'key', key: char('c') });
    expect(cancelled.effects).toEqual([{ type: 'cancel-scan' }]);
    expect(cancelled.model.quit).toBe(false);

    const qQuit = dispatch(running, { type: 'key', key: char('q') });
    expect(qQuit.effects).toEqual([{ type: 'cancel-scan' }]);
    expect(qQuit.model.quit).toBe(false);
  });

  it('q quits when idle', () => {
    const result = dispatch(start(), { type: 'key', key: char('q') });
    expect(result.model.quit).toBe(true);
    expect(result.effects).toEqual([]);
  });

  it('ctrl-c cancels a run and quits when idle', () => {
    const running = dispatch(start(), preflightOk).model;
    const cancelled = dispatch(running, { type: 'key', key: { type: 'ctrl-c' } });
    expect(cancelled.effects).toEqual([{ type: 'cancel-scan' }]);

    const idle = dispatch(start(), { type: 'key', key: { type: 'ctrl-c' } });
    expect(idle.model.quit).toBe(true);
  });

  it('l opens the live monitor for a run in progress and escape closes it', () => {
    let model = dispatch(start(), preflightOk).model;
    expect(model.liveOpen).toBe(true);
    model = dispatch(model, { type: 'key', key: { type: 'escape' } }).model;
    expect(model.liveOpen).toBe(false);
    model = dispatch(model, { type: 'key', key: char('l') }).model;
    expect(model.liveOpen).toBe(true);
  });

  it('l does nothing before any run', () => {
    const model = dispatch(start(), { type: 'key', key: char('l') }).model;
    expect(model.liveOpen).toBe(false);
  });

  it('r after a terminal state re-arms the scan input with the last target', () => {
    let model = dispatch(start(), preflightOk).model;
    model = dispatch(model, { type: 'scan-event', event: { type: 'scan-completed' } }).model;
    const rearmed = dispatch(model, { type: 'key', key: char('r') }).model;
    expect(rearmed.tab).toBe(2);
    expect(rearmed.input).toBe('/tmp/project/demo');
    expect(rearmed.inputFocused).toBe(true);
  });

  it('r does nothing while a run is active', () => {
    const running = dispatch(start(), preflightOk).model;
    const result = dispatch(running, { type: 'key', key: char('r') });
    expect(result.model.tab).toBe(1);
    expect(result.effects).toEqual([]);
  });

  it('a loaded report lands on the overview', () => {
    const report = { stats: { totalVulnerabilities: 0 } };
    const model = dispatch(start(), {
      type: 'report-loaded',
      report: report as never,
      path: '/tmp/report.json',
    }).model;
    expect(model.report).toBe(report);
    expect(model.reportSource).toBe('/tmp/report.json');
    expect(model.tab).toBe(1);
  });
});
