import { useState } from 'react';

import { Intro } from './components/Intro.js';
import { useScan } from './lib/useScan.js';
import { AgentScreen } from './screens/AgentScreen.js';
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
  { id: 'new-scan', label: 'Start New Scan' },
  { id: 'findings', label: 'Findings Explorer' },
  { id: 'tree', label: 'Dependency Tree' },
  { id: 'agent', label: 'AI Agent' },
  { id: 'history', label: 'Scan History' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

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
      <header className="topbar">
        <span className="brand">
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
              {item.label}
            </button>
          ))}
        </nav>
        <span
          className={`state-pill ${live ? 'scanning' : ''} ${session.ui.state === 'error' ? 'error' : ''}`}>
          {session.ui.state}
          {session.ui.state === 'scanning' || session.ui.state === 'analyzing'
            ? ` · ${session.ui.queriesDone}/${session.ui.queriesTotal}`
            : ''}
        </span>
      </header>
      <main className="screen">
        {live ? (
          <LiveMonitorScreen session={session} />
        ) : tab === 'overview' ? (
          <OverviewScreen session={session} />
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
