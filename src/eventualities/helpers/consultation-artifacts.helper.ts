import { DataSource, EntityManager, In } from 'typeorm';
import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import { Eventuality, EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import {
  EventualityMedicalReport,
  MedicalReportExtractionStatus,
} from '../entities/eventuality-medical-report.entity';
import {
  ConsumptionCategory,
  EventualityExtractionDetail,
  ExtractionStatus,
} from '../entities/eventuality-extraction-detail.entity';
import {
  EventualityServiceRequest,
  ServiceRequestStatus,
} from '../entities/eventuality-service-request.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { User } from '../../users/entities/user.entity';
import {
  FindDoctorConsultationsCalendarDto,
  ScheduleConsultationDto,
} from '../dto/schedule-consultation.dto';

export interface PreloadConsultationItem {
  readonly name: string;
  readonly cost: number;
  readonly salePrice: number;
}

export async function createConsultationInitialArtifacts(
  em: EntityManager,
  saved: Eventuality,
  doctor: Doctor,
  dto: ScheduleConsultationDto,
  preloadItem: PreloadConsultationItem | null,
): Promise<void> {
  const dtCaracas = DateTime.fromJSDate(saved.admissionDate || new Date()).setZone(CARACAS_ZONE);
  const reportRepo = em.getRepository(EventualityMedicalReport);
  await reportRepo.save(
    reportRepo.create({
      eventualityId: saved.id,
      status: MedicalReportExtractionStatus.PROCESSING,
      reportType: 'INFORME DE CONSULTA MÉDICA ESPECIALIZADA',
      reportDate: dtCaracas.toFormat('yyyy-MM-dd'),
      reportTime: dtCaracas.toFormat('HH:mm'),
      doctorId: doctor.id,
      doctorFullName: `${doctor.firstName} ${doctor.lastName}`,
      doctorIdentityCard: `${doctor.typeIdentityCard || 'V'}-${doctor.identityCard}`,
      doctorMs: doctor.mpps,
      doctorComezu: doctor.comezu,
      doctorSpecialty: doctor.specialty,
      reasonForConsultation: dto.notes || null,
    }),
  );

  if (preloadItem) {
    const detailRepo = em.getRepository(EventualityExtractionDetail);
    await detailRepo.save(
      detailRepo.create({
        eventualityId: saved.id,
        category: ConsumptionCategory.SERVICIO,
        itemName: preloadItem.name,
        quantity: 1,
        unitCost: preloadItem.cost,
        totalCost: preloadItem.cost,
        calculatedSalePrice: preloadItem.salePrice,
        status: ExtractionStatus.ADDED,
      }),
    );
  }

  if (dto.serviceRequestIds && dto.serviceRequestIds.length > 0) {
    const srRepo = em.getRepository(EventualityServiceRequest);
    const requests = await srRepo.findBy({ id: In(dto.serviceRequestIds) });
    const now = new Date();
    for (const req of requests) {
      req.status = ServiceRequestStatus.CONVERTED;
      req.childEventualityId = saved.id;
      req.convertedAt = now;
    }
    if (requests.length > 0) await srRepo.save(requests);
  }
}

export async function queryDoctorConsultationsCalendar(
  dataSource: DataSource,
  userId: string | undefined,
  query: FindDoctorConsultationsCalendarDto,
) {
  let resolvedDoctorId = query.doctorId || null;
  if (userId) {
    const user = await dataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { doctor: true, role: { permissions: true } },
    });
    const permissions = user?.role?.permissions?.map((p) => p.name) || [];
    const hasGlobalView =
      permissions.includes('audit:medical') ||
      permissions.includes('read:eventualities') ||
      permissions.includes('manage:doctors');

    // Si el usuario no tiene permisos de supervisión/auditoría global,
    // se fuerza la vista exclusiva a las citas asignadas a su perfil médico
    if (!hasGlobalView) {
      resolvedDoctorId = user?.doctorId || '__NONE__';
    }
  }

  const nowCaracas = DateTime.now().setZone(CARACAS_ZONE);
  const startStr = query.startDate || nowCaracas.startOf('day').toFormat('yyyy-MM-dd');
  const endStr = query.endDate || nowCaracas.plus({ days: 30 }).toFormat('yyyy-MM-dd');
  const startDt = DateTime.fromISO(startStr, { zone: CARACAS_ZONE }).startOf('day').toJSDate();
  const endDt = DateTime.fromISO(endStr, { zone: CARACAS_ZONE }).endOf('day').toJSDate();

  const qb = dataSource
    .getRepository(Eventuality)
    .createQueryBuilder('e')
    .leftJoinAndSelect('e.person', 'p')
    .leftJoinAndSelect('e.contractPerson', 'cp')
    .leftJoinAndSelect('cp.contract', 'c')
    .leftJoinAndSelect('cp.plan', 'plan')
    .leftJoinAndSelect('e.coveragePeriod', 'ccp')
    .leftJoinAndSelect('e.medicalReport', 'mr')
    .leftJoinAndSelect('e.doctor', 'doc')
    .where('e.type = :type', { type: EventualityType.CONSULTATION })
    .andWhere('e.admissionDate BETWEEN :startDt AND :endDt', { startDt, endDt })
    .orderBy('e.admissionDate', 'ASC');

  if (resolvedDoctorId === '__NONE__') {
    qb.andWhere('1 = 0');
  } else if (resolvedDoctorId) {
    qb.andWhere('e.doctorId = :doctorId', { doctorId: resolvedDoctorId });
  }
  const items = await qb.getMany();
  const todayIso = nowCaracas.toFormat('yyyy-MM-dd');
  const toDateIso = (d?: Date | null) =>
    d ? DateTime.fromJSDate(new Date(d)).setZone(CARACAS_ZONE).toFormat('yyyy-MM-dd') : '';
  const active = items.filter(
    (i) => i.status !== EventualityStatus.CANCELLED && i.status !== EventualityStatus.REJECTED,
  );
  const today = active.filter((i) => toDateIso(i.admissionDate) === todayIso);

  return {
    items,
    stats: {
      todayTotal: today.length,
      todayPending: today.filter((i) => i.status === EventualityStatus.SCHEDULED).length,
      todayAttended: today.filter((i) => i.status !== EventualityStatus.SCHEDULED).length,
      upcomingTotal: active.filter((i) => toDateIso(i.admissionDate) > todayIso).length,
    },
  };
}
