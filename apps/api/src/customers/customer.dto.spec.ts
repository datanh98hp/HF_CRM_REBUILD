import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateLoanProductDto,
  CustomerListQueryDto,
  AssignCustomerDto,
  BulkAssignCustomersDto,
  ContractListQueryDto,
  LoanProductType,
  LoanProductFormulaHistoryQueryDto,
  UpdateLoanProductDto,
} from './customer.dto.js';

describe('CustomerListQueryDto', () => {
  it('accepts take as a numeric query parameter', async () => {
    const query = plainToInstance(CustomerListQueryDto, { take: '100' });

    expect(query.take).toBe(100);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('accepts one extra result for pagination lookahead', async () => {
    const query = plainToInstance(CustomerListQueryDto, { take: '101' });

    expect(query.take).toBe(101);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('rejects take values above the maximum', async () => {
    const query = plainToInstance(CustomerListQueryDto, { take: '102' });

    expect(await validate(query)).not.toHaveLength(0);
  });
});

describe('LoanProductFormulaHistoryQueryDto', () => {
  it('converts a positive version cursor from a query string', async () => {
    const query = plainToInstance(LoanProductFormulaHistoryQueryDto, { beforeVersion: '2' });

    expect(query.beforeVersion).toBe(2);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('rejects non-positive version cursors', async () => {
    const query = plainToInstance(LoanProductFormulaHistoryQueryDto, { beforeVersion: '0' });

    expect(await validate(query)).not.toHaveLength(0);
  });
});

describe('ContractListQueryDto', () => {
  it('converts and accepts a bounded custom page size with contract code search', async () => {
    const query = plainToInstance(ContractListQueryDto, { pageSize: '50', search: 'LOAN-2026' });

    expect(query.pageSize).toBe(50);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it.each(['4', '101', '1.5', 'not-a-number'])('rejects invalid page sizes: %s', async (pageSize) => {
    const query = plainToInstance(ContractListQueryDto, { pageSize });

    expect(await validate(query)).not.toHaveLength(0);
  });

  it('rejects empty or overly long contract code searches', async () => {
    const empty = plainToInstance(ContractListQueryDto, { search: '' });
    const tooLong = plainToInstance(ContractListQueryDto, { search: 'A'.repeat(121) });

    expect(await validate(empty)).not.toHaveLength(0);
    expect(await validate(tooLong)).not.toHaveLength(0);
  });
});

describe('Loan product DTOs', () => {
  it('accepts a product without a user-entered code or amount bounds', async () => {
    const dto = plainToInstance(CreateLoanProductDto, {
      name: 'Sản phẩm hỗ trợ ngắn hạn',
      loanType: LoanProductType.SHORT_TERM_SUPPORT,
      source: 'Business catalog',
      minTermMonths: 1,
      maxTermMonths: 12,
      annualInterestRate: '0',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects product categories outside the configured choices', async () => {
    const dto = plainToInstance(CreateLoanProductDto, {
      name: 'Sản phẩm hỗ trợ ngắn hạn',
      loanType: 'Personal',
      source: 'Business catalog',
      minTermMonths: 1,
      maxTermMonths: 12,
      annualInterestRate: '0',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('allows clearing optional amount bounds on a draft product', async () => {
    const dto = plainToInstance(UpdateLoanProductDto, {
      minAmount: null,
      maxAmount: null,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});

describe('Customer assignment DTOs', () => {
  it('accepts single and bulk assignments without a reason', async () => {
    const adviserId = '4c27419c-3035-4e40-9f4d-8155065688f4';
    const single = plainToInstance(AssignCustomerDto, { adviserId });
    const bulk = plainToInstance(BulkAssignCustomersDto, {
      customerIds: ['e8b3bd2a-dc71-42e5-b141-2ad98ea6ac46'],
      adviserId,
    });

    await expect(validate(single)).resolves.toEqual([]);
    await expect(validate(bulk)).resolves.toEqual([]);
  });
});
