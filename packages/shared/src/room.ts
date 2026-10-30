import type { Id } from './contracts.js';
import type { InviteView, MemberView, Role } from './access.js';
import type { CharacterSummary } from './characters.js';

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
  dm?: { invites: InviteView[] };
}
