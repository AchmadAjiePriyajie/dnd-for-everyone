import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CharacterDraft, type CharacterOptions, type DerivedCharacter, type DerivedValue, emptyDraft } from '#shared/characters';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const dv = (value: number, contributions: DerivedValue['contributions'] = [{ source: 'base', value }]): DerivedValue => ({
  base: value,
  value,
  override: null,
  contributions,
});

/** Derivasi palsu: cukup untuk menguji tampilan; aturan sebenarnya diuji di packages/rules. */
function fakeDerive(draft: CharacterDraft): DerivedCharacter {
  const ability = { score: dv(10), modifier: 0 };
  const issues: DerivedCharacter['issues'] = [];
  if (!draft.name.trim()) issues.push({ field: 'name', code: 'REQUIRED' });
  if (!draft.classId) issues.push({ field: 'classId', code: 'REQUIRED' });
  return {
    level: 1,
    proficiencyBonus: 2,
    abilities: { str: { score: dv(17, [{ source: 'base', value: 15 }, { source: 'background.soldier', value: 2 }]), modifier: 3 }, dex: ability, con: ability, int: ability, wis: ability, cha: ability },
    savingThrows: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [a, { proficient: a === 'str', bonus: dv(a === 'str' ? 5 : 0) }])) as DerivedCharacter['savingThrows'],
    skills: {} as DerivedCharacter['skills'],
    armorClass: dv(16, [{ source: 'equipment.chain-mail', value: 16 }]),
    hitPoints: dv(13, [{ source: 'class.fighter', value: 10 }, { source: 'rule.ability-modifier', detail: 'con', value: 2 }, { source: 'species.dwarf', value: 1 }]),
    initiative: dv(1, [{ source: 'rule.ability-modifier', detail: 'dex', value: 1 }]),
    speed: dv(30, [{ source: 'species.dwarf', value: 30 }]),
    passivePerception: dv(13),
    darkvision: 120,
    armorTraining: ['light', 'medium', 'heavy', 'shield'],
    weaponProficiencies: { categories: ['simple', 'martial'], martialWithProperty: [] },
    tools: [],
    languages: ['Common', 'Dwarvish', 'Giant'],
    feats: ['feat.savage-attacker'],
    inventory: [{ id: 'equipment.chain-mail', quantity: 1, sources: ['class.fighter'] }],
    gp: 54,
    warnings: [],
    issues,
  };
}

const opt = (id: string, name: string, mechanics: Record<string, unknown> = {}) => ({ id, name, originalName: name, translation: 'translated' as const, mechanics });
const options: CharacterOptions = {
  species: [opt('species.dwarf', 'Dwarf', { size: ['medium'], speed: 30 })],
  backgrounds: [opt('background.soldier', 'Soldier', { abilityScores: ['str', 'dex', 'con'], feat: 'feat.savage-attacker', skills: ['athletics', 'intimidation'], toolProficiencies: { fixed: [], choices: [] }, startingEquipment: [{ option: 'A', items: [], gp: 14 }, { option: 'B', items: [], gp: 50 }] })],
  classes: [opt('class.fighter', 'Fighter', { hitDie: 10, savingThrows: ['str', 'con'], skillChoices: { count: 2, from: ['athletics', 'perception'] }, armorTraining: [], weaponProficiencies: { categories: [] }, startingEquipment: [{ option: 'A', items: [{ id: 'equipment.chain-mail', quantity: 1 }], gp: 4 }] })],
  originFeats: [opt('feat.alert', 'Alert')],
  languages: ['Dwarvish', 'Giant'],
  artisanTools: [],
  allowedMethods: ['standard-array', 'point-buy'],
  armor: { 'equipment.chain-mail': 'heavy' },
  names: { 'equipment.chain-mail': 'Chain Mail', 'species.dwarf': 'Dwarf', 'class.fighter': 'Fighter', 'background.soldier': 'Soldier', 'feat.savage-attacker': 'Savage Attacker' },
};

