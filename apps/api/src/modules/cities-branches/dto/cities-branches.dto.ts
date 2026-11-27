import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCityDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'slug باید شامل حروف کوچک انگلیسی، رقم و خط تیره باشد.' })
  slug!: string;

  @IsString()
  @Length(2, 60)
  nameFa!: string;

  @IsString()
  @Length(2, 60)
  nameEn!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  launchOrder?: number;
}

export class UpdateCityDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  nameFa?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  nameEn?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  launchOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBranchDto {
  @IsUUID()
  cityId!: string;

  @IsString()
  @Length(3, 20)
  code!: string;

  @IsString()
  @Length(2, 120)
  nameFa!: string;

  @IsString()
  @Length(5, 300)
  addressFa!: string;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(50_000)
  serviceRadiusMeters?: number;

  @IsOptional()
  @IsBoolean()
  hasPhysicalShowroom?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRateOverride?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  warrantyReserveOverride?: number | null;

  @IsOptional()
  @IsUUID()
  adminId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 20)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  nameFa?: string;

  @IsOptional()
  @IsString()
  @Length(5, 300)
  addressFa?: string;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(50_000)
  serviceRadiusMeters?: number;

  @IsOptional()
  @IsBoolean()
  hasPhysicalShowroom?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRateOverride?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  warrantyReserveOverride?: number | null;

  @IsOptional()
  @IsUUID()
  adminId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
