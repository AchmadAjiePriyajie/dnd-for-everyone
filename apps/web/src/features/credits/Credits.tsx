import { useTranslation } from 'react-i18next';
import { FANTASY_ICON_CREDITS, FANTASY_ICON_SOURCE, FantasyIcon } from '../../app/fantasy-icons';

/** Attribution required by the icon (CC BY 3.0) and rules (CC BY 4.0) licenses. */
export function Credits() {
  const { t } = useTranslation();
  const authors = [...new Set(FANTASY_ICON_CREDITS.map((credit) => credit.author))];
  return <section className="card credits" aria-label={t('credits.title')}>
    <h1>{t('credits.title')}</h1>
    <h2>{t('credits.rules')}</h2>
    <p>{t('credits.srd')}</p>
    <h2>{t('credits.icons')}</h2>
    <p>{t('credits.iconsBody', { site: FANTASY_ICON_SOURCE.site, license: FANTASY_ICON_SOURCE.license })} <a href={FANTASY_ICON_SOURCE.url} rel="noreferrer">{FANTASY_ICON_SOURCE.url}</a></p>
    <p>{authors.join(', ')}</p>
    <ul className="credits-icons">{FANTASY_ICON_CREDITS.map((credit) => <li key={credit.name}><FantasyIcon name={credit.name} /> {credit.id}</li>)}</ul>
    <h2>{t('credits.fonts')}</h2>
    <p>{t('credits.fontsBody')}</p>
  </section>;
}
