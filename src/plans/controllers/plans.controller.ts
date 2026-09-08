import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { BatchCreatePlanServicesDto } from '../dto/batch-create-plan-services.dto';
import { CreatePlanServiceDto } from '../dto/create-plan-service.dto';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { QueryPlanServicesDto } from '../dto/query-plan-services.dto';
import { UpdatePlanServiceDto } from '../dto/update-plan-service.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { PlanCloningService } from '../services/plan-cloning.service';
import { PlanServicesService } from '../services/plan-services.service';
import { PlansService } from '../services/plans.service';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly planServicesService: PlanServicesService,
    private readonly planCloningService: PlanCloningService,
  ) {}

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

  @Post(':id/services/batch')
  @RequirePermissions('update:plans')
  createServicesBatch(@Param('id') id: string, @Body() batchDto: BatchCreatePlanServicesDto) {
    return this.planServicesService.createBatch(id, batchDto);
  }

  @Post(':id/services')
  @RequirePermissions('update:plans')
  createService(@Param('id') id: string, @Body() createPlanServiceDto: CreatePlanServiceDto) {
    return this.planServicesService.create(id, createPlanServiceDto);
  }

  @Get(':id/services')
  @RequirePermissions('read:plans', 'create:contracts')
  findServices(@Param('id') id: string, @Query() query: QueryPlanServicesDto) {
    return this.planServicesService.findByPlan(id, query.grouped);
  }

  @Get(':id/services/:planServiceId')
  @RequirePermissions('read:plans', 'create:contracts')
  findService(@Param('id') id: string, @Param('planServiceId') planServiceId: string) {
    return this.planServicesService.findOne(id, planServiceId);
  }

  @Patch(':id/services/:planServiceId')
  @RequirePermissions('update:plans')
  updateService(
    @Param('id') id: string,
    @Param('planServiceId') planServiceId: string,
    @Body() updateDto: UpdatePlanServiceDto,
  ) {
    return this.planServicesService.update(id, planServiceId, updateDto);
  }

  @Delete(':id/services/:planServiceId')
  @RequirePermissions('update:plans')
  removeService(@Param('id') id: string, @Param('planServiceId') planServiceId: string) {
    return this.planServicesService.remove(id, planServiceId);
  }

  @Post(':id/clone-services-from/:sourcePlanId')
  @RequirePermissions('update:plans')
  cloneServices(@Param('id') id: string, @Param('sourcePlanId') sourcePlanId: string) {
    return this.planCloningService.cloneServices(id, sourcePlanId);
  }
}
