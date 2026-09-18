import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { CreateMedicalServiceDto } from '../dto/create-medical-service.dto';
import { UpdateMedicalServiceDto } from '../dto/update-medical-service.dto';
import { MedicalServicesService } from '../services/medical-services.service';

@Controller('plans/medical-services')
export class MedicalServicesController {
  constructor(private readonly medicalServicesService: MedicalServicesService) {}

  @Post()
  @RequirePermissions('create:plans')
  create(@Body() createMedicalServiceDto: CreateMedicalServiceDto) {
    return this.medicalServicesService.create(createMedicalServiceDto);
  }

  @Get()
  @RequirePermissions('read:plans', 'create:contracts')
  findAll() {
    return this.medicalServicesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('read:plans', 'create:contracts')
  findOne(@Param('id') id: string) {
    return this.medicalServicesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('update:plans')
  update(@Param('id') id: string, @Body() updateMedicalServiceDto: UpdateMedicalServiceDto) {
    return this.medicalServicesService.update(id, updateMedicalServiceDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:plans')
  remove(@Param('id') id: string) {
    return this.medicalServicesService.remove(id);
  }
}
