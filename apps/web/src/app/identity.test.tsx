import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionOption } from '#shared/combat';
import en from '../locales/en/common.json';
import id from '../locales/id/common.json';
import { installFakeApi } from '../test/fake-api';
import { actionIcon } from './action-icons';
import { App } from './App';
import { FANTASY_ICON_CREDITS } from './fantasy-icons';
import { setLocale } from './i18n';
import { resetRoomStore } from './room-store';

let fake: ReturnType<typeof installFakeApi>;
beforeEach(() => { localStorage.clear(); setLocale('en'); });
afterEach(() => { fake?.restore(); resetRoomStore(); });

const option = (over: Partial<ActionOption>): ActionOption => ({
  id: 'x', kind: 'spell', name: 'X', originalName: 'X', sourceId: 'spell.x', cost: 'action', damage: [], automation: 'manual', notes: [], text: '', ...over,
});
const spell = (school: string) => ({ level: 1, school, concentration: false, duration: '', upcastDice: null, upcastTarget: null, upcastManual: false });

describe('product identity and icons', () => {
  it('names_the_product_campfire_tales_without_trademarks', async () => {
    window.history.replaceState(null, '', '/');
    fake = installFakeApi();
    render(<App />);
    expect(await screen.findByRole('link', { name: /Campfire Tales/ })).toBeTruthy();
    expect(document.title).toBe('Campfire Tales');
    expect(document.body.textContent).not.toMatch(/D&D|DND|Dungeons/);
    setLocale('id');
    expect(await screen.findByRole('link', { name: /Campfire Tales/ })).toBeTruthy();
    // No UI string in either locale uses the D&D trademarks (SRD attribution on Credits is the only legal mention).
    const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Object.values(value as object).flatMap(strings);
    for (const catalog of [en, id]) expect(strings({ ...catalog, credits: {} }).filter((text) => /D&D|DND|Dungeons/.test(text))).toEqual([]);
  });

  it('maps_actions_to_fantasy_icons_by_kind', () => {
    expect(actionIcon(option({ damage: [{ dice: '8d6', average: null, type: 'fire' }], spell: spell('evocation') }))).toBe('fire');
    expect(actionIcon(option({ heal: { dice: '2d8', bonus: 3 } }))).toBe('heal');
    expect(actionIcon(option({ cost: 'reaction' }))).toBe('reaction');
    expect(actionIcon(option({ spell: spell('evocation') }))).toBe('evocation');
    expect(actionIcon(option({ kind: 'weapon', damage: [{ dice: '1d8', average: null, type: 'piercing' }] }))).toBe('pierce');
    expect(actionIcon(option({ kind: 'multiattack' }))).toBe('multiattack');
    expect(actionIcon(option({ kind: 'feature' }))).toBe('feature');
    expect(actionIcon(option({ kind: 'monster' }))).toBe('monster');
    expect(actionIcon(option({}))).toBe('action');
  });

  it('credits_icon_and_rules_licenses', async () => {
    window.history.replaceState(null, '', '/credits');
    fake = installFakeApi();
    render(<App />);
    const page = await screen.findByRole('region', { name: 'Credits' });
    for (const text of ['game-icons.net', 'CC BY 3.0', 'SRD 5.2.1', 'CC BY 4.0']) expect(page.textContent).toContain(text);
    for (const author of new Set(FANTASY_ICON_CREDITS.map((credit) => credit.author))) expect(page.textContent).toContain(author);
  });
});
