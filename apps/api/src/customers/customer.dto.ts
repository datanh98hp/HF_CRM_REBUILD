import {
  IsDateString,
  IsEnum,
  IsArray,
  IsObject,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Length,
  Matches,
  Max,
  Min,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CustomerStatus,
  CustomerVerificationStatus,
  DuplicateReviewStatus,
  LoanContractStatus,
  LoanProductStatus,
  LoanRequestSource,
  LoanRequestStatus,
} from '../generated/prisma/client.js';

export enum LoanProductType {
  SHORT_TERM_SUPPORT = 'Gói hỗ trợ ngắn hạn',
  MEDIUM_LONG_TERM_PRODUCT = 'Gói sản phẩm trung, dài hạn',
  CONSUMER_PURCHASE_SUPPORT = 'Gói hỗ trợ mua sắm tiêu dùng',
  REAL_ESTATE_MORTGAGE_SUPPORT = 'Gói hỗ trợ thế chấp bất động sản',
  CAR_PURCHASE_MORTGAGE = 'Vay thế chấp mua xe ô tô',
}

export class CreateCustomerDto {
  @IsString() @Length(2, 160)
  fullName!: string;

  @IsString() @Length(8, 32) @Matches(/^[0-9+().\s-]+$/)
  phone!: string;

  @IsOptional() @IsString() @Length(3, 254)
  email?: string;

  @IsOptional() @IsDateString()
  dateOfBirth?: string;

  @IsString() @Length(2, 120)
  provenance!: string;

  @IsUUID()
  branchId!: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @Length(2, 160)
  fullName?: string;

  @IsOptional() @IsString() @Length(8, 32) @Matches(/^[0-9+().\s-]+$/)
  phone?: string;

  @IsOptional() @IsString() @Length(3, 254)
  email?: string | null;

  @IsOptional() @IsDateString()
  dateOfBirth?: string | null;

  @IsOptional() @IsString() @Length(2, 120)
  provenance?: string;

  @IsOptional() @IsEnum(CustomerVerificationStatus)
  verificationStatus?: CustomerVerificationStatus;
}

export class ChangeCustomerStatusDto {
  @IsEnum(CustomerStatus)
  status!: CustomerStatus;

  @IsString() @Length(2, 1000)
  reason!: string;
}

export class AssignCustomerDto {
  @IsUUID()
  adviserId!: string;

  @IsOptional() @IsString() @Length(2, 1000)
  reason?: string;
}

export class BulkAssignCustomersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined, { each: true })
  customerIds!: string[];

  @IsUUID()
  adviserId!: string;

  @IsOptional() @IsString() @Length(2, 1000)
  reason?: string;
}

export class ResolveDuplicateDto {
  @IsEnum(DuplicateReviewStatus)
  status!: DuplicateReviewStatus;

  @IsString() @Length(2, 1000)
  reason!: string;
}

export class CreateLoanRequestDto {
  @IsUUID()
  customerId!: string;

  @IsOptional() @IsUUID()
  productId?: string;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  requestedAmount?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1200)
  requestedTermMonths?: number;

  @IsOptional() @IsString() @Length(2, 200)
  topic?: string;

  @IsOptional() @IsString() @Length(1, 4000)
  notes?: string;
}

export class UpdateLoanRequestStatusDto {
  @IsEnum(LoanRequestStatus)
  status!: LoanRequestStatus;
}

export class CreateLoanContractDto {
  @IsUUID()
  customerId!: string;

  @IsOptional() @IsUUID()
  productId?: string;

  @IsOptional() @IsUUID()
  loanRequestId?: string;

  @IsString() @Length(2, 120)
  contractNumber!: string;

  @IsOptional() @IsString() @Length(2, 200)
  packageName?: string;

  @IsOptional() @IsString() @Length(2, 120)
  loanType?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1200)
  termMonths?: number;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  loanAmount?: string;

  @IsOptional() @IsObject()
  formulaInputs?: Record<string, unknown>;
}

export class CreateLoanProductDto {
  @IsOptional() @IsUUID()
  branchId?: string;

  @IsOptional() @IsString() @Length(0, 80) @Matches(/^[A-Za-z0-9._-]*$/)
  code?: string;

  @IsString() @Length(2, 200)
  name!: string;

  @IsEnum(LoanProductType)
  loanType!: LoanProductType;

  @IsString() @Length(2, 200)
  source!: string;

  @IsOptional() @IsString() @Length(1, 4000)
  description?: string;

  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true })
  sourceUrl?: string;

  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true })
  thumbnailUrl?: string;

  @IsInt() @Min(1) @Max(1200)
  minTermMonths!: number;

  @IsInt() @Min(1) @Max(1200)
  maxTermMonths!: number;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  minAmount?: string | null;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  maxAmount?: string | null;

  @IsString() @Matches(/^\d+(?:\.\d{1,4})?$/)
  annualInterestRate!: string;
}

