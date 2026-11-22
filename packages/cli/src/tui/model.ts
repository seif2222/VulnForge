import {
  INITIAL_UI_STATE,
  agentStateFor,
  transition,
  type Report,
  type ScanEvent,
  type UiScanState,
} from '@vulnforge/core';

/**
 * The TUI's state and its pure reducer. Every transition is testable without a
 * terminal: the app shell only parses bytes into keys, executes effects (fs probes,
 * engine runs) and dispatches their results back.
 */

export const TAB_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type TabId = (typeof TAB_IDS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  1: 'Overview',
  2: 'Start New Scan',
  3: 'Findings Explorer',
  4: 'Dependency Tree',
  5: 'AI Agent',
  6: 'Scan History',
  7: 'Reports',
  8: 'Settings',
};

export interface PreflightFacts {
  readonly target: string;
  readonly exists: boolean;
  readonly manifest: string | null;
  readonly ecosystem: string | null;
  readonly ignoreFile: string | null;
}

export interface EnvFacts {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly cwd: string;
  readonly cacheDir: string;
  /** Key presence only, never values. */
  readonly aiConfigured: boolean;
  readonly toolVersion: string;
}

export interface SessionRun {
  readonly target: string;
  readonly startedAt: string;
  readonly outcome: 'completed' | 'error' | 'cancelled';
  readonly findings: number | null;
}

export interface TuiModel {
  readonly tab: TabId;
  /** Live Monitor is the in-scan view, not a tab: true while a run is on screen. */
  readonly liveOpen: boolean;
  readonly scan: UiScanState;
  readonly report: Report | null;
  /** Where the current report came from: a scanned target or a loaded file. */
  readonly reportSource: string | null;
  readonly input: string;
  readonly inputFocused: boolean;
  readonly preflight: PreflightFacts | null;
  /** Real events, newest last, already formatted `HH:MM:SS message` by the app. */
  readonly eventLog: readonly string[];
  /** Packages whose OSV query completed this run, in completion order. */
  readonly queriedPackages: readonly string[];
  readonly sessionRuns: readonly SessionRun[];
  readonly env: EnvFacts;
  readonly quit: boolean;
}

export type TuiKey =
  | { readonly type: 'char'; readonly value: string }
  | { readonly type: 'enter' }
  | { readonly type: 'escape' }
  | { readonly type: 'backspace' }
  | { readonly type: 'ctrl-c' };

export type TuiAction =
  | { readonly type: 'key'; readonly key: TuiKey }
  | { readonly type: 'preflight'; readonly facts: PreflightFacts }
  | { readonly type: 'scan-event'; readonly event: ScanEvent }
  | { readonly type: 'scan-report'; readonly report: Report; readonly target: string }
  | { readonly type: 'report-loaded'; readonly report: Report; readonly path: string }
  | { readonly type: 'tick' };

export type TuiEffect =
  | { readonly type: 'probe'; readonly path: string }
  | { readonly type: 'run-scan'; readonly path: string }
  | { readonly type: 'cancel-scan' };

export interface DispatchResult {
  readonly model: TuiModel;
  readonly effects: readonly TuiEffect[];
}

export function initialModel(env: EnvFacts): TuiModel {
  return {
    tab: 1,
    liveOpen: false,
    scan: INITIAL_UI_STATE,
    report: null,
    reportSource: null,
    input: '',
    inputFocused: false,
    preflight: null,
    eventLog: [],
    queriedPackages: [],
    sessionRuns: [],
    env,
    quit: false,
  };
}

const RUNNING = ['scanning', 'analyzing', 'detected'] as const;
const TERMINAL = ['completed', 'error', 'cancelled'] as const;

function isRunning(model: TuiModel): boolean {
  return (RUNNING as readonly string[]).includes(model.scan.state);
}

function isTerminal(model: TuiModel): boolean {
  return (TERMINAL as readonly string[]).includes(model.scan.state);
}

function withScan(model: TuiModel, event: ScanEvent): TuiModel {
  const result = transition(model.scan, event);
  return result.accepted ? { ...model, scan: result.next } : model;
}

