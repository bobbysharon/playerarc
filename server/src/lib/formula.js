'use strict';
/**
 * A tiny, dependency-free arithmetic expression evaluator.
 *
 * Derived statistics and sport performance-rating models are stored as text
 * formulas inside sports.config_json, so a director can change how (say) a
 * cricket rating is composed without a code deployment. Those formulas are
 * evaluated here — never with eval() or new Function(), which would let stored
 * configuration execute arbitrary code.
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-')? primary
 *   primary := number | identifier | call | '(' expr ')'
 *   call    := identifier '(' [expr (',' expr)*] ')'
 */

const FUNCTIONS = {
  // Safe divide: returns 0 instead of Infinity/NaN when the divisor is 0.
  div: (a, b) => (b === 0 || b === undefined || Number.isNaN(b) ? 0 : a / b),
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (n, dp = 0) => {
    const f = 10 ** dp;
    return Math.round((n + Number.EPSILON) * f) / f;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: (n) => (n < 0 ? 0 : Math.sqrt(n)),
  pow: (a, b) => a ** b,
  clamp: (n, lo, hi) => Math.min(Math.max(n, lo), hi),
  // Scale a raw value to 0..100 against a target ceiling.
  scale: (n, ceiling) => (ceiling ? Math.min(100, Math.max(0, (n / ceiling) * 100)) : 0),
  ifpos: (n, whenPositive, otherwise) => (n > 0 ? whenPositive : otherwise),
  gt: (a, b) => (a > b ? 1 : 0),
  gte: (a, b) => (a >= b ? 1 : 0),
  lt: (a, b) => (a < b ? 1 : 0),
  lte: (a, b) => (a <= b ? 1 : 0),
};

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let n = '';
      while (i < input.length && /[0-9._]/.test(input[i])) n += input[i++];
      const value = Number(n.replace(/_/g, ''));
      if (Number.isNaN(value)) throw new FormulaError(`Invalid number "${n}"`);
      tokens.push({ type: 'number', value });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let name = '';
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) name += input[i++];
      tokens.push({ type: 'ident', value: name });
      continue;
    }
    if ('+-*/%(),'.includes(ch)) {
      tokens.push({ type: ch });
      i += 1;
      continue;
    }
    throw new FormulaError(`Unexpected character "${ch}"`);
  }
  return tokens;
}

class FormulaError extends Error {}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (type) => {
    const t = tokens[pos];
    if (!t || t.type !== type) throw new FormulaError(`Expected ${type}`);
    pos += 1;
    return t;
  };

  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[pos++].type;
      node = { kind: 'bin', op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseUnary();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const op = tokens[pos++].type;
      node = { kind: 'bin', op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary() {
    if (peek() && peek().type === '-') {
      pos += 1;
      return { kind: 'neg', value: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw new FormulaError('Unexpected end of formula');
    if (t.type === 'number') {
      pos += 1;
      return { kind: 'num', value: t.value };
    }
    if (t.type === 'ident') {
      pos += 1;
      if (peek() && peek().type === '(') {
        eat('(');
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(parseExpr());
          while (peek() && peek().type === ',') {
            pos += 1;
            args.push(parseExpr());
          }
        }
        eat(')');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'var', name: t.value };
    }
    if (t.type === '(') {
      eat('(');
      const node = parseExpr();
      eat(')');
      return node;
    }
    throw new FormulaError(`Unexpected token "${t.type}"`);
  }

  const ast = parseExpr();
  if (pos !== tokens.length) throw new FormulaError('Trailing characters in formula');
  return ast;
}

function evaluate(node, scope) {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      const v = scope[node.name];
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    case 'neg':
      return -evaluate(node.value, scope);
    case 'bin': {
      const a = evaluate(node.left, scope);
      const b = evaluate(node.right, scope);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '%': return b === 0 ? 0 : a % b;
        default: throw new FormulaError(`Unknown operator ${node.op}`);
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function "${node.name}"`);
      return fn(...node.args.map((a) => evaluate(a, scope)));
    }
    default:
      throw new FormulaError('Bad formula node');
  }
}

const cache = new Map();

/**
 * Evaluate a formula string against a scope of numeric variables.
 * Returns 0 for an unparseable formula rather than throwing, so one bad
 * configured stat never takes down a player profile.
 */
function run(formula, scope = {}, { strict = false } = {}) {
  if (formula === null || formula === undefined || formula === '') return 0;
  if (typeof formula === 'number') return formula;
  try {
    let ast = cache.get(formula);
    if (!ast) {
      ast = parse(tokenize(String(formula)));
      cache.set(formula, ast);
    }
    const result = evaluate(ast, scope);
    return Number.isFinite(result) ? result : 0;
  } catch (err) {
    if (strict) throw err;
    return 0;
  }
}

/** Validate a formula at configuration time. Returns { valid, error }. */
function validate(formula) {
  try {
    parse(tokenize(String(formula)));
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = { run, validate, FormulaError, FUNCTIONS };
