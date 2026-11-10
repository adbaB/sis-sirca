import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { EventualityConsultationService } from './eventuality-consultation.service';
import { CoveragePeriodService } from '../../contracts/services/coverage-period.service';
import { SystemSettingsService } from '../../system-settings/system-settings.service';
import { DoctorScheduleService } from '../../doctors/services/doctor-schedule.service';
import { EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { InvalidDomainOperationException } from '../../common/exceptions/domain-exceptions';

vi.mock('../helpers/claim-number-generator.helper', () => ({
  generateClaimNumber: vi.fn().mockResolvedValue({ claimNumber: '2026000777' }),
}));

interface MockRepo {
  findOne: ReturnType<typeof vi.fn>;
  findBy: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

describe('EventualityConsultationService', () => {
  let service: EventualityConsultationService;
  let getMockRepo: (entity: { name?: string } | string) => MockRepo;
  let mockDataSource: Partial<DataSource>;
  let mockCoveragePeriodService: Partial<CoveragePeriodService>;
  let mockSystemSettingsService: Partial<SystemSettingsService>;
  let mockDoctorScheduleService: Partial<DoctorScheduleService>;

  beforeEach(() => {
    const repoMap = new Map<string, MockRepo>();

    getMockRepo = (entity: { name?: string } | string): MockRepo => {
      const key = typeof entity === 'string' ? entity : entity.name || 'Unknown';
      if (!repoMap.has(key)) {
        repoMap.set(key, {
          findOne: vi.fn(),
          findBy: vi.fn().mockResolvedValue([]),
          create: vi.fn((x: Record<string, unknown>) => ({ id: 'evt-new-1', ...x })),
          save: vi.fn((x: Record<string, unknown>) => Promise.resolve(x)),
        });
      }
      return repoMap.get(key)!;
    };

    const mockManager = {
      getRepository: vi.fn((entity: { name?: string } | string) => getMockRepo(entity)),
    };

    mockDataSource = {
      createQueryRunner: vi.fn().mockReturnValue({
        connect: vi.fn(),
        startTransaction: vi.fn(),
        commitTransaction: vi.fn(),
        rollbackTransaction: vi.fn(),
        release: vi.fn(),
        manager: mockManager,
      }),
      getRepository: mockManager.getRepository as unknown as DataSource['getRepository'],
    };

    mockCoveragePeriodService = {
      getOrCreateActivePeriod: vi.fn().mockResolvedValue({
        id: 'period-1',
        remainingCoverage: 500,
      }),
      lockCoverageAmount: vi.fn().mockResolvedValue(undefined),
      updateLockedCoverageAmount: vi.fn().mockResolvedValue(undefined),
    };

    mockSystemSettingsService = {
      getNumeric: vi.fn().mockResolvedValue(2.0),
    };

    mockDoctorScheduleService = {
      validateSlotForDoctor: vi.fn().mockResolvedValue({
        valid: true,
        normalizedIsoDateTime: '2026-11-16T08:00:00.000-04:00',
        date: '2026-11-16',
        startTime: '08:00',
      }),
    };

    service = new EventualityConsultationService(
      mockDataSource as DataSource,
      mockCoveragePeriodService as CoveragePeriodService,
      mockSystemSettingsService as SystemSettingsService,
      mockDoctorScheduleService as DoctorScheduleService,
    );
  });

  it('schedules a CONSULTATION eventuality in SCHEDULED status when slot and contract are valid', async () => {
    const cpRepo = getMockRepo('ContractPerson');
    cpRepo.findOne.mockResolvedValue({
      id: 'cp-1',
      person: { id: 'person-1', name: 'Carlos Gómez' },
      contract: { id: 'c-1', code: 'SIR-01', status: ContractStatus.ACTIVE },
      plan: { profitFactor: 2.0 },
    });

    const docRepo = getMockRepo('Doctor');
    docRepo.findOne.mockResolvedValue({
      id: 'doc-1',
      firstName: 'María',
      lastName: 'Rojas',
      specialty: 'Cardiología',
      isActive: true,
      defaultMedicalServiceId: null,
    });

    const created = await service.scheduleConsultation({
      personId: 'person-1',
      contractPersonId: 'cp-1',
      doctorId: 'doc-1',
      scheduledAt: '2026-11-16T08:00:00-04:00',
      notes: 'Control cardiológico',
    });

    expect(created.type).toBe(EventualityType.CONSULTATION);
    expect(created.status).toBe(EventualityStatus.SCHEDULED);
    expect(created.claimNumber).toBe('2026000777');
    expect(created.doctorId).toBe('doc-1');
  });

  it('throws InvalidDomainOperationException when doctor slot validation fails', async () => {
    const cpRepo = getMockRepo('ContractPerson');
    cpRepo.findOne.mockResolvedValue({
      id: 'cp-1',
      person: { id: 'person-1', name: 'Carlos Gómez' },
      contract: { id: 'c-1', code: 'SIR-01', status: ContractStatus.ACTIVE },
    });

    const docRepo = getMockRepo('Doctor');
    docRepo.findOne.mockResolvedValue({
      id: 'doc-1',
      isActive: true,
    });

    vi.mocked(mockDoctorScheduleService.validateSlotForDoctor!).mockResolvedValueOnce({
      valid: false,
      reason: 'El turno de las 08:00 ya está ocupado.',
    });

    await expect(
      service.scheduleConsultation({
        personId: 'person-1',
        contractPersonId: 'cp-1',
        doctorId: 'doc-1',
        scheduledAt: '2026-11-16T08:00:00-04:00',
      }),
    ).rejects.toThrow(InvalidDomainOperationException);
  });

  it('cancels a SCHEDULED consultation and releases locked coverage', async () => {
    const evtRepo = getMockRepo('Eventuality');
    evtRepo.findOne.mockResolvedValue({
      id: 'evt-1',
      type: EventualityType.CONSULTATION,
      status: EventualityStatus.SCHEDULED,
      coveragePeriodId: 'period-1',
      reservedCoverageAmount: 40,
      totalCoverageDeducted: 40,
      notes: 'Consulta inicial',
    });

    const cancelled = await service.cancelConsultation('evt-1', {
      reason: 'Paciente reprogramó viaje',
    });

    expect(cancelled.status).toBe(EventualityStatus.CANCELLED);
    expect(cancelled.reservedCoverageAmount).toBe(0);
    expect(mockCoveragePeriodService.updateLockedCoverageAmount).toHaveBeenCalledWith(
      'period-1',
      40,
      0,
      expect.anything(),
    );
  });

  it('throws InvalidDomainOperationException when doctor is a Medical Auditor', async () => {
    const cpRepo = getMockRepo('ContractPerson');
    cpRepo.findOne.mockResolvedValue({
      id: 'cp-1',
      person: { id: 'person-1', name: 'Carlos Gómez' },
      contract: { id: 'c-1', code: 'SIR-01', status: ContractStatus.ACTIVE },
    });

    const docRepo = getMockRepo('Doctor');
    docRepo.findOne.mockResolvedValue({
      id: 'doc-auditor',
      isActive: true,
      isMedicalAuditor: true,
    });

    await expect(
      service.scheduleConsultation({
        personId: 'person-1',
        contractPersonId: 'cp-1',
        doctorId: 'doc-auditor',
        scheduledAt: '2026-11-16T08:00:00-04:00',
      }),
    ).rejects.toThrow('No se pueden agendar consultas a un médico con perfil de auditor.');
  });

  it('throws InvalidDomainOperationException when doctor canScheduleConsultations is false', async () => {
    const cpRepo = getMockRepo('ContractPerson');
    cpRepo.findOne.mockResolvedValue({
      id: 'cp-1',
      person: { id: 'person-1', name: 'Carlos Gómez' },
      contract: { id: 'c-1', code: 'SIR-01', status: ContractStatus.ACTIVE },
    });

    const docRepo = getMockRepo('Doctor');
    docRepo.findOne.mockResolvedValue({
      id: 'doc-no-sched',
      isActive: true,
      canScheduleConsultations: false,
    });

    await expect(
      service.scheduleConsultation({
        personId: 'person-1',
        contractPersonId: 'cp-1',
        doctorId: 'doc-no-sched',
        scheduledAt: '2026-11-16T08:00:00-04:00',
      }),
    ).rejects.toThrow('El médico seleccionado no está habilitado para agendar citas programadas.');
  });

  it('throws InvalidDomainOperationException when a Medical Auditor user tries to cancel a consultation', async () => {
    const userRepo = getMockRepo('User');
    userRepo.findOne.mockResolvedValue({
      id: 'user-auditor',
      doctor: { isMedicalAuditor: true },
      role: { permissions: [{ name: 'audit:medical' }] },
    });

    await expect(
      service.cancelConsultation('evt-1', { reason: 'Cancelado por auditor' }, 'user-auditor'),
    ).rejects.toThrow(
      'El perfil de Médico Auditor es de solo lectura y no permite reprogramar ni cancelar citas.',
    );
  });
});
