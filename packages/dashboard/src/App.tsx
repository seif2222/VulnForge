import { useState, type ReactElement } from 'react';

import { Intro } from './components/Intro.js';
import { useScan } from './lib/useScan.js';
import { AgentScreen } from './screens/AgentScreen.js';
import { AnalyticsScreen } from './screens/AnalyticsScreen.js';
import { FindingsScreen } from './screens/FindingsScreen.js';
import { HistoryScreen } from './screens/HistoryScreen.js';
import { LiveMonitorScreen } from './screens/LiveMonitorScreen.js';
import { NewScanScreen } from './screens/NewScanScreen.js';
import { OverviewScreen } from './screens/OverviewScreen.js';
import { ReportsScreen } from './screens/ReportsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { TreeScreen } from './screens/TreeScreen.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'new-scan', label: 'Start New Scan' },
  { id: 'findings', label: 'Findings Explorer' },
  { id: 'tree', label: 'Dependency Tree' },
  { id: 'agent', label: 'AI Agent' },
  { id: 'history', label: 'Scan History' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'icon',
  'aria-hidden': true,
} as const;

/** Small line icons for the sidebar nav, ChainX-style. Attributes only: the CSP forbids inline styles. */
const ICONS: Record<TabId, ReactElement> = {
  overview: (
    <svg {...ICON_PROPS}>
      <rect x="1.75" y="1.75" width="5" height="5" rx="1.2" />
      <rect x="9.25" y="1.75" width="5" height="5" rx="1.2" />
      <rect x="1.75" y="9.25" width="5" height="5" rx="1.2" />
      <rect x="9.25" y="9.25" width="5" height="5" rx="1.2" />
    </svg>
  ),
  'new-scan': (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5.5v5M5.5 8h5" />
    </svg>
  ),
  analytics: (
    <svg {...ICON_PROPS}>
      <path d="M3 13.5V9M8 13.5V4.5M13 13.5V7.5" />
    </svg>
  ),
  findings: (
    <svg {...ICON_PROPS}>
      <path d="M8 1.9l4.8 1.9v3.9c0 2.9-2.1 5-4.8 6.2-2.7-1.2-4.8-3.3-4.8-6.2V3.8z" />
      <path d="M8 5.4v2.8" />
      <path d="M8 10.8v.2" />
    </svg>
  ),
  tree: (
    <svg {...ICON_PROPS}>
      <circle cx="4" cy="4" r="1.9" />
      <circle cx="4" cy="12" r="1.9" />
      <circle cx="12" cy="8" r="1.9" />
      <path d="M5.5 5 10.5 7.2M5.5 11l5-2.2" />
    </svg>
  ),
  agent: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="6" width="10" height="7" rx="2.4" />
      <path d="M8 6V3.2" />
      <circle cx="8" cy="2.3" r="0.9" />
      <path d="M6 9.6v.2M10 9.6v.2" />
    </svg>
  ),
  history: (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.8V8l2.1 1.5" />
    </svg>
  ),
  reports: (
    <svg {...ICON_PROPS}>
      <path d="M4.5 1.75h4.6l2.4 2.4v10.1H4.5z" />
      <path d="M9 1.75v2.5h2.5" />
      <path d="M6.2 8.3h3.6M6.2 10.7h3.6" />
    </svg>
  ),
  settings: (
    <svg {...ICON_PROPS}>
      <path d="M2.5 5.2h11M2.5 10.8h11" />
      <circle cx="6.1" cy="5.2" r="1.7" />
      <circle cx="9.9" cy="10.8" r="1.7" />
    </svg>
  ),
};

const LIVE_STATES = new Set(['scanning', 'analyzing', 'detected']);

export function App() {
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const session = useScan();

  if (!entered) {
    return <Intro onStart={() => setEntered(true)} />;
  }

  // Like the TUI, Live Monitor is the in-scan view, not a tab: an active run owns the screen.
  const live = LIVE_STATES.has(session.ui.state);

  return (
    <div className="shell">
      <aside className="sidebar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Vuln<span className="accent">Forge</span>
        </span>
        <nav className="tabs" role="tablist" aria-label="screens">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={!live && tab === item.id}
              className="tab"
              onClick={() => setTab(item.id)}>
              {ICONS[item.id]}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-state">
          <span className="sidebar-state-label">engine</span>
          <span
            className={`state-pill ${live ? 'scanning' : ''} ${session.ui.state === 'error' ? 'error' : ''}`}>
            {session.ui.state}
            {session.ui.state === 'scanning' || session.ui.state === 'analyzing'
              ? ` · ${session.ui.queriesDone}/${session.ui.queriesTotal}`
              : ''}
          </span>
        </div>
      </aside>
      <main className="screen">
        {live ? (
          <LiveMonitorScreen session={session} />
        ) : tab === 'overview' ? (
          <OverviewScreen session={session} />
        ) : tab === 'analytics' ? (
          <AnalyticsScreen session={session} />
        ) : tab === 'new-scan' ? (
          <NewScanScreen session={session} />
        ) : tab === 'findings' ? (
          <FindingsScreen session={session} />
        ) : tab === 'tree' ? (
          <TreeScreen session={session} />
        ) : tab === 'agent' ? (
          <AgentScreen session={session} />
        ) : tab === 'history' ? (
          <HistoryScreen session={session} />
        ) : tab === 'reports' ? (
          <ReportsScreen session={session} />
        ) : (
          <SettingsScreen session={session} />
        )}
      </main>
    </div>
  );
}
