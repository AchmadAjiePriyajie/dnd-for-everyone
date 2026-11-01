import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

/** ARIA tabs for long pages; the chosen tab is remembered per label in this browser only. */
export function Tabs({ label, tabs, initial }: { label: string; tabs: Array<{ id: string; label: string; content: ReactNode }>; initial?: string }) {
  const id = useId();
  const storageKey = `tabs:${label}`;
  const [selected, setSelected] = useState(() => {
    const saved = read(storageKey);
    return tabs.some((tab) => tab.id === saved) ? saved! : initial ?? tabs[0]?.id ?? '';
  });
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  const choose = (tabId: string) => { setSelected(tabId); write(storageKey, tabId); };
  const keys = (event: KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === active?.id);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length]!;
    choose(tab.id);
    document.getElementById(`${id}-tab-${tab.id}`)?.focus();
  };
  return <div className="page-tabs">
    <div role="tablist" aria-label={label} className="side-tabs" onKeyDown={keys}>
      {tabs.map((tab) => <button key={tab.id} id={`${id}-tab-${tab.id}`} type="button" role="tab" aria-selected={tab.id === active?.id} aria-controls={`${id}-panel-${tab.id}`}
        tabIndex={tab.id === active?.id ? 0 : -1} onClick={() => choose(tab.id)}>{tab.label}</button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} id={`${id}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.id}`} hidden={tab.id !== active?.id}>{tab.content}</div>)}
  </div>;
}
