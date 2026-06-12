import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { RequirePermissions } from '../auth/decorators';
import { ReportsService } from './reports.service';
import { SipCommissionsService } from './sip-commissions.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly sipCommissionsService: SipCommissionsService,
  ) {}

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

  @Get('sip-commissions/excel')
  @RequirePermissions('read:reports')
  async downloadSipCommissionsExcel(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new BadRequestException('Formato de fecha inválido. Debe ser YYYY-MM-DD');
    }

    const buffer = await this.sipCommissionsService.generateExcel(startDate, endDate);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="comisiones-sip-${startDate}-a-${endDate}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('sip-commissions/pdf')
  @RequirePermissions('read:reports')
  async downloadSipCommissionsPdf(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new BadRequestException('Formato de fecha inválido. Debe ser YYYY-MM-DD');
    }

    const buffer = await this.sipCommissionsService.generatePdf(startDate, endDate);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="comisiones-sip-${startDate}-a-${endDate}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
