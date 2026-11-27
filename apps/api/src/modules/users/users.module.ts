import { Module } from '@nestjs/common';
import { AdminTechniciansController } from './admin-technicians.controller';
import { AdminTechniciansService } from './admin-technicians.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, AdminTechniciansController],
  providers: [UsersService, AdminTechniciansService],
  exports: [UsersService],
})
export class UsersModule {}
