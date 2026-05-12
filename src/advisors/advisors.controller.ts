import { Controller, Get, Body, Param, Query } from '@nestjs/common';
import { AdvisorsService } from './advisors.service';
import { CreateAdvisorDto } from './dto/create-advisor.dto';
import { UpdateAdvisorDto } from './dto/update-advisor.dto';

@Controller('advisors')
export class AdvisorsController {
  constructor(private readonly advisorsService: AdvisorsService) {}

  create(@Body() createAdvisorDto: CreateAdvisorDto) {
    return this.advisorsService.create(createAdvisorDto);
  }

  @Get()
  findAll() {
    return this.advisorsService.findAll();
  }

  search(@Query('name') name: string) {
    return this.advisorsService.searchByName(name);
  }

  findOne(@Param('id') id: string) {
    return this.advisorsService.findOne(id);
  }

  update(@Param('id') id: string, @Body() updateAdvisorDto: UpdateAdvisorDto) {
    return this.advisorsService.update(id, updateAdvisorDto);
  }

  remove(@Param('id') id: string) {
    return this.advisorsService.remove(id);
  }
}
