import { ForgeVisual } from '../components/ForgeVisual.js';
import { agentStateFor } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';

/**
 * AI Agent: the character, its real state and task, and the latest Forge
 * suggestion only when one truly exists in the report. No fake activity feed.
 */
export function AgentScreen(props: { readonly session: ScanSession }) {
  const { session } = props;
  const agentState = agentStateFor(session.ui.state);
  const suggestions = session.report?.suggestions ?? [];

  return (
    <div className="grid-live">
      <section className="panel panel-forge">
        <h2>forge</h2>
        <ForgeVisual
          state={agentState}
          size={220}
          detectedSeverity={session.ui.state === 'detected' ? session.ui.detectedSeverity : null}
        />
        <p className="mono muted">STATE: {session.ui.state.toUpperCase()}</p>
        <p className="mono muted">
          {session.ui.target === null ? 'no task' : `task: ${session.ui.target}`}
        </p>
      </section>
      <section className="panel">
        <h2>latest suggestion</h2>
        {suggestions.length === 0 ? (
          <p className="muted mono">
            no AI suggestion in the current report
            <br />
            Forge writes suggestions only for real findings, and only when an AI provider is
            configured — nothing is invented here.
          </p>
        ) : (
          <div className="ai-block">
            <p className="mono muted">{suggestions.length} suggestion(s) in this report</p>
            {suggestions.slice(0, 5).map((suggestion) => (
              <div key={suggestion.findingKey} className="suggestion-card">
                <p className="mono">{suggestion.findingKey}</p>
                {suggestion.saferVersion !== null && (
                  <p>safer version: {suggestion.saferVersion}</p>
                )}
                {suggestion.alternativePackage !== null && (
                  <p>alternative: {suggestion.alternativePackage}</p>
                )}
                <p className="muted">{suggestion.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
