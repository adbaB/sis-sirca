import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { RequirePermissions } from '../auth/decorators';
import { AdvisorPaymentsService } from './advisor-payments.service';
import { ProjectionReportService } from './projection-report.service';
import { ReportsService } from './reports.service';
import { SipCommissionsService } from './sip-commissions.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly sipCommissionsService: SipCommissionsService,
    private readonly advisorPaymentsService: AdvisorPaymentsService,
    private readonly projectionReportService: ProjectionReportService,
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
    @Query('year') year: number,
    @Query('month') month: number,
    @Res() res: Response,
  ) {
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Año o mes inválidos.');
    }

    const buffer = await this.sipCommissionsService.generateExcel(Number(year), Number(month));
    const monthStr = String(month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="comisiones-sip-${year}-${monthStr}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('sip-commissions/pdf')
  @RequirePermissions('read:reports')
  async downloadSipCommissionsPdf(
    @Query('year') year: number,
    @Query('month') month: number,
    @Res() res: Response,
  ) {
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Año o mes inválidos.');
    }

    const buffer = await this.sipCommissionsService.generatePdf(Number(year), Number(month));
    const monthStr = String(month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="comisiones-sip-${year}-${monthStr}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('advisor-payments/excel')
  @RequirePermissions('read:reports')
  async downloadAdvisorPaymentsExcel(
    @Query('year') year: number,
    @Query('month') month: number,
    @Query('advisorId') advisorId: string,
    @Res() res: Response,
  ) {
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Año o mes inválidos.');
    }

    const buffer = await this.advisorPaymentsService.generateExcel(
      Number(year),
      Number(month),
      advisorId || undefined,
    );
    const monthStr = String(month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pagos-asesor-${year}-${monthStr}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('advisor-payments/pdf')
  @RequirePermissions('read:reports')
  async downloadAdvisorPaymentsPdf(
    @Query('year') year: number,
    @Query('month') month: number,
    @Query('advisorId') advisorId: string,
    @Res() res: Response,
  ) {
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Año o mes inválidos.');
    }

    const buffer = await this.advisorPaymentsService.generatePdf(
      Number(year),
      Number(month),
      advisorId || undefined,
    );
    const monthStr = String(month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="pagos-asesor-${year}-${monthStr}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('projection/excel')
  @RequirePermissions('read:reports')
  async downloadProjectionExcel(@Query('advisorId') advisorId: string, @Res() res: Response) {
    const buffer = await this.projectionReportService.generateExcel(advisorId || undefined);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="proyeccion-ingresos.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('projection/pdf')
  @RequirePermissions('read:reports')
  async downloadProjectionPdf(@Query('advisorId') advisorId: string, @Res() res: Response) {
    const buffer = await this.projectionReportService.generatePdf(advisorId || undefined);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="proyeccion-ingresos.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
