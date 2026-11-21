import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { PricingService } from './pricing.service';
import { EstimateDto } from './dto/pricing.dto';

/** Guest-friendly live sticky-bar estimates — no authentication. */
@Public()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('estimate')
  async estimate(@Body() dto: EstimateDto) {
    return this.pricingService.estimate({
      citySlug: dto.citySlug,
      lat: dto.lat,
      lng: dto.lng,
      urgency: dto.urgency,
      supplyMode: dto.supplyMode,
      items: dto.items,
    });
  }
}
