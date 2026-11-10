import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PdfService } from '../../pdf/services/pdf.service';
import { Person } from '../../persons/entities/person.entity';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { Eventuality, EventualityStatus, EventualityType } from '../entities/eventuality.entity';
import { EventualityTreatmentItem } from '../entities/eventuality-treatment-item.entity';
import { EventualityServiceRequest } from '../entities/eventuality-service-request.entity';
import { EventualityPdfService } from './eventuality-pdf.service';

describe('EventualityPdfService', () => {
  let service: EventualityPdfService;
  let eventualityRepo: { findOne: ReturnType<typeof vi.fn> };
  let treatmentItemRepo: { find: ReturnType<typeof vi.fn> };
  let serviceRequestRepo: { find: ReturnType<typeof vi.fn> };
  let pdfService: { generatePdf: ReturnType<typeof vi.fn> };

  const mockEventuality: Partial<Eventuality> = {
    id: 'a0000000-0000-0000-0000-000000000001',
    claimNumber: '20261015001',
    type: EventualityType.EMERGENCY,
    status: EventualityStatus.CLINIC_PROCESS,
    clinicName: 'Clínica Santiago de León',
    notes: 'Apendicitis aguda',
    admissionDate: new Date('2026-10-15T14:30:00Z'),
    person: {
      id: 'p-1',
      name: 'María García',
      firstName: 'María',
      lastName: 'García',
      identityCard: '19876543',
      typeIdentityCard: 'V',
    } as unknown as Person,
    contractPerson: {
      id: 'cp-1',
      contract: {
        id: 'c-1',
        code: 'SIR-2026-999',
      },
      plan: {
        id: 'pl-1',
        name: 'Plan Platino Individual',
      },
    } as unknown as ContractPerson,
  };

  beforeEach(async () => {
    eventualityRepo = {
      findOne: vi.fn(),
    };
    treatmentItemRepo = {
      find: vi.fn().mockResolvedValue([]),
    };
    serviceRequestRepo = {
      find: vi.fn().mockResolvedValue([]),
    };
    pdfService = {
      generatePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock buffer')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventualityPdfService,
        {
          provide: getRepositoryToken(Eventuality),
          useValue: eventualityRepo,
        },
        {
          provide: getRepositoryToken(EventualityTreatmentItem),
          useValue: treatmentItemRepo,
        },
        {
          provide: getRepositoryToken(EventualityServiceRequest),
          useValue: serviceRequestRepo,
        },
        {
          provide: PdfService,
          useValue: pdfService,
        },
      ],
    }).compile();

    service = module.get<EventualityPdfService>(EventualityPdfService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should generate voucher PDF successfully with UUID', async () => {
    eventualityRepo.findOne.mockResolvedValue(mockEventuality as Eventuality);

    const result = await service.generateVoucherPdf('a0000000-0000-0000-0000-000000000001');

    expect(result).toBeDefined();
    expect(result.pdfBuffer).toBeInstanceOf(Buffer);
    expect(result.filename).toBe('comprobante-eventualidad-20261015001.pdf');
    expect(eventualityRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'a0000000-0000-0000-0000-000000000001' },
      relations: [
        'person',
        'contractPerson',
        'contractPerson.contract',
        'contractPerson.plan',
        'contractPerson.person',
        'doctor',
        'medicalReport',
        'extractionDetails',
      ],
    });
    expect(pdfService.generatePdf).toHaveBeenCalledWith(
      'eventuality-voucher',
      expect.objectContaining({
        claimNumber: '20261015001',
        patientName: 'María García',
        patientIdCard: 'V-19876543',
        contractCode: 'SIR-2026-999',
        planName: 'Plan Platino Individual',
        clinicName: 'Clínica Santiago de León',
        notes: 'Apendicitis aguda',
      }),
      expect.objectContaining({
        landscape: false,
        displayHeaderFooter: false,
      }),
    );
  });

  it('should generate voucher PDF when searching by claim number', async () => {
    eventualityRepo.findOne.mockResolvedValue(mockEventuality as Eventuality);

    const result = await service.generateVoucherPdf('20261015001');

    expect(result).toBeDefined();
    expect(eventualityRepo.findOne).toHaveBeenCalledWith({
      where: { claimNumber: '20261015001' },
      relations: expect.any(Array),
    });
  });

  it('should throw NotFoundException if eventuality does not exist', async () => {
    eventualityRepo.findOne.mockResolvedValue(null);

    await expect(service.generateVoucherPdf('non-existent-id')).rejects.toThrow(NotFoundException);
  });

  it('should handle fallback patient and plan names gracefully', async () => {
    const minimalEventuality = {
      id: 'a0000000-0000-0000-0000-000000000002',
      claimNumber: null,
      person: null,
      contractPerson: null,
      clinicName: null,
      notes: null,
      admissionDate: null,
    };
    eventualityRepo.findOne.mockResolvedValue(minimalEventuality as unknown as Eventuality);

    const result = await service.generateVoucherPdf('a0000000-0000-0000-0000-000000000002');

    expect(result.filename).toBe(
      'comprobante-eventualidad-a0000000-0000-0000-0000-000000000002.pdf',
    );
    expect(pdfService.generatePdf).toHaveBeenCalledWith(
      'eventuality-voucher',
      expect.objectContaining({
        claimNumber: 'PENDIENTE',
        patientName: 'Afiliado SIRCA',
        patientIdCard: 'N/A',
        contractCode: 'N/A',
        planName: 'Plan de Salud',
        clinicName: 'Centro Médico Prestador',
        notes: 'Atención de emergencia médica no programada.',
      }),
      expect.any(Object),
    );
  });
});
