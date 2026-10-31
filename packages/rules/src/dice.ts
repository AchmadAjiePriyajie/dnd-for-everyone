import { d20InputSchema, type D20Input, type D20Result, type RandomInt, type RollResult } from '#shared/combat';

const invalid = (): never => { throw new Error('DICE_INVALID'); };
export function sampleDie(sides: number, randomInt: RandomInt): number {
  const value = randomInt(1, sides + 1);
  if (!Number.isInteger(value) || value < 1 || value > sides) throw new Error('RANDOM_INVALID');
  return value;
}

/** A bounded grammar, never eval or Function. Limits include extra critical dice. */
export function rollDice(expression: string, randomInt: RandomInt, critical = false): RollResult {
  if (typeof expression !== 'string' || expression.length > 100) invalid();
  const compact = expression.replace(/\s+/g, '');
  if (!/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(compact)) invalid();
  const terms = compact.match(/[+-]?[^+-]+/g)!;
  const groups: Array<{ count: number; sides: number; sign: 1 | -1 }> = [];
  let modifier = 0, count = 0;
  for (const term of terms) {
    const sign = term[0] === '-' ? -1 : 1;
    const body = term.replace(/^[+-]/, '');
    if (body.includes('d')) {
      const [number, faces] = body.split('d');
      const quantity = Number(number || '1') * (critical ? 2 : 1);
      const sides = Number(faces);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || sides < 1 || sides > 1000 || !Number.isInteger(sides)) invalid();
      count += quantity;
      if (count > 100) invalid();
      groups.push({ count: quantity, sides, sign });
    } else {
      const value = Number(body);
      if (!Number.isSafeInteger(value) || value > 99999) invalid();
      modifier += sign * value;
      if (Math.abs(modifier) > 99999) invalid();
    }
  }
  const dice = groups.map(({ count, sides, sign }) => ({ sides, sign, rolls: Array.from({ length: count }, () => sampleDie(sides, randomInt)) }));
  return { expression, dice, modifier, critical, total: modifier + dice.reduce((total, group) => total + group.sign * group.rolls.reduce((a, b) => a + b, 0), 0) };
}

/** Natural 1/20 override AC only for attacks, not ordinary checks or saves. */
export function resolveD20(input: D20Input, randomInt: RandomInt): D20Result {
  if (!d20InputSchema.safeParse(input).success) throw new Error('D20_INVALID');
  const twice = Boolean(input.advantage) !== Boolean(input.disadvantage);
  const rolls = Array.from({ length: twice ? 2 : 1 }, () => sampleDie(20, randomInt));
  const kept = twice ? (input.advantage ? Math.max(...rolls) : Math.min(...rolls)) : rolls[0]!;
  const critical = input.kind === 'attack' && kept === 20;
  const fumble = input.kind === 'attack' && kept === 1;
  const total = kept + input.modifier;
  return { kind: input.kind, rolls, kept, modifier: input.modifier, total, critical, fumble,
    ...(input.dc === undefined ? {} : { success: critical || (!fumble && total >= input.dc) }) };
}
