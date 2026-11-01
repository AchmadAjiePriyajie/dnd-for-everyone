import { type ReactNode, useId, useState } from 'react';

export interface MobileTab { id: 'map' | 'character' | 'actions' | 'turn' | 'more'; label: string; content: ReactNode }

/** Phone layout: one section fills the screen, tabs stay at the bottom; panels stay mounted to keep drafts. */
export function MobileTabs({ label, tabs }: { label: string; tabs: MobileTab[] }) {
  const id = useId();
  const [selected, setSelected] = useState<MobileTab['id']>('map');
  return <div className="mobile-tabs">
    {tabs.map((tab) => <div key={tab.id} id={`${id}-${tab.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.id}`} hidden={tab.id !== selected} className="mobile-panel">{tab.content}</div>)}
    <div role="tablist" aria-label={label} className="mobile-tablist">
      {tabs.map((tab) => <button key={tab.id} id={`${id}-tab-${tab.id}`} type="button" role="tab" aria-selected={tab.id === selected} aria-controls={`${id}-${tab.id}`} onClick={() => setSelected(tab.id)}>{tab.label}</button>)}
    </div>
  </div>;
}
