import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentService } from '../services/payment.service';
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
    private readonly receiptAnalysisService: ReceiptAnalysisService,
  ) {}

  /**
   * Crea y procesa un nuevo pago asociado a una o varias facturas.
   *
   * Requiere el permiso `create:payments`.
   *
   * @param createPaymentDto - Datos de creación del pago (referencia, monto, método, facturas).
   * @returns Promesa con el resultado de la transacción (pago guardado, factura, saldo pendiente, etc.).
   */
  @Post('payment')
  @RequirePermissions('create:payments')
  createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentService.createPayment(createPaymentDto);
  }

  /**
   * Obtiene la lista paginada y filtrada de pagos registrados.
   * Permite filtrar por estado (status), término de búsqueda (search) y período (mes/año).
   *
   * Requiere el permiso `read:payments`.
   *
   * @param page - Número de página actual (por defecto: 1).
   * @param limit - Cantidad de registros por página (por defecto: 10).
   * @param status - Estado del pago ('PROCESSING', 'COMPLETED', 'REJECTED').
   * @param search - Término de búsqueda (referencia, cédula, nombre, código de contrato).
   * @param month - Mes de facturación (1-12).
   * @param year - Año de facturación (e.g. 2026).
   * @returns Lista paginada de pagos junto con sus metadatos de paginación.
   */
  @Get('payments')
  @RequirePermissions('read:payments')
  getPayments(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    return this.paymentService.findPayments(
      Number(page),
      Number(limit),
      status,
      search,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }

  /**
   * Obtiene la cantidad total de pagos que se encuentran en estado pendiente (`PROCESSING`).
   *
   * Requiere el permiso `read:payments`.
   *
   * @returns Objeto con la propiedad `count` indicando el número de pagos pendientes.
   */
  @Get('payments/pending-count')
  @RequirePermissions('read:payments')
  async getPendingCount() {
    const count = await this.paymentService.countPendingPayments();
    return { count };
  }

  /**
   * Aprueba administrativamente un pago previamente registrado en estado `PROCESSING`.
   * Actualiza su estado a `COMPLETED` y recalculó el saldo abonado en la factura.
   *
   * Requiere el permiso `update:payments`.
   *
   * @param id - Identificador único UUID del pago a aprobar.
   * @returns El registro de pago actualizado.
   */
  @Patch('payments/:id/approve')
  @RequirePermissions('update:payments')
  approvePayment(@Param('id') id: string) {
    return this.paymentService.approvePayment(id);
  }

  /**
   * Rechaza un pago pendiente indicando el motivo correspondiente.
   * Modifica el estado del pago a `REJECTED` y anula los excedentes asociados.
   *
   * Requiere el permiso `update:payments`.
   *
   * @param id - Identificador único UUID del pago.
   * @param reason - Razón o justificación del rechazo.
   * @returns El registro de pago actualizado con su motivo de rechazo en los metadatos.
   */
  @Patch('payments/:id/reject')
  @RequirePermissions('update:payments')
  rejectPayment(@Param('id') id: string, @Body('reason') reason: string) {
    return this.paymentService.rejectPayment(id, reason || 'Rechazado por el administrador');
  }

  /**
   * Corrige/actualiza la fecha de un pago existente y recalcula las conversiones
   * de tasa de cambio y excedentes en función de la nueva fecha.
   *
   * Requiere el permiso `update:payments`.
   *
   * @param id - Identificador único UUID del pago.
   * @param paymentDate - Nueva fecha de pago (cadena de texto en formato fecha).
   * @returns El registro de pago actualizado.
   */
  @Patch('payments/:id/date')
  @RequirePermissions('update:payments')
  updatePaymentDate(@Param('id') id: string, @Body('paymentDate') paymentDate: string) {
    return this.paymentService.updatePaymentDate(id, paymentDate);
  }

  /**
   * Sube y analiza un archivo de comprobante bancario (imagen/PDF) mediante OCR y AWS.
   * Extrae automáticamente la referencia, fecha, monto, moneda y método de pago.
   *
   * Requiere el permiso `create:advisor-payments`.
   *
   * @param file - Archivo subido mediante el interceptor de Multer (`file`).
   * @returns Objeto con los datos extraídos del comprobante y la URL almacenada en S3.
   */
  @Post('payments/analyze-receipt')
  @RequirePermissions('create:advisor-payments')
  @UseInterceptors(FileInterceptor('file'))
  analyzeReceipt(@UploadedFile() file: Express.Multer.File) {
    return this.receiptAnalysisService.analyzeReceipt(file);
  }
}
