import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { JwtPayload } from '../../auth/guards/auth.guard';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { EventualitiesService } from '../services/eventualities.service';
import { EventualityPdfService } from '../services/eventuality-pdf.service';
import { EventualityStatisticsService } from '../services/eventuality-statistics.service';
import { CreateEmergencyDto } from '../dto/create-emergency.dto';
import { UploadMedicalReportDto } from '../dto/upload-medical-report.dto';
import { UpdateMedicalReportDataDto } from '../dto/update-medical-report-data.dto';
import {
  RecalculateConsumptionRateDto,
  UpdateExtractionDetailsDto,
} from '../dto/update-extraction-details.dto';
import { AddProviderInvoiceDto } from '../dto/add-provider-invoice.dto';
import { FindEventualitiesDto } from '../dto/find-eventualities.dto';
import { GetDailyEventualityStatsDto } from '../dto/get-daily-eventuality-stats.dto';
import { UpdateConsumptionAlertConfigDto } from '../dto/update-consumption-alert-config.dto';
import { RejectEventualityDto } from '../dto/reject-eventuality.dto';
import { MAX_UPLOAD_FILE_SIZE } from '../../common/constants/upload.constants';

const allowedDocumentMimes = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const documentFileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (allowedDocumentMimes.includes(file.mimetype.toLowerCase())) {
    callback(null, true);
  } else {
    callback(
      new BadRequestException(
        'Formato de archivo no soportado. Se permiten únicamente archivos PDF o imágenes (JPG, PNG, WebP).',
      ),
      false,
    );
  }
};

@Controller('eventualities')
export class EventualitiesController {
  constructor(
    private readonly eventualitiesService: EventualitiesService,
    private readonly eventualityPdfService: EventualityPdfService,
    private readonly eventualityStatisticsService: EventualityStatisticsService,
  ) {}

  @Get('stats/daily')
  @RequirePermissions('read:eventualities', 'read:statistics')
  async getDailyStats(@Query() query: GetDailyEventualityStatsDto) {
    return this.eventualityStatisticsService.getDailyCreatedStats(query.month, query.year);
  }

  @Get('settings/consumption-alert')
  @RequirePermissions('read:eventualities')
  async getConsumptionAlertConfig() {
    return this.eventualitiesService.getConsumptionAlertConfig();
  }

  @Put('settings/consumption-alert')
  @RequirePermissions('configure:eventualities')
  async updateConsumptionAlertConfig(@Body() dto: UpdateConsumptionAlertConfigDto) {
    return this.eventualitiesService.updateConsumptionAlertConfig(dto);
  }

  @Post('emergency')
  @RequirePermissions('create:eventualities')
  async createEmergency(@Body() dto: CreateEmergencyDto) {
    return this.eventualitiesService.createEmergency(dto);
  }

  @Post(':id/approve')
  @RequirePermissions('approve:eventualities')
  async approveEmergency(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: JwtPayload) {
    return this.eventualitiesService.approveEmergency(id, user);
  }

  @Post(':id/reject')
  @RequirePermissions('reject:eventualities')
  async rejectEmergency(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectEventualityDto,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.eventualitiesService.rejectEmergency(id, dto, user);
  }

  @Get()
  @RequirePermissions('read:eventualities')
  async findAll(@Query() query: FindEventualitiesDto) {
    return this.eventualitiesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('read:eventualities')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventualitiesService.findOne(id);
  }

  @Get(':id/pdf')
  @RequirePermissions('read:eventualities')
  async downloadVoucherPdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { pdfBuffer, filename } = await this.eventualityPdfService.generateVoucherPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Post(':id/medical-report')
  @RequirePermissions('update:eventualities', 'manage:eventualities')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
      fileFilter: documentFileFilter,
    }),
  )
  async uploadMedicalReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadMedicalReportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.eventualitiesService.uploadMedicalReport(id, dto, file);
  }

  @Get(':id/medical-report')
  @RequirePermissions('read:eventualities', 'update:eventualities', 'manage:eventualities')
  async getMedicalReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventualitiesService.getMedicalReport(id);
  }

  @Patch(':id/medical-report')
  @RequirePermissions('update:eventualities', 'manage:eventualities')
  async updateMedicalReportData(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalReportDataDto,
  ) {
    return this.eventualitiesService.updateMedicalReportData(id, dto);
  }

  @Post(':id/consumption-sheet')
  @RequirePermissions(
    'update:eventualities',
    'review:eventuality-consumption',
    'manage:eventualities',
  )
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
      fileFilter: documentFileFilter,
    }),
  )
  async uploadConsumptionFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar el archivo de hoja de consumo.');
    }
    return this.eventualitiesService.processConsumptionFile(id, file);
  }

  @Get(':id/extraction-details')
  @RequirePermissions(
    'read:eventualities',
    'update:eventualities',
    'review:eventuality-consumption',
    'manage:eventualities',
  )
  async getExtractionDetails(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventualitiesService.getExtractionDetails(id);
  }

  @Put(':id/extraction-details')
  @RequirePermissions(
    'review:eventuality-consumption',
    'update:eventualities',
    'manage:eventualities',
  )
  async updateExtractionDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExtractionDetailsDto,
  ) {
    return this.eventualitiesService.updateExtractionDetails(id, dto);
  }

  @Patch(':id/extraction-details/exchange-rate')
  @RequirePermissions(
    'review:eventuality-consumption',
    'update:eventualities',
    'manage:eventualities',
  )
  async recalculateConsumptionByDate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecalculateConsumptionRateDto,
  ) {
    return this.eventualitiesService.recalculateConsumptionByDate(id, dto.exchangeRateDate);
  }

  @Post(':id/provider-invoices/extract')
  @RequirePermissions('manage:eventuality-invoices', 'update:eventualities', 'manage:eventualities')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
      fileFilter: documentFileFilter,
    }),
  )
  async extractProviderInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar el archivo de la factura fiscal.');
    }
    return this.eventualitiesService.extractProviderInvoice(id, file);
  }

  @Post(':id/provider-invoices')
  @RequirePermissions('manage:eventuality-invoices', 'update:eventualities', 'manage:eventualities')
  async addProviderInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProviderInvoiceDto,
  ) {
    return this.eventualitiesService.addProviderInvoice(id, dto);
  }

  @Post(':id/finalize-emergency')
  @RequirePermissions('manage:eventuality-invoices', 'update:eventualities', 'manage:eventualities')
  async finalizeEmergency(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventualitiesService.finalizeEmergency(id);
  }
}
