import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { CreateServiceCategoryDto } from '../dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from '../dto/update-service-category.dto';
import { ServiceCategoriesService } from '../services/service-categories.service';

@Controller('plans/categories')
export class ServiceCategoriesController {
  constructor(private readonly serviceCategoriesService: ServiceCategoriesService) {}

  @Post()
  @RequirePermissions('create:plans')
  create(@Body() createServiceCategoryDto: CreateServiceCategoryDto) {
    return this.serviceCategoriesService.create(createServiceCategoryDto);
  }

  @Get()
  @RequirePermissions('read:plans', 'create:contracts')
  findAll() {
    return this.serviceCategoriesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('read:plans', 'create:contracts')
  findOne(@Param('id') id: string) {
    return this.serviceCategoriesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('update:plans')
  update(@Param('id') id: string, @Body() updateServiceCategoryDto: UpdateServiceCategoryDto) {
    return this.serviceCategoriesService.update(id, updateServiceCategoryDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:plans')
  remove(@Param('id') id: string) {
    return this.serviceCategoriesService.remove(id);
  }
}
