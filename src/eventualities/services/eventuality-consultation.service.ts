import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { resolveQueryRunner } from '../../common/context/request-context';
import {
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions/domain-exceptions';
import { Eventuality, EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import { EventualityMedicalReport } from '../entities/eventuality-medical-report.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { User } from '../../users/entities/user.entity';
import { MedicalService } from '../../plans/entities/medical-service.entity';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { CoveragePeriodService } from '../../contracts/services/coverage-period.service';
import { SystemSettingsService } from '../../system-settings/system-settings.service';
import { DoctorScheduleService } from '../../doctors/services/doctor-schedule.service';
import { generateClaimNumber } from '../helpers/claim-number-generator.helper';
import {
  createConsultationInitialArtifacts,
  queryDoctorConsultationsCalendar,
} from '../helpers/consultation-artifacts.helper';
import {
  CancelConsultationDto,
  FindDoctorConsultationsCalendarDto,
  RescheduleConsultationDto,
  ScheduleConsultationDto,
} from '../dto/schedule-consultation.dto';

@Injectable()
export class EventualityConsultationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly coveragePeriodService: CoveragePeriodService,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly doctorScheduleService: DoctorScheduleService,
  ) {}

  @Transactional()
  async scheduleConsultation(dto: ScheduleConsultationDto): Promise<Eventuality> {
    const em = resolveQueryRunner(undefined, this.dataSource).manager;
    const cp = await this.validateActiveAffiliation(em, dto.contractPersonId, dto.personId);
    const doctor = await this.validateDoctorAndSlot(em, dto.doctorId, dto.scheduledAt);
    const period = await this.coveragePeriodService.getOrCreateActivePeriod(cp.id, em);
    if (Number(period.remainingCoverage) <= 0) {
      throw new InvalidDomainOperationException(
        'El afiliado no posee cobertura disponible en su período anual vigente ($0.00 restante).',
      );
    }

    const appliedFactor = cp.plan?.profitFactor
      ? Number(cp.plan.profitFactor)
      : await this.systemSettingsService.getNumeric('DEFAULT_SERVICE_PRICE_FACTOR', 2.0);
    const { estimatedCost, lockedAmount, preloadItem } = await this.resolveCostAndLock(
      em,
      dto,
      doctor,
      appliedFactor,
      period.id,
      Number(period.remainingCoverage),
    );

    const { claimNumber } = await generateClaimNumber(em);
    const saved = await em.getRepository(Eventuality).save(
      em.getRepository(Eventuality).create({
        claimNumber,
        type: EventualityType.CONSULTATION,
        status: EventualityStatus.SCHEDULED,
        requiresApproval: false,
        personId: cp.person.id,
        contractPersonId: cp.id,
        coveragePeriodId: period.id,
        doctorId: doctor.id,
        clinicName: dto.clinicName || `Consultorio Dr(a). ${doctor.firstName} ${doctor.lastName}`,
        admissionDate: new Date(dto.scheduledAt),
        appliedFactor,
        reservedCoverageAmount: lockedAmount,
        totalCost: estimatedCost,
        totalCoverageDeducted: lockedAmount,
        notes: dto.notes || `Consulta de ${doctor.specialty}`,
        parentEventualityId: dto.parentEventualityId ?? null,
      }),
    );

    await createConsultationInitialArtifacts(em, saved, doctor, dto, preloadItem);
    saved.person = cp.person;
    saved.contractPerson = cp;
    saved.coveragePeriod = period;
    saved.doctor = doctor;
    return saved;
  }

  @Transactional()
  async rescheduleConsultation(
    id: string,
    dto: RescheduleConsultationDto,
    userId?: string,
  ): Promise<Eventuality> {
    const em = resolveQueryRunner(undefined, this.dataSource).manager;
    await this.assertNotAuditor(em, userId);
    const evtRepo = em.getRepository(Eventuality);
    const eventuality = await evtRepo.findOne({ where: { id } });
    if (!eventuality) throw new EntityNotFoundException('Eventualidad de consulta', id);
    if (eventuality.status !== EventualityStatus.SCHEDULED) {
      throw new InvalidDomainOperationException(
        `Solo se pueden reprogramar consultas en estado SCHEDULED (actual: ${eventuality.status}).`,
      );
    }

    const targetDoctorId = dto.doctorId || eventuality.doctorId;
    if (!targetDoctorId) {
      throw new InvalidDomainOperationException('La consulta debe tener un médico asignado.');
    }

    const doctor = await this.validateDoctorAndSlot(em, targetDoctorId, dto.scheduledAt, id);
    const newDate = new Date(dto.scheduledAt);
    eventuality.doctorId = doctor.id;
    eventuality.admissionDate = newDate;
    if (dto.notes) eventuality.notes = dto.notes;

    const reportRepo = em.getRepository(EventualityMedicalReport);
    const report = await reportRepo.findOne({ where: { eventualityId: id } });
    if (report) {
      const dtCaracas = DateTime.fromJSDate(newDate).setZone(CARACAS_ZONE);
      report.reportDate = dtCaracas.toFormat('yyyy-MM-dd');
      report.reportTime = dtCaracas.toFormat('HH:mm');
      report.doctorId = doctor.id;
      await reportRepo.save(report);
    }
    return evtRepo.save(eventuality);
  }

  @Transactional()
  async cancelConsultation(
    id: string,
    dto: CancelConsultationDto,
    userId?: string,
  ): Promise<Eventuality> {
    const em = resolveQueryRunner(undefined, this.dataSource).manager;
    await this.assertNotAuditor(em, userId);
    const evtRepo = em.getRepository(Eventuality);
    const eventuality = await evtRepo.findOne({ where: { id } });
    if (!eventuality) throw new EntityNotFoundException('Eventualidad de consulta', id);
    if (eventuality.status !== EventualityStatus.SCHEDULED) {
      throw new InvalidDomainOperationException(
        `Solo se pueden cancelar consultas agendadas en estado SCHEDULED (actual: ${eventuality.status}).`,
      );
    }

    const reserved = Number(eventuality.reservedCoverageAmount || 0);
    if (reserved > 0) {
      await this.coveragePeriodService.updateLockedCoverageAmount(
        eventuality.coveragePeriodId,
        reserved,
        0,
        em,
      );
    }

    eventuality.reservedCoverageAmount = 0;
    eventuality.totalCoverageDeducted = 0;
    eventuality.status = EventualityStatus.CANCELLED;
    eventuality.rejectionReason = dto.reason || 'Cita cancelada antes de la atención médica.';
    eventuality.closedAt = new Date();
    return evtRepo.save(eventuality);
  }

  async getDoctorConsultationsCalendar(
    userId: string | undefined,
    query: FindDoctorConsultationsCalendarDto,
  ) {
    return queryDoctorConsultationsCalendar(this.dataSource, userId, query);
  }

  private async validateActiveAffiliation(em: EntityManager, cpId: string, personId: string) {
    const cp = await em.getRepository(ContractPerson).findOne({
      where: { id: cpId },
      relations: { contract: true, plan: true, person: true },
    });
    if (!cp) throw new EntityNotFoundException('Afiliación contractual', cpId);
    if (cp.person?.id !== personId) {
      throw new InvalidDomainOperationException(
        'La afiliación contractual no corresponde a la persona indicada.',
      );
    }
    if (!cp.contract || cp.contract.status !== ContractStatus.ACTIVE) {
      throw new InvalidDomainOperationException('El contrato no se encuentra activo.');
    }
    return cp;
  }

  private async validateDoctorAndSlot(
    em: EntityManager,
    doctorId: string,
    scheduledAt: string,
    excludeId?: string,
  ): Promise<Doctor> {
    const doctor = await em.getRepository(Doctor).findOne({ where: { id: doctorId } });
    if (!doctor || !doctor.isActive) throw new EntityNotFoundException('Médico activo', doctorId);
    if (doctor.isMedicalAuditor) {
      throw new InvalidDomainOperationException(
        'No se pueden agendar consultas a un médico con perfil de auditor.',
      );
    }
    if (doctor.canScheduleConsultations === false) {
      throw new InvalidDomainOperationException(
        'El médico seleccionado no está habilitado para agendar citas programadas.',
      );
    }
    const check = await this.doctorScheduleService.validateSlotForDoctor({
      doctor,
      scheduledAt,
      excludeEventualityId: excludeId,
    });
    if (!check.valid) {
      throw new InvalidDomainOperationException(check.reason || 'Turno no disponible.');
    }
    return doctor;
  }

  private async assertNotAuditor(em: EntityManager, userId?: string): Promise<void> {
    if (!userId) return;
    const user = await em.getRepository(User).findOne({
      where: { id: userId },
      relations: { doctor: true, role: { permissions: true } },
    });
    const permissions = user?.role?.permissions?.map((p) => p.name) || [];
    if (
      user?.doctor?.isMedicalAuditor ||
      (permissions.includes('audit:medical') &&
        !permissions.includes('manage:doctors') &&
        !permissions.includes('update:eventualities'))
    ) {
      throw new InvalidDomainOperationException(
        'El perfil de Médico Auditor es de solo lectura y no permite reprogramar ni cancelar citas.',
      );
    }
  }

  private async resolveCostAndLock(
    em: EntityManager,
    dto: ScheduleConsultationDto,
    doctor: Doctor,
    appliedFactor: number,
    periodId: string,
    remainingCoverage: number,
  ) {
    const srvId = dto.medicalServiceId || doctor.defaultMedicalServiceId || null;
    const srv = srvId
      ? await em.getRepository(MedicalService).findOne({ where: { id: srvId } })
      : null;
    const estimatedCost =
      dto.estimatedCost !== undefined
        ? Number(dto.estimatedCost)
        : srv && Number(srv.cost) > 0
          ? Number(srv.cost)
          : 0;
    const lockedAmount = Number((estimatedCost * appliedFactor).toFixed(2));
    if (lockedAmount > 0) {
      if (remainingCoverage < lockedAmount) {
        throw new InvalidDomainOperationException('Saldo insuficiente en la póliza del afiliado.');
      }
      await this.coveragePeriodService.lockCoverageAmount(periodId, lockedAmount, em);
    }
    const preloadItem =
      srv || estimatedCost > 0
        ? {
            name: srv?.name || `Consulta de ${doctor.specialty}`,
            cost: estimatedCost,
            salePrice: srv && Number(srv.salePrice) > 0 ? Number(srv.salePrice) : lockedAmount,
          }
        : null;
    return { estimatedCost, lockedAmount, preloadItem };
  }
}
