import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { CheatSheetRow } from '#shared/notes';
import { Icon } from '../../app/icons';

/** Ringkasan party untuk DM dari projection server (snapshot player tidak memuatnya). */
export function DmCheatSheet({ rows }: { rows: CheatSheetRow[] }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className="card dm-tools" aria-labelledby={`${id}-heading`}>
      <p className="eyebrow">
        <Icon name="crown" />
        {t('room.dmTools')}
      </p>
      <h2 id={`${id}-heading`}>{t('notes.cheatSheet.title')}</h2>
      {rows.length === 0 ? (
        <p className="muted">{t('notes.cheatSheet.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="cheat-sheet">
            <thead>
              <tr>
                <th scope="col">{t('notes.cheatSheet.name')}</th>
                <th scope="col">{t('character.stat.armorClass')}</th>
                <th scope="col">{t('character.stat.passivePerception')}</th>
                <th scope="col">{t('character.stat.hitPoints')}</th>
                <th scope="col">{t('notes.cheatSheet.resources')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.characterId}>
                  <th scope="row">{row.name}</th>
                  <td className="mono">{row.armorClass}</td>
                  <td className="mono">{row.passivePerception}</td>
                  <td className="mono">
                    {row.hitPoints.current}/{row.hitPoints.max}
                    {row.hitPoints.temp > 0 && ` (+${row.hitPoints.temp})`}
                  </td>
                  <td>
                    <ul className="inline-list">
                      {row.resources.map((resource) => (
                        <li key={resource.key}>
                          {resource.name} {resource.remaining}/{resource.max}
                        </li>
                      ))}
                      {row.concentration && <li>{t('notes.cheatSheet.concentrating')}</li>}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
