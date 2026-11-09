import { AccessScope, BranchStatus } from '../generated/prisma/client.js';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RolePermissionDto {
  @IsString()
  @Length(1, 120)
  permissionKey!: string;

  @IsEnum(AccessScope)
  scope!: AccessScope;
}

export class CreateRoleDto {
  @IsString()
  @Matches(/^CUSTOM_[A-Z0-9_]{2,70}$/)
  key!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  permissions!: RolePermissionDto[];
}

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  permissions!: RolePermissionDto[];
}

export class CreateBranchDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,64}$/)
  code!: string;

  @IsString()
  @Length(2, 160)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateBranchStatusDto {
  @IsEnum(BranchStatus)
  status!: BranchStatus;

  @IsString()
  @Length(2, 1000)
  reason!: string;
}

export class AssignBranchManagerDto {
  @IsUUID()
  managerUserId!: string;
}

export class CreateUserDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,120}$/)
  username!: string;

  @IsString()
  @Length(2, 160)
  displayName!: string;

  @IsString()
  @Length(12, 256)
  temporaryPassword!: string;

  @IsString()
  @Matches(/^([A-Z][A-Z0-9_]{1,79}|CUSTOM_[A-Z0-9_]{2,70})$/)
  roleKey!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class CreateRoleGrantDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @Matches(/^([A-Z][A-Z0-9_]{1,79}|CUSTOM_[A-Z0-9_]{2,70})$/)
  roleKey!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 1000)
  reason?: string;
}

export class DisableUserDto {
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class RevokeRoleGrantDto {
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
