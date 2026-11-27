import { Module } from '@nestjs/common';
import { AdminCitiesBranchesController } from './admin-cities-branches.controller';
import { CitiesController } from './cities-branches.controller';
import { CitiesBranchesService } from './cities-branches.service';

@Module({
  controllers: [CitiesController, AdminCitiesBranchesController],
  providers: [CitiesBranchesService],
  exports: [CitiesBranchesService],
})
export class CitiesBranchesModule {}
