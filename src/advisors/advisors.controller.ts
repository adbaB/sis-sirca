import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { AdvisorsService } from './advisors.service';
import { CreateAdvisorDto } from './dto/create-advisor.dto';
import { UpdateAdvisorDto } from './dto/update-advisor.dto';
import { RequirePermissions } from '../auth/decorators';

@Controller('advisors')
export class AdvisorsController {
  constructor(private readonly advisorsService: AdvisorsService) {}

  @Post()
  @RequirePermissions('create:advisors')
  create(@Body() createAdvisorDto: CreateAdvisorDto) {
    return this.advisorsService.create(createAdvisorDto);
  }

  @Get()
  @RequirePermissions('read:advisors')
  findAll() {
    return this.advisorsService.findAll();
  }

  @Get('search')
  @RequirePermissions('read:advisors')
  search(@Query('name') name: string) {
    return this.advisorsService.searchByName(name);
  }

  @Get(':id')
  @RequirePermissions('read:advisors')
  findOne(@Param('id') id: string) {
    return this.advisorsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('update:advisors')
  update(@Param('id') id: string, @Body() updateAdvisorDto: UpdateAdvisorDto) {
    return this.advisorsService.update(id, updateAdvisorDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:advisors')
  remove(@Param('id') id: string) {
    return this.advisorsService.remove(id);
  }
}
