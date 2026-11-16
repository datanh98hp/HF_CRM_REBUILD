import { describe, expect, it } from '@jest/globals';
import {
  evaluateLoanFormula,
  LoanFormulaError,
  normalizeLoanFormulaInputs,
  validateLoanFormula,
  validateLoanFormulaVariables,
} from './loan-formula.js';

describe('loan formula DSL', () => {
  it('evaluates arithmetic with precedence and approved functions', () => {
    expect(evaluateLoanFormula('round((principal * annualRatePercent / 100) / termMonths, 2)', {
      principal: '12000000',
      annualRatePercent: '12',
      termMonths: 12,
    }).toString()).toBe('120000');
    expect(evaluateLoanFormula('max(2, min(5, 3)) + -1', {}).toString()).toBe('2');
  });

  it('rejects executable syntax, unknown symbols, and division by zero', () => {
    expect(() => validateLoanFormula('principal.constructor')).toThrow(LoanFormulaError);
    expect(() => validateLoanFormula('unknown + 1')).toThrow('LOAN_FORMULA_UNKNOWN_VARIABLE');
    expect(() => evaluateLoanFormula('10 / 0', {})).toThrow('LOAN_FORMULA_DIVIDE_BY_ZERO');
  });

  it('validates custom variable bounds and applies defaults to calculation inputs', () => {
    const variables = validateLoanFormulaVariables([
      { key: 'insuranceRate', label: 'Tỷ lệ bảo hiểm', min: '0', max: '5', defaultValue: '1.2' },
    ]);
    validateLoanFormula('principal * (1 + insuranceRate / 100)', variables);
    const normalized = normalizeLoanFormulaInputs(variables, { insuranceRate: '2' }, {
      principal: '1000000',
      annualRatePercent: '0',
      termMonths: 10,
    });
    expect(normalized.snapshot.insuranceRate).toBe('2');
    expect(evaluateLoanFormula('principal * (1 + insuranceRate / 100)', normalized.values).toString()).toBe('1020000');
    expect(() => normalizeLoanFormulaInputs(variables, { insuranceRate: '6' }, {
      principal: '1000000',
      annualRatePercent: '0',
      termMonths: 10,
    })).toThrow('LOAN_FORMULA_INPUT_OUT_OF_RANGE');
  });
});
