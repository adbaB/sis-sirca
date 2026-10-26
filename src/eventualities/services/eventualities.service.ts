import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Eventuality, EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import {
  ConsumptionCategory,
  EventualityExtractionDetail,
  ExtractionStatus,
} from '../entities/eventuality-extraction-detail.entity';
import {
  EventualityMedicalReport,
  MedicalReportExtractionStatus,
} from '../entities/eventuality-medical-report.entity';
import { EventualityMovement, MovementCategory } from '../entities/eventuality-movement.entity';
import { EventualityProviderInvoice } from '../entities/eventuality-provider-invoice.entity';
import { Person } from '../../persons/entities/person.entity';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { CoveragePeriodStatus } from '../../contracts/entities/contract-coverage-period.entity';
import { CoveragePeriodService } from '../../contracts/services/coverage-period.service';
import { SystemSettingsService } from '../../system-settings/system-settings.service';
import { AwsService } from '../../aws/aws.service';
import {
  EventualityOcrService,
  ExtractedConsumptionSheetResult,
  ExtractedProviderInvoiceResult,
} from './eventuality-ocr.service';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { MetaWhatsappService } from '../../chatbot/services/meta-whatsapp.service';
import { normalizeWhatsappPhone } from '../../chatbot/utils/phone.util';
import { formatToISODateString, getCaracasTodayJSDate } from '../../common/utils/date.util';
import { generateClaimNumber } from '../helpers/claim-number-generator.helper';
import { CreateEmergencyDto } from '../dto/create-emergency.dto';
import { UploadMedicalReportDto } from '../dto/upload-medical-report.dto';
import { UpdateMedicalReportDataDto } from '../dto/update-medical-report-data.dto';
import { UpdateExtractionDetailsDto } from '../dto/update-extraction-details.dto';
import { AddProviderInvoiceDto } from '../dto/add-provider-invoice.dto';
import { FindEventualitiesDto } from '../dto/find-eventualities.dto';
import {
  ConsumptionAlertConfigResponse,
  UpdateConsumptionAlertConfigDto,
} from '../dto/update-consumption-alert-config.dto';
import { RejectEventualityDto } from '../dto/reject-eventuality.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateQueryBuilder } from '../../common/utils/pagination.util';

