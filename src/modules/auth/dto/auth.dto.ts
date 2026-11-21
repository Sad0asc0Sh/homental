import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Length(8, 20)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @Length(8, 20)
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'کد تأیید باید ۶ رقم باشد.' })
  code!: string;

  @IsOptional()
  @IsString()
  @Length(1, 256)
  deviceInfo?: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 1024)
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @Length(20, 1024)
  refreshToken!: string;
}
