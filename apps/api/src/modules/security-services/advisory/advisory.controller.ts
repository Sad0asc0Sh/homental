import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { AdvisoryService } from './advisory.service';
import { EvaluateAdvisoryDto } from './dto/advisory.dto';

/** Guest-friendly instant evaluation (debounced live UI in the frontend). */
@Public()
@Controller('advisor')
export class AdvisoryController {
  constructor(private readonly advisoryService: AdvisoryService) {}

  @Post('evaluate')
  async evaluate(@Body() dto: EvaluateAdvisoryDto) {
    // CRITICAL: pass the Sticky-Live-Bar pricing options through — omitting
    // includePricing here silently disabled live pricing for the frontend.
    return this.advisoryService.evaluate({
      locationType: dto.locationType,
      buildingContext: dto.buildingContext ?? null,
      servicesConfig: dto.servicesConfig ?? null,
      includePricing: dto.includePricing,
      citySlug: dto.citySlug,
      lat: dto.lat,
      lng: dto.lng,
      urgency: dto.urgency,
      supplyMode: dto.supplyMode,
      sliderBps: dto.sliderBps,
    });
  }
}
