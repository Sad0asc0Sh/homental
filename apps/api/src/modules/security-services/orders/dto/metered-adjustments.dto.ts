import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { MAX_QUANTITY_CM } from '../../pricing/metered-quantity';

export class MeterReadingDto {
  @IsString()
  @Length(1, 160)
  lineKey!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY_CM)
  actualCm!: number;

  @IsString()
  @Length(1, 500)
  @Matches(/\S/)
  photoAssetId!: string;
}

export class SubmitMeterReadingsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MeterReadingDto)
  readings!: MeterReadingDto[];
}

export class ApproveMeteredAdjustmentDto {
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  idempotencyKey!: string;
}
