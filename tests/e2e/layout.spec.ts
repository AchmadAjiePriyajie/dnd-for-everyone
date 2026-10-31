import { expect, type Page, test } from '@playwright/test';
import { seedTable } from './seed';

const LONG_NAME = 'Vellandriel Ashcombe of the Ninefold Lantern and Quiet Rivers';

async function noHorizontalOverflow(page: Page, where: string) {
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(sizes.scroll, `${where}: page is ${sizes.scroll}px wide in a ${sizes.width}px viewport`).toBeLessThanOrEqual(sizes.width);
}

test('no_horizontal_overflow_in_en_and_id', async ({ browser, baseURL }) => {
  const table = await seedTable(browser, baseURL!, { characterName: LONG_NAME.slice(0, 60), scene: true });
  await table.command('dm', `session-${table.run}`, 'session.start', { title: 'The old mill' });
  const name = LONG_NAME.slice(0, 60);
  for (const locale of ['en', 'id'] as const) {
    for (const api of [table.dmApi, table.playerApi]) expect((await api('PUT', '/api/auth/me/locale', { locale })).status).toBe(200);
    for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) {
      const dmPage = await table.dm.newPage();
      const playerPage = await table.player.newPage();
      for (const page of [dmPage, playerPage]) await page.setViewportSize(viewport);
      const where = (page: string) => `${locale} ${viewport.width}px ${page}`;

      await dmPage.goto(`/campaigns/${table.campaignId}`);
      await expect(dmPage.getByRole('tablist', { name: locale === 'en' ? 'Campaign sections' : 'Bagian campaign' })).toBeVisible();
      await noHorizontalOverflow(dmPage, where('room'));

      for (const [page, who] of [[dmPage, 'DM'], [playerPage, 'player']] as const) {
        await page.goto(`/campaigns/${table.campaignId}/combat`);
        if (viewport.width < 768) {
          await expect(page.getByRole('tablist', { name: locale === 'en' ? 'Combat sections' : 'Bagian combat' })).toBeVisible();
          await page.getByRole('tab', { name: locale === 'en' ? 'Turn' : 'Giliran' }).click();
        } else {
          await expect(page.getByRole('region', { name: locale === 'en' ? 'Turn order' : 'Urutan turn' })).toBeVisible();
          await expect(page.getByRole('region', { name: locale === 'en' ? 'Battle map' : 'Peta pertempuran' })).toBeVisible();
          if (who === 'DM') await expect(page.getByRole('region', { name: locale === 'en' ? 'Action bar' : 'Hotbar aksi' })).toBeVisible();
        }
        await expect(page.getByRole('button', { name, exact: true }).first()).toHaveAttribute('title', name);
        await noHorizontalOverflow(page, where(`combat ${who}`));
      }

      await playerPage.goto(`/campaigns/${table.campaignId}/characters/${table.characterId}`);
      await expect(playerPage.getByRole('tablist', { name: locale === 'en' ? 'Character sections' : 'Bagian karakter' })).toBeVisible();
      await noHorizontalOverflow(playerPage, where('character sheet'));
      await playerPage.goto(`/campaigns/${table.campaignId}/session`);
      await expect(playerPage.getByRole('heading', { level: 2, name: locale === 'en' ? /Session 1/ : /Sesi 1/ })).toBeVisible();
      await noHorizontalOverflow(playerPage, where('session'));
      await dmPage.close(); await playerPage.close();
    }
  }
  await table.dm.close(); await table.player.close();
});
