import { Prisma } from '../generated/prisma/client.js';

export type LoanFormulaVariable = {
  key: string;
  label: string;
  min: string;
  max: string;
  defaultValue: string;
};

type Token =
  | { kind: 'number'; value: string }
  | { kind: 'identifier'; value: string }
  | { kind: 'operator'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' }
  | { kind: 'end' };

type Expression =
  | { kind: 'number'; value: Prisma.Decimal }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: '+' | '-'; expression: Expression }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: Expression; right: Expression }
  | { kind: 'call'; name: 'min' | 'max' | 'round'; arguments: Expression[] };

const RESERVED_VARIABLES = new Set(['principal', 'annualRatePercent', 'termMonths']);
const MAX_EXPRESSION_LENGTH = 512;
const MAX_TOKEN_COUNT = 256;
const MAX_NESTING_DEPTH = 32;

export class LoanFormulaError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function tokenize(source: string): Token[] {
  if (!source.trim() || source.length > MAX_EXPRESSION_LENGTH) {
    throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
  }
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) {
      offset += 1;
      continue;
    }
    const rest = source.slice(offset);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: number[0] });
      offset += number[0].length;
    } else {
      const identifier = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest);
      if (identifier) {
        tokens.push({ kind: 'identifier', value: identifier[0] });
        offset += identifier[0].length;
      } else if ('+-*/(),'.includes(source[offset])) {
        tokens.push({ kind: 'operator', value: source[offset] as '+' | '-' | '*' | '/' | '(' | ')' | ',' });
        offset += 1;
      } else {
        throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
      }
    }
    if (tokens.length > MAX_TOKEN_COUNT) throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
  }
  tokens.push({ kind: 'end' });
  return tokens;
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: Token[], private readonly allowedVariables: ReadonlySet<string>) {}

  parse(): Expression {
    const result = this.parseAddition(0);
    if (this.peek().kind !== 'end') throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
    return result;
  }

  private parseAddition(depth: number): Expression {
    let result = this.parseMultiplication(depth);
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = this.previous().value as '+' | '-';
      result = { kind: 'binary', operator, left: result, right: this.parseMultiplication(depth) };
    }
    return result;
  }

  private parseMultiplication(depth: number): Expression {
    let result = this.parseUnary(depth);
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const operator = this.previous().value as '*' | '/';
      result = { kind: 'binary', operator, left: result, right: this.parseUnary(depth) };
    }
    return result;
  }

  private parseUnary(depth: number): Expression {
    if (depth > MAX_NESTING_DEPTH) throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
    if (this.matchOperator('+') || this.matchOperator('-')) {
      return {
        kind: 'unary',
        operator: this.previous().value as '+' | '-',
        expression: this.parseUnary(depth + 1),
      };
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): Expression {
    if (depth > MAX_NESTING_DEPTH) throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
    const token = this.peek();
    if (token.kind === 'number') {
      this.index += 1;
      return { kind: 'number', value: new Prisma.Decimal(token.value) };
    }
    if (token.kind === 'identifier') {
      this.index += 1;
      if (this.matchOperator('(')) {
        if (!['min', 'max', 'round'].includes(token.value)) {
          throw new LoanFormulaError('LOAN_FORMULA_UNKNOWN_FUNCTION');
        }
        const args: Expression[] = [this.parseAddition(depth + 1)];
        while (this.matchOperator(',')) args.push(this.parseAddition(depth + 1));
        if (!this.matchOperator(')')) throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
        if ((token.value === 'round' && args.length !== 2) || (token.value !== 'round' && args.length < 2)) {
          throw new LoanFormulaError('LOAN_FORMULA_INVALID_FUNCTION_ARGUMENTS');
        }
        return { kind: 'call', name: token.value as 'min' | 'max' | 'round', arguments: args };
      }
      if (!this.allowedVariables.has(token.value)) {
        throw new LoanFormulaError('LOAN_FORMULA_UNKNOWN_VARIABLE');
      }
      return { kind: 'variable', name: token.value };
    }
    if (this.matchOperator('(')) {
      const result = this.parseAddition(depth + 1);
      if (!this.matchOperator(')')) throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
      return result;
    }
    throw new LoanFormulaError('LOAN_FORMULA_INVALID_EXPRESSION');
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private previous(): Extract<Token, { kind: 'operator' }> {
    return this.tokens[this.index - 1] as Extract<Token, { kind: 'operator' }>;
  }

  private matchOperator(value: Extract<Token, { kind: 'operator' }>['value']): boolean {
    const token = this.peek();
    if (token.kind !== 'operator' || token.value !== value) return false;
    this.index += 1;
    return true;
  }
}

function evaluate(expression: Expression, values: Readonly<Record<string, Prisma.Decimal>>): Prisma.Decimal {
  if (expression.kind === 'number') return expression.value;
  if (expression.kind === 'variable') {
    const value = values[expression.name];
    if (!value) throw new LoanFormulaError('LOAN_FORMULA_INPUT_REQUIRED');
    return value;
  }
  if (expression.kind === 'unary') {
    const value = evaluate(expression.expression, values);
    return expression.operator === '-' ? value.negated() : value;
  }
  if (expression.kind === 'binary') {
    const left = evaluate(expression.left, values);
    const right = evaluate(expression.right, values);
    if (expression.operator === '+') return left.plus(right);
    if (expression.operator === '-') return left.minus(right);
    if (expression.operator === '*') return left.times(right);
    if (right.isZero()) throw new LoanFormulaError('LOAN_FORMULA_DIVIDE_BY_ZERO');
    return left.dividedBy(right);
  }

  const args = expression.arguments.map((argument) => evaluate(argument, values));
  if (expression.name === 'min') return args.reduce((smallest, value) => value.lessThan(smallest) ? value : smallest);
  if (expression.name === 'max') return args.reduce((largest, value) => value.greaterThan(largest) ? value : largest);
  const digits = args[1];
  if (!digits.isInteger() || digits.lessThan(0) || digits.greaterThan(6)) {
    throw new LoanFormulaError('LOAN_FORMULA_INVALID_ROUND_PRECISION');
  }
  return args[0].toDecimalPlaces(digits.toNumber(), Prisma.Decimal.ROUND_HALF_UP);
}

export function validateLoanFormula(expression: string, variables: readonly LoanFormulaVariable[] = []): void {
  const allowedVariables = new Set([
    ...RESERVED_VARIABLES,
    ...variables.map(({ key }) => key),
  ]);
  new FormulaParser(tokenize(expression), allowedVariables).parse();
}

export function evaluateLoanFormula(
  expression: string,
  inputs: Readonly<Record<string, string | number>>,
): Prisma.Decimal {
  const allowedVariables = new Set(Object.keys(inputs));
  const parsed = new FormulaParser(tokenize(expression), allowedVariables).parse();
  const values: Record<string, Prisma.Decimal> = {};
  for (const [key, value] of Object.entries(inputs)) {
    try {
      const decimal = new Prisma.Decimal(value);
      if (!decimal.isFinite()) throw new Error();
      values[key] = decimal;
    } catch {
      throw new LoanFormulaError('LOAN_FORMULA_INVALID_INPUT');
    }
  }
  return evaluate(parsed, values);
}

export function validateLoanFormulaVariables(input: unknown): LoanFormulaVariable[] {
  if (!Array.isArray(input) || input.length > 20) {
    throw new LoanFormulaError('LOAN_FORMULA_INVALID_VARIABLES');
  }
  const keys = new Set<string>();
  return input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new LoanFormulaError('LOAN_FORMULA_INVALID_VARIABLES');
    }
    const value = item as Record<string, unknown>;
    const { key, label, min, max, defaultValue } = value;
    if (
      typeof key !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)
      || RESERVED_VARIABLES.has(key)
      || keys.has(key)
      || typeof label !== 'string'
      || !label.trim()
      || label.length > 80
      || typeof min !== 'string'
      || typeof max !== 'string'
      || typeof defaultValue !== 'string'
      || !/^-?\d+(?:\.\d{1,6})?$/.test(min)
      || !/^-?\d+(?:\.\d{1,6})?$/.test(max)
      || !/^-?\d+(?:\.\d{1,6})?$/.test(defaultValue)
    ) {
      throw new LoanFormulaError('LOAN_FORMULA_INVALID_VARIABLES');
    }
    const minimum = new Prisma.Decimal(min);
    const maximum = new Prisma.Decimal(max);
    const initial = new Prisma.Decimal(defaultValue);
    if (minimum.greaterThan(maximum) || initial.lessThan(minimum) || initial.greaterThan(maximum)) {
      throw new LoanFormulaError('LOAN_FORMULA_INVALID_VARIABLE_BOUNDS');
    }
    keys.add(key);
    return { key, label: label.trim(), min, max, defaultValue };
  });
}

