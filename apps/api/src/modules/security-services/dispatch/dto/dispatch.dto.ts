import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class TechnicianStatusDto {
  @IsBoolean()
  isOnline!: boolean;

  @IsOptional()
  @IsBoolean()
  isAcceptingOffers?: boolean;

  /** Required when going online — syncs Postgres + the Redis GEO index. */
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
}

export class TechnicianLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}