function handleKey(model: TuiModel, key: TuiKey): DispatchResult {
  // The scan-path input owns keys while focused.
  if (model.inputFocused) {
    switch (key.type) {
      case 'char':
        return done({ ...model, input: model.input + key.value, preflight: null });
      case 'backspace':
        return done({ ...model, input: model.input.slice(0, -1), preflight: null });
      case 'escape':
        return done({ ...model, inputFocused: false });
      case 'ctrl-c':
        return done({ ...model, inputFocused: false });
      case 'enter': {
        const target = model.input.trim();
        if (target === '' || isRunning(model)) {
          return done(model);
        }
        // Probe first; the app dispatches 'preflight' back and the run starts there
        // when the target is real.
        return {
          model: { ...model, inputFocused: false },
          effects: [{ type: 'probe', path: target }],
        };
      }
    }
  }

  if (key.type === 'ctrl-c') {
    if (isRunning(model)) {
      return { model, effects: [{ type: 'cancel-scan' }] };
    }
    return done({ ...model, quit: true });
  }

  if (key.type === 'escape') {
    if (model.liveOpen) {
      return done({ ...model, liveOpen: false });
    }
    return done(model);
  }

  if (key.type !== 'char') {
    return done(model);
  }

  const ch = key.value;

  if (ch >= '1' && ch <= '8') {
    const tab = Number(ch) as TabId;
    return done({
      ...model,
      tab,
      liveOpen: false,
      inputFocused: tab === 2 ? model.inputFocused : false,
    });
  }

  switch (ch) {
    case 'q':
      if (isRunning(model)) {
        // Never strand a run silently: q during a scan cancels it, a second q quits.
        return { model, effects: [{ type: 'cancel-scan' }] };
      }
      return done({ ...model, quit: true });

    case 's':
      return done({ ...model, tab: 2, liveOpen: false, inputFocused: true });

    case 'l':
      if (isRunning(model) || model.scan.state !== 'idle') {
        return done({ ...model, liveOpen: true, inputFocused: false });
      }
      return done(model);

    case 'c':
      if (isRunning(model)) {
        return { model, effects: [{ type: 'cancel-scan' }] };
      }
      return done(model);

    case 'r': {
      if (!isTerminal(model) || model.scan.target === null) {
        return done(model);
      }
      return {
        model: { ...model, tab: 2, liveOpen: false, input: model.scan.target, inputFocused: true },
        effects: [],
      };
    }

    default:
      return done(model);
  }
}

export function dispatch(model: TuiModel, action: TuiAction): DispatchResult {
  switch (action.type) {
    case 'key':
      return handleKey(model, action.key);

    case 'tick':
      return done(model);

    case 'preflight': {
      if (!action.facts.exists || action.facts.manifest === null || isRunning(model)) {
        // Blocked honestly: the Start New Scan screen shows the failing fact.
        return done({ ...model, preflight: action.facts, tab: 2 });
      }
      return {
        model: {
          ...withScan(model, {
            type: 'scan-started',
            target: action.facts.target,
            startedAt: clockNow(),
          }),
          preflight: action.facts,
          liveOpen: true,
          eventLog: [],
          queriedPackages: [],
        },
        effects: [{ type: 'run-scan', path: action.facts.target }],
      };
    }

    case 'scan-event': {
      const next = withScan(model, action.event);
      const line = describeEvent(action.event);
      const queried =
        action.event.type === 'query-progress'
          ? [...next.queriedPackages.slice(-63), action.event.pkg]
          : next.queriedPackages;
      return done({
        ...next,
        queriedPackages: queried,
        eventLog: line === null ? next.eventLog : [...next.eventLog.slice(-199), line],
      });
    }

    case 'scan-report': {
      const findings = action.report.stats.totalVulnerabilities;
      const outcome =
        model.scan.state === 'cancelled' ? ('cancelled' as const) : ('completed' as const);
      return done({
        ...model,
        report: action.report,
        reportSource: action.target,
        liveOpen: false,
        tab: 1,
        sessionRuns: [
          ...model.sessionRuns,
          {
            target: action.target,
            startedAt: model.scan.startedAt ?? '',
            outcome,
            findings: outcome === 'completed' ? findings : null,
          },
        ],
      });
    }

    case 'report-loaded':
      return done({
        ...model,
        report: action.report,
        reportSource: action.path,
        tab: 1,
      });
  }
}

function clockNow(): string {
  // The reducer stamps the real wall-clock start; tests override through dispatch order.
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function describeEvent(event: ScanEvent): string | null {
  switch (event.type) {
    case 'scan-started':
      return `scan started · ${event.target}`;
    case 'query-progress':
      return `OSV query done · ${event.pkg} (${event.done}/${event.total})`;
    case 'ai-started':
      return 'Forge explanations started';
    case 'detected':
      return `finding detected · ${event.severity}`;
    case 'scan-completed':
      return 'scan completed';
    case 'scan-failed':
      return `scan failed · ${event.message}`;
    case 'scan-cancelled':
      return 'scan cancelled';
    case 'reset':
      return null;
  }
}

function done(model: TuiModel): DispatchResult {
  return { model, effects: [] };
}

export { agentStateFor };
