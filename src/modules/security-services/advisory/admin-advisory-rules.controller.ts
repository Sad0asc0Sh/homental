import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { AdvisoryService } from './advisory.service';
import { CreateAdvisoryRuleDto, UpdateAdvisoryRuleDto } from './dto/advisory.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/advisory/rules')
export class AdminAdvisoryRulesController {
  constructor(private readonly advisoryService: AdvisoryService) {}

  @Get()
  async list() {
    return this.advisoryService.listRules();
  }

  @Post()
  async create(@Body() dto: CreateAdvisoryRuleDto) {
    return this.advisoryService.createRule(dto);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdvisoryRuleDto) {
    return this.advisoryService.updateRule(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.advisoryService.deleteRule(id);
  }
}
