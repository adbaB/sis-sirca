import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { RequirePermissions } from '../auth/decorators';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('contracts/excel')
  @RequirePermissions('read:reports')
  async downloadExcel(
    @Query('year') year: number,
    @Query('month') month: number,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateExcel(Number(year), Number(month));
    const monthStr = String(month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reporte-contratos-${year}-${monthStr}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('contracts/pdf')
  @RequirePermissions('read:reports')
  async downloadPdf(
    @Query('year') year: number,
    @Query('month') month: number,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generatePdf(Number(year), Number(month));
    const monthStr = String(month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reporte-contratos-${year}-${monthStr}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
