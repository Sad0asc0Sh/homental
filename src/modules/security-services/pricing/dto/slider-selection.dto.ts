import { IsDivisibleBy, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { MAX_DELTA_BPS, MIN_DELTA_BPS, SLIDER_STEP_BPS } from '../managed-pricing';

export class SliderSelectionDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt({ message: 'درصد تنظیم بسته باید عدد صحیح باشد.' })
  @Min(MIN_DELTA_BPS, { message: 'تنظیم بسته نمی‌تواند کمتر از منفی ۱۵ درصد باشد.' })
  @Max(MAX_DELTA_BPS, { message: 'تنظیم بسته نمی‌تواند بیشتر از مثبت ۲۵ درصد باشد.' })
  @IsDivisibleBy(SLIDER_STEP_BPS, { message: 'تنظیم بسته فقط با گام‌های یک درصدی مجاز است.' })
  sliderBps?: number;
}