@Injectable()
export class EventualitiesService {
  private readonly logger = new Logger(EventualitiesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Eventuality)
    private readonly eventualityRepo: Repository<Eventuality>,
    @InjectRepository(EventualityExtractionDetail)
    private readonly extractionDetailRepo: Repository<EventualityExtractionDetail>,
    @InjectRepository(EventualityMedicalReport)
    private readonly medicalReportRepo: Repository<EventualityMedicalReport>,
    @InjectRepository(EventualityMovement)
    private readonly movementRepo: Repository<EventualityMovement>,
    @InjectRepository(EventualityProviderInvoice)
    private readonly invoiceRepo: Repository<EventualityProviderInvoice>,
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonRepo: Repository<ContractPerson>,
    private readonly coveragePeriodService: CoveragePeriodService,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly awsService: AwsService,
    private readonly eventualityOcrService: EventualityOcrService,
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  /**
   * Crea una eventualidad de tipo EMERGENCIA.
   * Valida contrato activo, vigencia anual y cobertura disponible.
   * Genera número de siniestro atómico y bloquea preventivamente el saldo en la póliza.
   */
  async createEmergency(dto: CreateEmergencyDto): Promise<Eventuality> {
    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Validar existencia del paciente
      const person = await manager.getRepository(Person).findOne({
        where: { id: dto.personId },
      });
      if (!person) {
        throw new NotFoundException(`Persona con ID "${dto.personId}" no encontrada.`);
      }

      // 2. Validar afiliación contractual
      const cp = await manager.getRepository(ContractPerson).findOne({
        where: { id: dto.contractPersonId },
        relations: ['contract', 'plan', 'person', 'person.plan'],
      });
      if (!cp) {
        throw new NotFoundException(`Afiliación con ID "${dto.contractPersonId}" no encontrada.`);
      }

      if (cp.person?.id !== person.id) {
        throw new BadRequestException(
          'La afiliación contractual no corresponde a la persona indicada.',
        );
      }

      const contract = cp.contract;
      if (!contract) {
        throw new BadRequestException('La afiliación no tiene un contrato asociado.');
      }

      // 3. Validar estado del contrato
      if (contract.status !== ContractStatus.ACTIVE) {
        throw new BadRequestException(
          `El contrato "${contract.code}" no se encuentra activo (estado: ${contract.status}). No se pueden aperturar eventualidades.`,
        );
      }

      // 4. Validar vigencia de fechas [startDate, expirationDate]
      const now = new Date();
      if (contract.startDate && new Date(contract.startDate) > now) {
        throw new BadRequestException(
          `El contrato aún no ha iniciado su vigencia (inicio: ${contract.startDate}).`,
        );
      }
      if (contract.expirationDate && new Date(contract.expirationDate) < now) {
        throw new BadRequestException(
          `El contrato ha expirado su vigencia anual (vencimiento: ${contract.expirationDate}). Requiere renovación.`,
        );
      }

      // 5. Obtener período anual de cobertura activo
      const period = await this.coveragePeriodService.getOrCreateActivePeriod(cp.id, manager);

      if (Number(period.remainingCoverage) <= 0) {
        throw new BadRequestException(
          `El afiliado no posee cobertura disponible en su período anual vigente (Saldo restante: $0.00).`,
        );
      }

      // 6. Determinar factor de venta
      const effectivePlan = cp.plan ?? cp.person?.plan;
      const planFactor = effectivePlan?.profitFactor ? Number(effectivePlan.profitFactor) : null;
      const globalFactor = await this.systemSettingsService.getNumeric(
        'DEFAULT_SERVICE_PRICE_FACTOR',
        2.0,
      );
      const appliedFactor = planFactor ?? globalFactor;

      // 7. Determinar monto a bloquear y evaluar umbral de alerta
      const estimatedCost = Number(dto.estimatedCost || 0);
      const estimatedCoverageToLock = Number((estimatedCost * appliedFactor).toFixed(2));

      const initialCoverage = Number(period.initialCoverage) || 0;
      const consumedCoverage = Number(period.consumedCoverage) || 0;
      const reservedCoverage = Number(period.reservedCoverage) || 0;
      const currentConsumption = consumedCoverage + reservedCoverage;
      const projectedConsumption = currentConsumption + estimatedCoverageToLock;
      const projectedPercentage =
        initialCoverage > 0
          ? Number(((projectedConsumption / initialCoverage) * 100).toFixed(2))
          : 100;

      const alertConfig = await this.getConsumptionAlertConfig();
      const requiresApproval =
        alertConfig.enabled && projectedPercentage >= alertConfig.consumptionThresholdPercentage;

      let lockedAmount = 0;
      let claimNumber: string | null = null;
      let status: EventualityStatus = EventualityStatus.CLINIC_PROCESS;

      if (requiresApproval) {
        // Supera el umbral configurado: NO genera número de siniestro ni bloquea saldo hasta aprobación
        status = EventualityStatus.PENDING_APPROVAL;
      } else {
        // Dentro de los límites normales: bloquea saldo y genera número numérico
        if (estimatedCoverageToLock > 0) {
          await this.coveragePeriodService.lockCoverageAmount(
            period.id,
            estimatedCoverageToLock,
            manager,
          );
          lockedAmount = estimatedCoverageToLock;
        }
        const claimResult = await generateClaimNumber(manager);
        claimNumber = claimResult.claimNumber;
      }

      // 8. Crear eventualidad
      const eventuality = manager.getRepository(Eventuality).create({
        claimNumber,
        type: EventualityType.EMERGENCY,
        status,
        requiresApproval,
        personId: person.id,
        contractPersonId: cp.id,
        coveragePeriodId: period.id,
        clinicName: dto.clinicName,
        admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : new Date(),
        appliedFactor,
        reservedCoverageAmount: lockedAmount,
        totalCost: estimatedCost,
        totalCoverageDeducted: lockedAmount,
        notes: dto.notes,
        parentEventualityId: dto.parentEventualityId,
      });

      const saved = await manager.getRepository(Eventuality).save(eventuality);
      saved.person = person;
      saved.contractPerson = cp;
      saved.coveragePeriod = period;
      return saved;
    });

    if (result.requiresApproval) {
      const alertConfig = await this.getConsumptionAlertConfig();
      const initial = Number(result.coveragePeriod?.initialCoverage || 0);
      const consumed =
        Number(result.coveragePeriod?.consumedCoverage || 0) +
        Number(result.coveragePeriod?.reservedCoverage || 0);
      const cost = Number(result.totalCost || 0);
      const coverageProj = Number((cost * (result.appliedFactor || 1)).toFixed(2));
      const projectedPercentage =
        initial > 0 ? (((consumed + coverageProj) / initial) * 100).toFixed(1) : '100.0';

      const message =
        `⚠️ ALERTA DE CONSUMO DE COBERTURA - SIRCA\n` +
        `Se ha registrado una solicitud de Emergencia que supera el umbral configurado (${alertConfig.consumptionThresholdPercentage}%).\n\n` +
        `• Paciente: ${result.person?.name ?? 'Afiliado'} (${result.person?.typeIdentityCard ? `${result.person.typeIdentityCard}-` : ''}${result.person?.identityCard ?? 'N/A'})\n` +
        `• Clínica: ${result.clinicName}\n` +
        `• Cobertura Inicial: $${initial.toFixed(2)}\n` +
        `• Consumo Acumulado: $${consumed.toFixed(2)}\n` +
        `• Costo Estimado: $${cost.toFixed(2)} (Cobertura proyectada: $${coverageProj.toFixed(2)})\n` +
        `• Consumo Proyectado: ${projectedPercentage}%\n` +
        `• ID Solicitud: ${result.id}\n\n` +
        `Estado: PENDIENTE DE APROBACIÓN. No se generará nro de eventualidad hasta su aprobación.`;

      void this.sendWhatsappNotifications(alertConfig.notificationPhones, message);
    }

    return result;
  }

  /**
   * Sube o asocia el PDF/imagen del informe médico, actualiza la fecha de egreso al momento
   * de la carga, cierra la fase clínica (WAITING_INVOICE) y dispara en segundo plano
   * la extracción de datos del informe médico con IA.
   */
  async uploadMedicalReport(
    id: string,
    dto: UploadMedicalReportDto,
    file?: Express.Multer.File,
  ): Promise<Eventuality> {
    const eventuality = await this.eventualityRepo.findOne({
      where: { id },
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    if (
      eventuality.status !== EventualityStatus.CLINIC_PROCESS &&
      eventuality.status !== EventualityStatus.WAITING_INVOICE &&
      eventuality.status !== EventualityStatus.UNDER_ADMIN_REVIEW
    ) {
      throw new BadRequestException(
        `No se puede cargar informe médico en estado ${eventuality.status}.`,
      );
    }

    if (file) {
      const uploaded = await this.awsService.uploadFile(
        file,
        'medical-reports',
        `report-${eventuality.claimNumber || eventuality.id}-${Date.now()}`,
      );
      eventuality.medicalReportUrl = uploaded;
      if (!eventuality.dischargeDate) {
        eventuality.dischargeDate = new Date();
      }
    } else if (dto.medicalReportUrl) {
      eventuality.medicalReportUrl = dto.medicalReportUrl;
      if (!eventuality.dischargeDate) {
        eventuality.dischargeDate = new Date();
      }
    }

    if (dto.medicalReportNotes !== undefined) {
      eventuality.medicalReportNotes = dto.medicalReportNotes;
    }

    if (eventuality.status === EventualityStatus.CLINIC_PROCESS) {
      eventuality.status = EventualityStatus.WAITING_INVOICE;
    }
    const savedEventuality = await this.eventualityRepo.save(eventuality);

    const extractionSource = file ? file.buffer : savedEventuality.medicalReportUrl;
    if (extractionSource) {
      let reportRecord = await this.medicalReportRepo.findOne({
        where: { eventualityId: savedEventuality.id },
      });

      if (!reportRecord) {
        reportRecord = this.medicalReportRepo.create({
          eventualityId: savedEventuality.id,
          status: MedicalReportExtractionStatus.PROCESSING,
          errorMessage: null,
        });
      } else {
        reportRecord.status = MedicalReportExtractionStatus.PROCESSING;
        reportRecord.errorMessage = null;
      }

      const savedReportRecord = await this.medicalReportRepo.save(reportRecord);
      savedEventuality.medicalReport = savedReportRecord;

      // Disparar extracción con IA en segundo plano sin bloquear al usuario
      void this.extractMedicalReportInBackground(
        savedEventuality.id,
        extractionSource,
        file?.mimetype,
      );
    }

    return savedEventuality;
  }

  /**
   * Ejecuta la extracción de datos del informe médico en segundo plano.
   * Captura cualquier error y actualiza el estado a FAILED sin propagar excepciones.
   */
  async extractMedicalReportInBackground(
    eventualityId: string,
    source: string | Buffer,
    mimeType?: string,
  ): Promise<void> {
    try {
      const extracted = await this.eventualityOcrService.extractMedicalReportData(source, mimeType);

      let report = await this.medicalReportRepo.findOne({
        where: { eventualityId },
      });

      if (!report) {
        report = this.medicalReportRepo.create({ eventualityId });
      }

      // Si el usuario ya editó manualmente el registro mientras procesaba, respetar los campos ya editados
      if (report.status === MedicalReportExtractionStatus.EDITED) {
        report.reportType = report.reportType ?? extracted.reportType;
        report.company = report.company ?? extracted.company;
        report.doctorFullName = report.doctorFullName ?? extracted.doctorFullName;
        report.doctorIdentityCard = report.doctorIdentityCard ?? extracted.doctorIdentityCard;
        report.doctorMs = report.doctorMs ?? extracted.doctorMs;
        report.doctorComezu = report.doctorComezu ?? extracted.doctorComezu;
        report.doctorSpecialty = report.doctorSpecialty ?? extracted.doctorSpecialty;
        report.admissionDiagnosis = report.admissionDiagnosis ?? extracted.admissionDiagnosis;
        report.medicalReport = report.medicalReport ?? extracted.medicalReport;
        report.dischargeDiagnosis = report.dischargeDiagnosis ?? extracted.dischargeDiagnosis;
        report.reportDate = report.reportDate ?? extracted.reportDate;
        report.reportTime = report.reportTime ?? extracted.reportTime;
      } else {
        report.reportType = extracted.reportType;
        report.company = extracted.company;
        report.doctorFullName = extracted.doctorFullName;
        report.doctorIdentityCard = extracted.doctorIdentityCard;
        report.doctorMs = extracted.doctorMs;
        report.doctorComezu = extracted.doctorComezu;
        report.doctorSpecialty = extracted.doctorSpecialty;
        report.admissionDiagnosis = extracted.admissionDiagnosis;
        report.medicalReport = extracted.medicalReport;
        report.dischargeDiagnosis = extracted.dischargeDiagnosis;
        report.reportDate = extracted.reportDate;
        report.reportTime = extracted.reportTime;
        report.status = MedicalReportExtractionStatus.EXTRACTED;
      }

      report.errorMessage = null;
      await this.medicalReportRepo.save(report);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error en extracción en segundo plano de informe médico para eventualidad ${eventualityId}: ${errMsg}`,
      );

      try {
        const report = await this.medicalReportRepo.findOne({
          where: { eventualityId },
        });
        if (report && report.status !== MedicalReportExtractionStatus.EDITED) {
          report.status = MedicalReportExtractionStatus.FAILED;
          report.errorMessage = errMsg;
          await this.medicalReportRepo.save(report);
        }
      } catch (saveError) {
        this.logger.error(
          `No se pudo actualizar estado FAILED del informe médico para eventualidad ${eventualityId}`,
          saveError,
        );
      }
    }
  }

  /**
   * Consulta los datos extraídos del informe médico asociados a la eventualidad.
   */
  async getMedicalReport(id: string): Promise<EventualityMedicalReport> {
    const eventuality = await this.eventualityRepo.findOne({ where: { id } });
    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    const report = await this.medicalReportRepo.findOne({
      where: { eventualityId: id },
    });

    if (!report) {
      throw new NotFoundException(
        `No existe información de informe médico registrada para la eventualidad "${id}".`,
      );
    }

    return report;
  }

  /**
   * Permite editar o completar manualmente los datos del informe médico de una eventualidad.
   */
  async updateMedicalReportData(
    id: string,
    dto: UpdateMedicalReportDataDto,
  ): Promise<EventualityMedicalReport> {
    const eventuality = await this.eventualityRepo.findOne({ where: { id } });
    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    let report = await this.medicalReportRepo.findOne({
      where: { eventualityId: id },
    });

    if (!report) {
      report = this.medicalReportRepo.create({
        eventualityId: id,
      });
    }

    if (dto.reportType !== undefined) report.reportType = dto.reportType;
    if (dto.company !== undefined) report.company = dto.company;
    if (dto.doctorFullName !== undefined) report.doctorFullName = dto.doctorFullName;
    if (dto.doctorIdentityCard !== undefined) report.doctorIdentityCard = dto.doctorIdentityCard;
    if (dto.doctorMs !== undefined) report.doctorMs = dto.doctorMs;
    if (dto.doctorComezu !== undefined) report.doctorComezu = dto.doctorComezu;
    if (dto.doctorSpecialty !== undefined) report.doctorSpecialty = dto.doctorSpecialty;
    if (dto.admissionDiagnosis !== undefined) report.admissionDiagnosis = dto.admissionDiagnosis;
    if (dto.medicalReport !== undefined) report.medicalReport = dto.medicalReport;
    if (dto.dischargeDiagnosis !== undefined) report.dischargeDiagnosis = dto.dischargeDiagnosis;
    if (dto.reportDate !== undefined) report.reportDate = dto.reportDate;
    if (dto.reportTime !== undefined) report.reportTime = dto.reportTime;

    if (dto.medicalReportNotes !== undefined) {
      eventuality.medicalReportNotes = dto.medicalReportNotes;
      await this.eventualityRepo.save(eventuality);
    }

    report.status = MedicalReportExtractionStatus.EDITED;
    report.errorMessage = null;

    return this.medicalReportRepo.save(report);
  }

  /**
   * Procesa la hoja de consumo (PDF/Imagen) con IA (OpenRouter Vision),
   * extrae los insumos en las 3 áreas y ajusta el saldo bloqueado provisionalmente.
   */
  async processConsumptionFile(
    id: string,
    file: Express.Multer.File,
  ): Promise<{
    eventuality: Eventuality;
    extractedItems: EventualityExtractionDetail[];
    totals: {
      detectedCurrency?: 'USD' | 'Bs';
      exchangeRateDate?: string | null;
      appliedExchangeRate?: number | null;
      medicamentos: number;
      materiales: number;
      servicios: number;
      totalCosto: number;
      totalCostoBs?: number | null;
      totalCoberturaEstimada: number;
    };
  }> {
    const eventuality = await this.eventualityRepo.findOne({
      where: { id },
      relations: ['coveragePeriod'],
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    if (
      eventuality.status !== EventualityStatus.WAITING_INVOICE &&
      eventuality.status !== EventualityStatus.UNDER_ADMIN_REVIEW &&
      eventuality.status !== EventualityStatus.CLINIC_PROCESS
    ) {
      throw new BadRequestException(
        `No se puede procesar hoja de consumo en estado ${eventuality.status}.`,
      );
    }

    // 1. Subir archivo a S3
    const consumptionPdfUrl = await this.awsService.uploadFile(
      file,
      'consumption-sheets',
      `consumption-${eventuality.claimNumber}-${Date.now()}`,
    );

    // 2. Extraer ítems con IA (con fallback seguro si el OCR falla)
    let ocrResult: ExtractedConsumptionSheetResult = {
      currency: 'USD',
      exchangeRate: null,
      items: [],
      totalMedicamentos: 0,
      totalMateriales: 0,
      totalServicios: 0,
      totalGeneral: 0,
    };
    let ocrSucceeded = false;

    try {
      ocrResult = await this.eventualityOcrService.extractConsumptionItems(
        file.buffer,
        file.mimetype,
      );
      ocrSucceeded = true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No se pudo extraer consumo por IA para eventualidad ${id} (se guarda el archivo y se permite carga manual): ${errMsg}`,
      );
    }

    // 2.1 Si la hoja de consumo viene en Bolívares (Bs), conservar precios en Bs y convertir a USD usando tasa BCV
    let appliedExchangeRate: number | null = null;
    let resolvedExchangeRateDate: string | null = null;
    let totalCostoBs: number | null = null;

    type ItemWithBs = ExtractedConsumptionSheetResult['items'][number] & {
      unitCostBs?: number | null;
      totalCostBs?: number | null;
    };
    let processedItems: ItemWithBs[] = ocrResult.items.map((it) => ({
      ...it,
      unitCostBs: null,
      totalCostBs: null,
    }));

    if (ocrSucceeded && ocrResult.currency === 'Bs') {
      const referenceDate =
        eventuality.dischargeDate ?? eventuality.admissionDate ?? getCaracasTodayJSDate();
      const rateRecord =
        (await this.exchangeRateService.getLatestExchangeRateOnOrBefore(referenceDate)) ??
        (await this.exchangeRateService.getLatestExchangeRateOnOrBefore(getCaracasTodayJSDate()));

      const dbRate = rateRecord?.rateUsd ? Number(rateRecord.rateUsd) : null;
      const effectiveRate =
        dbRate && Number.isFinite(dbRate) && dbRate > 0
          ? dbRate
          : ocrResult.exchangeRate && ocrResult.exchangeRate > 0
            ? ocrResult.exchangeRate
            : null;

      resolvedExchangeRateDate = formatToISODateString(rateRecord?.date ?? referenceDate);

      totalCostoBs = Number(
        ocrResult.items.reduce((sum, i) => sum + Number(i.totalCost || 0), 0).toFixed(2),
      );

      if (!effectiveRate || effectiveRate <= 0) {
        throw new BadRequestException(
          `La hoja de consumo está expresada en Bolívares (Bs), pero no se encontró una tasa de cambio BCV registrada para la fecha "${resolvedExchangeRateDate || 'de atención'}" ni en el documento. Registre la tasa oficial antes de procesar el consumo.`,
        );
      }

      appliedExchangeRate = effectiveRate;
      this.logger.log(
        `Hoja de consumo detectada en Bs para eventualidad ${id}. Convirtiendo a USD con tasa BCV: ${effectiveRate} (fecha: ${resolvedExchangeRateDate})`,
      );

      processedItems = ocrResult.items.map((it) => {
        const unitBs = Number(Number(it.unitCost).toFixed(2));
        const totalBs = Number(Number(it.totalCost).toFixed(2));
        const unitUsd = Number((unitBs / effectiveRate).toFixed(2));
        const totalUsd = Number((totalBs / effectiveRate).toFixed(2));
        return {
          ...it,
          unitCostBs: unitBs,
          totalCostBs: totalBs,
          unitCost: unitUsd,
          totalCost: totalUsd,
        };
      });

      const totalMedUsd = processedItems
        .filter((i) => i.category === ConsumptionCategory.MEDICAMENTO)
        .reduce((sum, i) => sum + i.totalCost, 0);
      const totalMatUsd = processedItems
        .filter((i) => i.category === ConsumptionCategory.MATERIAL)
        .reduce((sum, i) => sum + i.totalCost, 0);
      const totalServUsd = processedItems
        .filter((i) => i.category === ConsumptionCategory.SERVICIO)
        .reduce((sum, i) => sum + i.totalCost, 0);

      ocrResult.totalMedicamentos = Number(totalMedUsd.toFixed(2));
      ocrResult.totalMateriales = Number(totalMatUsd.toFixed(2));
      ocrResult.totalServicios = Number(totalServUsd.toFixed(2));
      ocrResult.totalGeneral = Number((totalMedUsd + totalMatUsd + totalServUsd).toFixed(2));
    }

    // 3. Persistir ítems y ajustar saldo bloqueado en transacción
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const detailRepo = manager.getRepository(EventualityExtractionDetail);

      let savedDetails: EventualityExtractionDetail[] = [];

      if (ocrSucceeded) {
        // Eliminar extracciones previas si existían
        await detailRepo.delete({ eventualityId: eventuality.id });

        const newDetails = processedItems.map((it) => {
          const itemSalePrice = Number(
            (it.totalCost * Number(eventuality.appliedFactor)).toFixed(2),
          );
          return detailRepo.create({
            eventualityId: eventuality.id,
            category: it.category,
            itemName: it.name,
            quantity: it.quantity,
            unitCost: it.unitCost,
            totalCost: it.totalCost,
            unitCostBs: it.unitCostBs ?? null,
            totalCostBs: it.totalCostBs ?? null,
            calculatedSalePrice: itemSalePrice,
            status: ExtractionStatus.EXTRACTED,
            rawLineText: it.rawLineText,
          });
        });

        savedDetails = await detailRepo.save(newDetails);

        const totalCostBase = ocrResult.totalGeneral;
        const newEstimatedCoverage = Number(
          (totalCostBase * Number(eventuality.appliedFactor)).toFixed(2),
        );

        // Ajustar saldo bloqueado preventivo en el período de cobertura
        const oldLocked = Number(eventuality.reservedCoverageAmount);
        await this.coveragePeriodService.updateLockedCoverageAmount(
          eventuality.coveragePeriodId,
          oldLocked,
          newEstimatedCoverage,
          manager,
        );

        eventuality.consumptionCurrency = ocrResult.currency;
        eventuality.exchangeRateDate = resolvedExchangeRateDate;
        eventuality.appliedExchangeRate = appliedExchangeRate;
        eventuality.totalCost = totalCostBase;
        eventuality.totalCoverageDeducted = newEstimatedCoverage;
        eventuality.reservedCoverageAmount = newEstimatedCoverage;
      }

      eventuality.consumptionPdfUrl = consumptionPdfUrl;
      eventuality.status = EventualityStatus.UNDER_ADMIN_REVIEW;

      const updatedEventuality = await manager.getRepository(Eventuality).save(eventuality);

      return {
        eventuality: updatedEventuality,
        extractedItems: savedDetails,
        totals: {
          detectedCurrency: ocrResult.currency,
          exchangeRateDate: resolvedExchangeRateDate,
          appliedExchangeRate,
          medicamentos: ocrResult.totalMedicamentos,
          materiales: ocrResult.totalMateriales,
          servicios: ocrResult.totalServicios,
          totalCosto: Number(updatedEventuality.totalCost || 0),
          totalCostoBs,
          totalCoberturaEstimada: Number(updatedEventuality.totalCoverageDeducted || 0),
        },
      };
    });
  }

  /**
   * Obtiene la lista de insumos extraídos por IA para revisión administrativa.
   */
  async getExtractionDetails(id: string): Promise<{
    eventualityId: string;
    consumptionCurrency: 'USD' | 'Bs';
    exchangeRateDate: string | Date | null;
    appliedExchangeRate: number | null;
    items: EventualityExtractionDetail[];
    subtotals: {
      medicamentos: number;
      materiales: number;
      servicios: number;
      totalCosto: number;
      totalCostoBs: number | null;
      totalCoberturaConFactor: number;
    };
  }> {
    const eventuality = await this.eventualityRepo.findOne({ where: { id } });
    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    const items = await this.extractionDetailRepo.find({
      where: { eventualityId: id },
      order: { category: 'ASC', createdAt: 'ASC' },
    });

    const activeItems = items.filter((i) => i.status !== ExtractionStatus.REMOVED);

    const med = activeItems
      .filter((i) => i.category === ConsumptionCategory.MEDICAMENTO)
      .reduce((sum, i) => sum + Number(i.totalCost), 0);

    const mat = activeItems
      .filter((i) => i.category === ConsumptionCategory.MATERIAL)
      .reduce((sum, i) => sum + Number(i.totalCost), 0);

    const serv = activeItems
      .filter((i) => i.category === ConsumptionCategory.SERVICIO)
      .reduce((sum, i) => sum + Number(i.totalCost), 0);

    const hasBsItems = activeItems.some(
      (i) => i.totalCostBs !== null && i.totalCostBs !== undefined,
    );
    const totalCostoBs = hasBsItems
      ? Number(activeItems.reduce((sum, i) => sum + Number(i.totalCostBs || 0), 0).toFixed(2))
      : null;

    const totalCosto = Number((med + mat + serv).toFixed(2));
    const totalCob = Number((totalCosto * Number(eventuality.appliedFactor)).toFixed(2));

    return {
      eventualityId: id,
      consumptionCurrency: (eventuality.consumptionCurrency as 'USD' | 'Bs') || 'USD',
      exchangeRateDate: eventuality.exchangeRateDate ?? null,
      appliedExchangeRate: eventuality.appliedExchangeRate ?? null,
      items,
      subtotals: {
        medicamentos: Number(med.toFixed(2)),
        materiales: Number(mat.toFixed(2)),
        servicios: Number(serv.toFixed(2)),
        totalCosto,
        totalCostoBs,
        totalCoberturaConFactor: totalCob,
      },
    };
  }

  /**
   * Permite al personal administrativo editar, auditar, agregar o eliminar insumos,
   * y opcionalmente cambiar la fecha de la tasa de cambio para recalcular.
   */
  async updateExtractionDetails(id: string, dto: UpdateExtractionDetailsDto): Promise<Eventuality> {
    let newRateFromDate: number | null = null;
    let resolvedDateStr: string | null = null;

    if (dto.exchangeRateDate) {
      const rateRecord = await this.exchangeRateService.getLatestExchangeRateOnOrBefore(
        dto.exchangeRateDate,
      );
      if (!rateRecord || !rateRecord.rateUsd || Number(rateRecord.rateUsd) <= 0) {
        throw new BadRequestException(
          `No se encontró una tasa de cambio BCV disponible para la fecha "${dto.exchangeRateDate}".`,
        );
      }
      newRateFromDate = Number(rateRecord.rateUsd);
      resolvedDateStr = formatToISODateString(rateRecord.date ?? dto.exchangeRateDate);
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      const eventuality = await manager.getRepository(Eventuality).findOne({
        where: { id },
      });
      if (!eventuality) {
        throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
      }

      if (
        eventuality.status !== EventualityStatus.UNDER_ADMIN_REVIEW &&
        eventuality.status !== EventualityStatus.WAITING_INVOICE &&
        eventuality.status !== EventualityStatus.CLINIC_PROCESS
      ) {
        throw new BadRequestException(
          `No se pueden editar insumos en estado ${eventuality.status}.`,
        );
      }

      if (newRateFromDate !== null && resolvedDateStr !== null) {
        eventuality.exchangeRateDate = resolvedDateStr;
        eventuality.appliedExchangeRate = newRateFromDate;
        eventuality.consumptionCurrency = 'Bs';
      }

      const effectiveRate =
        eventuality.appliedExchangeRate && Number(eventuality.appliedExchangeRate) > 0
          ? Number(eventuality.appliedExchangeRate)
          : null;

      const detailRepo = manager.getRepository(EventualityExtractionDetail);

      // Reemplazar o actualizar los renglones
      await detailRepo.delete({ eventualityId: id });

      let newTotalCost = 0;
      const newItems = dto.items.map((it) => {
        let unitCostBs: number | null =
          it.unitCostBs !== undefined && it.unitCostBs !== null ? Number(it.unitCostBs) : null;
        let totalCostBs: number | null =
          unitCostBs !== null ? Number((it.quantity * unitCostBs).toFixed(2)) : null;

        let unitCostUsd = it.unitCost !== undefined ? Number(it.unitCost) : 0;
        let lineTotal = Number((it.quantity * unitCostUsd).toFixed(2));

        if (unitCostBs !== null && effectiveRate) {
          unitCostUsd = Number((unitCostBs / effectiveRate).toFixed(2));
          lineTotal = Number((totalCostBs! / effectiveRate).toFixed(2));
        } else if (
          unitCostBs === null &&
          eventuality.consumptionCurrency === 'Bs' &&
          effectiveRate
        ) {
          unitCostBs = Number((unitCostUsd * effectiveRate).toFixed(2));
          totalCostBs = Number((lineTotal * effectiveRate).toFixed(2));
        }

        const itemStatus = it.status ?? ExtractionStatus.EDITED;
        if (itemStatus !== ExtractionStatus.REMOVED) {
          newTotalCost += lineTotal;
        }
        const lineSale = Number((lineTotal * Number(eventuality.appliedFactor)).toFixed(2));

        return detailRepo.create({
          eventualityId: id,
          itemName: it.itemName,
          quantity: it.quantity,
          unitCost: unitCostUsd,
          totalCost: lineTotal,
          unitCostBs,
          totalCostBs,
          calculatedSalePrice: lineSale,
          category: it.category,
          status: itemStatus,
        });
      });

      const savedItems = await detailRepo.save(newItems);

      newTotalCost = Number(newTotalCost.toFixed(2));
      const newCoverageDeducted = Number(
        (newTotalCost * Number(eventuality.appliedFactor)).toFixed(2),
      );

      // Ajustar reserva de cobertura con el nuevo total auditado
      const oldLocked = Number(eventuality.reservedCoverageAmount);
      await this.coveragePeriodService.updateLockedCoverageAmount(
        eventuality.coveragePeriodId,
        oldLocked,
        newCoverageDeducted,
        manager,
      );

      eventuality.totalCost = newTotalCost;
      eventuality.totalCoverageDeducted = newCoverageDeducted;
      eventuality.reservedCoverageAmount = newCoverageDeducted;

      const savedEventuality = await manager.getRepository(Eventuality).save(eventuality);
      savedEventuality.extractionDetails = savedItems;
      return savedEventuality;
    });
  }

  /**
   * Cambia la fecha de la tasa de cambio BCV utilizada en una eventualidad y recalcula
   * todos los precios en USD y cobertura de los insumos a partir de sus montos en Bolívares (Bs).
   */
  async recalculateConsumptionByDate(id: string, exchangeRateDate: string) {
    const rateRecord =
      await this.exchangeRateService.getLatestExchangeRateOnOrBefore(exchangeRateDate);

    if (!rateRecord || !rateRecord.rateUsd || Number(rateRecord.rateUsd) <= 0) {
      throw new BadRequestException(
        `No se encontró una tasa de cambio BCV disponible para la fecha "${exchangeRateDate}".`,
      );
    }

    const newRate = Number(rateRecord.rateUsd);
    const resolvedDateStr = formatToISODateString(rateRecord.date ?? exchangeRateDate);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const eventuality = await manager.getRepository(Eventuality).findOne({
        where: { id },
      });

      if (!eventuality) {
        throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
      }

      if (
        eventuality.status !== EventualityStatus.UNDER_ADMIN_REVIEW &&
        eventuality.status !== EventualityStatus.WAITING_INVOICE &&
        eventuality.status !== EventualityStatus.CLINIC_PROCESS
      ) {
        throw new BadRequestException(
          `No se puede recalcular la hoja de consumo en estado ${eventuality.status}.`,
        );
      }

      const detailRepo = manager.getRepository(EventualityExtractionDetail);
      const items = await detailRepo.find({
        where: { eventualityId: id },
        order: { category: 'ASC', createdAt: 'ASC' },
      });

      const oldRate =
        eventuality.appliedExchangeRate && Number(eventuality.appliedExchangeRate) > 0
          ? Number(eventuality.appliedExchangeRate)
          : null;

      let newTotalCost = 0;

      for (const item of items) {
        const unitBs =
          item.unitCostBs !== null && item.unitCostBs !== undefined
            ? Number(item.unitCostBs)
            : oldRate
              ? Number((Number(item.unitCost) * oldRate).toFixed(2))
              : Number(item.unitCost);

        const totalBs =
          item.totalCostBs !== null && item.totalCostBs !== undefined
            ? Number(item.totalCostBs)
            : Number((unitBs * item.quantity).toFixed(2));

        const unitUsd = Number((unitBs / newRate).toFixed(2));
        const totalUsd = Number((totalBs / newRate).toFixed(2));
        const salePrice = Number((totalUsd * Number(eventuality.appliedFactor)).toFixed(2));

        item.unitCostBs = unitBs;
        item.totalCostBs = totalBs;
        item.unitCost = unitUsd;
        item.totalCost = totalUsd;
        item.calculatedSalePrice = salePrice;

        if (item.status !== ExtractionStatus.REMOVED) {
          newTotalCost += totalUsd;
        }
      }

      if (items.length > 0) {
        await detailRepo.save(items);
      }

      newTotalCost = Number(newTotalCost.toFixed(2));
      const newCoverageDeducted = Number(
        (newTotalCost * Number(eventuality.appliedFactor)).toFixed(2),
      );

      const oldLocked = Number(eventuality.reservedCoverageAmount);
      await this.coveragePeriodService.updateLockedCoverageAmount(
        eventuality.coveragePeriodId,
        oldLocked,
        newCoverageDeducted,
        manager,
      );

      eventuality.consumptionCurrency = 'Bs';
      eventuality.exchangeRateDate = resolvedDateStr;
      eventuality.appliedExchangeRate = newRate;
      eventuality.totalCost = newTotalCost;
      eventuality.totalCoverageDeducted = newCoverageDeducted;
      eventuality.reservedCoverageAmount = newCoverageDeducted;

      await manager.getRepository(Eventuality).save(eventuality);
    });

    return this.getExtractionDetails(id);
  }

  /**
   * Sube y procesa una factura fiscal de proveedor con OCR/IA, devolviendo la URL del archivo
   * y los datos fiscales extraídos para autocompletar el formulario de registro.
   */
  async extractProviderInvoice(
    id: string,
    file: Express.Multer.File,
  ): Promise<{ fileUrl: string; extractedData: ExtractedProviderInvoiceResult }> {
    const eventuality = await this.eventualityRepo.findOne({ where: { id } });
    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    const uploadedUrl = await this.awsService.uploadFile(
      file,
      'provider-invoices',
      `invoice-${eventuality.claimNumber}-${Date.now()}`,
    );

    const extractedData = await this.eventualityOcrService.extractProviderInvoiceData(
      file.buffer,
      file.mimetype,
    );

    return {
      fileUrl: uploadedUrl,
      extractedData,
    };
  }

  /**
   * Asocia una factura fiscal de proveedor a la eventualidad.
   */
  async addProviderInvoice(
    id: string,
    dto: AddProviderInvoiceDto,
  ): Promise<EventualityProviderInvoice> {
    const eventuality = await this.eventualityRepo.findOne({ where: { id } });
    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    const invoice = this.invoiceRepo.create({
      eventualityId: id,
      providerName: dto.providerName,
      providerRif: dto.providerRif,
      invoiceNumber: dto.invoiceNumber,
      controlNumber: dto.controlNumber,
      invoiceDate: new Date(dto.invoiceDate),
      invoicePdfUrl: dto.invoicePdfUrl,
      subtotalAmount: dto.subtotalAmount,
      taxAmount: dto.taxAmount || 0,
      totalAmount: dto.totalAmount,
      notes: dto.notes,
    });

    return this.invoiceRepo.save(invoice);
  }

  /**
   * Finaliza y liquida la emergencia:
   * 1. Consolida los 3 movimientos en eventuality_movements (Medicamentos, Materiales, Servicios).
   * 2. Libera el saldo bloqueado preventivo y descuenta el saldo definitivo en contract_coverage_periods.
   * 3. Pasa la eventualidad a estado CLOSED.
   */
  async finalizeEmergency(id: string): Promise<Eventuality> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const eventuality = await manager.getRepository(Eventuality).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!eventuality) {
        throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
      }

      if (
        eventuality.status !== EventualityStatus.UNDER_ADMIN_REVIEW &&
        eventuality.status !== EventualityStatus.WAITING_INVOICE
      ) {
        throw new BadRequestException(
          `Solo eventualidades en espera de factura o revisión administrativa pueden liquidarse (estado actual: ${eventuality.status}).`,
        );
      }

      // 0. Validar existencia de factura fiscal de la clínica proveedora
      const providerInvoices = await manager.getRepository(EventualityProviderInvoice).find({
        where: { eventualityId: id },
      });
      if (!providerInvoices || providerInvoices.length === 0) {
        throw new BadRequestException(
          'Debe registrar al menos una factura fiscal del proveedor antes de liquidar la eventualidad.',
        );
      }

      // 1. Obtener insumos activos
      const items = await manager.getRepository(EventualityExtractionDetail).find({
        where: { eventualityId: id },
      });

      const activeItems = items.filter((i) => i.status !== ExtractionStatus.REMOVED);

      const medCost = activeItems
        .filter((i) => i.category === ConsumptionCategory.MEDICAMENTO)
        .reduce((sum, i) => sum + Number(i.totalCost), 0);

      const matCost = activeItems
        .filter((i) => i.category === ConsumptionCategory.MATERIAL)
        .reduce((sum, i) => sum + Number(i.totalCost), 0);

      const servCost = activeItems
        .filter((i) => i.category === ConsumptionCategory.SERVICIO)
        .reduce((sum, i) => sum + Number(i.totalCost), 0);

      const factor = Number(eventuality.appliedFactor);

      const medCoverage = Number((medCost * factor).toFixed(2));
      const matCoverage = Number((matCost * factor).toFixed(2));
      const servCoverage = Number((servCost * factor).toFixed(2));

      const totalCoverageToDeduct = Number((medCoverage + matCoverage + servCoverage).toFixed(2));
      const totalCost = Number((medCost + matCost + servCost).toFixed(2));

      // 2. Crear los 3 movimientos en eventuality_movements
      const movementRepo = manager.getRepository(EventualityMovement);
      await movementRepo.delete({ eventualityId: id });

      const movementsToSave: EventualityMovement[] = [];

      if (medCost > 0) {
        movementsToSave.push(
          movementRepo.create({
            eventualityId: id,
            coveragePeriodId: eventuality.coveragePeriodId,
            category: MovementCategory.MEDICAMENTO,
            description: `Consumo de Medicamentos (${eventuality.claimNumber})`,
            costAmount: Number(medCost.toFixed(2)),
            coverageDeductedAmount: medCoverage,
            consumesLimit: false,
          }),
        );
      }

      if (matCost > 0) {
        movementsToSave.push(
          movementRepo.create({
            eventualityId: id,
            coveragePeriodId: eventuality.coveragePeriodId,
            category: MovementCategory.MATERIAL,
            description: `Consumo de Materiales e Insumos (${eventuality.claimNumber})`,
            costAmount: Number(matCost.toFixed(2)),
            coverageDeductedAmount: matCoverage,
            consumesLimit: false,
          }),
        );
      }

      if (servCost > 0) {
        movementsToSave.push(
          movementRepo.create({
            eventualityId: id,
            coveragePeriodId: eventuality.coveragePeriodId,
            category: MovementCategory.SERVICIO,
            description: `Servicios y Atención de Emergencia (${eventuality.claimNumber})`,
            costAmount: Number(servCost.toFixed(2)),
            coverageDeductedAmount: servCoverage,
            consumesLimit: false,
          }),
        );
      }

      // Si no hubo desglose detallado de insumos pero hubo costo global registrado
      if (movementsToSave.length === 0 && totalCost > 0) {
        movementsToSave.push(
          movementRepo.create({
            eventualityId: id,
            coveragePeriodId: eventuality.coveragePeriodId,
            category: MovementCategory.FACTURA_GLOBAL,
            description: `Liquidación de Emergencia (${eventuality.claimNumber})`,
            costAmount: totalCost,
            coverageDeductedAmount: totalCoverageToDeduct,
            consumesLimit: false,
          }),
        );
      }

      if (movementsToSave.length > 0) {
        await movementRepo.save(movementsToSave);
      }

      // 3. Liberar reserva y descontar cobertura definitiva en el período
      const lockedToRelease = Number(eventuality.reservedCoverageAmount);
      await this.coveragePeriodService.releaseAndDeductCoverage(
        eventuality.coveragePeriodId,
        lockedToRelease,
        totalCoverageToDeduct,
        manager,
      );

      // 4. Actualizar estado y totales de la eventualidad
      eventuality.totalCost = totalCost;
      eventuality.totalCoverageDeducted = totalCoverageToDeduct;
      eventuality.reservedCoverageAmount = 0.0;
      eventuality.status = EventualityStatus.CLOSED;
      eventuality.closedAt = new Date();

      return manager.getRepository(Eventuality).save(eventuality);
    });
  }

  /**
   * Consulta una eventualidad con todo su detalle de relaciones.
   */
  async findOne(id: string): Promise<Eventuality> {
    const eventuality = await this.eventualityRepo.findOne({
      where: { id },
      relations: [
        'person',
        'contractPerson',
        'contractPerson.contract',
        'contractPerson.plan',
        'coveragePeriod',
        'extractionDetails',
        'medicalReport',
        'movements',
        'providerInvoices',
        'parentEventuality',
      ],
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
    }

    return eventuality;
  }

  /**
   * Listado paginado de eventualidades con filtros.
   */
  async findAll(query: FindEventualitiesDto): Promise<PaginatedResult<Eventuality>> {
    const qb = this.eventualityRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.person', 'p')
      .leftJoinAndSelect('e.contractPerson', 'cp')
      .leftJoinAndSelect('cp.contract', 'c')
      .leftJoinAndSelect('cp.plan', 'plan')
      .leftJoinAndSelect('e.coveragePeriod', 'ccp')
      .leftJoinAndSelect('e.medicalReport', 'emr')
      .orderBy('e.createdAt', 'DESC');

    if (query.type) {
      qb.andWhere('e.type = :type', { type: query.type });
    }

    if (query.status) {
      qb.andWhere('e.status = :status', { status: query.status });
    }

    if (query.personId) {
      qb.andWhere('e.personId = :personId', { personId: query.personId });
    }

    if (query.claimNumber) {
      qb.andWhere('e.claimNumber ILIKE :claimNumber', {
        claimNumber: `%${query.claimNumber}%`,
      });
    }

    if (query.contractId) {
      qb.andWhere('cp.contractId = :contractId', {
        contractId: query.contractId,
      });
    }

    return paginateQueryBuilder(qb, query);
  }

  /**
   * Aprueba una eventualidad que estaba en PENDING_APPROVAL.
   * Genera el nro de eventualidad numérico, bloquea la cobertura proyectada,
   * cambia el estado a CLINIC_PROCESS y notifica por WhatsApp.
   */
  async approveEmergency(id: string, user?: { userId?: string }): Promise<Eventuality> {
    const approved = await this.dataSource.transaction(async (manager: EntityManager) => {
      const eventuality = await manager.getRepository(Eventuality).findOne({
        where: { id },
        relations: ['person', 'coveragePeriod'],
      });

      if (!eventuality) {
        throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
      }

      if (eventuality.status !== EventualityStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          `La eventualidad no se encuentra pendiente de aprobación (estado actual: ${eventuality.status}).`,
        );
      }

      // Si el período de cobertura original fue cerrado (ej. por renovación de contrato anual),
      // reasociar la eventualidad al período activo vigente del afiliado
      let targetPeriod = eventuality.coveragePeriod;
      if (targetPeriod.status !== CoveragePeriodStatus.ACTIVE) {
        targetPeriod = await this.coveragePeriodService.getOrCreateActivePeriod(
          eventuality.contractPersonId,
          manager,
        );
        eventuality.coveragePeriod = targetPeriod;
        eventuality.coveragePeriodId = targetPeriod.id;
      }

      // Bloquear cobertura estimada si existe
      const estimatedCost = Number(eventuality.totalCost || 0);
      const appliedFactor = Number(eventuality.appliedFactor || 1);
      const coverageToLock = Number((estimatedCost * appliedFactor).toFixed(2));

      if (coverageToLock > 0) {
        await this.coveragePeriodService.lockCoverageAmount(
          eventuality.coveragePeriodId,
          coverageToLock,
          manager,
        );
        eventuality.reservedCoverageAmount = coverageToLock;
        eventuality.totalCoverageDeducted = coverageToLock;
      }

      // Generar correlativo de siniestro atómico numérico
      const claimResult = await generateClaimNumber(manager);
      eventuality.claimNumber = claimResult.claimNumber;
      eventuality.status = EventualityStatus.CLINIC_PROCESS;
      eventuality.approvedAt = new Date();
      eventuality.approvedBy = user?.userId ?? 'ADMIN';

      return manager.getRepository(Eventuality).save(eventuality);
    });

    const alertConfig = await this.getConsumptionAlertConfig();
    const message =
      `✅ EVENTUALIDAD APROBADA - SIRCA\n` +
      `La solicitud de Emergencia ha sido aprobada exitosamente.\n\n` +
      `• Nro de Eventualidad: ${approved.claimNumber}\n` +
      `• Paciente: ${approved.person?.name ?? 'Afiliado'}\n` +
      `• Clínica: ${approved.clinicName}\n` +
      `• Cobertura Reservada: $${Number(approved.reservedCoverageAmount).toFixed(2)}\n` +
      `• Aprobado por: ${approved.approvedBy}`;

    void this.sendWhatsappNotifications(alertConfig.notificationPhones, message);

    return approved;
  }

  /**
   * Rechaza una eventualidad en PENDING_APPROVAL.
   * NO genera nro de eventualidad ni descuenta cobertura.
   * Cambia el estado a REJECTED, registra el motivo y notifica por WhatsApp.
   */
  async rejectEmergency(
    id: string,
    dto: RejectEventualityDto,
    user?: { userId?: string },
  ): Promise<Eventuality> {
    const rejected = await this.dataSource.transaction(async (manager: EntityManager) => {
      const eventuality = await manager.getRepository(Eventuality).findOne({
        where: { id },
        relations: ['person'],
      });

      if (!eventuality) {
        throw new NotFoundException(`Eventualidad con ID "${id}" no encontrada.`);
      }

      if (eventuality.status !== EventualityStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          `La eventualidad no se encuentra pendiente de aprobación (estado actual: ${eventuality.status}).`,
        );
      }

      eventuality.status = EventualityStatus.REJECTED;
      eventuality.rejectionReason =
        dto.reason || 'Rechazado por exceder umbral de cobertura sin autorización.';
      eventuality.closedAt = new Date();

      return manager.getRepository(Eventuality).save(eventuality);
    });

    const alertConfig = await this.getConsumptionAlertConfig();
    const message =
      `❌ EVENTUALIDAD RECHAZADA - SIRCA\n` +
      `La solicitud de Emergencia ha sido rechazada.\n\n` +
      `• Paciente: ${rejected.person?.name ?? 'Afiliado'}\n` +
      `• Clínica: ${rejected.clinicName}\n` +
      `• Motivo: ${rejected.rejectionReason}\n` +
      `• Rechazado por: ${user?.userId ?? 'ADMIN'}`;

    void this.sendWhatsappNotifications(alertConfig.notificationPhones, message);

    return rejected;
  }

  /**
   * Obtiene la configuración de alerta de consumo para siniestros.
   */
  async getConsumptionAlertConfig(): Promise<ConsumptionAlertConfigResponse> {
    const threshold = await this.systemSettingsService.getNumeric(
      'EVENTUALITY_ALERT_THRESHOLD',
      80,
    );
    const phonesStr = (await this.systemSettingsService.get('EVENTUALITY_ALERT_PHONES', '')) || '';
    const enabledStr =
      (await this.systemSettingsService.get('EVENTUALITY_ALERT_ENABLED', 'true')) || 'true';

    const notificationPhones = phonesStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    return {
      consumptionThresholdPercentage: threshold,
      notificationPhones,
      enabled: enabledStr.toLowerCase() !== 'false',
    };
  }

  /**
   * Actualiza los parámetros de alerta de consumo para siniestros.
   */
  async updateConsumptionAlertConfig(
    dto: UpdateConsumptionAlertConfigDto,
  ): Promise<ConsumptionAlertConfigResponse> {
    await this.systemSettingsService.set(
      'EVENTUALITY_ALERT_THRESHOLD',
      String(dto.consumptionThresholdPercentage),
      'Porcentaje de cobertura consumida para requerir aprobación previa',
    );

    const phonesJoined = (dto.notificationPhones || [])
      .map((p) => p.trim())
      .filter(Boolean)
      .join(',');

    await this.systemSettingsService.set(
      'EVENTUALITY_ALERT_PHONES',
      phonesJoined,
      'Lista de teléfonos separados por coma para notificaciones WhatsApp de siniestros',
    );

    if (dto.enabled !== undefined) {
      await this.systemSettingsService.set(
        'EVENTUALITY_ALERT_ENABLED',
        String(dto.enabled),
        'Habilita o deshabilita la alerta de aprobación por consumo de siniestros',
      );
    }

    return this.getConsumptionAlertConfig();
  }

  /**
   * Envía notificaciones de WhatsApp a una lista de números.
   * No propaga errores para no comprometer transacciones del negocio.
   */
  private async sendWhatsappNotifications(phones: string[], text: string): Promise<void> {
    if (!phones || phones.length === 0) return;

    for (const rawPhone of phones) {
      const phone = normalizeWhatsappPhone(rawPhone);
      if (!phone) {
        this.logger.warn(`Número de teléfono inválido para WhatsApp: ${rawPhone}`);
        continue;
      }
      try {
        await this.metaWhatsappService.sendMessage(phone, text);
        this.logger.log(`Notificación WhatsApp enviada con éxito a ${phone}`);
      } catch (error) {
        this.logger.error(
          `Error enviando notificación WhatsApp a ${phone}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
