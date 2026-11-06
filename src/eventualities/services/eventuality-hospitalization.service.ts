import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Eventuality, EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import {
  EventualityServiceRequest,
  ServiceRequestStatus,
} from '../entities/eventuality-service-request.entity';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { CoveragePeriodService } from '../../contracts/services/coverage-period.service';
import { SystemSettingsService } from '../../system-settings/system-settings.service';
import { MetaWhatsappService } from '../../chatbot/services/meta-whatsapp.service';
import { normalizeWhatsappPhone } from '../../chatbot/utils/phone.util';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { registerPostCommitHook, resolveQueryRunner } from '../../common/context/request-context';
import {
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions/domain-exceptions';
import { CreateHospitalizationDto } from '../dto/create-hospitalization.dto';

@Injectable()
export class EventualityHospitalizationService {
  private readonly logger = new Logger(EventualityHospitalizationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Eventuality)
    private readonly eventualityRepo: Repository<Eventuality>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonRepo: Repository<ContractPerson>,
    private readonly coveragePeriodService: CoveragePeriodService,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly metaWhatsappService: MetaWhatsappService,
  ) {}

  /**
   * Registra una Solicitud de Hospitalización.
   * Toda hospitalización nace estrictamente en PENDING_APPROVAL sin número de siniestro
   * y con reserva $0.00 hasta ser aprobada.
   */
  @Transactional()
  async requestHospitalization(dto: CreateHospitalizationDto): Promise<Eventuality> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const em = qr.manager;

    const cp = await em.getRepository(ContractPerson).findOne({
      where: { id: dto.contractPersonId },
      relations: {
        contract: true,
        plan: true,
        person: true,
      },
    });

    if (!cp) {
      throw new EntityNotFoundException('Afiliación contractual', dto.contractPersonId);
    }

    if (cp.person?.id !== dto.personId) {
      throw new InvalidDomainOperationException(
        'La afiliación contractual no corresponde a la persona indicada.',
      );
    }

    const contract = cp.contract;
    if (!contract || contract.status !== ContractStatus.ACTIVE) {
      throw new InvalidDomainOperationException(
        `El contrato no se encuentra activo. No se pueden aperturar solicitudes de hospitalización.`,
      );
    }

    const now = new Date();
    if (contract.startDate && new Date(contract.startDate) > now) {
      throw new InvalidDomainOperationException(
        `El contrato aún no ha iniciado su vigencia (inicio: ${contract.startDate}).`,
      );
    }
    if (contract.expirationDate && new Date(contract.expirationDate) < now) {
      throw new InvalidDomainOperationException(
        `El contrato ha expirado su vigencia anual (vencimiento: ${contract.expirationDate}). Requiere renovación.`,
      );
    }

    const period = await this.coveragePeriodService.getOrCreateActivePeriod(cp.id, em);
    if (Number(period.remainingCoverage) <= 0) {
      throw new InvalidDomainOperationException(
        'El afiliado no posee cobertura disponible en su período anual vigente ($0.00 restante).',
      );
    }

    const effectivePlan = cp.plan ?? cp.person?.plan;
    const planFactor = effectivePlan?.profitFactor ? Number(effectivePlan.profitFactor) : null;
    const globalFactor = await this.systemSettingsService.getNumeric(
      'DEFAULT_SERVICE_PRICE_FACTOR',
      2.0,
    );
    const appliedFactor = planFactor ?? globalFactor;

    const noteContent = dto.notes
      ? `[Ingreso Hospitalario]: ${dto.admissionReason}. ${dto.notes}`
      : `[Ingreso Hospitalario]: ${dto.admissionReason}`;

    const eventualityRepo = em.getRepository(Eventuality);
    const eventuality = eventualityRepo.create({
      claimNumber: null,
      type: EventualityType.HOSPITALIZATION,
      status: EventualityStatus.PENDING_APPROVAL,
      requiresApproval: true,
      personId: cp.person.id,
      contractPersonId: cp.id,
      coveragePeriodId: period.id,
      clinicName: dto.clinicName,
      admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : new Date(),
      appliedFactor,
      reservedCoverageAmount: 0.0,
      totalCost: 0.0,
      totalCoverageDeducted: 0.0,
      notes: noteContent,
      parentEventualityId: dto.parentEventualityId ?? null,
      doctorId: dto.doctorId ?? null,
    });

    const saved = await eventualityRepo.save(eventuality);

    if (dto.serviceRequestIds && dto.serviceRequestIds.length > 0) {
      const srRepo = em.getRepository(EventualityServiceRequest);
      const requests = await srRepo.findBy({
        id: In(dto.serviceRequestIds),
      });
      const convTime = new Date();
      for (const req of requests) {
        req.status = ServiceRequestStatus.CONVERTED;
        req.childEventualityId = saved.id;
        req.convertedAt = convTime;
      }
      if (requests.length > 0) {
        await srRepo.save(requests);
      }
    }

    registerPostCommitHook(async () => {
      await this.notifyHospitalizationRequested(
        saved,
        cp.person.name,
        Number(period.remainingCoverage || 0),
        dto.admissionReason,
      );
    });

    saved.person = cp.person;
    saved.contractPerson = cp;
    saved.coveragePeriod = period;
    return saved;
  }

  /**
   * Notificación por WhatsApp enviada fuera de la transacción para coordinadores.
   */
  private async notifyHospitalizationRequested(
    eventuality: Eventuality,
    patientName: string,
    remainingCoverage: number,
    admissionReason: string,
  ): Promise<void> {
    try {
      const phonesStr =
        (await this.systemSettingsService.get('EVENTUALITY_ALERT_PHONES', '')) || '';
      const phones = phonesStr
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      if (phones.length === 0) return;

      const message =
        `🏥 NUEVA SOLICITUD DE HOSPITALIZACIÓN - SIRCA\n` +
        `Se ha recibido una solicitud de hospitalización pendiente de aprobación:\n\n` +
        `• Paciente: ${patientName}\n` +
        `• Clínica: ${eventuality.clinicName || 'No indicada'}\n` +
        `• Motivo: ${admissionReason}\n` +
        `• Cobertura Disponible: $${remainingCoverage.toFixed(2)}\n\n` +
        `Acceda al panel de eventualidades para evaluar y autorizar el caso.`;

      for (const rawPhone of phones) {
        const phone = normalizeWhatsappPhone(rawPhone);
        if (!phone) continue;
        try {
          await this.metaWhatsappService.sendMessage(phone, message);
        } catch {
          this.logger.warn(`No se pudo enviar notificación WhatsApp a ${phone}`);
        }
      }
    } catch (error) {
      this.logger.error('Error enviando alerta de solicitud de hospitalización', error);
    }
  }
}
