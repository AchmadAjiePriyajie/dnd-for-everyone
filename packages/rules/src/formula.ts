/**
 * Formula homebrew yang aman: angka bulat, dadu `NdM`, variabel whitelist, + − × ÷ dan kurung.
 * Diurai menjadi pohon sendiri lalu dievaluasi tanpa eval/Function, sehingga teks seperti
 * `alert(1)` atau `process.exit()` ditolak sebagai FORMULA_INVALID.
 */
export const FORMULA_VARIABLES = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'prof', 'level'] as const;
export type FormulaVariable = (typeof FORMULA_VARIABLES)[number];

export type FormulaNode =
  | { type: 'number'; value: number }
  | { type: 'dice'; count: number; sides: number }
  | { type: 'variable'; name: FormulaVariable }
  | { type: 'negate'; operand: FormulaNode }
  | { type: 'binary'; operator: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };

const MAX_LENGTH = 120;
const MAX_NUMBER = 10_000;
const MAX_DICE = 100;
const MAX_SIDES = 100;
const MAX_DEPTH = 20;

const invalid = (): never => {
  throw new Error('FORMULA_INVALID');
};

type Token = { kind: 'number'; value: number } | { kind: 'dice'; count: number; sides: number } | { kind: 'name'; value: string } | { kind: 'op'; value: string };

function tokenize(text: string): Token[] {
  if (!text.trim() || text.length > MAX_LENGTH) invalid();
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d{0,3})d(\d{1,3})(?![a-z0-9])|(\d{1,5})(?![a-z0-9])|([a-z]+)(?![a-z0-9])|([-+*/()]))/gy;
  let index = 0;
  while (index < text.length) {
    if (/^\s+$/.test(text.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) invalid();
    index = pattern.lastIndex;
    const [, count, sides, number, name, op] = match!;
    if (sides !== undefined) {
      const dice = { kind: 'dice' as const, count: count ? Number(count) : 1, sides: Number(sides) };
      if (dice.count < 1 || dice.count > MAX_DICE || dice.sides < 2 || dice.sides > MAX_SIDES) invalid();
      tokens.push(dice);
    } else if (number !== undefined) {
      if (Number(number) > MAX_NUMBER) invalid();
      tokens.push({ kind: 'number', value: Number(number) });
    } else if (name !== undefined) {
      if (!(FORMULA_VARIABLES as readonly string[]).includes(name)) invalid();
      tokens.push({ kind: 'name', value: name });
    } else tokens.push({ kind: 'op', value: op! });
  }
  return tokens;
}

export function parseFormula(text: string): FormulaNode {
  const tokens = tokenize(text);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => peek()?.kind === 'op' && (peek() as { value: string }).value === value;

  const expression = (depth: number): FormulaNode => {
    if (depth > MAX_DEPTH) invalid();
    let node = term(depth);
    while (isOp('+') || isOp('-')) {
      const operator = (tokens[position++] as { value: '+' | '-' }).value;
      node = { type: 'binary', operator, left: node, right: term(depth) };
    }
    return node;
  };
  const term = (depth: number): FormulaNode => {
    let node = factor(depth);
    while (isOp('*') || isOp('/')) {
      const operator = (tokens[position++] as { value: '*' | '/' }).value;
      node = { type: 'binary', operator, left: node, right: factor(depth) };
    }
    return node;
  };
  const factor = (depth: number): FormulaNode => {
    const token = tokens[position++];
    if (!token) return invalid();
    if (token.kind === 'number') return { type: 'number', value: token.value };
    if (token.kind === 'dice') return { type: 'dice', count: token.count, sides: token.sides };
    if (token.kind === 'name') return { type: 'variable', name: token.value as FormulaVariable };
    if (token.value === '-') return { type: 'negate', operand: factor(depth + 1) };
    if (token.value === '(') {
      const inner = expression(depth + 1);
      if (!isOp(')')) invalid();
      position++;
      return inner;
    }
    return invalid();
  };

  const tree = expression(0);
  if (position !== tokens.length) invalid();
  return tree;
}

/** Nilai formula; `roll(sides)` menyediakan satu lemparan dadu. Pembagian dibulatkan ke bawah. */
export function evaluateFormula(node: FormulaNode, variables: Partial<Record<FormulaVariable, number>>, roll: (sides: number) => number): number {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'dice': {
      let total = 0;
      for (let index = 0; index < node.count; index++) total += roll(node.sides);
      return total;
    }
    case 'variable':
      return variables[node.name] ?? 0;
    case 'negate':
      return -evaluateFormula(node.operand, variables, roll);
    case 'binary': {
      const left = evaluateFormula(node.left, variables, roll);
      const right = evaluateFormula(node.right, variables, roll);
      if (node.operator === '+') return left + right;
      if (node.operator === '-') return left - right;
      if (node.operator === '*') return left * right;
      return right === 0 ? 0 : Math.floor(left / right);
    }
  }
}

/** true bila teks dapat diurai sebagai formula aman. */
export function isSafeFormula(text: string): boolean {
  try {
    parseFormula(text);
    return true;
  } catch {
    return false;
  }
}
