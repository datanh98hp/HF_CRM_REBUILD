import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(1, 120)
  username!: string;

  @IsString()
  @Length(8, 256)
  password!: string;
}

export class MockCustomerTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,128}$/)
  customerId!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(12, 256)
  currentPassword!: string;

  @IsString()
  @Length(12, 256)
  newPassword!: string;
}
