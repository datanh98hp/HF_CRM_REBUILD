import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AccessScope,
  CustomerStatus,
  DuplicateReviewStatus,
  LoanContractStatus,
  LoanProductStatus,
  LoanRequestSource,
  Prisma,
} from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AssignCustomerDto,
  BulkAssignCustomersDto,
  ChangeCustomerStatusDto,
  CreateCustomerDto,
  CreateLoanContractDto,
  CreateLoanProductDto,
  ContractListQueryDto,
  ExternalLoanContractDto,
  CreateLoanRequestDto,
  CalculateLoanProductDto,
  CustomerListQueryDto,
  LoanProductListQueryDto,
  ResolveDuplicateDto,
  SetLoanProductFormulaDto,
  SetLoanProductStatusDto,
  UpdateLoanProductDto,
  UpdateCustomerDto,
  UpdateLoanRequestStatusDto,
} from './customer.dto.js';
import { normalizeVietnamesePhone, normalizeVietnamesePhoneSearch } from './phone-normalizer.js';
import {
  evaluateLoanFormula,
  LoanFormulaError,
  normalizeLoanFormulaInputs,
  validateLoanFormula,
  validateLoanFormulaVariables,
} from './loan-formula.js';

type CustomerRecord = Prisma.CustomerGetPayload<{
  include: { assignments: { where: { endedAt: null }; select: { adviserId: true; assignedAt: true } } };
}>;

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

type ContractUploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const CONTRACT_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const CONTRACT_DOCUMENT_DIRECTORY = process.env.CONTRACT_DOCUMENT_DIRECTORY ? resolve(process.env.CONTRACT_DOCUMENT_DIRECTORY) : resolve('/tmp/contracts');
const CONTRACT_DOCUMENT_MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};

