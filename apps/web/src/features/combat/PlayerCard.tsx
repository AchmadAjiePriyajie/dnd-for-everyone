import { useTranslation } from 'react-i18next';
import type { CombatantView } from '#shared/combat';
import { Link, routePath } from '../../app/router';
import { CombatantSummary } from './TurnOrder';

/** The player's own creature at a glance; the full sheet (slots, AC, inventory) is one link away. */
export function PlayerCard({ creature, campaignId }: { creature: CombatantView; campaignId: string }) {
  const { t } = useTranslation();
  return <section className="card player-card" aria-label={t('screen.yourCharacter', { name: creature.name })}>
    <h2 title={creature.name}>{creature.name}</h2>
    <CombatantSummary creature={creature} />
    {creature.characterId ? <Link href={routePath.character(campaignId, creature.characterId)}>{t('screen.openSheet')}</Link> : null}
  </section>;
}
