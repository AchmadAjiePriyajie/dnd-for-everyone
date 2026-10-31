/**
 * Generator nama NPC lokal (tanpa internet). Suku kata orisinal, bukan daftar nama dari buku;
 * `random` dapat disuntik agar hasil dapat diuji.
 */
const STARTS = ['Al', 'Bar', 'Cor', 'Dun', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lir', 'Mor', 'Nes', 'Or', 'Pell', 'Quin', 'Ros', 'Sar', 'Tor', 'Ul', 'Vel', 'Wyn', 'Yar', 'Zan'];
const MIDDLES = ['', '', 'a', 'e', 'i', 'o', 'an', 'el', 'or', 'ra', 'ri', 'un'];
const ENDS = ['bric', 'dan', 'dra', 'eth', 'ia', 'ik', 'is', 'mund', 'na', 'ra', 'ric', 'ros', 'sa', 'thea', 'vin', 'wen', 'wyn'];
const PLACES = ['Ash', 'Briar', 'Cold', 'Deep', 'Ember', 'Fox', 'Grey', 'High', 'Iron', 'Moss', 'Raven', 'Salt', 'Stone', 'Thorn', 'Wolf'];
const PLACE_ENDS = ['brook', 'dale', 'field', 'ford', 'gate', 'hill', 'hollow', 'mere', 'reach', 'vale', 'watch', 'wood'];

type Random = () => number;
const pick = <T>(list: readonly T[], random: Random): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;

export function generateNpcName(random: Random = Math.random): string {
  const given = `${pick(STARTS, random)}${pick(MIDDLES, random)}${pick(ENDS, random)}`;
  return `${given} ${pick(PLACES, random)}${pick(PLACE_ENDS, random)}`;
}