const snapshot: RoomSnapshot = {
  campaignId: 'camp-1',
  eventSequence: 1,
  campaign: { id: 'camp-1', title: 'Lost Mine', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: 'acc-dm', role: 'player' },
  members: [{ accountId: 'acc-dm', username: 'dungeon_master', role: 'player' }],
  characters: [],
};

let fake: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/campaigns/camp-1');
  setLocale('en');
  // Socket tersambung agar command diizinkan (aksi saat terputus ditolak client).
  configureRoomStore({
    createSocket: () => {
      const socket = new FakeSocket();
      socket.connected = true;
      return socket;
    },
  });
});

afterEach(() => {
  fake?.restore();
  resetRoomStore();
});

describe('character wizard', () => {
  it('saves_draft_keeps_input_on_locale_switch_and_explains_numbers', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot }, characterOptions: options, deriveCharacter: fakeDerive });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Create character' }));
    const name = await screen.findByRole('textbox', { name: 'Character name' });
    await waitFor(() => expect(fake.requests.some((r) => r.method === 'POST' && (r.body as { kind?: string })?.kind === 'character.create')).toBe(true));
    await user.type(name, 'Brakka');
    await user.type(screen.getByRole('textbox', { name: 'Concept' }), 'Former caravan guard');

    // Autosave mengirim draft lewat command, bukan localStorage.
    await waitFor(() => {
      const saves = fake.requests.filter((r) => (r.body as { kind?: string })?.kind === 'character.save-draft');
      expect((saves.at(-1)?.body as { payload: { draft: CharacterDraft } })?.payload.draft).toMatchObject({ name: 'Brakka', concept: 'Former caravan guard' });
    });
    expect(await screen.findByText('All changes saved')).toBeTruthy();

    // Ganti bahasa di tengah wizard: input tetap sama.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'id');
    expect((screen.getByRole('textbox', { name: 'Nama karakter' }) as HTMLInputElement).value).toBe('Brakka');
    expect((screen.getByRole('textbox', { name: 'Konsep' }) as HTMLTextAreaElement).value).toBe('Former caravan guard');

    // Langkah class memakai opsi corpus; pilihan tersimpan.
    await user.click(screen.getByRole('tab', { name: 'Class' }));
    await user.click(screen.getByRole('radio', { name: /Fighter/ }));
    await waitFor(() => expect(Object.values(fake.state.characters)[0]!.character.draft.classId).toBe('class.fighter'));

    // Review menunjukkan masalah dari server dalam bahasa aktif dan menahan finalisasi.
    await user.click(screen.getByRole('tab', { name: 'Konsep' }));
    await user.clear(screen.getByRole('textbox', { name: 'Nama karakter' }));
    await waitFor(() => expect(Object.values(fake.state.characters)[0]!.character.draft.name).toBe(''));
    await user.click(screen.getByRole('tab', { name: 'Tinjau' }));
    const review = await screen.findByRole('region', { name: 'Tinjau' });
    expect(await within(review).findByText('Nama karakter wajib diisi.')).toBeTruthy();
    expect((within(review).getByRole('button', { name: 'Finalisasi karakter' }) as HTMLButtonElement).disabled).toBe(true);

    // Setelah lengkap, finalisasi lewat command dan sheet ditampilkan.
    await user.click(screen.getByRole('tab', { name: 'Konsep' }));
    await user.type(screen.getByRole('textbox', { name: 'Nama karakter' }), 'Brakka');
    await user.click(screen.getByRole('tab', { name: 'Tinjau' }));
    const ready = await screen.findByRole('region', { name: 'Tinjau' });
    await waitFor(() => expect((within(ready).getByRole('button', { name: 'Finalisasi karakter' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(ready).getByRole('button', { name: 'Finalisasi karakter' }));
    expect(await screen.findByRole('article', { name: 'Brakka' })).toBeTruthy();
    expect(fake.requests.some((r) => (r.body as { kind?: string })?.kind === 'character.finalize')).toBe(true);
  });

  it('shows_where_each_number_comes_from', async () => {
    const draft = { ...emptyDraft(), name: 'Brakka', classId: 'class.fighter', speciesId: 'species.dwarf', backgroundId: 'background.soldier' };
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot },
      characterOptions: options,
      deriveCharacter: fakeDerive,
      characters: {
        'char-1': {
          character: { id: 'char-1', campaignId: 'camp-1', ownerAccountId: 'acc-dm', status: 'final', classLevels: [{ classId: 'class.fighter', level: 1 }], draft, rolls: [], overrides: {}, revision: 3, updatedAt: '' },
          derived: fakeDerive(draft),
          allowedMethods: ['standard-array'],
        },
      },
    });
    setLocale('id');
    window.history.replaceState(null, '', '/campaigns/camp-1/characters/char-1');
    render(<App />);

    const sheet = await screen.findByRole('article', { name: 'Brakka' });
    const ac = within(sheet).getByRole('group', { name: 'Armor Class' });
    // Total di atas; rincian sumber di bawahnya (nilai dasar tanpa tanda, tambahan bertanda).
    expect(ac.querySelector('.stat-value')?.textContent).toBe('16');
    expect(within(ac).getByText('Chain Mail')).toBeTruthy();
    const hp = within(sheet).getByRole('group', { name: 'Hit Points' });
    expect(within(hp).getByText('Fighter')).toBeTruthy();
    expect(within(hp).getByText('Modifier Constitution')).toBeTruthy();
    expect(within(hp).getByText('+2')).toBeTruthy();
    expect(within(sheet).getByText('Dwarvish')).toBeTruthy();
    // Sheet final tidak menawarkan wizard; player tidak melihat alat DM.
    expect(screen.queryByRole('tab', { name: 'Class' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Alat DM' })).toBeNull();
  });

  it('lets_the_dm_transfer_and_correct_numbers', async () => {
    const draft = { ...emptyDraft(), name: 'Brakka', classId: 'class.fighter' };
    fake = installFakeApi({
      snapshots: {
        'camp-1': {
          ...snapshot,
          you: { accountId: 'acc-dm', role: 'dm' },
          members: [
            { accountId: 'acc-dm', username: 'dungeon_master', role: 'dm' },
            { accountId: 'acc-alice', username: 'alice', role: 'player' },
            { accountId: 'acc-bob', username: 'bob', role: 'player' },
          ],
          dm: { invites: [] },
        },
      },
      characterOptions: options,
      deriveCharacter: fakeDerive,
      characters: {
        'char-1': {
          character: { id: 'char-1', campaignId: 'camp-1', ownerAccountId: 'acc-alice', status: 'final', classLevels: [{ classId: 'class.fighter', level: 1 }], draft, rolls: [], overrides: {}, revision: 3, updatedAt: '' },
          derived: fakeDerive(draft),
          allowedMethods: ['standard-array'],
        },
      },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/characters/char-1');
    const user = userEvent.setup();
    render(<App />);

    const tools = await screen.findByRole('region', { name: 'DM tools' });
    await user.selectOptions(within(tools).getByRole('combobox', { name: 'New owner' }), 'acc-bob');
    await user.click(within(tools).getByRole('button', { name: 'Transfer character' }));
    await waitFor(() => expect(fake.requests.map((r) => r.body)).toContainEqual(expect.objectContaining({ kind: 'character.transfer', payload: { toAccountId: 'acc-bob' } })));

    await user.type(within(tools).getByRole('spinbutton', { name: 'Armor Class' }), '18');
    await user.click(within(tools).getByRole('button', { name: 'Save corrections' }));
    await waitFor(() => expect(fake.requests.map((r) => r.body)).toContainEqual(expect.objectContaining({ kind: 'character.set-override', payload: { field: 'armorClass', value: 18 } })));
  });
});
