import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Headers,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { Authenticated, RequirePermission } from '../common/auth-metadata.js';
import { CustomersService } from './customers.service.js';
import {
  AssignCustomerDto,
  ConfirmContractOtpDto,
  ContractListQueryDto,
  ContractStatusReasonDto,
  ChangeCustomerStatusDto,
  CreateCustomerDto,
  CreateLoanContractDto,
  CreateLoanRequestDto,
  ExternalLoanContractDto,
  CustomerListQueryDto,
  ResolveDuplicateDto,
  UpdateCustomerDto,
  UpdateLoanRequestStatusDto,
} from './customer.dto.js';

@Controller()
@ApiTags('customers and loans')
@ApiBearerAuth()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermission('customers.read')
  @Get('customers')
  listCustomers(@CurrentActor() actor: ActorContext, @Query() query: CustomerListQueryDto) {
    return this.customers.list(actor, query);
  }

  @RequirePermission('customers.manage')
  @Post('customers')
  createCustomer(@CurrentActor() actor: ActorContext, @Body() dto: CreateCustomerDto, @Req() request: ActorRequest) {
    return this.customers.create(actor, dto, request);
  }

  @Authenticated()
  @Get('customers/:customerId')
  customerDetail(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customers.detail(actor, customerId);
  }

  @RequirePermission('customers.manage')
  @Patch('customers/:customerId')
  updateCustomer(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() dto: UpdateCustomerDto, @Req() request: ActorRequest) {
    return this.customers.update(actor, customerId, dto, request);
  }

  @RequirePermission('customers.manage')
  @Post('customers/:customerId/status')
  changeCustomerStatus(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() dto: ChangeCustomerStatusDto, @Req() request: ActorRequest) {
    return this.customers.changeStatus(actor, customerId, dto, request);
  }

  @RequirePermission('customers.assign')
  @Post('customers/:customerId/assignments')
  assignCustomer(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() dto: AssignCustomerDto, @Req() request: ActorRequest) {
    return this.customers.assign(actor, customerId, dto, request);
  }

  @Authenticated()
  @Get('customers/:customerId/assignments')
  assignments(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customers.assignments(actor, customerId);
  }

  @RequirePermission('customers.read')
  @Get('customers/:customerId/duplicates')
  duplicates(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customers.duplicateCandidates(actor, customerId);
  }

  @RequirePermission('customers.duplicates.review')
  @Post('customers/:customerId/duplicates/:candidateId/resolve')
  resolveDuplicate(@CurrentActor() actor: ActorContext, @Param('customerId', ParseUUIDPipe) customerId: string, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() dto: ResolveDuplicateDto, @Req() request: ActorRequest) {
    return this.customers.resolveDuplicate(actor, customerId, candidateId, dto, request);
  }

  @Authenticated()
  @Get('loan-requests')
  listLoanRequests(@CurrentActor() actor: ActorContext, @Query('customerId', new ParseUUIDPipe({ optional: true })) customerId?: string) {
    return this.customers.listLoanRequests(actor, customerId);
  }

  @Authenticated()
  @Post('loan-requests')
  createLoanRequest(@CurrentActor() actor: ActorContext, @Body() dto: CreateLoanRequestDto, @Req() request: ActorRequest) {
    return this.customers.createLoanRequest(actor, dto, request);
  }

  @RequirePermission('loan-requests.manage')
  @Patch('loan-requests/:loanRequestId/status')
  updateLoanRequestStatus(@CurrentActor() actor: ActorContext, @Param('loanRequestId', ParseUUIDPipe) loanRequestId: string, @Body() dto: UpdateLoanRequestStatusDto, @Req() request: ActorRequest) {
    return this.customers.updateLoanRequestStatus(actor, loanRequestId, dto, request);
  }

  @Authenticated()
  @Get('loan-contracts')
  listLoanContracts(@CurrentActor() actor: ActorContext, @Query() query: ContractListQueryDto) {
    return this.customers.listLoanContracts(actor, query);
  }

  @RequirePermission('loan-contracts.manage')
  @Post('loan-contracts')
  createLoanContract(@CurrentActor() actor: ActorContext, @Body() dto: CreateLoanContractDto, @Req() request: ActorRequest) {
    return this.customers.createLoanContract(actor, dto, request);
  }

  @RequirePermission('loan-contracts.ingest')
  @Post('loan-contracts/external')
  ingestExternalContract(@CurrentActor() actor: ActorContext, @Body() dto: ExternalLoanContractDto, @Headers('idempotency-key') key: string, @Req() request: ActorRequest) {
    return this.customers.ingestExternalContract(actor, dto, key, request);
  }

  @RequirePermission('loan-contracts.review')
  @Post('loan-contracts/:contractId/approve')
  approveContract(@CurrentActor() actor: ActorContext, @Param('contractId', ParseUUIDPipe) contractId: string, @Req() request: ActorRequest) {
    return this.customers.approveContract(actor, contractId, request);
  }

  @RequirePermission('loan-contracts.review')
  @Post('loan-contracts/:contractId/reject')
  rejectContract(@CurrentActor() actor: ActorContext, @Param('contractId', ParseUUIDPipe) contractId: string, @Body() dto: ContractStatusReasonDto, @Req() request: ActorRequest) {
    return this.customers.rejectContract(actor, contractId, dto.reason, request);
  }

  @RequirePermission('loan-contracts.status.manage')
  @Post('loan-contracts/:contractId/request-completion-otp')
  requestCompletionOtp(@CurrentActor() actor: ActorContext, @Param('contractId', ParseUUIDPipe) contractId: string, @Req() request: ActorRequest) {
    return this.customers.requestCompletionOtp(actor, contractId, request);
  }

  @Authenticated()
  @Post('loan-contracts/:contractId/confirm-completion')
  confirmCompletion(@CurrentActor() actor: ActorContext, @Param('contractId', ParseUUIDPipe) contractId: string, @Body() dto: ConfirmContractOtpDto, @Req() request: ActorRequest) {
    return this.customers.confirmCompletion(actor, contractId, dto.code, request);
  }
}
