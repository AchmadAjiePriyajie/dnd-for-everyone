import { useTranslation } from 'react-i18next';
import { ABILITIES, type Contribution, type DerivedWarning, type DraftIssue, SKILLS } from '#shared/characters';
import type { Id } from '#shared/contracts';

const isAbility = (value: unknown): value is (typeof ABILITIES)[number] => (ABILITIES as readonly unknown[]).includes(value);
const isSkill = (value: unknown): value is (typeof SKILLS)[number] => (SKILLS as readonly unknown[]).includes(value);

/** Label sheet/wizard pada locale aktif; judul entri corpus diambil dari `names`. */
export function useCharacterLabels(names: Record<Id, string>) {
  const { t } = useTranslation();
  const ability = (key: string) => t(`character.ability.${key}`);
  const skill = (key: string) => t(`character.skill.${key}`);
  const name = (id: Id) => names[id] ?? id;
  const valueLabel = (value: unknown) =>
    isAbility(value) ? ability(value) : isSkill(value) ? skill(value) : typeof value === 'string' ? name(value) : String(value ?? '');

  return {
    ability,
    skill,
    name,
    signed: (value: number) => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`),
    source(contribution: Contribution): string {
      switch (contribution.source) {
        case 'base':
          return t('character.source.base');
        case 'rule.base-ac':
          return t('character.source.unarmored');
        case 'rule.proficiency':
          return t('character.source.proficiency');
        case 'rule.passive':
          return t('character.source.passive');
        case 'rule.ability-modifier':
          return t('character.source.abilityModifier', { ability: ability(contribution.detail ?? '') });
        case 'override':
          return t('character.source.override');
        default:
          return name(contribution.source);
      }
    },
    issue(issue: DraftIssue): string {
      const field = t(`character.field.${issue.field}`);
      if (issue.params && 'cost' in issue.params) return t('character.issue.POINT_BUY', { cost: issue.params.cost, budget: issue.params.budget });
      if (issue.code === 'COUNT') return t('character.issue.COUNT', { field, expected: issue.params?.expected ?? 0 });
      if (issue.code === 'INVALID' && issue.params?.value !== undefined) {
        return t('character.issue.INVALID_VALUE', { field, value: valueLabel(issue.params.value) });
      }
      return t(`character.issue.${issue.code}`, { field });
    },
    warning(warning: DerivedWarning): string {
      return t(`character.warning.${warning.code}`, {
        armor: name(String(warning.params.armor ?? '')),
        feat: name(String(warning.params.feat ?? '')),
        strength: warning.params.strength ?? 0,
      });
    },
  };
}
