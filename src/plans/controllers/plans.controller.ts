import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { PlansService } from '../services/plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  @RequirePermissions('create:plans')
  create(@Body() createPlanDto: CreatePlanDto) {
    return this.plansService.create(createPlanDto);
  }

  @Get()
  @RequirePermissions('read:plans', 'create:contracts')
  findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  @RequirePermissions('read:plans', 'create:contracts')
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('update:plans')
  update(@Param('id') id: string, @Body() updatePlanDto: UpdatePlanDto) {
    return this.plansService.update(id, updatePlanDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:plans')
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
