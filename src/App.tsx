import { useState, type ReactNode } from 'react';
import { OverviewView } from './views/OverviewView';
import { OutlookView } from './views/OutlookView';
import { MoneyFlowView } from './views/MoneyFlowView';
import { AgenciesView } from './views/AgenciesView';
import { FunctionsView } from './views/FunctionsView';
import { AwardsView } from './views/AwardsView';
import { DebtView } from './views/DebtView';
import { SourcesView } from './views/SourcesView';
import { SelfCheckView } from './views/SelfCheckView';

const TABS = [
  { id: 'overview', label: 'Overview', render: () => <OverviewView /> },
  { id: 'flows', label: 'In and out', render: () => <MoneyFlowView /> },
  { id: 'functions', label: 'What it buys', render: () => <FunctionsView /> },
  { id: 'agencies', label: 'Agencies', render: () => <AgenciesView /> },
  { id: 'awards', label: 'Awards', render: () => <AwardsView /> },
  { id: 'debt', label: 'Debt', render: () => <DebtView /> },
  { id: 'outlook', label: 'Outlook', render: () => <OutlookView /> },
  { id: 'sources', label: 'Sources', render: () => <SourcesView /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * `?selfcheck=1` swaps the whole app for its diagnostic page.
 *
 * Deliberately not a nav tab: a reader here for budget figures should never
 * trip over it, but anyone debugging a deployment needs a URL they can reach
 * without a terminal, a clone, or Node installed.
 */
function selfCheckRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('selfcheck');
}

export function App(): ReactNode {
  const [tab, setTab] = useState<TabId>('overview');
  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0];
  const selfCheck = selfCheckRequested();

  if (selfCheck) {
    return (
      <div className="app">
        <header className="appbar">
          <h1 className="appbar__title">USA Budget Copilot — self check</h1>
          <p className="appbar__tagline">Diagnostics for this deployment.</p>
          <span className="appbar__spacer" />
          <a className="button" href={window.location.pathname}>
            Back to the app
          </a>
        </header>
        <main className="main">
          <SelfCheckView />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="appbar">
        <h1 className="appbar__title">USA Budget Copilot</h1>
        <p className="appbar__tagline">
          The federal budget, read straight from Treasury and USAspending — with the caveats attached.
        </p>
      </header>

      <nav className="nav" aria-label="Views">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === tab ? 'nav__item is-active' : 'nav__item'}
            aria-current={entry.id === tab ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <main className="main">{active.render()}</main>
    </div>
  );
}
