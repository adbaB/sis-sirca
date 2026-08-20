import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { UpdateSurplusStatusDto } from '../dto/update-surplus-status.dto';
import { PaymentService } from '../services/payment.service';
import { SurplusService } from '../services/surplus.service';
import { ReceiptAnalysisService } from '../services/receipt-analysis.service';
import { FileInterceptor } from '@nestjs/platform-express';

/**
 * Controlador de facturación enfocado en la gestión HTTP de pagos y análisis de comprobantes.
 * Expone los endpoints de la ruta base `/billing`.
 */
@Controller('billing')
export class PaymentBillingController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly surplusService: SurplusService,
    private readonly receiptAnalysisService: ReceiptAnalysisService,
  ) {}

  /**
   * Crea y procesa un nuevo pago asociado a una o varias facturas.
   * Soporta rutas singulares y plurales para retrocompatibilidad con el frontend.
   *
   * Requiere el permiso `create:advisor-payments` o `create:payments`.
   *
   * @param dto - DTO con la información del pago.
   * @returns Pago procesado o resultado del registro.
   */
  @Post(['payments', 'payment'])
  @RequirePermissions('create:advisor-payments', 'create:payments')
  createPayment(@Body() dto: CreatePaymentDto) {
    return this.paymentService.createPayment(dto);
  }

  /**
   * Consulta paginada de pagos con filtros opcionales.
   * Soporta rutas singulares y plurales.
   *
   * Requiere el permiso `read:advisor-payments` o `read:payments`.
   *
   * @param status - Estado del pago (`PROCESSING`, `COMPLETED`, `REJECTED`).
   * @param search - Término de búsqueda (nombre, cédula, código contrato, referencia).
   * @param page - Número de página (1-based, default 1).
   * @param limit - Elementos por página (default 10).
   * @param month - Filtro de mes (1-12).
   * @param year - Filtro de año (e.g. 2026).
   * @returns Lista paginada de pagos y metadatos.
   */
  @Get(['payments', 'payment'])
  @RequirePermissions('read:advisor-payments', 'read:payments')
  findPayments(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    return this.paymentService.findPayments(
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
      status,
      search,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }

  /**
   * Cuenta la cantidad total de pagos en estado `PROCESSING`.
   * Soporta alias de rutas `/payments/pending/count` y `/payments/pending-count`.
   *
   * Requiere el permiso `read:advisor-payments` o `read:payments`.
   *
   * @returns Objeto con `{ count: number }`.
   */
  @Get(['payments/pending/count', 'payments/pending-count', 'payment/pending-count'])
  @RequirePermissions('read:advisor-payments', 'read:payments')
  async countPendingPayments() {
    const count = await this.paymentService.countPendingPayments();
    return { count };
  }

  /**
   * Aprueba un pago registrado en estado `PROCESSING`.
   *
   * Requiere el permiso `create:advisor-payments`, `update:payments` o `create:payments`.
   *
   * @param id - Identificador UUID del pago.
   * @returns Pago actualizado en estado `COMPLETED`.
   */
  @Patch(['payments/:id/approve', 'payment/:id/approve'])
  @RequirePermissions('create:advisor-payments', 'update:payments', 'create:payments')
  approvePayment(@Param('id') id: string) {
    return this.paymentService.approvePayment(id);
  }

  /**
   * Rechaza un pago pendiente indicando el motivo correspondiente.
   * Modifica el estado del pago a `REJECTED` y anula los excedentes asociados.
   *
   * Requiere el permiso `create:advisor-payments`, `update:payments` o `create:payments`.
   *
   * @param id - Identificador único UUID del pago.
   * @param body - Razón o justificación del rechazo (vía body o 'reason').
   * @returns El registro de pago actualizado con su motivo de rechazo en los metadatos.
   */
  @Patch(['payments/:id/reject', 'payment/:id/reject'])
  @RequirePermissions('create:advisor-payments', 'update:payments', 'create:payments')
  rejectPayment(@Param('id') id: string, @Body() body: { reason?: string } | string) {
    const reasonStr = typeof body === 'string' ? body : body?.reason;
    return this.paymentService.rejectPayment(id, reasonStr || 'Rechazado por el administrador');
  }

  /**
   * Corrige/actualiza la fecha de un pago existente y recalcula las conversiones
   * de tasa de cambio y excedentes en función de la nueva fecha.
   *
   * Requiere el permiso `create:advisor-payments`, `update:payments` o `create:payments`.
   *
   * @param id - Identificador único UUID del pago.
   * @param body - Objeto con la nueva fecha (`paymentDate`).
   * @returns El registro de pago actualizado.
   */
  @Patch(['payments/:id/date', 'payment/:id/date'])
  @RequirePermissions('create:advisor-payments', 'update:payments', 'create:payments')
  updatePaymentDate(@Param('id') id: string, @Body() body: { paymentDate: string } | string) {
    const dateStr = typeof body === 'string' ? body : body?.paymentDate;
    return this.paymentService.updatePaymentDate(id, dateStr);
  }

  /**
   * Sube y analiza un archivo de comprobante bancario (imagen/PDF) mediante OCR y AWS.
   * Extrae automáticamente la referencia, fecha, monto, moneda y método de pago.
   *
   * Requiere el permiso `create:advisor-payments` o `create:payments`.
   *
   * @param file - Archivo subido mediante el interceptor de Multer (`file`).
   * @returns Objeto con los datos extraídos del comprobante y la URL almacenada en S3.
   */
  @Post(['payments/analyze-receipt', 'payment/analyze-receipt'])
  @RequirePermissions('create:advisor-payments', 'create:payments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Tipo de archivo no soportado: ${file.mimetype}. Formatos permitidos: JPG, PNG, WEBP, PDF`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  analyzeReceipt(@UploadedFile() file: Express.Multer.File) {
    return this.receiptAnalysisService.analyzeReceipt(file);
  }

  /**
   * Modifica manualmente el estado de un excedente / saldo a favor ('pending', 'refunded', 'cancelled').
   *
   * Requiere el permiso `update:payments`, `create:advisor-payments` o `update:billing`.
   *
   * @param id - Identificador UUID del excedente.
   * @param dto - DTO con el estado destino y justificación opcional.
   * @returns El registro de excedente actualizado.
   */
  @Patch(['surpluses/:id/status', 'surplus/:id/status'])
  @RequirePermissions('update:payments', 'create:advisor-payments', 'update:billing')
  updateSurplusStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSurplusStatusDto) {
    return this.surplusService.updateSurplusStatus(id, dto);
  }
}
