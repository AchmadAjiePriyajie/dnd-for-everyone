import type { Id } from './contracts.js';
import type { InviteView, MemberView, Role } from './access.js';
import type { CharacterSummary } from './characters.js';
import type { CheatSheetRow, NoteSummary } from './notes.js';
import type { SceneSummary } from './scenes.js';
import type { CombatView, Resolution, RollRecord } from './combat.js';
import type { SessionSummary } from './sessions.js';

/**
 * Projection room per peserta. Field khusus DM berada di `dm` dan tidak pernah
 * ada pada snapshot player. Diperluas bersama fitur berikutnya.
 */
export interface RoomSnapshot {
  campaignId: Id;
  eventSequence: number;
  campaign: { id: Id; title: string; ruleset: string };
  you: { accountId: Id; role: Role };
  members: MemberView[];
  /** Ringkasan karakter campaign; sheet penuh hanya untuk pemilik dan DM. */
  characters?: CharacterSummary[];
  /** Catatan yang boleh dilihat peserta ini (judul saja; isi lewat GET notes/:id). */
  notes?: NoteSummary[];
  /** Scene yang boleh dilihat peserta (token lewat GET scenes/:id). */
  scenes?: SceneSummary[];
  /** Latest combat, projected for this member; hidden turns never expose an active ID. */
  combat?: CombatView | null;
  rolls?: RollRecord[];
  /** Open resolutions plus the latest closed ones, filtered/redacted per member. */
  resolutions?: Resolution[];
  /** Current (active/paused) play session, else the latest one. */
  session?: SessionSummary | null;
  dm?: { invites: InviteView[]; cheatSheet?: CheatSheetRow[] };
}
