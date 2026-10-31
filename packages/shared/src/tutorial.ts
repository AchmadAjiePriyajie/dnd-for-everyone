import type { Id } from './contracts.js';

/** One help pointer of the tutorial guide; `link` names an existing page, never a tutorial-only screen. */
export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  link: { page: 'room' | 'notes' | 'combat' | 'encounters' | 'session' | 'scenes' | 'reference'; target?: Id };
}
export interface TutorialGuide { campaignId: Id; steps: TutorialStep[] }
