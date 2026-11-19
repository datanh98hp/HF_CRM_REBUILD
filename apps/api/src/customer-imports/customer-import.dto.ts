import { IsUUID } from 'class-validator';

export class CreateCustomerImportBatchDto {
  @IsUUID()
  branchId!: string;
}
