import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { noteDraftSchema } from '#shared/notes';
import { defaultContentDir } from './catalog.ts';

const step = z.strictObject({
  id: z.string().min(1), title: z.string().min(1), body: z.string().min(1),
  link: z.strictObject({ page: z.enum(['room', 'notes', 'combat', 'encounters', 'session', 'scenes', 'reference']), target: z.string().min(1).optional() }),
});
const note = noteDraftSchema.omit({ links: true, scene: true, quest: true, visibility: true }).extend({
  id: z.string().regex(/^tutorial-[a-z0-9-]+$/), visibility: z.enum(['party', 'dm']), links: z.array(z.string()),
  scene: noteDraftSchema.shape.scene.optional(), quest: noteDraftSchema.shape.quest.optional(),
}).strict();
export const tutorialSchema = z.strictObject({
  title: z.string().min(1).max(120),
  notes: z.array(note).min(1),
  scene: z.strictObject({ id: z.string(), name: z.string().min(1), tokens: z.array(z.strictObject({ id: z.string(), label: z.string(), x: z.number().int(), y: z.number().int() })) }),
  encounter: z.strictObject({ id: z.string(), name: z.string().min(1), notes: z.string() }),
  guide: z.strictObject({ dm: z.array(step).min(1), player: z.array(step).min(1) }),
});
export type TutorialContent = z.infer<typeof tutorialSchema>;

/** Original tutorial adventure in one locale (data/tutorial/<locale>.json), validated on load. */
export function loadTutorial(locale: 'en' | 'id', contentDir = defaultContentDir): TutorialContent {
  return tutorialSchema.parse(JSON.parse(readFileSync(join(contentDir, 'data', 'tutorial', `${locale}.json`), 'utf8')));
}
