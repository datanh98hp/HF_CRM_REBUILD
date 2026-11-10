import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  AccessScope,
  CustomerStatus,
  DuplicateReviewStatus,
  LoanRequestSource,
  Prisma,
} from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AssignCustomerDto,
  ChangeCustomerStatusDto,
  CreateCustomerDto,
  CreateLoanContractDto,
  ContractListQueryDto,
  ExternalLoanContractDto,
  CreateLoanRequestDto,
  CustomerListQueryDto,
  ResolveDuplicateDto,
  UpdateCustomerDto,
  UpdateLoanRequestStatusDto,
} from './customer.dto.js';
import { normalizeVietnamesePhone, normalizeVietnamesePhoneSearch } from './phone-normalizer.js';

type CustomerRecord = Prisma.CustomerGetPayload<{
  include: { assignments: { where: { endedAt: null }; select: { adviserId: true; assignedAt: true } } };
}>;

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

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
  ) {}

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
    return this.prisma.$transaction(async (tx) => {
      await tx.customerAssignment.updateMany({ where: { customerId, endedAt: null }, data: { endedAt: new Date() } });
      const assignment = await tx.customerAssignment.create({
        data: { customerId, adviserId: dto.adviserId, branchId: customer.branchId, assignedById: actor.id, isPrimary: true },
      });
      await this.audit.write(tx, {
        actor, action: 'customer.assigned', targetType: 'customer', targetId: customerId, branchId: customer.branchId,
        reason: dto.reason.trim(), afterState: { adviserId: dto.adviserId, assignmentId: assignment.id }, requestId: requestId(request),
      });
      return assignment;
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

  async createLoanRequest(actor: ActorContext, dto: CreateLoanRequestDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(dto.customerId);
    if (actor.type === 'CUSTOMER') {
      if (actor.id !== customer.id) throw new ForbiddenException({ code: 'CUSTOMER_OWN_DATA_ONLY' });
    } else {
      await this.assertCustomerAccess(actor, 'loan-requests.manage', customer);
    }
    return this.prisma.$transaction(async (tx) => {
      const loanRequest = await tx.loanRequest.create({
        data: {
          customerId: customer.id, branchId: customer.branchId,
          source: actor.type === 'CUSTOMER' ? LoanRequestSource.CUSTOMER : LoanRequestSource.ADVISING,
          topic: dto.topic.trim(), notes: dto.notes?.trim(), recordedById: actor.type === 'STAFF' ? actor.id : null,
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
    const rows = await this.prisma.loanContract.findMany({
      where: query.customerId ? { customerId: query.customerId } : undefined, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 100,
      include: { customer: { include: { assignments: { where: { endedAt: null } } } } },
    });
    const output = [];
    let lastScannedId: string | null = null;
    for (const row of rows) {
      lastScannedId = row.id;
      if (await this.canReadContract(actor, row.customer)) output.push(this.serializeContract(row, actor.type === 'CUSTOMER'));
      if (output.length === 20) break;
    }
    return { items: output, pageSize: 20, nextCursor: rows.length === 100 || (output.length === 20 && lastScannedId !== rows.at(-1)?.id) ? lastScannedId : null };
  }

  async createLoanContract(actor: ActorContext, dto: CreateLoanContractDto, request?: ActorRequest) {
    const customer = await this.customerOrThrow(dto.customerId);
    this.assertStaff(actor);
    await this.assertCustomerAccess(actor, 'loan-contracts.manage', customer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const contract = await tx.loanContract.create({
          data: { customerId: customer.id, branchId: customer.branchId, contractNumber: dto.contractNumber.trim(), packageName: dto.packageName.trim(), loanType: dto.loanType?.trim(), termMonths: dto.termMonths, createdById: actor.id, status: 'PENDING_REVIEW' },
        });
        await tx.loanContractStatusHistory.create({ data: { contractId: contract.id, toStatus: 'PENDING_REVIEW', reason: 'Contract created; pending branch manager review', changedById: actor.id } });
        await this.audit.write(tx, {
          actor, action: 'loan_contract.created', targetType: 'loan_contract', targetId: contract.id, branchId: customer.branchId,
          afterState: { customerId: customer.id, contractNumber: contract.contractNumber }, requestId: requestId(request),
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
    const existing = await this.prisma.loanContract.findFirst({ where: { OR: [
      { sourceSystem, externalContractId },
      { idempotencyKeyHash: keyHash },
    ] } });
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
          data: { fullName: name, normalizedName: normalized, phone, phoneNormalized: phone,
            dateOfBirth: dob, email: normalizedEmail(dto.customerEmail), emailNormalized: normalizedEmail(dto.customerEmail),
            provenance: `external:${dto.sourceSystem}`, verificationStatus: 'UNVERIFIED', branchId: dto.branchId },
          include: { assignments: { where: { endedAt: null } } },
        });
        if (exact.length !== 1) await this.syncDuplicateCandidates(tx, customer);
        const contract = await tx.loanContract.create({ data: {
          customerId: customer.id, branchId: dto.branchId, contractNumber: dto.contractNumber.trim(),
          packageCode: dto.packageCode?.trim(), packageName: dto.packageName.trim(), packageVersion: dto.packageVersion?.trim(),
          loanType: dto.loanType?.trim(), termMonths: dto.termMonths, sourceSystem,
          externalContractId, sourceUpdatedAt: dto.sourceUpdatedAt ? new Date(dto.sourceUpdatedAt) : undefined,
          sourcePayloadHash: payloadHash, idempotencyKeyHash: keyHash, createdById: actor.id, status: 'PENDING_REVIEW',
        } });
        await tx.loanContractStatusHistory.create({ data: { contractId: contract.id, toStatus: 'PENDING_REVIEW', reason: 'External import; pending branch manager review', changedById: actor.id } });
        await this.audit.write(tx, { actor, action: 'loan_contract.external_ingested', targetType: 'loan_contract', targetId: contract.id, branchId: dto.branchId,
          afterState: { sourceSystem: dto.sourceSystem, externalContractId: dto.externalContractId, sourcePayloadHash: payloadHash, customerCreated: exact.length !== 1 }, requestId: requestId(request) });
        return { ...this.serializeContract(contract), customerCreated: exact.length !== 1, replayed: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.loanContract.findFirst({ where: { OR: [
          { sourceSystem, externalContractId }, { idempotencyKeyHash: keyHash },
        ] } });
        if (raced?.sourcePayloadHash === payloadHash) return { ...this.serializeContract(raced), replayed: true };
        throw new ConflictException({ code: raced ? 'IDEMPOTENCY_CONFLICT' : 'CONTRACT_NUMBER_EXISTS' });
      }
      throw error;
    }
  }

  async approveContract(actor: ActorContext, contractId: string, request?: ActorRequest) {
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.review', contract.branchId);
    if (!await this.access.hasPermission(actor.id, 'loan-contracts.review', AccessScope.ALL) && !await this.access.isBranchManager(actor.id, contract.branchId)) throw new ForbiddenException({ code: 'DIRECT_BRANCH_MANAGER_REQUIRED' });
    if (contract.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'CONTRACT_NOT_PENDING_REVIEW' });
    return this.changeContractStatus(actor, contract, 'APPROVED', 'Branch manager approved contract', request, { approvedBy: { connect: { id: actor.id } }, approvedAt: new Date() });
  }

  async rejectContract(actor: ActorContext, contractId: string, reason: string, request?: ActorRequest) {
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.review', contract.branchId);
    if (!await this.access.hasPermission(actor.id, 'loan-contracts.review', AccessScope.ALL) && !await this.access.isBranchManager(actor.id, contract.branchId)) throw new ForbiddenException({ code: 'DIRECT_BRANCH_MANAGER_REQUIRED' });
    if (contract.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'CONTRACT_NOT_PENDING_REVIEW' });
    return this.changeContractStatus(actor, contract, 'REJECTED', reason.trim(), request);
  }

  async requestCompletionOtp(actor: ActorContext, contractId: string, request?: ActorRequest) {
    this.assertStaff(actor);
    const contract = await this.contractForAction(actor, contractId);
    await this.assertBranchManagePermission(actor, 'loan-contracts.status.manage', contract.branchId);
    if (!await this.access.hasPermission(actor.id, 'loan-contracts.status.manage', AccessScope.ALL) && !await this.access.isBranchManager(actor.id, contract.branchId)) throw new ForbiddenException({ code: 'DIRECT_BRANCH_MANAGER_REQUIRED' });
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
        await this.audit.write(tx, { actor, action: 'customer.phone.verified', targetType: 'customer', targetId: actor.id, branchId: contract.branchId,
          afterState: { phoneVerifiedAt, source: 'loan_contract_otp' }, requestId: requestId(request) });
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

  private serializeLoanRequest(row: { id: string; customerId: string; branchId: string; source: LoanRequestSource; topic: string; notes: string | null; status: string; createdAt: Date; updatedAt: Date }, customerView = false) {
    if (customerView) return { id: row.id, customerId: row.customerId, topic: row.topic, notes: row.notes, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt };
    return { id: row.id, customerId: row.customerId, branchId: row.branchId, source: row.source, topic: row.topic, notes: row.notes, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private serializeContract(row: { id: string; customerId: string; branchId: string; contractNumber: string; packageCode: string | null; packageName: string; packageVersion: string | null; loanType: string | null; termMonths: number | null; status: string; approvedAt?: Date | null; completedAt?: Date | null; createdAt: Date }, customerView = false) {
    const allowed = { id: row.id, customerId: row.customerId, contractNumber: row.contractNumber, packageCode: row.packageCode, packageName: row.packageName, packageVersion: row.packageVersion, loanType: row.loanType, termMonths: row.termMonths, status: row.status, approvedAt: row.approvedAt ?? null, completedAt: row.completedAt ?? null, createdAt: row.createdAt };
    if (customerView) return allowed;
    return { ...allowed, branchId: row.branchId };
  }

  private customerAuditState(customer: CustomerRecord) {
    return { fullName: customer.fullName, phone: customer.phone, email: customer.email, dateOfBirth: customer.dateOfBirth?.toISOString().slice(0, 10) ?? null, provenance: customer.provenance, verificationStatus: customer.verificationStatus };
  }
}