export function normalizeLoanFormulaInputs(
  variables: readonly LoanFormulaVariable[],
  supplied: unknown,
  builtIns: { principal: string; annualRatePercent: string; termMonths: number },
): { values: Record<string, string | number>; snapshot: Record<string, string> } {
  if (supplied !== undefined && (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))) {
    throw new LoanFormulaError('LOAN_FORMULA_INVALID_INPUT');
  }
  const provided = (supplied ?? {}) as Record<string, unknown>;
  const allowed = new Set(variables.map(({ key }) => key));
  if (Object.keys(provided).some((key) => !allowed.has(key))) {
    throw new LoanFormulaError('LOAN_FORMULA_UNKNOWN_INPUT');
  }
  const values: Record<string, string | number> = {
    ...builtIns,
  };
  const snapshot: Record<string, string> = {
    principal: builtIns.principal,
    annualRatePercent: builtIns.annualRatePercent,
    termMonths: String(builtIns.termMonths),
  };
  for (const variable of variables) {
    const value = provided[variable.key] ?? variable.defaultValue;
    if (
      typeof value !== 'string'
      || !/^-?\d+(?:\.\d{1,6})?$/.test(value)
    ) {
      throw new LoanFormulaError('LOAN_FORMULA_INVALID_INPUT');
    }
    const decimal = new Prisma.Decimal(value);
    if (decimal.lessThan(variable.min) || decimal.greaterThan(variable.max)) {
      throw new LoanFormulaError('LOAN_FORMULA_INPUT_OUT_OF_RANGE');
    }
    values[variable.key] = value;
    snapshot[variable.key] = value;
  }
  return { values, snapshot };
}