export class UpdateLoanProductDto {
  @IsOptional() @IsString() @Length(2, 200)
  name?: string;

  @IsOptional() @IsEnum(LoanProductType)
  loanType?: LoanProductType;

  @IsOptional() @IsString() @Length(2, 200)
  source?: string;

  @IsOptional() @IsString() @Length(1, 4000)
  description?: string | null;

  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true })
  sourceUrl?: string | null;

  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true })
  thumbnailUrl?: string | null;

  @IsOptional() @IsInt() @Min(1) @Max(1200)
  minTermMonths?: number;

  @IsOptional() @IsInt() @Min(1) @Max(1200)
  maxTermMonths?: number;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  minAmount?: string | null;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  maxAmount?: string | null;

  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,4})?$/)
  annualInterestRate?: string;
}

export class SetLoanProductStatusDto {
  @IsEnum(LoanProductStatus)
  status!: LoanProductStatus;
}

export class LoanProductFormulaVariableDto {
  @IsString() @Length(1, 40) @Matches(/^[A-Za-z][A-Za-z0-9_]*$/)
  key!: string;

  @IsString() @Length(1, 80)
  label!: string;

  @IsString() @Matches(/^-?\d+(?:\.\d{1,6})?$/)
  min!: string;

  @IsString() @Matches(/^-?\d+(?:\.\d{1,6})?$/)
  max!: string;

  @IsString() @Matches(/^-?\d+(?:\.\d{1,6})?$/)
  defaultValue!: string;
}

export class SetLoanProductFormulaDto {
  @IsString() @Length(1, 512)
  interestFormula!: string;

  @IsString() @Length(1, 512)
  monthlyPaymentFormula!: string;

  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => LoanProductFormulaVariableDto)
  variables!: LoanProductFormulaVariableDto[];
}

export class LoanProductFormulaHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  beforeVersion?: number;
}

export class CalculateLoanProductDto {
  @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  principal!: string;

  @IsInt() @Min(1) @Max(1200)
  termMonths!: number;

  @IsOptional() @IsObject()
  formulaInputs?: Record<string, unknown>;
}

export class ExternalLoanContractDto {
  @IsString() @Length(2, 80) @Matches(/^[A-Za-z0-9._-]+$/)
  sourceSystem!: string;
  @IsString() @Length(1, 160)
  externalContractId!: string;
  @IsString() @Length(2, 120)
  contractNumber!: string;
  @IsString() @Length(2, 200)
  packageName!: string;
  @IsOptional() @IsString() @Length(1, 80)
  packageCode?: string;
  @IsOptional() @IsString() @Length(1, 40)
  packageVersion?: string;
  @IsOptional() @IsString() @Length(2, 120)
  loanType?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1200)
  termMonths?: number;
  @IsOptional() @IsDateString()
  sourceUpdatedAt?: string;
  @IsString() @Length(2, 160)
  customerFullName!: string;
  @IsString() @Length(8, 32) @Matches(/^[0-9+().\s-]+$/)
  customerPhone!: string;
  @IsOptional() @IsDateString()
  customerDateOfBirth?: string;
  @IsOptional() @IsString() @Length(3, 254)
  customerEmail?: string;
  @IsUUID()
  branchId!: string;
}

export class ContractStatusReasonDto {
  @IsString() @Length(2, 1000)
  reason!: string;
}

export class ConfirmContractOtpDto {
  @IsString() @Matches(/^\d{6}$/)
  code!: string;
}

export class ContractListQueryDto {
  @IsOptional() @IsUUID()
  customerId?: string;
  @IsOptional() @IsUUID()
  cursor?: string;
  @IsOptional() @IsUUID()
  branchId?: string;
  @IsOptional() @IsEnum(LoanContractStatus)
  status?: LoanContractStatus;
  @IsOptional() @IsString() @Length(1, 120)
  search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(100)
  pageSize?: number;
}

export class LoanProductListQueryDto {
  @IsOptional() @IsUUID()
  branchId?: string;

  @IsOptional() @IsEnum(LoanProductStatus)
  status?: LoanProductStatus;
}

export class CustomerListQueryDto {
  @IsOptional() @IsString() @Length(1, 160)
  search?: string;

  @IsOptional() @IsUUID()
  cursor?: string;

  @IsOptional() @IsUUID()
  branchId?: string;

  @IsOptional() @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional() @IsDateString()
  assignedFrom?: string;

  @IsOptional() @IsDateString()
  assignedTo?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(101)
  take?: number = 50;
}

export { LoanRequestSource };
