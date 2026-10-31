import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react';

export interface SideTab { id: string; label: string; badge?: number; attention?: boolean; content: ReactNode }

/** ARIA tabs; a tab that needs attention (e.g. a waiting reaction) is selected when it starts needing it. */
export function SidePanel({ label, tabs, initial }: { label: string; tabs: SideTab[]; initial?: string }) {
  const id = useId();
  const [selected, setSelected] = useState(initial ?? tabs[0]?.id ?? '');
  const attention = tabs.find((tab) => tab.attention)?.id;
  useEffect(() => { if (attention) setSelected(attention); }, [attention]);
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  const keys = (event: KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === active?.id);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length]!;
    setSelected(tab.id);
    document.getElementById(`${id}-tab-${tab.id}`)?.focus();
  };
  return <div className="side-panel">
    <div role="tablist" aria-label={label} className="side-tabs" onKeyDown={keys}>
      {tabs.map((tab) => <button key={tab.id} id={`${id}-tab-${tab.id}`} type="button" role="tab" aria-selected={tab.id === active?.id} aria-controls={`${id}-panel-${tab.id}`}
        tabIndex={tab.id === active?.id ? 0 : -1} className={tab.attention ? 'needs-attention' : undefined} onClick={() => setSelected(tab.id)}>
        {tab.label}{tab.badge ? <span className="badge">{tab.badge}</span> : null}
      </button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} id={`${id}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.id}`} hidden={tab.id !== active?.id} className="side-tabpanel">
      {tab.content}
    </div>)}
  </div>;
}
