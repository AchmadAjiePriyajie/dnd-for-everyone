import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Id, Locale } from '#shared/contracts';
import type { TutorialStep } from '#shared/tutorial';
import { api } from '../../app/api';
import { Link, routePath } from '../../app/router';

const key = (campaignId: Id) => `tutorial-hidden:${campaignId}`;
const read = (campaignId: Id) => { try { return localStorage.getItem(key(campaignId)) === '1'; } catch { return false; } };
const write = (campaignId: Id, hidden: boolean) => { try { if (hidden) localStorage.setItem(key(campaignId), '1'); else localStorage.removeItem(key(campaignId)); } catch { /* storage unavailable */ } };

export function stepHref(campaignId: Id, step: TutorialStep): string {
  const { page, target } = step.link;
  if (page === 'notes') return routePath.notes(campaignId, target);
  if (page === 'reference') return target ? `${routePath.reference(campaignId)}?entry=${encodeURIComponent(target)}` : routePath.reference(campaignId);
  if (page === 'room') return routePath.campaign(campaignId);
  return routePath[page](campaignId);
}

/** Help pointers of the tutorial adventure, in the viewer's language; every link opens a real page. */
export function TutorialGuide({ campaignId }: { campaignId: Id }) {
  const { t, i18n } = useTranslation();
  const [steps, setSteps] = useState<TutorialStep[] | null>(null);
  const [hidden, setHidden] = useState(() => read(campaignId));
  const locale = i18n.language as Locale;
  useEffect(() => {
    let cancelled = false;
    api.tutorialGuide(campaignId, locale).then((guide) => { if (!cancelled) setSteps(guide.steps); }, () => { if (!cancelled) setSteps(null); });
    return () => { cancelled = true; };
  }, [campaignId, locale]);
  if (!steps) return null;
  const toggle = (next: boolean) => { setHidden(next); write(campaignId, next); };
  if (hidden) return <p><button type="button" className="small" onClick={() => toggle(false)}>{t('tutorial.show')}</button></p>;
  return <section className="card tutorial-guide" aria-label={t('tutorial.guide')}>
    <h2>{t('tutorial.guide')}</h2>
    <p className="small muted">{t('tutorial.guideHelp')}</p>
    <ol>{steps.map((step) => <li key={step.id}>
      <Link href={stepHref(campaignId, step)}><strong>{step.title}</strong></Link>
      <p className="small">{step.body}</p>
    </li>)}</ol>
    <button type="button" onClick={() => toggle(true)}>{t('tutorial.hide')}</button>
  </section>;
}
