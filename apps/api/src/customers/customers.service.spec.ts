import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { AccessScope, CustomerStatus, LoanContractStatus, Prisma } from '../generated/prisma/client.js';
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
    customer = { id: contract.customerId, branchId: contract.branchId, createdById: 'owner-id', status: CustomerStatus.QUALIFIED, assignments: [] };
    tx = {
      loanProduct: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'product-id',
          branchId: data.branchId ?? 'new-branch-id',
          branch: { id: 'new-branch-id', code: 'NEW', name: 'New Branch' },
          code: 'LP-1',
          name: data.name ?? 'Business loan',
          loanType: data.loanType ?? 'Gói hỗ trợ ngắn hạn',
          source: data.source ?? 'Internal',
          description: data.description ?? null,
          sourceUrl: data.sourceUrl ?? null,
          thumbnailUrl: data.thumbnailUrl ?? null,
          minTermMonths: data.minTermMonths ?? 1,
          maxTermMonths: data.maxTermMonths ?? 12,
          minAmount: null,
          maxAmount: null,
          annualInterestRate: new Prisma.Decimal(data.annualInterestRate ?? '8.4500'),
          status: 'ACTIVE',
          currentFormulaVersion: 1,
          createdById: actor.id,
          createdAt: new Date('2026-11-26T00:00:00.000Z'),
          updatedAt: new Date('2026-11-26T00:00:00.000Z'),
        })),
      },
      loanContractStatusHistory: { create: jest.fn(async () => undefined) },
      loanContractDocument: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'document-id',
          fileName: data.fileName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          createdAt: new Date('2026-11-26T00:00:00.000Z'),
          uploadedBy: { displayName: 'Consultant', username: 'adviser' },
        })),
      },
      loanContractChangeHistory: { create: jest.fn(async () => undefined) },
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
        findMany: jest.fn(async () => []),
      },
      userRoleGrant: {
        findFirst: jest.fn(async () => ({ id: 'admin-grant-id' })),
      },
      loanProduct: {
        findUnique: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      branch: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id: 'new-branch-id' })),
      },
      customerStatusHistory: {
        findMany: jest.fn(async () => []),
      },
      loanContract: {
        findUnique: jest.fn(async () => ({ ...contract, customer })),
        findMany: jest.fn(async () => []),
      },
      loanContractStatusHistory: { findMany: jest.fn(async () => []) },
      loanContractChangeHistory: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      hasPermission: jest.fn(async (_userId: string, _permission: string, _scope: AccessScope) => false),
      hasManagedBranches: jest.fn(async () => true),
      hasResourceAccess: jest.fn(async () => true),
      isBranchManager: jest.fn(async () => true),
      assertPermission: jest.fn(async () => undefined),
      assertResourceAccess: jest.fn(async () => undefined),
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

  it('filters customers by branch and includes the branch name', async () => {
    prisma.customer.findMany.mockResolvedValue([{
      ...customer,
      fullName: 'Nguyen Van A',
      phone: '0987000001',
      email: null,
      dateOfBirth: null,
      provenance: 'Manual',
      verificationStatus: 'UNVERIFIED',
      createdAt: new Date('2026-11-26T00:00:00.000Z'),
      updatedAt: new Date('2026-11-26T00:00:00.000Z'),
      assignments: [],
    }]);
    prisma.branch.findMany.mockResolvedValue([{ id: contract.branchId, name: 'Hai Phong Branch' }]);

    await expect(service.list(actor, { branchId: contract.branchId, take: 20 })).resolves.toEqual([
      expect.objectContaining({
        id: customer.id,
        branchId: contract.branchId,
        branchName: 'Hai Phong Branch',
      }),
    ]);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: contract.branchId }),
    }));
  });

  it('returns the latest customer status changes with their notes and actors', async () => {
    const createdAt = new Date('2026-11-25T05:30:00.000Z');
    prisma.customerStatusHistory.findMany.mockResolvedValue([{
      id: 'history-id',
      fromStatus: CustomerStatus.NEW,
      toStatus: CustomerStatus.CONTACTED,
      reason: 'Đã gọi và hẹn tư vấn',
      createdAt,
      changedBy: { displayName: 'Tư vấn viên' },
      changedByCustomer: null,
    }]);

    await expect(service.customerStatusHistory(actor, customer.id)).resolves.toEqual({
      items: [{
        id: 'history-id',
        fromStatus: CustomerStatus.NEW,
        toStatus: CustomerStatus.CONTACTED,
        reason: 'Đã gọi và hẹn tư vấn',
        changedAt: createdAt,
        changedBy: 'Tư vấn viên',
      }],
      nextCursor: null,
    });
  });

  it('paginates customer status history without dropping older entries', async () => {
    const entries = Array.from({ length: 11 }, (_, index) => ({
      id: `history-${index + 1}`,
      fromStatus: CustomerStatus.NEW,
      toStatus: CustomerStatus.CONTACTED,
      reason: `Ghi chú ${index + 1}`,
      createdAt: new Date(`2026-11-${String(25 - index).padStart(2, '0')}T05:30:00.000Z`),
      changedBy: null,
      changedByCustomer: null,
    }));
    prisma.customerStatusHistory.findMany.mockResolvedValue(entries);

    const result = await service.customerStatusHistory(actor, customer.id, 'older-cursor');

    expect(result.items).toHaveLength(10);
    expect(result.items[0].reason).toBe('Ghi chú 1');
    expect(result.nextCursor).toBe('history-10');
    expect(prisma.customerStatusHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: customer.id },
      cursor: { id: 'older-cursor' },
      skip: 1,
      take: 11,
    }));
  });

  it('checks customer read access before returning status history', async () => {
    access.assertResourceAccess.mockRejectedValue(new Error('forbidden'));

    await expect(service.customerStatusHistory(actor, customer.id)).rejects.toThrow('forbidden');
    expect(prisma.customerStatusHistory.findMany).not.toHaveBeenCalled();
  });

  it('includes system-wide loan products when filtering by branch', async () => {
    access.hasPermission.mockResolvedValue(true);
    prisma.loanProduct.findMany.mockResolvedValue([{
      id: 'global-product-id',
      branchId: null,
      branch: null,
      code: 'LP-GLOBAL',
      name: 'Global loan',
      loanType: 'Gói hỗ trợ ngắn hạn',
      source: 'Internal',
      description: null,
      sourceUrl: null,
      thumbnailUrl: null,
      minTermMonths: 1,
      maxTermMonths: 12,
      minAmount: null,
      maxAmount: null,
      annualInterestRate: new Prisma.Decimal('8.4500'),
      status: 'ACTIVE',
      currentFormulaVersion: 1,
      createdById: actor.id,
      createdAt: new Date('2026-11-26T00:00:00.000Z'),
      updatedAt: new Date('2026-11-26T00:00:00.000Z'),
    }]);

    await expect(service.listLoanProducts(actor, { branchId: contract.branchId })).resolves.toEqual([
      expect.objectContaining({
        id: 'global-product-id',
        branchId: null,
        branch: null,
      }),
    ]);
    expect(prisma.loanProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ branchId: contract.branchId }, { branchId: null }],
      }),
    }));
  });

  it('rejects loan product deletion for non-admin staff', async () => {
    access.hasPermission.mockResolvedValue(false);

    await expect(service.deleteLoanProduct(actor, 'product-id')).rejects.toMatchObject({
      response: { code: 'LOAN_PRODUCT_DELETE_ADMIN_ONLY' },
    });
  });

  it('allows an admin to update an active loan product including branch', async () => {
    access.hasPermission.mockResolvedValue(true);
    prisma.loanProduct.findUnique.mockResolvedValue({
      id: 'product-id',
      branchId: 'old-branch-id',
      branch: { id: 'old-branch-id', code: 'OLD', name: 'Old Branch' },
      code: 'LP-1',
      name: 'Business loan',
      loanType: 'Gói hỗ trợ ngắn hạn',
      source: 'Internal',
      description: null,
      sourceUrl: null,
      thumbnailUrl: null,
      minTermMonths: 1,
      maxTermMonths: 12,
      minAmount: null,
      maxAmount: null,
      annualInterestRate: new Prisma.Decimal('8.4500'),
      status: 'ACTIVE',
      currentFormulaVersion: 1,
      deletedAt: null,
      createdById: actor.id,
      createdAt: new Date('2026-11-26T00:00:00.000Z'),
      updatedAt: new Date('2026-11-26T00:00:00.000Z'),
    });

    await expect(service.updateLoanProduct(actor, 'product-id', {
      branchId: 'new-branch-id',
      name: 'Updated business loan',
      source: 'Updated source',
    })).resolves.toMatchObject({
      id: 'product-id',
      branchId: 'new-branch-id',
      name: 'Updated business loan',
      source: 'Updated source',
    });
  });

  it('allows an admin to soft-delete a loan product', async () => {
    access.hasPermission.mockResolvedValue(true);
    prisma.loanProduct.findUnique.mockResolvedValue({
      id: 'product-id',
      branchId: null,
      branch: null,
      code: 'LP-1',
      name: 'Business loan',
      loanType: 'Gói hỗ trợ ngắn hạn',
      source: 'Internal',
      description: null,
      sourceUrl: null,
      thumbnailUrl: null,
      minTermMonths: 1,
      maxTermMonths: 12,
      minAmount: null,
      maxAmount: null,
      annualInterestRate: new Prisma.Decimal('8.4500'),
      status: 'DRAFT',
      currentFormulaVersion: 0,
      deletedAt: null,
      createdById: actor.id,
      createdAt: new Date('2026-11-26T00:00:00.000Z'),
      updatedAt: new Date('2026-11-26T00:00:00.000Z'),
    });

    await expect(service.deleteLoanProduct(actor, 'product-id')).resolves.toMatchObject({
      id: 'product-id',
      status: 'INACTIVE',
    });
    expect(tx.loanProduct.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-id', deletedAt: null },
      data: expect.objectContaining({ status: 'INACTIVE', deletedAt: expect.any(Date) }),
    }));
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
      id: 'product-id',
      name: 'Short-term support',
      annualInterestRate: '12.0000',
      minTermMonths: 6,
      maxTermMonths: 24,
      source: 'Test source',
      description: 'Public description',
    }]);
  });

  it('lets an adviser manage documents and read history for an assigned customer', async () => {
    const adviser = { id: 'adviser-id', type: 'STAFF' as const };
    customer.assignments = [{ adviserId: adviser.id }];
    access.hasManagedBranches.mockResolvedValue(false);
    access.hasResourceAccess.mockImplementation(async (_userId: string, permission: string, _scope: AccessScope | undefined, resource: any) =>
      resource.assigneeId === adviser.id && ['loan-contracts.read', 'loan-contracts.manage'].includes(permission));
    access.assertResourceAccess.mockImplementation(async (userId: string, permission: string, scope: AccessScope | undefined, resource: any) => {
      if (!await access.hasResourceAccess(userId, permission, scope, resource)) {
        throw new ForbiddenException({ code: 'RESOURCE_SCOPE_DENIED' });
      }
    });

    await expect(service.getContractHistory(adviser, contract.id)).resolves.toEqual({ items: [] });

    const buffer = Buffer.from('%PDF-1.4\nLoan document');
    await expect(service.uploadContractDocument(adviser, contract.id, {
      originalname: 'loan-document.pdf',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
    })).resolves.toEqual(expect.objectContaining({ fileName: 'loan-document.pdf' }));
    expect(documentStorage.put).toHaveBeenCalledTimes(1);
    expect(tx.loanContractChangeHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'DOCUMENT_UPLOADED' }),
    }));
  });

  it('denies document uploads without contract-management scope, even with customer-management access', async () => {
    const adviser = { id: 'other-adviser-id', type: 'STAFF' as const };
    customer.assignments = [{ adviserId: adviser.id }];
    access.hasManagedBranches.mockResolvedValue(false);
    access.hasResourceAccess.mockImplementation(async (_userId: string, permission: string) =>
      ['loan-contracts.read', 'customers.manage'].includes(permission));
    access.assertResourceAccess.mockImplementation(async (userId: string, permission: string, scope: AccessScope | undefined, resource: any) => {
      if (!await access.hasResourceAccess(userId, permission, scope, resource)) {
        throw new ForbiddenException({ code: 'RESOURCE_SCOPE_DENIED' });
      }
    });
    access.assertPermission.mockImplementation(async (userId: string, permission: string, scope: AccessScope | undefined, branchId?: string) => {
      if (!await access.hasPermission(userId, permission, scope, branchId)) {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      }
    });

    const buffer = Buffer.from('%PDF-1.4\nLoan document');
    await expect(service.uploadContractDocument(adviser, contract.id, {
      originalname: 'loan-document.pdf',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentStorage.put).not.toHaveBeenCalled();
  });

  it('denies contract history outside the adviser resource scope', async () => {
    const adviser = { id: 'other-adviser-id', type: 'STAFF' as const };
    customer.assignments = [{ adviserId: 'assigned-adviser-id' }];
    access.hasManagedBranches.mockResolvedValue(false);
    access.hasResourceAccess.mockResolvedValue(false);
    access.assertResourceAccess.mockRejectedValue(new ForbiddenException({ code: 'RESOURCE_SCOPE_DENIED' }));

    await expect(service.getContractHistory(adviser, contract.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
