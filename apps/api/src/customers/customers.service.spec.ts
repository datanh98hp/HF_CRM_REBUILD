import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AccessScope, CustomerStatus, LoanContractStatus } from '../generated/prisma/client.js';
import { CustomersService } from './customers.service.js';

describe('CustomersService contract approval', () => {
  const actor = { id: 'manager-id', type: 'STAFF' as const };
  const contract = {
    id: 'contract-id',
    customerId: 'customer-id',
    branchId: 'branch-id',
    contractNumber: 'CONTRACT-1',
    packageCode: null,
    packageName: 'Loan package',
    packageVersion: null,
    loanType: null,
    termMonths: null,
    status: LoanContractStatus.PENDING_REVIEW,
    createdById: 'maker-id',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  let prisma: any;
  let access: any;
  let audit: any;
  let documentStorage: any;
  let tx: any;
  let customer: any;
  let service: CustomersService;

  beforeEach(() => {
    customer = { id: contract.customerId, branchId: contract.branchId, status: CustomerStatus.QUALIFIED };
    tx = {
      loanContractStatusHistory: { create: jest.fn(async () => undefined) },
      loanContract: {
        update: jest.fn(async ({ data }: any) => ({ ...contract, ...data, status: LoanContractStatus.APPROVED })),
      },
      customer: {
        findUnique: jest.fn(async () => customer),
        update: jest.fn(async ({ data }: any) => ({ ...customer, ...data })),
      },
      customerStatusHistory: { create: jest.fn(async () => undefined) },
    };
    prisma = {
      customer: {
        findUnique: jest.fn(async () => customer),
      },
      loanProduct: {
        findMany: jest.fn(async () => []),
      },
      loanContract: {
        findUnique: jest.fn(async () => contract),
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      hasPermission: jest.fn(async (_userId: string, _permission: string, _scope: AccessScope) => false),
      hasManagedBranches: jest.fn(async () => true),
      hasResourceAccess: jest.fn(async () => true),
      isBranchManager: jest.fn(async () => true),
      assertPermission: jest.fn(async () => undefined),
    };
    audit = { write: jest.fn(async () => undefined) };
    documentStorage = {
      assertUploadsAvailable: jest.fn(),
      put: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
      read: jest.fn(),
    };
    service = new CustomersService(prisma, access, audit, documentStorage);
  });

  it('converts the customer and records status history when a contract is approved', async () => {
    const result = await service.approveContract(actor, contract.id);

    expect(result.status).toBe(LoanContractStatus.APPROVED);
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: customer.id },
      data: { status: CustomerStatus.CONVERTED },
    });
    expect(tx.customerStatusHistory.create).toHaveBeenCalledWith({
      data: {
        customerId: customer.id,
        fromStatus: CustomerStatus.QUALIFIED,
        toStatus: CustomerStatus.CONVERTED,
        reason: 'Automatically converted after a loan contract was approved',
        changedById: actor.id,
      },
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'customer.status.changed',
      targetId: customer.id,
      beforeState: { status: CustomerStatus.QUALIFIED },
      afterState: { status: CustomerStatus.CONVERTED },
    }));
  });

  it('does not create duplicate conversion history for an already converted customer', async () => {
    customer.status = CustomerStatus.CONVERTED;

    await service.approveContract(actor, contract.id);

    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.customerStatusHistory.create).not.toHaveBeenCalled();
  });

  it('allows a global reviewer to approve a contract they created', async () => {
    contract.createdById = actor.id;
    access.hasPermission.mockResolvedValue(true);

    const result = await service.approveContract(actor, contract.id);

    expect(result.status).toBe(LoanContractStatus.APPROVED);
  });

  it('keeps maker-checker restrictions for branch-only reviewers', async () => {
    contract.createdById = actor.id;

    await expect(service.approveContract(actor, contract.id)).rejects.toMatchObject({
      response: { code: 'CONTRACT_CREATOR_CANNOT_REVIEW' },
    });
  });

  it('exposes self-review in the contract list only to global reviewers', async () => {
    contract.createdById = actor.id;
    prisma.loanContract.findMany.mockImplementation(async () => [{
      ...contract,
      branch: { name: 'North Branch' },
      customer: { id: contract.customerId, fullName: 'Customer', assignments: [] },
    }]);

    const branchResult = await service.listLoanContracts(actor, { pageSize: 10 });
    expect(branchResult.items[0]).toHaveProperty('canReview', false);

    access.hasPermission.mockResolvedValue(true);
    const globalResult = await service.listLoanContracts(actor, { pageSize: 10 });
    expect(globalResult.items[0]).toHaveProperty('canReview', true);
  });

  it('limits unapproved customer product details and includes approved source and description', async () => {
    prisma.loanContract.findMany.mockImplementation(async () => [{
      ...contract,
      approvedAt: null,
      loanAmount: null,
      annualInterestRate: null,
      interestAmount: null,
      monthlyPayment: null,
      formulaSnapshot: {
        product: {
          code: 'LP-1',
          name: 'Short-term support',
          loanType: 'Gói hỗ trợ ngắn hạn',
          source: 'Test source',
          description: 'Snapshot description',
          minAmount: '1000000.00',
          maxAmount: '5000000.00',
          minTermMonths: 6,
          maxTermMonths: 24,
          annualInterestRate: '12.0000',
        },
      },
      branch: { name: 'North Branch' },
      customer: { id: contract.customerId, fullName: 'Customer', assignments: [] },
    }]);

    const staffResult = await service.listLoanContracts(actor, { pageSize: 10 });
    const staffItem = staffResult.items[0];
    expect(staffItem && 'loanProduct' in staffItem ? staffItem.loanProduct : null).toMatchObject({
      code: 'LP-1',
      name: 'Short-term support',
      description: 'Snapshot description',
    });

    const customerResult = await service.listLoanContracts({ id: contract.customerId, type: 'CUSTOMER' }, { pageSize: 10 });
    const customerItem = customerResult.items[0];
    expect(customerItem && 'loanProduct' in customerItem ? customerItem.loanProduct : null).toEqual({
      name: 'Short-term support',
      annualInterestRate: '12.0000',
      minTermMonths: 6,
      maxTermMonths: 24,
    });

    prisma.loanContract.findMany.mockImplementation(async () => [{
      ...contract,
      approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      formulaSnapshot: {
        product: {
          code: 'LP-1',
          name: 'Short-term support',
          loanType: 'Gói hỗ trợ ngắn hạn',
          source: 'Test source',
          description: 'Snapshot description',
          minAmount: '1000000.00',
          maxAmount: '5000000.00',
          minTermMonths: 6,
          maxTermMonths: 24,
          annualInterestRate: '12.0000',
        },
      },
      branch: { name: 'North Branch' },
      customer: { id: contract.customerId, fullName: 'Customer', assignments: [] },
    }]);
    const approvedResult = await service.listLoanContracts({ id: contract.customerId, type: 'CUSTOMER' }, { pageSize: 10 });
    const approvedItem = approvedResult.items[0];
    expect(approvedItem && 'loanProduct' in approvedItem ? approvedItem.loanProduct : null).toEqual({
      name: 'Short-term support',
      annualInterestRate: '12.0000',
      minTermMonths: 6,
      maxTermMonths: 24,
      source: 'Test source',
      description: 'Snapshot description',
    });

    it('returns only the approved loan-product allowlist to customers', async () => {
      prisma.loanProduct.findMany.mockImplementation(async () => [{
        id: 'product-id',
        branchId: null,
        branch: null,
        code: 'LP-1',
        name: 'Short-term support',
        loanType: 'Gói hỗ trợ ngắn hạn',
        source: 'Test source',
        description: 'Public description',
        sourceUrl: 'https://example.invalid/internal',
        thumbnailUrl: 'https://example.invalid/image',
        minTermMonths: 6,
        maxTermMonths: 24,
        minAmount: { toFixed: () => '1000000.00' },
        maxAmount: { toFixed: () => '5000000.00' },
        annualInterestRate: { toFixed: () => '12.0000' },
        status: 'ACTIVE',
        currentFormulaVersion: 3,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      }]);

      await expect(service.listLoanProducts({ id: customer.id, type: 'CUSTOMER' }, {})).resolves.toEqual([{
        name: 'Short-term support',
        annualInterestRate: '12.0000',
        minTermMonths: 6,
        maxTermMonths: 24,
        source: 'Test source',
        description: 'Public description',
      }]);
    });
  });
});
