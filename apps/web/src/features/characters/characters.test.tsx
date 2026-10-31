import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CharacterDraft, type CharacterOptions, type DerivedCharacter, type DerivedValue, emptyDraft, emptyResources, type FeatureUse } from '#shared/characters';
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
    attacks: [],
    currentHitPoints: 13,
    temporaryHitPoints: 0,
    hitDice: [{ classId: 'class.fighter', die: 10, max: 1, spent: 0 }],
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
  masteryWeapons: [
    opt('equipment.longsword', 'Longsword', { category: 'martial', type: 'melee', mastery: 'rule.mastery-sap' }),
    opt('equipment.dagger', 'Dagger', { category: 'simple', type: 'melee', mastery: 'rule.mastery-nick' }),
  ],
  items: [opt('equipment.javelin', 'Javelin', { category: 'weapon' }), opt('equipment.chain-mail', 'Chain Mail', { category: 'armor' })],
  spells: [
    opt('spell.fire-bolt', 'Fire Bolt', { level: 0, classes: ['class.wizard'], concentration: false }),
    opt('spell.detect-magic', 'Detect Magic', { level: 1, classes: ['class.wizard'], concentration: true }),
  ],
  subclasses: [opt('subclass.champion', 'Champion', { class: 'class.fighter' })],
  feats: [opt('feat.ability-score-improvement', 'Ability Score Improvement', { category: 'general', prerequisiteLevel: 4, repeatable: true })],
  armor: { 'equipment.chain-mail': 'heavy' },
  names: { 'equipment.chain-mail': 'Chain Mail', 'species.dwarf': 'Dwarf', 'class.fighter': 'Fighter', 'class.wizard': 'Wizard', 'background.soldier': 'Soldier', 'feat.savage-attacker': 'Savage Attacker', 'rule.mastery-sap': 'Sap', 'rule.mastery-nick': 'Nick' },
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

  it('uses_features_after_confirmation_and_picks_masteries', async () => {
    const draft = { ...emptyDraft(), name: 'Brakka', classId: 'class.fighter' };
    const feature = (over: Partial<FeatureUse>): FeatureUse => ({
      key: 'class.fighter/fighting-style',
      sourceId: 'class.fighter',
      featureId: 'fighting-style',
      level: 1,
      name: 'Fighting Style',
      originalName: 'Fighting Style',
      action: null,
      automation: 'manual',
      resource: null,
      cost: null,
      text: 'You gain a Fighting Style feat of your choice.',
      ...over,
    });
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot },
      characterOptions: options,
      deriveCharacter: fakeDerive,
      characters: {
        'char-1': {
          character: { id: 'char-1', campaignId: 'camp-1', ownerAccountId: 'acc-dm', status: 'final', classLevels: [{ classId: 'class.fighter', level: 1 }], draft, rolls: [], overrides: {}, revision: 3, updatedAt: '' },
          derived: fakeDerive(draft),
          features: [
            feature({}),
            feature({
              key: 'class.fighter/second-wind',
              featureId: 'second-wind',
              name: 'Second Wind',
              originalName: 'Second Wind',
              action: 'bonus-action',
              automation: 'tracked',
              resource: { max: 2, spent: 0, remaining: 2, unit: 'uses', recovery: { short: 'one', long: 'all' } },
              text: 'As a Bonus Action, you can use it to regain Hit Points equal to 1d10 plus your Fighter level.',
            }),
          ],
          masteryGrants: [{ sourceId: 'class.fighter', count: 3, restriction: 'simple-or-martial' }],
          allowedMethods: ['standard-array'],
        },
      },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/characters/char-1');
    const user = userEvent.setup();
    render(<App />);

    const region = await screen.findByRole('region', { name: 'Features and resources' });
    const secondWind = within(region).getByText('Second Wind').closest('li')!;
    expect(within(secondWind).getByText('2 of 2 uses left')).toBeTruthy();
    expect(within(secondWind).getByText(/Short Rest: regain one · Long Rest: regain all/)).toBeTruthy();
    // Fitur naratif: hanya teks, tanpa tombol pakai.
    const style = within(region).getByText('Fighting Style').closest('li')!;
    expect(within(style).queryByRole('button', { name: 'Use' })).toBeNull();
    expect(within(style).getByText('Resolve at the table')).toBeTruthy();

    // Pakai butuh konfirmasi; command baru dikirim setelah dikonfirmasi.
    await user.click(within(secondWind).getByRole('button', { name: 'Use' }));
    expect(fake.requests.some((r) => (r.body as { kind?: string })?.kind === 'character.use-feature')).toBe(false);
    await user.click(within(secondWind).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(fake.requests.map((r) => r.body)).toContainEqual(expect.objectContaining({ kind: 'character.use-feature', payload: { featureKey: 'class.fighter/second-wind' } })),
    );
    expect(await within(region).findByText('1 of 2 uses left')).toBeTruthy();

    const mastery = screen.getByRole('region', { name: 'Weapon Mastery' });
    await user.click(within(mastery).getByRole('checkbox', { name: /Longsword/ }));
    expect(within(mastery).getByText('1 of 3 chosen')).toBeTruthy();
    await user.click(within(mastery).getByRole('button', { name: 'Save weapon mastery' }));
    await waitFor(() =>
      expect(fake.requests.map((r) => r.body)).toContainEqual(expect.objectContaining({ kind: 'character.set-weapon-masteries', payload: { weapons: ['equipment.longsword'] } })),
    );
  });

  it('manages_inventory_spells_and_rests_with_preview', async () => {
    const draft = { ...emptyDraft(), name: 'Ilse', classId: 'class.wizard' };
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot },
      characterOptions: options,
      deriveCharacter: fakeDerive,
      characters: {
        'char-1': {
          character: {
            id: 'char-1',
            campaignId: 'camp-1',
            ownerAccountId: 'acc-dm',
            status: 'final',
            classLevels: [{ classId: 'class.wizard', level: 1 }],
            draft,
            rolls: [],
            overrides: {},
            resources: { ...emptyResources(), initialized: true, inventory: [{ entryId: 'item-1', itemId: 'equipment.javelin', quantity: 2 }], coins: { cp: 0, sp: 3, ep: 0, gp: 5, pp: 0 } },
            revision: 3,
            updatedAt: '',
          },
          derived: { ...fakeDerive(draft), currentHitPoints: 4 },
          spellcasting: {
            classes: [{ classId: 'class.wizard', ability: 'int', saveDc: 13, attackBonus: 5, cantripsMax: 3, preparedMax: 4, maxSpellLevel: 1, cantrips: [], prepared: [] }],
            spellbook: ['spell.detect-magic'],
            slots: [{ level: 1, max: 2, spent: 0, remaining: 2 }],
            pact: null,
            concentration: null,
            issues: [],
          },
          restPolicy: 'players',
          restPreview: { rest: 'long', changes: [{ key: 'hitPoints', before: 4, after: 13 }, { key: 'slot:1', before: 0, after: 2 }] },
          allowedMethods: ['standard-array'],
        },
      },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/characters/char-1');
    const user = userEvent.setup();
    render(<App />);
    const kinds = () =>
      fake.requests.flatMap((r) => {
        const body = r.body as { kind?: string; payload?: unknown } | undefined;
        return body?.kind ? [{ kind: body.kind, payload: body.payload }] : [];
      });

    // Inventory hidup: jumlah dan koin dari resources, bukan paket awal.
    const inventory = await screen.findByRole('region', { name: 'Inventory' });
    expect(within(inventory).getByText('Javelin')).toBeTruthy();
    expect(within(inventory).getByText('×2')).toBeTruthy();
    await user.click(within(inventory).getByRole('button', { name: 'One fewer Javelin' }));
    await waitFor(() => expect(kinds()).toContainEqual({ kind: 'character.adjust-item', payload: { entryId: 'item-1', delta: -1 } }));
    await user.type(within(inventory).getByRole('spinbutton', { name: 'Amount' }), '2');
    await user.click(within(inventory).getByRole('button', { name: 'Spend' }));
    await waitFor(() => expect(kinds()).toContainEqual({ kind: 'character.adjust-coins', payload: { coin: 'gp', delta: -2 } }));

    // Spell: DC/attack dari server; slot dipakai setelah konfirmasi; cantrip dan spellbook dipisah.
    const spells = screen.getByRole('region', { name: 'Spells' });
    expect(within(spells).getByText(/save DC 13 · spell attack \+5/)).toBeTruthy();
    await user.click(within(spells).getByRole('button', { name: 'Use slot' }));
    await user.click(within(spells).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(kinds()).toContainEqual({ kind: 'character.spend-slot', payload: { level: 1 } }));
    await user.click(within(spells).getByText('Choose Wizard spells'));
    await user.click(within(spells).getByRole('checkbox', { name: /Fire Bolt/ }));
    await user.click(within(spells).getAllByRole('checkbox', { name: /Detect Magic/ })[0]!);
    await user.click(within(spells).getByRole('button', { name: 'Save spells' }));
    await waitFor(() =>
      expect(kinds()).toContainEqual({
        kind: 'character.set-spells',
        payload: { spells: [{ classId: 'class.wizard', cantrips: ['spell.fire-bolt'], prepared: ['spell.detect-magic'] }], spellbook: ['spell.detect-magic'] },
      }),
    );

    // Rest: pratinjau dulu, baru dikonfirmasi.
    const vitals = screen.getByRole('region', { name: 'Hit Points and rests' });
    expect(within(vitals).getByText('4 / 13 HP')).toBeTruthy();
    await user.click(within(vitals).getByRole('button', { name: 'Long Rest…' }));
    const preview = await within(vitals).findByRole('group', { name: 'Long Rest preview' });
    expect(within(preview).getByText(/Hit Points:/).parentElement?.textContent).toContain('4 → 13');
    expect(within(preview).getByText(/Level 1 slots:/)).toBeTruthy();
    expect(kinds().some((b) => b.kind === 'character.rest')).toBe(false);
    await user.click(within(preview).getByRole('button', { name: 'Finish rest' }));
    await waitFor(() => expect(kinds()).toContainEqual({ kind: 'character.rest', payload: { rest: 'long' } }));
  });

  it('levels_up_after_reviewing_before_and_after', async () => {
    const draft = { ...emptyDraft(), name: 'Brakka', classId: 'class.fighter' };
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot },
      characterOptions: options,
      deriveCharacter: fakeDerive,
      characters: {
        'char-1': {
          character: {
            id: 'char-1',
            campaignId: 'camp-1',
            ownerAccountId: 'acc-dm',
            status: 'final',
            classLevels: [{ classId: 'class.fighter', level: 2 }],
            draft,
            rolls: [],
            overrides: {},
            resources: { ...emptyResources(), initialized: true },
            revision: 3,
            updatedAt: '',
          },
          derived: fakeDerive(draft),
          advancement: { mode: 'milestone', xp: 0, nextLevelXp: 900, levelsGranted: 1, startingLevel: 1, canAdvance: true },
          advancementPreview: {
            choice: { classId: 'class.fighter', hp: 'fixed' },
            level: 3,
            classLevel: 3,
            multiclass: false,
            hpDie: 6,
            hitDie: 10,
            required: ['subclass'],
            featCategory: null,
            newFeatures: [{ key: 'subclass.champion/improved-critical', name: 'Improved Critical' }],
            issues: [],
            before: { level: 2, proficiencyBonus: 2, hitPoints: 22, slots: [], pact: null },
            after: { level: 3, proficiencyBonus: 2, hitPoints: 31, slots: [], pact: null },
          },
          allowedMethods: ['standard-array'],
        },
      },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/characters/char-1');
    const user = userEvent.setup();
    render(<App />);

    const card = await screen.findByRole('region', { name: 'Level up' });
    expect(within(card).getByText('Milestone levels from the DM: 1')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Level up to 3…' }));
    const preview = await within(card).findByRole('group', { name: 'Before and after' });
    expect(within(preview).getByText('22 → 31')).toBeTruthy();
    expect(within(preview).getByText('Still to choose: subclass')).toBeTruthy();
    // Pilihan wajib belum lengkap: tombol terapkan nonaktif.
    expect((within(card).getByRole('button', { name: 'Apply level up' }) as HTMLButtonElement).disabled).toBe(true);

    // Pilih subclass → draft disimpan, pratinjau baru tanpa pilihan wajib.
    fake.state.characters['char-1']!.advancementPreview = { ...fake.state.characters['char-1']!.advancementPreview!, required: [] };
    await user.selectOptions(within(card).getByRole('combobox', { name: 'Subclass' }), 'subclass.champion');
    await waitFor(() =>
      expect(fake.requests.map((r) => r.body)).toContainEqual(
        expect.objectContaining({ kind: 'character.save-advancement-draft', payload: { choice: { classId: 'class.fighter', hp: 'fixed', subclassId: 'subclass.champion' } } }),
      ),
    );
    await waitFor(() => expect((within(card).getByRole('button', { name: 'Apply level up' }) as HTMLButtonElement).disabled).toBe(false));
    expect(within(card).getByText('Improved Critical')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Apply level up' }));
    await waitFor(() =>
      expect(fake.requests.map((r) => r.body)).toContainEqual(
        expect.objectContaining({ kind: 'character.advance', payload: { choice: { classId: 'class.fighter', hp: 'fixed', subclassId: 'subclass.champion' } } }),
      ),
    );
  });
});
