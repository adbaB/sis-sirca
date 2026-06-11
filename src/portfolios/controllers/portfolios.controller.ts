import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { PortfoliosService } from '../services/portfolios.service';
import { CreatePortfolioDto } from '../dto/create-portfolio.dto';
import { UpdatePortfolioDto } from '../dto/update-portfolio.dto';

@Controller('portfolios')
export class PortfoliosController {
  constructor(private readonly portfoliosService: PortfoliosService) {}

  @Post()
  @RequirePermissions('create:portfolios')
  create(@Body() createPortfolioDto: CreatePortfolioDto) {
    return this.portfoliosService.create(createPortfolioDto);
  }

  @Get()
  @RequirePermissions('read:portfolios')
  findAll() {
    return this.portfoliosService.findAll();
  }

  @Get(':id')
  @RequirePermissions('read:portfolios')
  findOne(@Param('id') id: string) {
    return this.portfoliosService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('update:portfolios')
  update(@Param('id') id: string, @Body() updatePortfolioDto: UpdatePortfolioDto) {
    return this.portfoliosService.update(id, updatePortfolioDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:portfolios')
  remove(@Param('id') id: string) {
    return this.portfoliosService.remove(id);
  }
}
