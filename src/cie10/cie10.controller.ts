import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Cie10Service } from './cie10.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('cie10')
export class Cie10Controller {
  constructor(private readonly cie10Service: Cie10Service) {}

  @Get()
  async search(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('onlyTerminal') onlyTerminal?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 30;
    const isOnlyTerminal = onlyTerminal !== undefined ? onlyTerminal === 'true' : true;
    return this.cie10Service.search(search, parsedLimit, isOnlyTerminal);
  }

  @Get(':code')
  async findOne(@Param('code') code: string) {
    return this.cie10Service.findOne(code);
  }
}
