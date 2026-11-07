import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  CustomerStatus,
  CustomerVerificationStatus,
  DuplicateReviewStatus,
  LoanRequestSource,
  LoanRequestStatus,
} from '../generated/prisma/client.js';

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

  @IsString() @Length(2, 1000)
  reason!: string;
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

  @IsString() @Length(2, 200)
  topic!: string;

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

  @IsString() @Length(2, 120)
  contractNumber!: string;

  @IsString() @Length(2, 200)
  packageName!: string;

  @IsOptional() @IsString() @Length(2, 120)
  loanType?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1200)
  termMonths?: number;
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
}

export class CustomerListQueryDto {
  @IsOptional() @IsString() @Length(1, 160)
  search?: string;

  @IsOptional() @IsUUID()
  branchId?: string;

  @IsOptional() @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  take?: number = 50;
}

export { LoanRequestSource };