function normalizedName(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function normalizedEmail(value?: string | null): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException({ code: 'INVALID_EMAIL' });
  }
  return email;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
  ) { }

  async list(actor: ActorContext, query: CustomerListQueryDto) {
    this.assertStaff(actor);
    const assignedAt: Prisma.DateTimeFilter = {};
    if (query.assignedFrom) assignedAt.gte = new Date(query.assignedFrom);
    if (query.assignedTo) assignedAt.lte = new Date(query.assignedTo);
    if (query.assignedFrom && query.assignedTo && new Date(query.assignedFrom).getTime() > new Date(query.assignedTo).getTime()) {
      throw new BadRequestException({ code: 'INVALID_ASSIGNMENT_DATE_RANGE' });
    }
    const where: Prisma.CustomerWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedFrom || query.assignedTo
        ? { assignments: { some: { endedAt: null, assignedAt } } }
        : {}),
      ...(query.search ? {
        OR: [
          { fullName: { contains: query.search.trim(), mode: 'insensitive' } },
          ...(normalizeVietnamesePhoneSearch(query.search) ? [{ phoneNormalized: { contains: normalizeVietnamesePhoneSearch(query.search) } }] : []),
          { emailNormalized: { contains: query.search.trim().toLowerCase() } },
        ],
      } : {}),
    };
    const result: CustomerRecord[] = [];
    const pageSize = 100;
    const take = query.take ?? 50;
    let cursor = query.cursor;
    while (result.length < take) {
      const candidates = await this.prisma.customer.findMany({
        where,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: pageSize,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { assignments: { where: { endedAt: null }, select: { adviserId: true, assignedAt: true } } },
      });
      if (!candidates.length) break;
      for (const customer of candidates) {
        if (await this.canAccessCustomer(actor, 'customers.read', customer)) result.push(customer);
        if (result.length >= take) break;
      }
      cursor = candidates[candidates.length - 1].id;
      if (candidates.length < pageSize) break;
    }
    return result.map((customer) => this.serializeCustomer(customer));
  }

  async create(actor: ActorContext, dto: CreateCustomerDto, request?: ActorRequest) {
    this.assertStaff(actor);
    await this.assertBranchManagePermission(actor, 'customers.manage', dto.branchId);
    const phone = normalizeVietnamesePhone(dto.phone);
    const phoneNormalized = phone;
    const emailNormalized = normalizedEmail(dto.email);
    const dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    await this.assertBranchExists(dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          fullName: dto.fullName.trim(), normalizedName: normalizedName(dto.fullName), phone, phoneNormalized,
          email: emailNormalized, emailNormalized, dateOfBirth, provenance: dto.provenance.trim(),
          branchId: dto.branchId, createdById: actor.id,
        },
        include: { assignments: { where: { endedAt: null } } },
      });
      await this.syncDuplicateCandidates(tx, customer);
      await this.audit.write(tx, {
        actor, action: 'customer.created', targetType: 'customer', targetId: customer.id, branchId: customer.branchId,
        afterState: { status: customer.status, provenance: customer.provenance }, requestId: requestId(request),
      });
      return this.serializeCustomer(customer);
    });
  }

  async detail(actor: ActorContext, customerId: string) {
    const customer = await this.customerOrThrow(customerId);
    await this.assertCustomerRead(actor, customer);
    return this.serializeCustomer(customer, actor.type === 'CUSTOMER');
  }

  async update(actor: ActorContext, customerId: string, dto: UpdateCustomerDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'customers.manage', customer);
    const nextFullName = dto.fullName?.trim() ?? customer.fullName;
    const nextPhone = dto.phone === undefined ? customer.phone : normalizeVietnamesePhone(dto.phone);
    const nextEmail = dto.email === undefined ? customer.email : dto.email;
    const nextDob = dto.dateOfBirth === undefined ? customer.dateOfBirth : dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    const email = normalizedEmail(nextEmail);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: {
          fullName: nextFullName, normalizedName: normalizedName(nextFullName), phone: nextPhone,
          phoneNormalized: nextPhone, email, emailNormalized: email, dateOfBirth: nextDob,
          ...(dto.provenance ? { provenance: dto.provenance.trim() } : {}),
          ...(dto.verificationStatus ? { verificationStatus: dto.verificationStatus } : {}),
        },
        include: { assignments: { where: { endedAt: null } } },
      });
      await this.syncDuplicateCandidates(tx, updated);
      await this.audit.write(tx, {
        actor, action: 'customer.updated', targetType: 'customer', targetId: updated.id, branchId: updated.branchId,
        beforeState: this.customerAuditState(customer), afterState: this.customerAuditState(updated), requestId: requestId(request),
      });
      return this.serializeCustomer(updated);
    });
  }

  async changeStatus(actor: ActorContext, customerId: string, dto: ChangeCustomerStatusDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'customers.manage', customer);
    if (customer.status === dto.status) throw new BadRequestException({ code: 'CUSTOMER_STATUS_UNCHANGED' });
    return this.prisma.$transaction(async (tx) => {
      if (dto.status === CustomerStatus.CONVERTED) {
        const contractCount = await tx.loanContract.count({ where: { customerId, status: 'COMPLETED' } });
        if (!contractCount) throw new ConflictException({ code: 'CONVERTED_REQUIRES_CONTRACT' });
      }
      const updated = await tx.customer.update({ where: { id: customerId }, data: { status: dto.status } });
      await tx.customerStatusHistory.create({
        data: { customerId, fromStatus: customer.status, toStatus: dto.status, reason: dto.reason.trim(), changedById: actor.id },
      });
      await this.audit.write(tx, {
        actor, action: 'customer.status.changed', targetType: 'customer', targetId: customerId, branchId: customer.branchId,
        reason: dto.reason.trim(), beforeState: { status: customer.status }, afterState: { status: updated.status }, requestId: requestId(request),
      });
      return updated;
    });
  }

  async assign(actor: ActorContext, customerId: string, dto: AssignCustomerDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'customers.assign', customer);
    await this.assertAdviserInBranch(dto.adviserId, customer.branchId);
    const reason = dto.reason?.trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.customerAssignment.updateMany({ where: { customerId, endedAt: null }, data: { endedAt: new Date() } });
      const assignment = await tx.customerAssignment.create({
        data: { customerId, adviserId: dto.adviserId, branchId: customer.branchId, assignedById: actor.id, isPrimary: true },
      });
      await this.audit.write(tx, {
        actor, action: 'customer.assigned', targetType: 'customer', targetId: customerId, branchId: customer.branchId,
        reason: reason || undefined, afterState: { adviserId: dto.adviserId, assignmentId: assignment.id }, requestId: requestId(request),
      });
      return assignment;
    });
  }

  async bulkAssign(actor: ActorContext, dto: BulkAssignCustomersDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const customers = await Promise.all(dto.customerIds.map((id) => this.customerOrThrow(id)));
    for (const customer of customers) {
      await this.assertCustomerAccess(actor, 'customers.assign', customer);
    }
    for (const branchId of new Set(customers.map(({ branchId }) => branchId))) {
      await this.assertAdviserInBranch(dto.adviserId, branchId);
    }
    const reason = dto.reason?.trim();

    return this.prisma.$transaction(async (tx) => {
      const currentCustomers = await tx.customer.findMany({
        where: { id: { in: dto.customerIds } },
        include: { assignments: { where: { endedAt: null }, select: { adviserId: true } } },
      });
      if (currentCustomers.length !== dto.customerIds.length) {
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND' });
      }

      const results: Array<{ customerId: string; assignmentId: string | null; changed: boolean }> = [];
      for (const customer of currentCustomers) {
        const current = customer.assignments[0];
        if (current?.adviserId === dto.adviserId) {
          results.push({ customerId: customer.id, assignmentId: null, changed: false });
          continue;
        }
        await tx.customerAssignment.updateMany({
          where: { customerId: customer.id, endedAt: null },
          data: { endedAt: new Date() },
        });
        const assignment = await tx.customerAssignment.create({
          data: {
            customerId: customer.id,
            adviserId: dto.adviserId,
            branchId: customer.branchId,
            assignedById: actor.id,
            isPrimary: true,
          },
        });
        await this.audit.write(tx, {
          actor,
          action: 'customer.assigned',
          targetType: 'customer',
          targetId: customer.id,
          branchId: customer.branchId,
          reason: reason || undefined,
          afterState: { adviserId: dto.adviserId, assignmentId: assignment.id, bulk: true },
          requestId: requestId(request),
        });
        results.push({ customerId: customer.id, assignmentId: assignment.id, changed: true });
      }
      return {
        adviserId: dto.adviserId,
        requestedCount: dto.customerIds.length,
        assignedCount: results.filter(({ changed }) => changed).length,
        unchangedCount: results.filter(({ changed }) => !changed).length,
        items: results,
      };
    });
  }

  async assignments(actor: ActorContext, customerId: string) {
    this.assertStaff(actor);
    const customer = await this.customerOrThrow(customerId);
    await this.assertCustomerRead(actor, customer);
    return this.prisma.customerAssignment.findMany({
      where: { customerId }, orderBy: { assignedAt: 'desc' },
      include: { adviser: { select: { id: true, username: true, displayName: true } }, assignedBy: { select: { id: true, username: true, displayName: true } } },
    });
  }

  async duplicateCandidates(actor: ActorContext, customerId: string) {
    const customer = await this.customerOrThrow(customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'customers.read', customer);
    return this.prisma.duplicateCandidate.findMany({
      where: { customerId, isCurrent: true }, orderBy: { updatedAt: 'desc' },
      include: { candidateCustomer: { select: { id: true, fullName: true, phone: true, email: true, dateOfBirth: true, branchId: true } } },
    });
  }

  async resolveDuplicate(actor: ActorContext, customerId: string, candidateId: string, dto: ResolveDuplicateDto, request?: ActorRequest) {
    if (dto.status === DuplicateReviewStatus.OPEN) throw new BadRequestException({ code: 'INVALID_DUPLICATE_RESOLUTION' });
    const customer = await this.customerOrThrow(customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'customers.duplicates.review', customer);
    const candidate = await this.prisma.duplicateCandidate.findFirst({ where: { id: candidateId, customerId }, include: { candidateCustomer: true } });
    if (!candidate) throw new NotFoundException({ code: 'DUPLICATE_CANDIDATE_NOT_FOUND' });
    await this.assertCustomerAccess(actor, 'customers.duplicates.review', { ...candidate.candidateCustomer, assignments: [] });
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.duplicateCandidate.update({
        where: { id: candidate.id },
        data: { status: dto.status, reviewedById: actor.id, reviewedAt: new Date(), resolutionReason: dto.reason.trim() },
      });
      await tx.duplicateCandidate.updateMany({
        where: { customerId: candidate.candidateCustomerId, candidateCustomerId: customer.id },
        data: { status: dto.status, reviewedById: actor.id, reviewedAt: updated.reviewedAt, resolutionReason: dto.reason.trim() },
      });
      await this.audit.write(tx, {
        actor, action: 'customer.duplicate.resolved', targetType: 'duplicate_candidate', targetId: candidate.id, branchId: customer.branchId,
        reason: dto.reason.trim(), beforeState: { status: candidate.status }, afterState: { status: updated.status, candidateCustomerId: candidate.candidateCustomerId }, requestId: requestId(request),
      });
      return updated;
    });
  }

  async listLoanRequests(actor: ActorContext, customerId?: string) {
    const rows = await this.prisma.loanRequest.findMany({
      where: customerId ? { customerId } : undefined, orderBy: { createdAt: 'desc' }, take: 100,
      include: { customer: { include: { assignments: { where: { endedAt: null } } } } },
    });
    const output = [];
    for (const row of rows) {
      if (await this.canReadLoanRequest(actor, row.customer)) output.push(this.serializeLoanRequest(row, actor.type === 'CUSTOMER'));
    }
    return output;
  }

  async listLoanProducts(actor: ActorContext, query: LoanProductListQueryDto) {
    const customer = actor.type === 'CUSTOMER' ? await this.customerOrThrow(actor.id) : null;
    if (actor.type === 'STAFF') this.assertStaff(actor);
    if (query.branchId && actor.type === 'STAFF') {
      await this.access.assertPermission(actor.id, 'loan-products.read', undefined, query.branchId);
    }
    const products = await this.prisma.loanProduct.findMany({
      where: {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
    const visible = [];
    for (const product of products) {
      const allowed = customer
        ? product.status === LoanProductStatus.ACTIVE && (!product.branchId || product.branchId === customer.branchId)
        : await this.canReadLoanProduct(actor, product);
      if (allowed) visible.push(this.serializeLoanProduct(product));
    }
    return visible;
  }

  async loanProductDetail(actor: ActorContext, productId: string) {
    const product = await this.loanProductOrThrow(productId);
    if (actor.type === 'CUSTOMER') {
      const customer = await this.customerOrThrow(actor.id);
      if (product.status !== LoanProductStatus.ACTIVE || (product.branchId && product.branchId !== customer.branchId)) {
        throw new NotFoundException({ code: 'LOAN_PRODUCT_NOT_FOUND' });
      }
    } else {
      await this.assertLoanProductAccess(actor, 'loan-products.read', product);
    }
    return this.serializeLoanProduct(product);
  }

  async createLoanProduct(actor: ActorContext, dto: CreateLoanProductDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const branchId = dto.branchId ?? null;
    if (branchId) {
      await this.assertBranchManagePermission(actor, 'loan-products.manage', branchId);
      await this.assertBranchExists(branchId);
    } else {
      await this.access.assertPermission(actor.id, 'loan-products.manage', AccessScope.ALL);
    }
    const minAmount = dto.minAmount ? new Prisma.Decimal(dto.minAmount) : null;
    const maxAmount = dto.maxAmount ? new Prisma.Decimal(dto.maxAmount) : null;
    if (
      minAmount?.isZero()
      || maxAmount?.isZero()
      || (minAmount && maxAmount && minAmount.greaterThan(maxAmount))
      || dto.minTermMonths > dto.maxTermMonths
    ) {
      throw new BadRequestException({ code: 'LOAN_PRODUCT_INVALID_LIMITS' });
    }
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.loanProduct.create({
          data: {
            branchId,
            code: dto.code?.trim() || `LP-${randomUUID().toUpperCase()}`,
            name: dto.name.trim(),
            loanType: dto.loanType.trim(),
            source: dto.source.trim(),
            description: dto.description?.trim(),
            sourceUrl: dto.sourceUrl?.trim(),
            thumbnailUrl: dto.thumbnailUrl?.trim(),
            minTermMonths: dto.minTermMonths,
            maxTermMonths: dto.maxTermMonths,
            minAmount,
            maxAmount,
            annualInterestRate: new Prisma.Decimal(dto.annualInterestRate),
            createdById: actor.id,
          },
          include: { branch: { select: { id: true, code: true, name: true } } },
        });
        await this.audit.write(tx, {
          actor,
          action: 'loan_product.created',
          targetType: 'loan_product',
          targetId: created.id,
          branchId,
          afterState: { code: created.code, name: created.name, status: created.status },
          requestId: requestId(request),
        });
        return created;
      });
      return this.serializeLoanProduct(product);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'LOAN_PRODUCT_CODE_EXISTS' });
      }
      throw error;
    }
  }

  async updateLoanProduct(actor: ActorContext, productId: string, dto: UpdateLoanProductDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const product = await this.loanProductOrThrow(productId);
    await this.assertLoanProductAccess(actor, 'loan-products.manage', product, true);
    if (product.status === LoanProductStatus.ACTIVE) {
      throw new ConflictException({ code: 'ACTIVE_LOAN_PRODUCT_IMMUTABLE' });
    }
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException({ code: 'LOAN_PRODUCT_UPDATE_EMPTY' });
    }
    const minAmount = dto.minAmount === undefined
      ? product.minAmount
      : dto.minAmount === null ? null : new Prisma.Decimal(dto.minAmount);
    const maxAmount = dto.maxAmount === undefined
      ? product.maxAmount
      : dto.maxAmount === null ? null : new Prisma.Decimal(dto.maxAmount);
    const minTermMonths = dto.minTermMonths ?? product.minTermMonths;
    const maxTermMonths = dto.maxTermMonths ?? product.maxTermMonths;
    if (
      minAmount?.isZero()
      || maxAmount?.isZero()
      || (minAmount && maxAmount && minAmount.greaterThan(maxAmount))
      || minTermMonths > maxTermMonths
    ) {
      throw new BadRequestException({ code: 'LOAN_PRODUCT_INVALID_LIMITS' });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.loanProduct.update({
        where: { id: product.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.loanType !== undefined ? { loanType: dto.loanType.trim() } : {}),
          ...(dto.source !== undefined ? { source: dto.source.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl?.trim() ?? null } : {}),
          ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl?.trim() ?? null } : {}),
          minTermMonths,
          maxTermMonths,
          minAmount,
          maxAmount,
          ...(dto.annualInterestRate !== undefined ? { annualInterestRate: new Prisma.Decimal(dto.annualInterestRate) } : {}),
        },
        include: { branch: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.write(tx, {
        actor,
        action: 'loan_product.updated',
        targetType: 'loan_product',
        targetId: row.id,
        branchId: row.branchId,
        beforeState: { name: product.name, minAmount: product.minAmount?.toFixed(2) ?? null, maxAmount: product.maxAmount?.toFixed(2) ?? null, status: product.status },
        afterState: { name: row.name, minAmount: row.minAmount?.toFixed(2) ?? null, maxAmount: row.maxAmount?.toFixed(2) ?? null, status: row.status },
        requestId: requestId(request),
      });
      return row;
    });
    return this.serializeLoanProduct(updated);
  }

  async setLoanProductStatus(actor: ActorContext, productId: string, dto: SetLoanProductStatusDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const product = await this.loanProductOrThrow(productId);
    await this.assertLoanProductAccess(actor, 'loan-products.publish', product, true);
    if (product.status === dto.status) return this.serializeLoanProduct(product);
    const allowedTransition = product.status === LoanProductStatus.DRAFT
      ? dto.status === LoanProductStatus.ACTIVE || dto.status === LoanProductStatus.INACTIVE
      : (product.status === LoanProductStatus.ACTIVE && dto.status === LoanProductStatus.INACTIVE)
      || (product.status === LoanProductStatus.INACTIVE && dto.status === LoanProductStatus.ACTIVE);
    if (!allowedTransition) throw new ConflictException({ code: 'LOAN_PRODUCT_STATUS_TRANSITION_INVALID' });
    if (dto.status === LoanProductStatus.ACTIVE) {
      if (!product.currentFormulaVersion) throw new ConflictException({ code: 'LOAN_PRODUCT_FORMULA_REQUIRED' });
      if (product.branchId) await this.assertBranchExists(product.branchId);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.loanProduct.update({ where: { id: product.id }, data: { status: dto.status }, include: { branch: { select: { id: true, code: true, name: true } } } });
      await this.audit.write(tx, {
        actor,
        action: 'loan_product.status.changed',
        targetType: 'loan_product',
        targetId: row.id,
        branchId: row.branchId,
        beforeState: { status: product.status },
        afterState: { status: row.status },
        requestId: requestId(request),
      });
      return row;
    });
    return this.serializeLoanProduct(updated);
  }

  async getLoanProductFormula(actor: ActorContext, productId: string) {
    this.assertStaff(actor);
    await this.access.assertPermission(actor.id, 'loan-products.formula.manage', AccessScope.ALL);
    const product = await this.loanProductOrThrow(productId);
    if (!product.currentFormulaVersion) return null;
    return this.prisma.loanProductFormulaVersion.findUnique({
      where: { productId_version: { productId, version: product.currentFormulaVersion } },
    });
  }

  async getLoanProductFormulaHistory(actor: ActorContext, productId: string, beforeVersion?: number) {
    this.assertStaff(actor);
    await this.access.assertPermission(actor.id, 'loan-products.formula.manage', AccessScope.ALL);
    await this.loanProductOrThrow(productId);
    const pageSize = 10;
    const versions = await this.prisma.loanProductFormulaVersion.findMany({
      where: {
        productId,
        ...(beforeVersion === undefined ? {} : { version: { lt: beforeVersion } }),
      },
      orderBy: { version: 'desc' },
      take: pageSize + 1,
      select: {
        version: true,
        interestFormula: true,
        monthlyPaymentFormula: true,
        variables: true,
        createdAt: true,
        createdBy: { select: { displayName: true, username: true } },
      },
    });
    const items = versions.slice(0, pageSize);
    return {
      items,
      nextBeforeVersion: versions.length > pageSize ? items[items.length - 1].version : null,
    };
  }

  async getLoanProductFormulaInputs(actor: ActorContext, productId: string) {
    this.assertStaff(actor);
    const product = await this.loanProductOrThrow(productId);
    await this.assertLoanProductAccess(actor, 'loan-products.read', product);
    if (product.status !== LoanProductStatus.ACTIVE) throw new ConflictException({ code: 'LOAN_PRODUCT_NOT_ACTIVE' });
    if (!product.currentFormulaVersion) throw new ConflictException({ code: 'LOAN_PRODUCT_FORMULA_REQUIRED' });
    const formula = await this.prisma.loanProductFormulaVersion.findUnique({
      where: { productId_version: { productId: product.id, version: product.currentFormulaVersion } },
      select: { version: true, variables: true },
    });
    if (!formula) throw new ConflictException({ code: 'LOAN_PRODUCT_FORMULA_REQUIRED' });
    return { version: formula.version, variables: formula.variables };
  }

  async setLoanProductFormula(actor: ActorContext, productId: string, dto: SetLoanProductFormulaDto, request?: ActorRequest) {
    this.assertStaff(actor);
    await this.access.assertPermission(actor.id, 'loan-products.formula.manage', AccessScope.ALL);
    const product = await this.loanProductOrThrow(productId);
    const variables = validateLoanFormulaVariables(dto.variables);
    validateLoanFormula(dto.interestFormula, variables);
    validateLoanFormula(dto.monthlyPaymentFormula, variables);
    return this.prisma.$transaction(async (tx) => {
      const version = product.currentFormulaVersion + 1;
      const claimed = await tx.loanProduct.updateMany({
        where: { id: product.id, currentFormulaVersion: product.currentFormulaVersion },
        data: { currentFormulaVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'LOAN_PRODUCT_FORMULA_VERSION_CHANGED' });
      const formula = await tx.loanProductFormulaVersion.create({
        data: {
          productId: product.id,
          version,
          interestFormula: dto.interestFormula.trim(),
          monthlyPaymentFormula: dto.monthlyPaymentFormula.trim(),
          variables,
          createdById: actor.id,
        },
      });
      await this.audit.write(tx, {
        actor,
        action: 'loan_product.formula.version.created',
        targetType: 'loan_product',
        targetId: product.id,
        branchId: product.branchId,
        afterState: { version, variableCount: variables.length },
        requestId: requestId(request),
      });
      return formula;
    });
  }

  async calculateLoanProduct(actor: ActorContext, productId: string, dto: CalculateLoanProductDto) {
    const product = await this.loanProductOrThrow(productId);
    if (product.status !== LoanProductStatus.ACTIVE) throw new ConflictException({ code: 'LOAN_PRODUCT_NOT_ACTIVE' });
    if (actor.type === 'CUSTOMER') {
      const customer = await this.customerOrThrow(actor.id);
      if (product.branchId && product.branchId !== customer.branchId) {
        throw new NotFoundException({ code: 'LOAN_PRODUCT_NOT_FOUND' });
      }
    } else {
      this.assertStaff(actor);
      await this.access.assertPermission(actor.id, 'loan-contracts.manage', undefined, product.branchId ?? undefined);
      await this.assertLoanProductAccess(actor, 'loan-products.read', product);
    }
    const principal = new Prisma.Decimal(dto.principal);
    if (
      (product.minAmount !== null && principal.lessThan(product.minAmount))
      || (product.maxAmount !== null && principal.greaterThan(product.maxAmount))
      || dto.termMonths < product.minTermMonths
      || dto.termMonths > product.maxTermMonths
    ) {
      throw new BadRequestException({ code: 'LOAN_PRODUCT_LIMITS_NOT_MET' });
    }
    const formula = await this.prisma.loanProductFormulaVersion.findUnique({
      where: { productId_version: { productId: product.id, version: product.currentFormulaVersion } },
    });
    if (!formula) throw new ConflictException({ code: 'LOAN_PRODUCT_FORMULA_REQUIRED' });
    const variables = validateLoanFormulaVariables(formula.variables);
    const normalized = normalizeLoanFormulaInputs(variables, dto.formulaInputs, {
      principal: principal.toFixed(2),
      annualRatePercent: product.annualInterestRate.toString(),
      termMonths: dto.termMonths,
    });
    const interest = evaluateLoanFormula(formula.interestFormula, normalized.values)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const monthlyPayment = evaluateLoanFormula(formula.monthlyPaymentFormula, normalized.values)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (interest.isNegative() || monthlyPayment.isNegative()) {
      throw new BadRequestException({ code: 'LOAN_FORMULA_NEGATIVE_RESULT' });
    }
    return {
      productId: product.id,
      formulaVersion: formula.version,
      inputs: normalized.snapshot,
      outputs: {
        interestAmount: interest.toFixed(2),
        monthlyPayment: monthlyPayment.toFixed(2),
        totalRepayment: principal.plus(interest).toFixed(2),
      },
    };
  }

  async createLoanRequest(actor: ActorContext, dto: CreateLoanRequestDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(dto.customerId);
    if (actor.type === 'CUSTOMER') {
      if (actor.id !== customer.id) throw new ForbiddenException({ code: 'CUSTOMER_OWN_DATA_ONLY' });
    } else {
      await this.assertCustomerAccess(actor, 'loan-requests.manage', customer);
    }
    const product = dto.productId ? await this.loanProductOrThrow(dto.productId) : null;
    if (product) {
      if (actor.type === 'STAFF') await this.assertLoanProductAccess(actor, 'loan-products.read', product);
      if (product.status !== LoanProductStatus.ACTIVE) throw new ConflictException({ code: 'LOAN_PRODUCT_NOT_ACTIVE' });
      if (product.branchId && product.branchId !== customer.branchId) throw new NotFoundException({ code: 'LOAN_PRODUCT_NOT_FOUND' });
      if (dto.requestedAmount === undefined || dto.requestedTermMonths === undefined) {
        throw new BadRequestException({ code: 'LOAN_PRODUCT_REQUEST_INPUT_REQUIRED' });
      }
      const requestedAmount = new Prisma.Decimal(dto.requestedAmount);
      if (
        (product.minAmount !== null && requestedAmount.lessThan(product.minAmount))
        || (product.maxAmount !== null && requestedAmount.greaterThan(product.maxAmount))
        || dto.requestedTermMonths < product.minTermMonths
        || dto.requestedTermMonths > product.maxTermMonths
      ) throw new BadRequestException({ code: 'LOAN_PRODUCT_LIMITS_NOT_MET' });
    } else if (!dto.topic?.trim()) {
      throw new BadRequestException({ code: 'LOAN_REQUEST_TOPIC_REQUIRED' });
    }
    return this.prisma.$transaction(async (tx) => {
      const loanRequest = await tx.loanRequest.create({
        data: {
          customerId: customer.id, branchId: customer.branchId,
          productId: product?.id,
          requestedAmount: dto.requestedAmount === undefined ? undefined : new Prisma.Decimal(dto.requestedAmount),
          requestedTermMonths: dto.requestedTermMonths,
          source: actor.type === 'CUSTOMER' ? LoanRequestSource.CUSTOMER : LoanRequestSource.ADVISING,
          topic: dto.topic?.trim() || product?.name || '',
          notes: dto.notes?.trim(), recordedById: actor.type === 'STAFF' ? actor.id : null,
        },
      });
      await this.audit.write(tx, {
        actor, action: 'loan_request.created', targetType: 'loan_request', targetId: loanRequest.id, branchId: customer.branchId,
        afterState: { source: loanRequest.source, customerId: customer.id }, requestId: requestId(request),
      });
      return this.serializeLoanRequest(loanRequest, actor.type === 'CUSTOMER');
    });
  }

  async updateLoanRequestStatus(actor: ActorContext, loanRequestId: string, dto: UpdateLoanRequestStatusDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const row = await this.prisma.loanRequest.findUnique({ where: { id: loanRequestId }, include: { customer: { include: { assignments: { where: { endedAt: null } } } } } });
    if (!row) throw new NotFoundException({ code: 'LOAN_REQUEST_NOT_FOUND' });
    await this.assertCustomerAccess(actor, 'loan-requests.manage', row.customer);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.loanRequest.update({ where: { id: row.id }, data: { status: dto.status } });
      await this.audit.write(tx, {
        actor, action: 'loan_request.status.changed', targetType: 'loan_request', targetId: row.id, branchId: row.branchId,
        beforeState: { status: row.status }, afterState: { status: updated.status }, requestId: requestId(request),
      });
      return this.serializeLoanRequest(updated);
    });
  }

  async listLoanContracts(actor: ActorContext, query: ContractListQueryDto) {
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.LoanContractWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { contractNumber: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
    };
    const output = [];
    let scanCursor = query.cursor;
    let hasMore = false;
    const hasGlobalReview = actor.type === 'STAFF'
      && await this.access.hasPermission(actor.id, 'loan-contracts.review', AccessScope.ALL);

    while (output.length < pageSize) {
      const rows = await this.prisma.loanContract.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
        take: 100,
        include: {
          branch: { select: { name: true } },
          customer: { include: { assignments: { where: { endedAt: null } } } },
        },
      });
      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      let pageFilled = false;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        scanCursor = row.id;
        if (await this.canReadContract(actor, row.customer)) {
          const contract = this.serializeContract(row, actor.type === 'CUSTOMER');
          output.push(actor.type === 'CUSTOMER'
            ? contract
            : {
              ...contract,
              customerName: row.customer.fullName,
              branchName: row.branch.name,
              canReview: row.status === LoanContractStatus.PENDING_REVIEW
                && row.createdById !== actor.id
                && (hasGlobalReview || await this.access.isBranchManager(actor.id, row.branchId)),
            });
        }
        if (output.length === pageSize) {
          hasMore = index < rows.length - 1;
          if (!hasMore && rows.length === 100) {
            hasMore = (await this.prisma.loanContract.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              cursor: { id: row.id },
              skip: 1,
              take: 1,
              select: { id: true },
            })).length > 0;
          }
          pageFilled = true;
          break;
        }
      }

      if (pageFilled) break;
      if (rows.length < 100) {
        hasMore = false;
        break;
      }
      hasMore = true;
    }

    return { items: output, pageSize, nextCursor: hasMore ? scanCursor : null };
  }

  async listContractDocuments(actor: ActorContext, contractId: string) {
    await this.contractForAction(actor, contractId);
    const documents = await this.prisma.loanContractDocument.findMany({
      where: { contractId, deletedAt: null },
      include: { uploadedBy: { select: { displayName: true, username: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      createdAt: document.createdAt,
      uploadedBy: document.uploadedBy,
      downloadPath: `/loan-contracts/${contractId}/documents/${document.id}/download`,
    }));
  }

  async uploadContractDocument(actor: ActorContext, contractId: string, file: ContractUploadFile | undefined, request?: ActorRequest) {
    this.assertStaff(actor);
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.manage', contract.branchId);
    const fileData = this.validateContractDocument(file);
    const storageKey = `${randomUUID()}${fileData.extension}`;
    const filePath = join(CONTRACT_DOCUMENT_DIRECTORY, storageKey);
    await mkdir(CONTRACT_DOCUMENT_DIRECTORY, { recursive: true });
    await writeFile(filePath, fileData.buffer, { flag: 'wx' });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.loanContractDocument.create({
          data: {
            contractId,
            fileName: fileData.fileName,
            storageKey,
            mimeType: fileData.mimeType,
            sizeBytes: fileData.sizeBytes,
            uploadedById: actor.id,
          },
          include: { uploadedBy: { select: { displayName: true, username: true } } },
        });
        await tx.loanContractChangeHistory.create({
          data: {
            contractId,
            action: 'DOCUMENT_UPLOADED',
            afterState: { fileName: document.fileName, documentId: document.id, sizeBytes: document.sizeBytes },
            changedById: actor.id,
          },
        });
        await this.audit.write(tx, {
          actor,
          action: 'loan_contract.document.uploaded',
          targetType: 'loan_contract',
          targetId: contractId,
          branchId: contract.branchId,
          afterState: { fileName: document.fileName, documentId: document.id, sizeBytes: document.sizeBytes },
          requestId: requestId(request),
        });
        return {
          id: document.id,
          fileName: document.fileName,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          createdAt: document.createdAt,
          uploadedBy: document.uploadedBy,
          downloadPath: `/loan-contracts/${contractId}/documents/${document.id}/download`,
        };
      });
    } catch (error) {
      await unlink(filePath);
      throw error;
    }
  }

  async replaceContractDocument(
    actor: ActorContext,
    contractId: string,
    documentId: string,
    file: ContractUploadFile | undefined,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.manage', contract.branchId);
    const existing = await this.prisma.loanContractDocument.findFirst({ where: { id: documentId, contractId, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 'LOAN_CONTRACT_DOCUMENT_NOT_FOUND' });

    const fileData = this.validateContractDocument(file);
    const storageKey = `${randomUUID()}${fileData.extension}`;
    const filePath = join(CONTRACT_DOCUMENT_DIRECTORY, storageKey);
    await mkdir(CONTRACT_DOCUMENT_DIRECTORY, { recursive: true });
    await writeFile(filePath, fileData.buffer, { flag: 'wx' });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.loanContractDocument.findFirst({ where: { id: documentId, contractId, deletedAt: null } });
        if (!current) throw new NotFoundException({ code: 'LOAN_CONTRACT_DOCUMENT_NOT_FOUND' });
        const now = new Date();
        await tx.loanContractDocument.update({ where: { id: documentId }, data: { deletedAt: now } });
        const replacement = await tx.loanContractDocument.create({
          data: {
            contractId,
            fileName: fileData.fileName,
            storageKey,
            mimeType: fileData.mimeType,
            sizeBytes: fileData.sizeBytes,
            uploadedById: actor.id,
          },
          include: { uploadedBy: { select: { displayName: true, username: true } } },
        });
        const beforeState = { fileName: current.fileName, documentId: current.id, sizeBytes: current.sizeBytes };
        const afterState = { fileName: replacement.fileName, documentId: replacement.id, sizeBytes: replacement.sizeBytes };
        await tx.loanContractChangeHistory.create({
          data: { contractId, action: 'DOCUMENT_REPLACED', beforeState, afterState, changedById: actor.id },
        });
        await this.audit.write(tx, {
          actor,
          action: 'loan_contract.document.replaced',
          targetType: 'loan_contract',
          targetId: contractId,
          branchId: contract.branchId,
          beforeState,
          afterState,
          requestId: requestId(request),
        });
        return {
          id: replacement.id,
          fileName: replacement.fileName,
          mimeType: replacement.mimeType,
          sizeBytes: replacement.sizeBytes,
          createdAt: replacement.createdAt,
          uploadedBy: replacement.uploadedBy,
          downloadPath: `/loan-contracts/${contractId}/documents/${replacement.id}/download`,
        };
      });
    } catch (error) {
      await unlink(filePath);
      throw error;
    }
  }

  async deleteContractDocument(actor: ActorContext, contractId: string, documentId: string, request?: ActorRequest) {
    this.assertStaff(actor);
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.manage', contract.branchId);
    const document = await this.prisma.loanContractDocument.findFirst({ where: { id: documentId, contractId, deletedAt: null } });
    if (!document) throw new NotFoundException({ code: 'LOAN_CONTRACT_DOCUMENT_NOT_FOUND' });

    return this.prisma.$transaction(async (tx) => {
      const deletedAt = new Date();
      const result = await tx.loanContractDocument.updateMany({
        where: { id: documentId, contractId, deletedAt: null },
        data: { deletedAt },
      });
      if (result.count !== 1) throw new NotFoundException({ code: 'LOAN_CONTRACT_DOCUMENT_NOT_FOUND' });
      const beforeState = { fileName: document.fileName, documentId: document.id, sizeBytes: document.sizeBytes };
      const afterState = { deletedAt: deletedAt.toISOString() };
      await tx.loanContractChangeHistory.create({
        data: { contractId, action: 'DOCUMENT_SOFT_DELETED', beforeState, afterState, changedById: actor.id },
      });
      await this.audit.write(tx, {
        actor,
        action: 'loan_contract.document.soft_deleted',
        targetType: 'loan_contract',
        targetId: contractId,
        branchId: contract.branchId,
        beforeState,
        afterState,
        requestId: requestId(request),
      });
      return { id: documentId, deletedAt };
    });
  }

  async getContractDocumentFile(actor: ActorContext, contractId: string, documentId: string) {
    await this.contractForAction(actor, contractId);
    const document = await this.prisma.loanContractDocument.findFirst({
      where: { id: documentId, contractId, deletedAt: null },
      select: { fileName: true, storageKey: true, mimeType: true },
    });
    if (!document) throw new NotFoundException({ code: 'LOAN_CONTRACT_DOCUMENT_NOT_FOUND' });
    if (!/^[\da-f-]{36}\.(docx|jpeg|jpg|pdf|png)$/.test(document.storageKey)) {
      throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_STORAGE_KEY_INVALID' });
    }

    const filePath = join(CONTRACT_DOCUMENT_DIRECTORY, document.storageKey);
    try {
      if (!(await stat(filePath)).isFile()) throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_FILE_MISSING' });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_FILE_MISSING' });
      }
      throw error;
    }
    return { filePath, fileName: document.fileName, mimeType: document.mimeType };
  }

  async getContractHistory(actor: ActorContext, contractId: string) {
    await this.contractForAction(actor, contractId);
    const [statusHistory, changeHistory] = await Promise.all([
      this.prisma.loanContractStatusHistory.findMany({
        where: { contractId },
        include: {
          changedBy: { select: { displayName: true, username: true } },
          changedByCustomer: { select: { fullName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.loanContractChangeHistory.findMany({
        where: { contractId },
        include: { changedBy: { select: { displayName: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const items = [
      ...statusHistory.map((entry) => ({
        id: entry.id,
        action: 'STATUS_CHANGED',
        beforeState: { status: entry.fromStatus },
        afterState: { status: entry.toStatus, reason: entry.reason },
        changedBy: entry.changedBy ?? (entry.changedByCustomer ? { displayName: entry.changedByCustomer.fullName, username: null } : null),
        createdAt: entry.createdAt,
      })),
      ...changeHistory.map((entry) => ({
        id: entry.id,
        action: entry.action,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
        changedBy: entry.changedBy,
        createdAt: entry.createdAt,
      })),
    ];
    items.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return { items };
  }

  private validateContractDocument(file: ContractUploadFile | undefined) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException({ code: 'LOAN_CONTRACT_DOCUMENT_REQUIRED' });
    }
    if (file.size !== file.buffer.length || file.size > CONTRACT_DOCUMENT_MAX_BYTES) {
      throw new BadRequestException({ code: 'LOAN_CONTRACT_DOCUMENT_SIZE_INVALID' });
    }

    const fileName = basename(file.originalname.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const extension = extname(fileName).toLowerCase();
    const mimeType = CONTRACT_DOCUMENT_MIME_TYPES[extension];
    if (!fileName || fileName.length > 255 || !mimeType || file.mimetype !== mimeType) {
      throw new BadRequestException({ code: 'LOAN_CONTRACT_DOCUMENT_TYPE_INVALID' });
    }

    const signatureIsValid = extension === '.pdf'
      ? file.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
      : extension === '.png'
        ? file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : extension === '.jpg' || extension === '.jpeg'
          ? file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff
          : file.buffer[0] === 0x50
          && file.buffer[1] === 0x4b
          && file.buffer[2] === 0x03
          && file.buffer[3] === 0x04
          && file.buffer.includes(Buffer.from('[Content_Types].xml'))
          && file.buffer.includes(Buffer.from('word/document.xml'));
    if (!signatureIsValid) throw new BadRequestException({ code: 'LOAN_CONTRACT_DOCUMENT_CONTENT_INVALID' });

    return { fileName, extension, mimeType, sizeBytes: file.size, buffer: file.buffer };
  }

  async createLoanContract(actor: ActorContext, dto: CreateLoanContractDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(dto.customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'loan-contracts.manage', customer);
    const loanRequest = dto.loanRequestId
      ? await this.prisma.loanRequest.findUnique({ where: { id: dto.loanRequestId } })
      : null;
    if (dto.loanRequestId && !loanRequest) throw new NotFoundException({ code: 'LOAN_REQUEST_NOT_FOUND' });
    if (loanRequest && loanRequest.customerId !== customer.id) throw new BadRequestException({ code: 'LOAN_REQUEST_CUSTOMER_MISMATCH' });
    if (dto.productId && loanRequest?.productId && dto.productId !== loanRequest.productId) {
      throw new BadRequestException({ code: 'LOAN_REQUEST_PRODUCT_MISMATCH' });
    }
    const productId = dto.productId ?? loanRequest?.productId ?? null;
    const product = productId ? await this.loanProductOrThrow(productId) : null;
    let calculation: Awaited<ReturnType<CustomersService['calculateLoanProduct']>> | null = null;
    let formula: Prisma.LoanProductFormulaVersionGetPayload<object> | null = null;
    let loanAmount: Prisma.Decimal | null = null;
    let termMonths = dto.termMonths ?? loanRequest?.requestedTermMonths ?? null;
    if (product) {
      await this.assertLoanProductAccess(actor, 'loan-products.read', product);
      if (product.status !== LoanProductStatus.ACTIVE) throw new ConflictException({ code: 'LOAN_PRODUCT_NOT_ACTIVE' });
      if (product.branchId && product.branchId !== customer.branchId) throw new NotFoundException({ code: 'LOAN_PRODUCT_NOT_FOUND' });
      const amountValue = dto.loanAmount ?? loanRequest?.requestedAmount?.toString();
      if (!amountValue || termMonths === null) throw new BadRequestException({ code: 'LOAN_CONTRACT_PRODUCT_INPUT_REQUIRED' });
      loanAmount = new Prisma.Decimal(amountValue);
      calculation = await this.calculateLoanProduct(actor, product.id, {
        principal: loanAmount.toString(),
        termMonths,
        formulaInputs: dto.formulaInputs,
      });
      formula = await this.prisma.loanProductFormulaVersion.findUnique({
        where: { productId_version: { productId: product.id, version: calculation.formulaVersion } },
      });
      if (!formula) throw new ConflictException({ code: 'LOAN_PRODUCT_FORMULA_REQUIRED' });
    }
    if (!product && !dto.packageName?.trim()) throw new BadRequestException({ code: 'CONTRACT_PACKAGE_NAME_REQUIRED' });
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (product && formula && loanAmount && termMonths !== null && calculation) {
          const currentProduct = await tx.loanProduct.findUnique({
            where: { id: product.id },
            select: { status: true, currentFormulaVersion: true },
          });
          if (!currentProduct || currentProduct.status !== LoanProductStatus.ACTIVE || currentProduct.currentFormulaVersion !== formula.version) {
            throw new ConflictException({ code: 'LOAN_PRODUCT_CHANGED_DURING_CONTRACT_CREATION' });
          }
        }
        if (loanRequest && await tx.loanContract.findFirst({ where: { loanRequestId: loanRequest.id }, select: { id: true } })) {
          throw new ConflictException({ code: 'LOAN_REQUEST_ALREADY_CONVERTED' });
        }
        const formulaSnapshot = product && formula ? {
          product: {
            id: product.id,
            code: product.code,
            name: product.name,
            loanType: product.loanType,
            minAmount: product.minAmount?.toFixed(2) ?? null,
            maxAmount: product.maxAmount?.toFixed(2) ?? null,
            minTermMonths: product.minTermMonths,
            maxTermMonths: product.maxTermMonths,
            annualInterestRate: product.annualInterestRate.toFixed(4),
          },
          formula: {
            version: formula.version,
            interestFormula: formula.interestFormula,
            monthlyPaymentFormula: formula.monthlyPaymentFormula,
            variables: formula.variables,
          },
        } : undefined;
        const contract = await tx.loanContract.create({
          data: {
            customerId: customer.id,
            branchId: customer.branchId,
            productId: product?.id,
            loanRequestId: loanRequest?.id,
            formulaVersionId: formula?.id,
            contractNumber: dto.contractNumber.trim(),
            packageCode: product?.code,
            packageName: product?.name ?? dto.packageName!.trim(),
            packageVersion: formula ? String(formula.version) : null,
            loanType: product?.loanType ?? dto.loanType?.trim(),
            termMonths,
            loanAmount,
            annualInterestRate: product?.annualInterestRate,
            interestAmount: calculation ? new Prisma.Decimal(calculation.outputs.interestAmount) : null,
            monthlyPayment: calculation ? new Prisma.Decimal(calculation.outputs.monthlyPayment) : null,
            formulaSnapshot,
            formulaInputs: calculation?.inputs as Prisma.InputJsonValue | undefined,
            formulaOutputs: calculation?.outputs as Prisma.InputJsonValue | undefined,
            createdById: actor.id,
            status: 'PENDING_REVIEW',
          },
        });
        await tx.loanContractStatusHistory.create({ data: { contractId: contract.id, toStatus: 'PENDING_REVIEW', reason: 'Contract created; pending branch manager review', changedById: actor.id } });
        await this.audit.write(tx, {
          actor, action: 'loan_contract.created', targetType: 'loan_contract', targetId: contract.id, branchId: customer.branchId,
          afterState: { customerId: customer.id, contractNumber: contract.contractNumber, productId: product?.id, formulaVersion: formula?.version }, requestId: requestId(request),
        });
        return this.serializeContract(contract);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'CONTRACT_NUMBER_EXISTS' });
      }
      throw error;
    }
  }

  async ingestExternalContract(actor: ActorContext, dto: ExternalLoanContractDto, idempotencyKey: string | undefined, request?: ActorRequest) {
    this.assertStaff(actor);
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    if (await this.access.hasManagedBranches(actor.id) && !(await this.access.hasPermission(actor.id, 'loan-contracts.ingest', AccessScope.ALL)) &&
      !(await this.access.isBranchManager(actor.id, dto.branchId))) throw new ForbiddenException({ code: 'BRANCH_MANAGER_WRITE_DIRECT_BRANCH_ONLY' });
    await this.access.assertPermission(actor.id, 'loan-contracts.ingest', AccessScope.BRANCH, dto.branchId);
    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId }, select: { id: true, status: true } });
    if (!branch || branch.status !== 'ACTIVE') throw new ConflictException({ code: 'BRANCH_NOT_READY' });
    const phone = normalizeVietnamesePhone(dto.customerPhone);
    const dob = dto.customerDateOfBirth ? new Date(dto.customerDateOfBirth) : null;
    const name = dto.customerFullName.trim();
    const normalized = normalizedName(name);
    const sourceSystem = dto.sourceSystem.trim();
    const externalContractId = dto.externalContractId.trim();
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    const payloadHash = createHmac('sha256', process.env.AUTH_ACCESS_TOKEN_SECRET ?? '').update(JSON.stringify({
      sourceSystem, externalContractId, contractNumber: dto.contractNumber.trim(),
      packageCode: dto.packageCode?.trim() ?? null, packageName: dto.packageName.trim(), packageVersion: dto.packageVersion?.trim() ?? null,
      loanType: dto.loanType?.trim() ?? null, termMonths: dto.termMonths ?? null, sourceUpdatedAt: dto.sourceUpdatedAt ?? null,
      customerFullName: name, customerPhone: phone, customerDateOfBirth: dto.customerDateOfBirth ?? null,
      customerEmail: normalizedEmail(dto.customerEmail), branchId: dto.branchId,
    })).digest('hex');
    const existing = await this.prisma.loanContract.findFirst({
      where: {
        OR: [
          { sourceSystem, externalContractId },
          { idempotencyKeyHash: keyHash },
        ]
      }
    });
    if (existing) {
      if (existing.sourcePayloadHash !== payloadHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return { ...this.serializeContract(existing), replayed: true };
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const matches = await tx.customer.findMany({ where: { phoneNormalized: phone, branchId: dto.branchId }, take: 3, include: { assignments: { where: { endedAt: null } } } });
        const exact = matches.filter((candidate) => candidate.normalizedName === normalized && (!dob || candidate.dateOfBirth?.getTime() === dob.getTime()));
        // Attach only to one unambiguous exact identity. Otherwise create a separate unverified customer for manual duplicate review.
        const customer = exact.length === 1 ? exact[0] : await tx.customer.create({
          data: {
            fullName: name, normalizedName: normalized, phone, phoneNormalized: phone,
            dateOfBirth: dob, email: normalizedEmail(dto.customerEmail), emailNormalized: normalizedEmail(dto.customerEmail),
            provenance: `external:${dto.sourceSystem}`, verificationStatus: 'UNVERIFIED', branchId: dto.branchId
          },
          include: { assignments: { where: { endedAt: null } } },
        });
        if (exact.length !== 1) await this.syncDuplicateCandidates(tx, customer);
        const contract = await tx.loanContract.create({
          data: {
            customerId: customer.id, branchId: dto.branchId, contractNumber: dto.contractNumber.trim(),
            packageCode: dto.packageCode?.trim(), packageName: dto.packageName.trim(), packageVersion: dto.packageVersion?.trim(),
            loanType: dto.loanType?.trim(), termMonths: dto.termMonths, sourceSystem,
            externalContractId, sourceUpdatedAt: dto.sourceUpdatedAt ? new Date(dto.sourceUpdatedAt) : undefined,
            sourcePayloadHash: payloadHash, idempotencyKeyHash: keyHash, createdById: actor.id, status: 'PENDING_REVIEW',
          }
        });
        await tx.loanContractStatusHistory.create({ data: { contractId: contract.id, toStatus: 'PENDING_REVIEW', reason: 'External import; pending branch manager review', changedById: actor.id } });
        await this.audit.write(tx, {
          actor, action: 'loan_contract.external_ingested', targetType: 'loan_contract', targetId: contract.id, branchId: dto.branchId,
          afterState: { sourceSystem: dto.sourceSystem, externalContractId: dto.externalContractId, sourcePayloadHash: payloadHash, customerCreated: exact.length !== 1 }, requestId: requestId(request)
        });
        return { ...this.serializeContract(contract), customerCreated: exact.length !== 1, replayed: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.loanContract.findFirst({
          where: {
            OR: [
              { sourceSystem, externalContractId }, { idempotencyKeyHash: keyHash },
            ]
          }
        });
        if (raced?.sourcePayloadHash === payloadHash) return { ...this.serializeContract(raced), replayed: true };
        throw new ConflictException({ code: raced ? 'IDEMPOTENCY_CONFLICT' : 'CONTRACT_NUMBER_EXISTS' });
      }
      throw error;
    }
  }

  async approveContract(actor: ActorContext, contractId: string, request?: ActorRequest) {
    const contract = await this.contractForAction(actor, contractId);
    const hasGlobalReview = await this.access.hasPermission(actor.id, 'loan-contracts.review', AccessScope.ALL);
    await this.assertBranchManagePermission(actor, 'loan-contracts.review', contract.branchId);
    if (contract.createdById === actor.id) throw new ForbiddenException({ code: 'CONTRACT_CREATOR_CANNOT_REVIEW' });
    if (!hasGlobalReview && !await this.access.isBranchManager(actor.id, contract.branchId)) throw new ForbiddenException({ code: 'DIRECT_BRANCH_MANAGER_REQUIRED' });
    if (contract.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'CONTRACT_NOT_PENDING_REVIEW' });
    return this.changeContractStatus(actor, contract, 'APPROVED', 'Branch manager approved contract', request, { approvedBy: { connect: { id: actor.id } }, approvedAt: new Date() });
  }

  async rejectContract(actor: ActorContext, contractId: string, reason: string, request?: ActorRequest) {
    const contract = await this.contractForAction(actor, contractId);
    const hasGlobalReview = await this.access.hasPermission(actor.id, 'loan-contracts.review', AccessScope.ALL);
    await this.assertBranchManagePermission(actor, 'loan-contracts.review', contract.branchId);
    if (contract.createdById === actor.id) throw new ForbiddenException({ code: 'CONTRACT_CREATOR_CANNOT_REVIEW' });
    if (!hasGlobalReview && !await this.access.isBranchManager(actor.id, contract.branchId)) throw new ForbiddenException({ code: 'DIRECT_BRANCH_MANAGER_REQUIRED' });
    if (contract.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'CONTRACT_NOT_PENDING_REVIEW' });
    return this.changeContractStatus(actor, contract, 'REJECTED', reason.trim(), request);
  }

  async requestCompletionOtp(actor: ActorContext, contractId: string, request?: ActorRequest) {
    this.assertStaff(actor);
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.status.manage', contract.branchId);
    if (!await this.access.isBranchManager(actor.id, contract.branchId)) throw new ForbiddenException({ code: 'DIRECT_BRANCH_MANAGER_REQUIRED' });
    if (contract.status !== 'APPROVED') throw new ConflictException({ code: 'CONTRACT_NOT_APPROVED' });
    if (!this.isCustomerOtpTestMode()) throw new ServiceUnavailableException({
      code: 'CUSTOMER_OTP_DEFERRED',
      status: 'DEFERRED',
      message: 'Xác nhận hợp đồng bằng OTP đang chờ cấu hình đăng nhập khách hàng trên mobile và cổng SMS.',
    });
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: contract.customerId }, select: { phone: true } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const secret = process.env.AUTH_ACCESS_TOKEN_SECRET;
    if (!secret) throw new ConflictException({ code: 'OTP_HASH_SECRET_NOT_CONFIGURED' });
    const codeHash = createHmac('sha256', secret).update(`${contract.id}:${contract.version}:${code}`).digest('hex');
    const contentHash = this.contractContentHash(contract);
    const now = new Date();
    const recent = await this.prisma.contractOtpChallenge.findMany({ where: { contractId, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } }, orderBy: { createdAt: 'desc' }, take: 3 });
    if (recent.length >= 3 || (recent[0] && now.getTime() - recent[0].lastSentAt.getTime() < 60_000)) throw new ConflictException({ code: 'OTP_RATE_LIMITED' });
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.contractOtpChallenge.updateMany({ where: { contractId, status: 'PENDING' }, data: { status: 'INVALIDATED' } });
      const created = await tx.contractOtpChallenge.create({ data: { contractId, customerId: contract.customerId, codeHash, contractVersion: contract.version, contentHash, expiresAt: new Date(now.getTime() + 5 * 60_000) } });
      await tx.loanContract.update({ where: { id: contractId }, data: { status: 'AWAITING_CUSTOMER_CONFIRMATION' } });
      await tx.loanContractStatusHistory.create({ data: { contractId, fromStatus: 'APPROVED', toStatus: 'AWAITING_CUSTOMER_CONFIRMATION', reason: 'OTP confirmation requested', changedById: actor.id } });
      await this.audit.write(tx, { actor, action: 'loan_contract.otp.requested', targetType: 'loan_contract', targetId: contractId, branchId: contract.branchId, afterState: { challengeId: created.id, expiresAt: created.expiresAt }, requestId: requestId(request) });
      return created;
    });
    return { status: 'AWAITING_CUSTOMER_CONFIRMATION', expiresAt: challenge.expiresAt, debugOtp: code };
  }

  async confirmCompletion(actor: ActorContext, contractId: string, code: string, request?: ActorRequest) {
    if (!this.isCustomerOtpTestMode()) throw new ServiceUnavailableException({
      code: 'CUSTOMER_OTP_DEFERRED',
      status: 'DEFERRED',
      message: 'Xác nhận hợp đồng bằng OTP đang chờ cấu hình đăng nhập khách hàng trên mobile và cổng SMS.',
    });
    if (actor.type !== 'CUSTOMER') throw new ForbiddenException({ code: 'CUSTOMER_AUTHENTICATION_REQUIRED' });
    const contract = await this.prisma.loanContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException({ code: 'LOAN_CONTRACT_NOT_FOUND' });
    if (contract.customerId !== actor.id) throw new ForbiddenException({ code: 'CUSTOMER_OWN_DATA_ONLY' });
    if (contract.status !== 'AWAITING_CUSTOMER_CONFIRMATION') throw new ConflictException({ code: 'CONTRACT_NOT_AWAITING_CONFIRMATION' });
    const challenge = await this.prisma.contractOtpChallenge.findFirst({ where: { contractId, customerId: actor.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.contractVersion !== contract.version || challenge.contentHash !== this.contractContentHash(contract)) throw new ConflictException({ code: 'OTP_EXPIRED_OR_INVALIDATED' });
    const secret = process.env.AUTH_ACCESS_TOKEN_SECRET;
    if (!secret) throw new ConflictException({ code: 'OTP_HASH_SECRET_NOT_CONFIGURED' });
    const codeHash = createHmac('sha256', secret).update(`${contract.id}:${contract.version}:${code}`).digest('hex');
    const suppliedHash = Buffer.from(codeHash);
    const expectedHash = Buffer.from(challenge.codeHash);
    if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
      await this.prisma.contractOtpChallenge.updateMany({ where: { id: challenge.id, status: 'PENDING', attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
      const attempted = await this.prisma.contractOtpChallenge.findUniqueOrThrow({ where: { id: challenge.id }, select: { attempts: true } });
      if (attempted.attempts >= 5) await this.prisma.contractOtpChallenge.update({ where: { id: challenge.id }, data: { status: 'LOCKED' } });
      throw new BadRequestException({ code: 'OTP_INVALID' });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contractOtpChallenge.updateMany({ where: { id: challenge.id, status: 'PENDING', attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException({ code: 'OTP_ALREADY_USED' });
      const updated = await tx.loanContract.update({ where: { id: contractId, status: 'AWAITING_CUSTOMER_CONFIRMATION' }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await tx.loanContractStatusHistory.create({ data: { contractId, fromStatus: 'AWAITING_CUSTOMER_CONFIRMATION', toStatus: 'COMPLETED', reason: 'Customer completed confirmation with OTP', changedByCustomerId: actor.id } });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: actor.id }, select: { status: true, phoneVerifiedAt: true } });
      if (!customer.phoneVerifiedAt) {
        const phoneVerifiedAt = new Date();
        await tx.customer.update({ where: { id: actor.id }, data: { phoneVerifiedAt } });
        await this.audit.write(tx, {
          actor, action: 'customer.phone.verified', targetType: 'customer', targetId: actor.id, branchId: contract.branchId,
          afterState: { phoneVerifiedAt, source: 'loan_contract_otp' }, requestId: requestId(request)
        });
      }
      if (customer.status !== 'CLOSED' && customer.status !== 'CONVERTED') {
        await tx.customer.update({ where: { id: actor.id }, data: { status: 'CONVERTED' } });
        await tx.customerStatusHistory.create({ data: { customerId: actor.id, fromStatus: customer.status, toStatus: 'CONVERTED', reason: 'Loan contract completed after customer OTP confirmation', changedByCustomerId: actor.id } });
      }
      await this.audit.write(tx, { actor, action: 'loan_contract.completed', targetType: 'loan_contract', targetId: contractId, branchId: contract.branchId, requestId: requestId(request) });
      return this.serializeContract(updated, true);
    });
  }

  private isCustomerOtpTestMode(): boolean {
    return process.env.NODE_ENV === 'test' && process.env.CUSTOMER_OTP_TEST_MODE === 'mock';
  }

  private async contractForAction(actor: ActorContext, id: string) {
    const contract = await this.prisma.loanContract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException({ code: 'LOAN_CONTRACT_NOT_FOUND' });
    await this.assertBranchManagePermission(actor, 'loan-contracts.read', contract.branchId);
    return contract;
  }

  private async changeContractStatus(actor: ActorContext, contract: Prisma.LoanContractGetPayload<object>, status: 'APPROVED' | 'REJECTED', reason: string, request?: ActorRequest, extra: Prisma.LoanContractUpdateInput = {}) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.loanContract.update({ where: { id: contract.id }, data: { status, ...extra } });
      await tx.loanContractStatusHistory.create({ data: { contractId: contract.id, fromStatus: contract.status, toStatus: status, reason, changedById: actor.id } });
      await this.audit.write(tx, { actor, action: `loan_contract.${status.toLowerCase()}`, targetType: 'loan_contract', targetId: contract.id, branchId: contract.branchId, reason, beforeState: { status: contract.status }, afterState: { status }, requestId: requestId(request) });
      return this.serializeContract(updated);
    });
  }

  private contractContentHash(contract: { id: string; version: number; contractNumber: string; packageCode: string | null; packageName: string; packageVersion: string | null; loanType: string | null; termMonths: number | null }) {
    return createHash('sha256').update(JSON.stringify({ id: contract.id, version: contract.version, contractNumber: contract.contractNumber, packageCode: contract.packageCode, packageName: contract.packageName, packageVersion: contract.packageVersion, loanType: contract.loanType, termMonths: contract.termMonths })).digest('hex');
  }

  private async customerOrThrow(customerId: string): Promise<CustomerRecord> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { assignments: { where: { endedAt: null } } } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND' });
    return customer;
  }

  private async loanProductOrThrow(productId: string) {
    const product = await this.prisma.loanProduct.findUnique({
      where: { id: productId },
      include: { branch: { select: { id: true, code: true, name: true } } },
    });
    if (!product) throw new NotFoundException({ code: 'LOAN_PRODUCT_NOT_FOUND' });
    return product;
  }

  private async canReadLoanProduct(actor: ActorContext, product: { branchId: string | null; createdById: string | null }) {
    return this.access.hasResourceAccess(actor.id, 'loan-products.read', undefined, {
      ownerId: product.createdById,
      branchId: product.branchId,
    });
  }

  private async assertLoanProductAccess(
    actor: ActorContext,
    permission: string,
    product: { branchId: string | null; createdById: string | null },
    write = false,
  ) {
    if (!product.branchId) {
      await this.access.assertPermission(actor.id, permission, AccessScope.ALL);
      return;
    }
    if (write) {
      await this.assertBranchManagePermission(actor, permission, product.branchId);
      return;
    }
    await this.access.assertResourceAccess(actor.id, permission, undefined, {
      ownerId: product.createdById,
      branchId: product.branchId,
    });
  }

  private serializeLoanProduct(product: {
    id: string;
    branchId: string | null;
    branch: { id: string; code: string; name: string } | null;
    code: string;
    name: string;
    loanType: string;
    source: string;
    description: string | null;
    sourceUrl: string | null;
    thumbnailUrl: string | null;
    minTermMonths: number;
    maxTermMonths: number;
    minAmount: Prisma.Decimal | null;
    maxAmount: Prisma.Decimal | null;
    annualInterestRate: Prisma.Decimal;
    status: LoanProductStatus;
    currentFormulaVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: product.id,
      branchId: product.branchId,
      branch: product.branch,
      code: product.code,
      name: product.name,
      loanType: product.loanType,
      source: product.source,
      description: product.description,
      sourceUrl: product.sourceUrl,
      thumbnailUrl: product.thumbnailUrl,
      minTermMonths: product.minTermMonths,
      maxTermMonths: product.maxTermMonths,
      minAmount: product.minAmount?.toFixed(2) ?? null,
      maxAmount: product.maxAmount?.toFixed(2) ?? null,
      annualInterestRate: product.annualInterestRate.toFixed(4),
      status: product.status,
      currentFormulaVersion: product.currentFormulaVersion,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private async assertCustomerRead(actor: ActorContext, customer: CustomerRecord) {
    if (actor.type === 'CUSTOMER') {
      if (actor.id !== customer.id) throw new ForbiddenException({ code: 'CUSTOMER_OWN_DATA_ONLY' });
      return;
    }
    await this.assertCustomerAccess(actor, 'customers.read', customer);
  }

  private async canAccessCustomer(actor: ActorContext, permission: string, customer: CustomerRecord): Promise<boolean> {
    if (actor.type === 'CUSTOMER') return actor.id === customer.id;
    return this.access.hasResourceAccess(actor.id, permission, undefined, this.customerResource(customer));
  }

  private async assertCustomerAccess(actor: ActorContext, permission: string, customer: CustomerRecord) {
    this.assertStaff(actor);
    if (!permission.endsWith('.read') && await this.access.hasManagedBranches(actor.id) && !(await this.access.hasPermission(actor.id, permission, AccessScope.ALL)) &&
      !(await this.access.isBranchManager(actor.id, customer.branchId))) {
      throw new ForbiddenException({ code: 'BRANCH_MANAGER_WRITE_DIRECT_BRANCH_ONLY' });
    }
    await this.access.assertResourceAccess(actor.id, permission, undefined, this.customerResource(customer));
  }

  private async canReadLoanRequest(actor: ActorContext, customer: CustomerRecord): Promise<boolean> {
    if (actor.type === 'CUSTOMER') return actor.id === customer.id;
    return this.canAccessCustomer(actor, 'loan-requests.read', customer);
  }

  private async canReadContract(actor: ActorContext, customer: CustomerRecord): Promise<boolean> {
    if (actor.type === 'CUSTOMER') return actor.id === customer.id;
    return this.canAccessCustomer(actor, 'loan-contracts.read', customer);
  }

  private customerResource(customer: CustomerRecord) {
    return { ownerId: customer.createdById, assigneeId: customer.assignments[0]?.adviserId ?? null, branchId: customer.branchId };
  }

  private assertStaff(actor: ActorContext) {
    if (actor.type !== 'STAFF') throw new ForbiddenException({ code: 'STAFF_PERMISSION_REQUIRED' });
  }

  private async assertBranchManagePermission(actor: ActorContext, permission: string, branchId: string) {
    if (await this.access.hasPermission(actor.id, permission, AccessScope.ALL)) return;
    if (await this.access.hasManagedBranches(actor.id) && !(await this.access.isBranchManager(actor.id, branchId))) {
      throw new ForbiddenException({ code: 'BRANCH_MANAGER_WRITE_DIRECT_BRANCH_ONLY' });
    }
    await this.access.assertPermission(actor.id, permission, AccessScope.BRANCH, branchId);
  }

  private async assertBranchExists(branchId: string) {
    if (!await this.prisma.branch.findFirst({ where: { id: branchId, status: 'ACTIVE' }, select: { id: true } })) {
      throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
    }
  }

  private async assertAdviserInBranch(adviserId: string, branchId: string) {
    const adviser = await this.prisma.user.findUnique({
      where: { id: adviserId },
      include: { roleGrants: { where: { role: { key: 'ADVISING' } }, select: { branchId: true } } },
    });
    if (!adviser || adviser.status !== 'ACTIVE') throw new BadRequestException({ code: 'ADVISER_NOT_ACTIVE' });
    const valid = await Promise.all(adviser.roleGrants.map((grant) => grant.branchId === null || this.access.isBranchInScope(branchId, grant.branchId)));
    if (!valid.some(Boolean)) throw new BadRequestException({ code: 'ADVISER_OUTSIDE_CUSTOMER_BRANCH' });
  }

  private async syncDuplicateCandidates(tx: Prisma.TransactionClient, customer: CustomerRecord) {
    const matches = await tx.customer.findMany({
      where: {
        id: { not: customer.id },
        OR: [
          { phoneNormalized: customer.phoneNormalized },
          ...(customer.emailNormalized ? [{ emailNormalized: customer.emailNormalized }] : []),
          ...(customer.dateOfBirth ? [{ normalizedName: customer.normalizedName, dateOfBirth: customer.dateOfBirth }] : []),
        ],
      },
      select: { id: true, phoneNormalized: true, emailNormalized: true, normalizedName: true, dateOfBirth: true },
    });
    const matchedIds = new Set(matches.map((match) => match.id));
    const previousPairs = await tx.duplicateCandidate.findMany({
      where: { OR: [{ customerId: customer.id }, { candidateCustomerId: customer.id }] },
      select: { id: true, customerId: true, candidateCustomerId: true },
    });
    for (const pair of previousPairs) {
      const otherId = pair.customerId === customer.id ? pair.candidateCustomerId : pair.customerId;
      if (!matchedIds.has(otherId)) {
        await tx.duplicateCandidate.update({ where: { id: pair.id }, data: { isCurrent: false } });
      }
    }
    for (const match of matches) {
      const matchReasons = [
        ...(match.phoneNormalized === customer.phoneNormalized ? ['PHONE'] : []),
        ...(customer.emailNormalized && match.emailNormalized === customer.emailNormalized ? ['EMAIL'] : []),
        ...(customer.dateOfBirth && match.dateOfBirth?.getTime() === customer.dateOfBirth.getTime() && match.normalizedName === customer.normalizedName ? ['NAME_AND_DATE_OF_BIRTH'] : []),
      ];
      await tx.duplicateCandidate.upsert({
        where: { customerId_candidateCustomerId: { customerId: customer.id, candidateCustomerId: match.id } },
        create: { customerId: customer.id, candidateCustomerId: match.id, matchReasons },
        update: { matchReasons, isCurrent: true },
      });
      await tx.duplicateCandidate.upsert({
        where: { customerId_candidateCustomerId: { customerId: match.id, candidateCustomerId: customer.id } },
        create: { customerId: match.id, candidateCustomerId: customer.id, matchReasons },
        update: { matchReasons, isCurrent: true },
      });
    }
  }

  private serializeCustomer(customer: CustomerRecord, customerView = false) {
    if (customerView) {
      return {
        id: customer.id, fullName: customer.fullName, dateOfBirth: customer.dateOfBirth,
        phone: customer.phone, email: customer.email,
      };
    }
    return {
      id: customer.id, fullName: customer.fullName, dateOfBirth: customer.dateOfBirth, phone: customer.phone, email: customer.email,
      provenance: customer.provenance, verificationStatus: customer.verificationStatus, status: customer.status, branchId: customer.branchId,
      primaryAdviserId: customer.assignments[0]?.adviserId ?? null,
      primaryAssignedAt: customer.assignments[0]?.assignedAt ?? null,
      createdAt: customer.createdAt, updatedAt: customer.updatedAt,
    };
  }

  private serializeLoanRequest(row: { id: string; customerId: string; branchId: string; productId: string | null; requestedAmount: Prisma.Decimal | null; requestedTermMonths: number | null; source: LoanRequestSource; topic: string; notes: string | null; status: string; createdAt: Date; updatedAt: Date }, customerView = false) {
    const allowed = {
      id: row.id,
      customerId: row.customerId,
      productId: row.productId,
      requestedAmount: row.requestedAmount?.toFixed(2) ?? null,
      requestedTermMonths: row.requestedTermMonths,
      topic: row.topic,
      notes: row.notes,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (customerView) return allowed;
    return { ...allowed, branchId: row.branchId, source: row.source };
  }

  private serializeContract(row: { id: string; customerId: string; branchId: string; contractNumber: string; packageCode: string | null; packageName: string; packageVersion: string | null; loanType: string | null; termMonths: number | null; loanAmount?: Prisma.Decimal | null; annualInterestRate?: Prisma.Decimal | null; interestAmount?: Prisma.Decimal | null; monthlyPayment?: Prisma.Decimal | null; status: string; approvedAt?: Date | null; completedAt?: Date | null; createdAt: Date }, customerView = false) {
    const allowed = {
      id: row.id,
      customerId: row.customerId,
      contractNumber: row.contractNumber,
      packageCode: row.packageCode,
      packageName: row.packageName,
      packageVersion: row.packageVersion,
      loanType: row.loanType,
      termMonths: row.termMonths,
      loanAmount: row.loanAmount?.toFixed(2) ?? null,
      annualInterestRate: row.annualInterestRate?.toFixed(4) ?? null,
      interestAmount: row.interestAmount?.toFixed(2) ?? null,
      monthlyPayment: row.monthlyPayment?.toFixed(2) ?? null,
      status: row.status,
      approvedAt: row.approvedAt ?? null,
      completedAt: row.completedAt ?? null,
      createdAt: row.createdAt,
    };
    if (customerView) return allowed;
    return { ...allowed, branchId: row.branchId };
  }

  private customerAuditState(customer: CustomerRecord) {
    return { fullName: customer.fullName, phone: customer.phone, email: customer.email, dateOfBirth: customer.dateOfBirth?.toISOString().slice(0, 10) ?? null, provenance: customer.provenance, verificationStatus: customer.verificationStatus };
  }
}
