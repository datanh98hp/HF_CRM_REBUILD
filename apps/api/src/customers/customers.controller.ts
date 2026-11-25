import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  StreamableFile,
  Headers,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { Authenticated, RequirePermission } from '../common/auth-metadata.js';
import { CustomersService } from './customers.service.js';
import {
  AssignCustomerDto,
  BulkAssignCustomersDto,
  ConfirmContractOtpDto,
  CreateLoanContractDisbursementDto,
  ContractListQueryDto,
  ContractStatusReasonDto,
  ChangeCustomerStatusDto,
  CreateCustomerDto,
  CreateLoanContractDto,
  CreateLoanProductDto,
  CreateLoanRequestDto,
  CalculateLoanProductDto,
  ExternalLoanContractDto,
  CustomerListQueryDto,
  LoanProductFormulaHistoryQueryDto,
  LoanProductListQueryDto,
  ResolveDuplicateDto,
  SetLoanProductFormulaDto,
  SetLoanProductStatusDto,
  UpdateLoanProductDto,
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

  @RequirePermission('customers.read')
  @Get('customers/:customerId/status-history')
  customerStatusHistory(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query('cursor', new ParseUUIDPipe({ optional: true })) cursor?: string,
  ) {
    return this.customers.customerStatusHistory(actor, customerId, cursor);
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

  @RequirePermission('customers.assign')
  @Post('customers/assignments/bulk')
  bulkAssignCustomers(@CurrentActor() actor: ActorContext, @Body() dto: BulkAssignCustomersDto, @Req() request: ActorRequest) {
    return this.customers.bulkAssign(actor, dto, request);
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
  @Get('loan-products')
  listLoanProducts(@CurrentActor() actor: ActorContext, @Query() query: LoanProductListQueryDto) {
    return this.customers.listLoanProducts(actor, query);
  }

  @Authenticated()
  @Get('loan-products/:productId')
  loanProductDetail(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.customers.loanProductDetail(actor, productId);
  }

  @RequirePermission('loan-products.manage')
  @Post('loan-products')
  createLoanProduct(@CurrentActor() actor: ActorContext, @Body() dto: CreateLoanProductDto, @Req() request: ActorRequest) {
    return this.customers.createLoanProduct(actor, dto, request);
  }

  @RequirePermission('loan-products.manage')
  @Patch('loan-products/:productId')
  updateLoanProduct(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: UpdateLoanProductDto, @Req() request: ActorRequest) {
    return this.customers.updateLoanProduct(actor, productId, dto, request);
  }

  @RequirePermission('loan-products.publish')
  @Post('loan-products/:productId/status')
  setLoanProductStatus(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: SetLoanProductStatusDto, @Req() request: ActorRequest) {
    return this.customers.setLoanProductStatus(actor, productId, dto, request);
  }

  @RequirePermission('loan-products.formula.manage')
  @Get('loan-products/:productId/formula')
  getLoanProductFormula(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.customers.getLoanProductFormula(actor, productId);
  }

  @RequirePermission('loan-products.formula.manage')
  @Get('loan-products/:productId/formula-versions')
  getLoanProductFormulaHistory(
    @CurrentActor() actor: ActorContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: LoanProductFormulaHistoryQueryDto,
  ) {
    return this.customers.getLoanProductFormulaHistory(actor, productId, query.beforeVersion);
  }

  @RequirePermission('loan-products.formula.manage')
  @Post('loan-products/:productId/formula')
  setLoanProductFormula(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: SetLoanProductFormulaDto, @Req() request: ActorRequest) {
    return this.customers.setLoanProductFormula(actor, productId, dto, request);
  }

  @RequirePermission('loan-contracts.manage')
  @Get('loan-products/:productId/formula-inputs')
  getLoanProductFormulaInputs(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.customers.getLoanProductFormulaInputs(actor, productId);
  }

  @Authenticated()
  @Post('loan-products/:productId/calculate')
  calculateLoanProduct(@CurrentActor() actor: ActorContext, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: CalculateLoanProductDto) {
    return this.customers.calculateLoanProduct(actor, productId, dto);
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

  @Authenticated()
  @Get('loan-contracts/:contractId/documents')
  listContractDocuments(@CurrentActor() actor: ActorContext, @Param('contractId', ParseUUIDPipe) contractId: string) {
    return this.customers.listContractDocuments(actor, contractId);
  }

  @Authenticated()
  @Get('loan-contracts/:contractId/history')
  getContractHistory(@CurrentActor() actor: ActorContext, @Param('contractId', ParseUUIDPipe) contractId: string) {
    return this.customers.getContractHistory(actor, contractId);
  }

  @Authenticated()
  @Get('loan-contracts/:contractId/documents/:documentId/download')
  async downloadContractDocument(
    @CurrentActor() actor: ActorContext,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    const document = await this.customers.getContractDocumentFile(actor, contractId, documentId);
    return new StreamableFile(document.stream, {
      type: document.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @RequirePermission('loan-contracts.manage')
  @Post('loan-contracts/:contractId/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadContractDocument(
    @CurrentActor() actor: ActorContext,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Req() request: ActorRequest,
  ) {
    return this.customers.uploadContractDocument(actor, contractId, file, request);
  }

  @RequirePermission('loan-contracts.manage')
  @Put('loan-contracts/:contractId/documents/:documentId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  replaceContractDocument(
    @CurrentActor() actor: ActorContext,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Req() request: ActorRequest,
  ) {
    return this.customers.replaceContractDocument(actor, contractId, documentId, file, request);
  }

  @RequirePermission('loan-contracts.manage')
  @Delete('loan-contracts/:contractId/documents/:documentId')
  deleteContractDocument(
    @CurrentActor() actor: ActorContext,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() request: ActorRequest,
  ) {
    return this.customers.deleteContractDocument(actor, contractId, documentId, request);
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

  @RequirePermission('loan-contracts.status.manage')
  @Post('loan-contracts/:contractId/disbursements')
  recordLoanContractDisbursement(
    @CurrentActor() actor: ActorContext,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() dto: CreateLoanContractDisbursementDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: ActorRequest,
  ) {
    return this.customers.recordLoanContractDisbursement(actor, contractId, dto, idempotencyKey, request);
  }
}
