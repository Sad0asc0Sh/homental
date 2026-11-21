import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { CitiesBranchesService } from './cities-branches.service';

/** Public catalog endpoints — consumed by the future Next.js frontend. */
@Public()
@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesBranchesService: CitiesBranchesService) {}

  @Get()
  async listCities() {
    return this.citiesBranchesService.listActiveCities();
  }

  @Get(':slug/branches')
  async listBranches(@Param('slug') slug: string) {
    return this.citiesBranchesService.listActiveBranches(slug);
  }
}
