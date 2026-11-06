import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventualityHospitalizationService } from './eventuality-hospitalization.service';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import { ServiceRequestStatus } from '../entities/eventuality-service-request.entity';

describe('EventualityHospitalizationService', () => {
  let service: EventualityHospitalizationService;
  let mockEm: { getRepository: ReturnType<typeof vi.fn> };
  let mockDataSource: { manager: typeof mockEm; createQueryRunner: ReturnType<typeof vi.fn> };
  let mockCoveragePeriodService: { getOrCreateActivePeriod: ReturnType<typeof vi.fn> };
  let mockSystemSettingsService: {
    getNumeric: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let mockMetaWhatsappService: { sendMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockEm = {
      getRepository: vi.fn(),
    };

    const mockQr = {
      manager: mockEm,
      connect: vi.fn().mockResolvedValue(undefined),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    mockDataSource = {
      manager: mockEm,
      createQueryRunner: vi.fn().mockReturnValue(mockQr),
    };

    mockCoveragePeriodService = {
      getOrCreateActivePeriod: vi.fn().mockResolvedValue({
        id: 'period-uuid-1',
        remainingCoverage: '1000.00',
        initialCoverage: '1000.00',
      }),
    };

    mockSystemSettingsService = {
      getNumeric: vi.fn().mockResolvedValue(2.0),
      get: vi.fn().mockResolvedValue('584120000000'),
    };

    mockMetaWhatsappService = {
      sendMessage: vi.fn().mockResolvedValue(true),
    };

    service = new EventualityHospitalizationService(
      mockDataSource as unknown as ConstructorParameters<
        typeof EventualityHospitalizationService
      >[0],
      {} as unknown as ConstructorParameters<typeof EventualityHospitalizationService>[1],
      {} as unknown as ConstructorParameters<typeof EventualityHospitalizationService>[2],
      mockCoveragePeriodService as unknown as ConstructorParameters<
        typeof EventualityHospitalizationService
      >[3],
      mockSystemSettingsService as unknown as ConstructorParameters<
        typeof EventualityHospitalizationService
      >[4],
      mockMetaWhatsappService as unknown as ConstructorParameters<
        typeof EventualityHospitalizationService
      >[5],
    );
  });

  it('debe crear una hospitalización en estado PENDING_APPROVAL, sin claimNumber y con reserva 0', async () => {
    const mockContractPerson = {
      id: 'cp-uuid-1',
      person: { id: 'person-uuid-1', name: 'Juan Perez' },
      contract: {
        id: 'contract-uuid-1',
        status: ContractStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        expirationDate: new Date('2026-12-31'),
      },
      plan: { profitFactor: '2.50' },
    };

    const mockSavedEventuality = {
      id: 'evt-uuid-1',
      claimNumber: null,
      type: EventualityType.HOSPITALIZATION,
      status: EventualityStatus.PENDING_APPROVAL,
      requiresApproval: true,
      personId: 'person-uuid-1',
      contractPersonId: 'cp-uuid-1',
      coveragePeriodId: 'period-uuid-1',
      appliedFactor: 2.5,
      reservedCoverageAmount: 0.0,
      totalCost: 0.0,
      totalCoverageDeducted: 0.0,
      clinicName: 'Clínica San José',
    };

    const cpRepo = {
      findOne: vi.fn().mockResolvedValue(mockContractPerson),
    };

    const evtRepo = {
      create: vi.fn().mockReturnValue(mockSavedEventuality),
      save: vi.fn().mockResolvedValue(mockSavedEventuality),
    };

    mockEm.getRepository.mockImplementation((entity: { name?: string }) => {
      if (entity.name === 'ContractPerson') return cpRepo;
      return evtRepo;
    });

    const result = await service.requestHospitalization({
      personId: 'person-uuid-1',
      contractPersonId: 'cp-uuid-1',
      clinicName: 'Clínica San José',
      admissionReason: 'Cirugía de urgencia',
    });

    expect(result.status).toBe(EventualityStatus.PENDING_APPROVAL);
    expect(result.type).toBe(EventualityType.HOSPITALIZATION);
    expect(result.requiresApproval).toBe(true);
    expect(result.claimNumber).toBeNull();
    expect(result.reservedCoverageAmount).toBe(0.0);
    expect(evtRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EventualityType.HOSPITALIZATION,
        status: EventualityStatus.PENDING_APPROVAL,
        requiresApproval: true,
        reservedCoverageAmount: 0.0,
      }),
    );
  });

  it('debe rechazar si el contrato no se encuentra activo', async () => {
    const mockContractPerson = {
      id: 'cp-uuid-1',
      person: { id: 'person-uuid-1' },
      contract: {
        id: 'contract-uuid-1',
        status: 'SUSPENDED',
      },
    };

    mockEm.getRepository.mockReturnValue({
      findOne: vi.fn().mockResolvedValue(mockContractPerson),
    });

    await expect(
      service.requestHospitalization({
        personId: 'person-uuid-1',
        contractPersonId: 'cp-uuid-1',
        clinicName: 'Clínica',
        admissionReason: 'Motivo',
      }),
    ).rejects.toThrow('El contrato no se encuentra activo');
  });

  it('debe convertir las solicitudes de servicio pasadas en serviceRequestIds', async () => {
    const mockContractPerson = {
      id: 'cp-uuid-1',
      person: { id: 'person-uuid-1', name: 'Maria Gomez' },
      contract: { id: 'c-1', status: ContractStatus.ACTIVE },
    };

    const mockSavedEventuality = {
      id: 'evt-uuid-child',
      type: EventualityType.HOSPITALIZATION,
      status: EventualityStatus.PENDING_APPROVAL,
    };

    const mockRequests = [
      { id: 'req-1', status: ServiceRequestStatus.PENDING, childEventualityId: null },
      { id: 'req-2', status: ServiceRequestStatus.PENDING, childEventualityId: null },
    ];

    const cpRepo = { findOne: vi.fn().mockResolvedValue(mockContractPerson) };
    const evtRepo = {
      create: vi.fn().mockReturnValue(mockSavedEventuality),
      save: vi.fn().mockResolvedValue(mockSavedEventuality),
    };
    const srRepo = {
      findBy: vi.fn().mockResolvedValue(mockRequests),
      save: vi.fn().mockResolvedValue(mockRequests),
    };

    mockEm.getRepository.mockImplementation((entity: { name?: string }) => {
      if (entity.name === 'ContractPerson') return cpRepo;
      if (entity.name === 'EventualityServiceRequest') return srRepo;
      return evtRepo;
    });

    await service.requestHospitalization({
      personId: 'person-uuid-1',
      contractPersonId: 'cp-uuid-1',
      clinicName: 'Clínica',
      admissionReason: 'Hospitalización derivada',
      serviceRequestIds: ['req-1', 'req-2'],
    });

    expect(srRepo.save).toHaveBeenCalled();
    expect(mockRequests[0].status).toBe(ServiceRequestStatus.CONVERTED);
    expect(mockRequests[0].childEventualityId).toBe('evt-uuid-child');
  });
});
