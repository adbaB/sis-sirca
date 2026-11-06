import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
import { EventualityMovement } from '../entities/eventuality-movement.entity';
import { EventualityProviderInvoice } from '../entities/eventuality-provider-invoice.entity';
import { EventualityTreatmentItem } from '../entities/eventuality-treatment-item.entity';
import { EventualityServiceRequest } from '../entities/eventuality-service-request.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { MedicalService } from '../../plans/entities/medical-service.entity';
import { Person } from '../../persons/entities/person.entity';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { ContractCoveragePeriod } from '../../contracts/entities/contract-coverage-period.entity';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { SystemCounter } from '../../common/entities/system-counter.entity';
import { CoveragePeriodService } from '../../contracts/services/coverage-period.service';
import { SystemSettingsService } from '../../system-settings/system-settings.service';
import { AwsService } from '../../aws/aws.service';
import { EventualityOcrService } from './eventuality-ocr.service';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { MetaWhatsappService } from '../../chatbot/services/meta-whatsapp.service';
import { EventualityHospitalizationService } from './eventuality-hospitalization.service';
import { EventualitiesService } from './eventualities.service';

describe('EventualitiesService - Emergencias', () => {
  let service: EventualitiesService;
  let dataSource: DataSource;
  let eventualityRepo: jest.Mocked<Repository<Eventuality>>;
  let extractionDetailRepo: jest.Mocked<Repository<EventualityExtractionDetail>>;
  let medicalReportRepo: jest.Mocked<Repository<EventualityMedicalReport>>;
  let coveragePeriodService: jest.Mocked<CoveragePeriodService>;
  let awsService: jest.Mocked<AwsService>;
  let ocrService: jest.Mocked<EventualityOcrService>;
  let exchangeRateService: jest.Mocked<ExchangeRateService>;
  let metaWhatsappService: jest.Mocked<MetaWhatsappService>;

  const mockPerson = {
    id: 'person-1',
    name: 'Juan Pérez',
    identityCard: '12345678',
  } as unknown as Person;

  const mockContractPerson = {
    id: 'cp-1',
    person: mockPerson,
    contract: {
      id: 'contract-1',
      code: 'SIR-001',
      status: ContractStatus.ACTIVE,
      startDate: new Date('2026-01-01'),
      expirationDate: new Date('2027-01-01'),
    },
    plan: {
      id: 'plan-1',
      name: 'Plan Platino',
      coverage: 5000,
      profitFactor: 2.2,
    },
  } as unknown as ContractPerson;

  const mockCoveragePeriod = {
    id: 'period-1',
    contractId: 'contract-1',
    remainingCoverage: 4500,
    reservedCoverage: 500,
    consumedCoverage: 0,
    initialCoverage: 5000,
  };

  beforeEach(async () => {
    const mockManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === Person) {
          return {
            findOne: jest.fn().mockResolvedValue(mockPerson),
          };
        }
        if (entity === ContractPerson) {
          return {
            findOne: jest.fn().mockResolvedValue(mockContractPerson),
          };
        }
        if (entity === SystemCounter) {
          return {
            findOne: jest.fn().mockResolvedValue({ key: 'claim_number', value: 1 }),
            create: jest.fn().mockReturnValue({ key: 'claim_number', value: 1 }),
            save: jest.fn().mockResolvedValue({ key: 'claim_number', value: 2 }),
          };
        }
        if (entity === Eventuality) {
          return {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((d) => d),
            save: jest.fn().mockImplementation(async (d) => ({
              id: 'eventuality-1',
              ...d,
            })),
          };
        }
        if (entity === EventualityExtractionDetail) {
          return {
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation((d) => d),
            save: jest.fn().mockImplementation(async (d) => d),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
            remove: jest.fn().mockResolvedValue([]),
          };
        }
        if (entity === EventualityMovement) {
          return {
            create: jest.fn().mockImplementation((d) => d),
            save: jest.fn().mockImplementation(async (d) => d),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
          };
        }
        if (entity === EventualityProviderInvoice) {
          return {
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation((d) => d),
            save: jest.fn().mockImplementation(async (d) => d),
          };
        }
        return {
          findOne: jest.fn(),
          find: jest.fn().mockResolvedValue([]),
          save: jest.fn(),
          create: jest.fn(),
          delete: jest.fn().mockResolvedValue({ affected: 0 }),
        };
      }),
      query: jest.fn().mockResolvedValue([]),
    };

    const mockDataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventualitiesService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(Eventuality),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn().mockImplementation(async (d) => d),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(EventualityExtractionDetail),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: getRepositoryToken(EventualityMedicalReport),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((d) => ({ id: 'emr-1', ...d })),
            save: jest.fn().mockImplementation(async (d) => ({ id: 'emr-1', ...d })),
          },
        },
        {
          provide: getRepositoryToken(EventualityMovement),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
          },
        },
        {
          provide: getRepositoryToken(EventualityProviderInvoice),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Person),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(EventualityTreatmentItem),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(EventualityServiceRequest),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Doctor),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MedicalService),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: CoveragePeriodService,
          useValue: {
            getOrCreateActivePeriod: jest.fn().mockResolvedValue(mockCoveragePeriod),
            lockCoverageAmount: jest.fn().mockResolvedValue(mockCoveragePeriod),
            updateLockedCoverageAmount: jest.fn().mockResolvedValue(mockCoveragePeriod),
            updateLockedCoverageWithCap: jest
              .fn()
              .mockImplementation((periodId, oldAmount, newAmount) =>
                Promise.resolve({
                  period: mockCoveragePeriod,
                  actualLockedAmount: newAmount,
                  excessAmount: 0,
                }),
              ),
            releaseAndDeductCoverage: jest.fn().mockResolvedValue(mockCoveragePeriod),
          },
        },
        {
          provide: SystemSettingsService,
          useValue: {
            getNumeric: jest.fn().mockImplementation((key: string, def?: number) => {
              if (key === 'DEFAULT_SERVICE_PRICE_FACTOR') return Promise.resolve(def ?? 2.0);
              if (key === 'EVENTUALITY_ALERT_THRESHOLD') return Promise.resolve(80);
              return Promise.resolve(def ?? 0);
            }),
            get: jest.fn().mockImplementation((key: string, def?: string) => {
              if (key === 'EVENTUALITY_ALERT_THRESHOLD') return Promise.resolve('80');
              if (key === 'EVENTUALITY_ALERT_PHONES')
                return Promise.resolve('584141234567,584249876543');
              if (key === 'EVENTUALITY_ALERT_ENABLED') return Promise.resolve('true');
              return Promise.resolve(def ?? '');
            }),
            set: jest
              .fn()
              .mockImplementation((key: string, val: string) =>
                Promise.resolve({ key, value: val }),
              ),
          },
        },
        {
          provide: MetaWhatsappService,
          useValue: {
            sendMessage: jest.fn().mockResolvedValue(undefined),
            sendTemplateMessage: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ExchangeRateService,
          useValue: {
            getLatestExchangeRateOnOrBefore: jest.fn().mockResolvedValue({
              rateUsd: 50,
            }),
          },
        },
        {
          provide: AwsService,
          useValue: {
            uploadFile: jest.fn().mockResolvedValue('https://s3.amazonaws.com/sirca/test-file.pdf'),
          },
        },
        {
          provide: EventualityOcrService,
          useValue: {
            extractConsumptionItems: jest.fn().mockResolvedValue({
              currency: 'USD',
              exchangeRate: null,
              items: [
                {
                  name: 'Ampicilina 500mg',
                  quantity: 2,
                  unitCost: 10,
                  totalCost: 20,
                  category: ConsumptionCategory.MEDICAMENTO,
                },
                {
                  name: 'Jeringa descartable',
                  quantity: 3,
                  unitCost: 2,
                  totalCost: 6,
                  category: ConsumptionCategory.MATERIAL,
                },
                {
                  name: 'Atención médica de urgencia',
                  quantity: 1,
                  unitCost: 50,
                  totalCost: 50,
                  category: ConsumptionCategory.SERVICIO,
                },
              ],
              totalMedicamentos: 20,
              totalMateriales: 6,
              totalServicios: 50,
              totalGeneral: 76,
            }),
            extractMedicalReportData: jest.fn().mockResolvedValue({
              reportType: 'Informe de Emergencia',
              company: 'Hospital Clínico de Maracaibo',
              doctorFullName: 'Carlos Alberto Gómez',
              doctorIdentityCard: 'V-14555666',
              doctorMs: '98765',
              doctorComezu: '12345',
              doctorSpecialty: 'Medicina Interna',
              admissionDiagnosis: 'Síndrome febril agudo',
              medicalReport: 'Paciente ingresa con fiebre de 39°C de 48h de evolución.',
              dischargeDiagnosis: 'Infección viral resuelta',
              reportDate: '21/10/2026',
              reportTime: '10:30 AM',
            }),
          },
        },
        {
          provide: EventualityHospitalizationService,
          useValue: {
            requestHospitalization: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventualitiesService>(EventualitiesService);
    dataSource = module.get<DataSource>(DataSource);
    eventualityRepo = module.get(getRepositoryToken(Eventuality));
    extractionDetailRepo = module.get(getRepositoryToken(EventualityExtractionDetail));
    medicalReportRepo = module.get(getRepositoryToken(EventualityMedicalReport));
    coveragePeriodService = module.get(CoveragePeriodService);
    awsService = module.get(AwsService);
    ocrService = module.get(EventualityOcrService);
    exchangeRateService = module.get(ExchangeRateService);
    metaWhatsappService = module.get(MetaWhatsappService);
  });

  describe('createEmergency', () => {
    it('should create emergency with lock and CLINIC_PROCESS status', async () => {
      const dto = {
        personId: 'person-1',
        contractPersonId: 'cp-1',
        clinicName: 'Clínica Caracas',
        notes: 'Dr. Gregory House - Dolor abdominal agudo',
        admissionDate: '2026-03-15T10:00:00Z',
        estimatedCost: 300,
      };

      const result = await service.createEmergency(dto);

      expect(result).toBeDefined();
      expect(result.type).toBe(EventualityType.EMERGENCY);
      expect(result.status).toBe(EventualityStatus.CLINIC_PROCESS);
      expect(result.claimNumber).toBeDefined();
      expect(result.claimNumber).toMatch(/^\d+$/);
      expect(result.claimNumber).not.toContain('-');
      expect(result.appliedFactor).toBe(2.2); // Uses plan.profitFactor
      expect(coveragePeriodService.lockCoverageAmount).toHaveBeenCalledWith(
        'period-1',
        660, // 300 * 2.2 = 660 estimated coverage hold
        expect.anything(),
      );
    });

    it('should throw BadRequestException if contract is SUSPENDED or INACTIVE', async () => {
      const inactiveCp = {
        ...mockContractPerson,
        contract: {
          ...mockContractPerson.contract,
          status: ContractStatus.SUSPENDED,
        },
      };

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Person) return { findOne: jest.fn().mockResolvedValue(mockPerson) };
            if (entity === ContractPerson)
              return { findOne: jest.fn().mockResolvedValue(inactiveCp) };
            return {};
          }),
        };
        return cb(mgr);
      });

      await expect(
        service.createEmergency({
          personId: 'person-1',
          contractPersonId: 'cp-1',
          clinicName: 'Clínica',
          admissionDate: '2026-03-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if contractPerson does not belong to personId', async () => {
      const mismatchedCp = {
        ...mockContractPerson,
        person: {
          id: 'other-person-id',
        },
      };

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Person) return { findOne: jest.fn().mockResolvedValue(mockPerson) };
            if (entity === ContractPerson)
              return { findOne: jest.fn().mockResolvedValue(mismatchedCp) };
            return {};
          }),
        };
        return cb(mgr);
      });

      await expect(
        service.createEmergency({
          personId: 'person-1',
          contractPersonId: 'cp-1',
          clinicName: 'Clínica',
          admissionDate: '2026-03-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create emergency with PENDING_APPROVAL and notify WhatsApp if projected consumption exceeds threshold', async () => {
      const highConsumptionPeriod = {
        ...mockCoveragePeriod,
        consumedCoverage: 3800,
        reservedCoverage: 0,
        remainingCoverage: 1200,
      };

      coveragePeriodService.getOrCreateActivePeriod.mockResolvedValueOnce(
        highConsumptionPeriod as unknown as ContractCoveragePeriod,
      );

      const dto = {
        personId: 'person-1',
        contractPersonId: 'cp-1',
        clinicName: 'Clínica Caracas',
        notes: 'Emergencia de alto costo',
        admissionDate: '2026-03-15T10:00:00Z',
        estimatedCost: 300, // 300 * 2.2 = 660 -> (3800 + 660) / 5000 = 89.2% >= 80%
      };

      const result = await service.createEmergency(dto);

      expect(result).toBeDefined();
      expect(result.status).toBe(EventualityStatus.PENDING_APPROVAL);
      expect(result.requiresApproval).toBe(true);
      expect(result.claimNumber).toBeNull();
      expect(result.reservedCoverageAmount).toBe(0);
      expect(coveragePeriodService.lockCoverageAmount).not.toHaveBeenCalled();
      expect(metaWhatsappService.sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          cobertura_restante: expect.any(String),
          razon_ingreso: expect.any(String),
        }),
        undefined,
        undefined,
        expect.arrayContaining([
          expect.stringContaining('APPROVE_'),
          expect.stringContaining('REJECT_'),
        ]),
      );
    });
  });

  describe('uploadMedicalReport', () => {
    it('should upload medical report, set dischargeDate, transition to WAITING_INVOICE and trigger background OCR extraction', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.CLINIC_PROCESS,
        medicalReportUrl: null,
        dischargeDate: null,
      } as unknown as Eventuality;

      eventualityRepo.findOne.mockResolvedValue(mockEv);
      eventualityRepo.save.mockImplementation(async (d) => d as Eventuality);

      let storedReport: EventualityMedicalReport | null = null;
      medicalReportRepo.findOne.mockImplementation(async () => storedReport);
      medicalReportRepo.save.mockImplementation(async (d) => {
        storedReport = { id: 'emr-1', ...(d as EventualityMedicalReport) };
        return storedReport;
      });

      const file = {
        buffer: Buffer.from('mock pdf content'),
        originalname: 'informe_medico.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      const result = await service.uploadMedicalReport('eventuality-1', {}, file);

      expect(awsService.uploadFile).toHaveBeenCalled();
      expect(result.status).toBe(EventualityStatus.WAITING_INVOICE);
      expect(result.medicalReportUrl).toBeDefined();
      expect(result.dischargeDate).toBeInstanceOf(Date);
      expect(result.medicalReport).toBeDefined();

      // Wait for background promise to resolve
      await new Promise((resolve) => setImmediate(resolve));

      expect(ocrService.extractMedicalReportData).toHaveBeenCalledWith(
        file.buffer,
        'application/pdf',
      );
      expect(storedReport?.status).toBe(MedicalReportExtractionStatus.EXTRACTED);
      expect(storedReport?.reportType).toBe('Informe de Emergencia');
      expect(storedReport?.company).toBe('Hospital Clínico de Maracaibo');
      expect(storedReport?.doctorFullName).toBe('Carlos Alberto Gómez');
      expect(storedReport?.doctorComezu).toBe('12345');
    });

    it('should mark medical report extraction as FAILED if background OCR throws an error', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.CLINIC_PROCESS,
        medicalReportUrl: null,
      } as unknown as Eventuality;

      eventualityRepo.findOne.mockResolvedValue(mockEv);
      eventualityRepo.save.mockImplementation(async (d) => d as Eventuality);

      let storedReport: EventualityMedicalReport | null = null;
      medicalReportRepo.findOne.mockImplementation(async () => storedReport);
      medicalReportRepo.save.mockImplementation(async (d) => {
        storedReport = { id: 'emr-1', ...(d as EventualityMedicalReport) };
        return storedReport;
      });

      ocrService.extractMedicalReportData.mockRejectedValueOnce(new Error('OpenRouter timeout'));

      const file = {
        buffer: Buffer.from('corrupt image'),
        originalname: 'informe.jpg',
        mimetype: 'image/jpeg',
      } as Express.Multer.File;

      await service.uploadMedicalReport('eventuality-1', {}, file);
      await new Promise((resolve) => setImmediate(resolve));

      expect(storedReport?.status).toBe(MedicalReportExtractionStatus.FAILED);
      expect(storedReport?.errorMessage).toContain('OpenRouter timeout');
    });

    it('should allow editing extracted medical report fields via updateMedicalReportData and set status to EDITED', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.WAITING_INVOICE,
      } as unknown as Eventuality;

      const existingReport = {
        id: 'emr-1',
        eventualityId: 'eventuality-1',
        status: MedicalReportExtractionStatus.EXTRACTED,
        doctorFullName: 'Carlos Gómez',
        doctorComezu: '123',
      } as EventualityMedicalReport;

      eventualityRepo.findOne.mockResolvedValue(mockEv);
      medicalReportRepo.findOne.mockResolvedValue(existingReport);
      medicalReportRepo.save.mockImplementation(async (d) => d as EventualityMedicalReport);

      const updated = await service.updateMedicalReportData('eventuality-1', {
        doctorComezu: '12345-Z',
        dischargeDiagnosis: 'Gastritis aguda controlada',
      });

      expect(updated.status).toBe(MedicalReportExtractionStatus.EDITED);
      expect(updated.doctorComezu).toBe('12345-Z');
      expect(updated.dischargeDiagnosis).toBe('Gastritis aguda controlada');
      expect(updated.doctorFullName).toBe('Carlos Gómez');
    });

    it('should throw BadRequestException if status is not eligible for medical report upload', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.CLOSED,
      } as unknown as Eventuality;

      eventualityRepo.findOne.mockResolvedValue(mockEv);

      await expect(
        service.uploadMedicalReport('eventuality-1', {}, {
          buffer: Buffer.from(''),
          originalname: 'f.pdf',
          mimetype: 'application/pdf',
        } as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processConsumptionFile', () => {
    it('should process OCR consumption sheet and advance to UNDER_ADMIN_REVIEW', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.WAITING_INVOICE,
        appliedFactor: 2.2,
        coveragePeriodId: 'period-1',
        reservedCoverageAmount: 300,
        extractionDetails: [],
      } as unknown as Eventuality;

      eventualityRepo.findOne.mockResolvedValue(mockEv);

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(mockEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === EventualityExtractionDetail) {
              return {
                create: jest.fn().mockImplementation((d) => d),
                save: jest.fn().mockImplementation(async (d) => d),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                find: jest.fn().mockResolvedValue([]),
              };
            }
            return {};
          }),
        };
        return cb(mgr);
      });

      const file = {
        buffer: Buffer.from('consumption sheet pdf'),
        originalname: 'consumo.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      const result = await service.processConsumptionFile('eventuality-1', file);

      expect(ocrService.extractConsumptionItems).toHaveBeenCalled();
      expect(coveragePeriodService.updateLockedCoverageWithCap).toHaveBeenCalled();
      expect(result.eventuality.status).toBe(EventualityStatus.UNDER_ADMIN_REVIEW);
      expect(result.totals.totalCosto).toBe(76);
    });

    it('should convert Bs prices to USD using BCV exchange rate when currency is Bs', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.WAITING_INVOICE,
        appliedFactor: 2.0,
        coveragePeriodId: 'period-1',
        reservedCoverageAmount: 100,
        extractionDetails: [],
      } as unknown as Eventuality;

      eventualityRepo.findOne.mockResolvedValue(mockEv);

      ocrService.extractConsumptionItems.mockResolvedValueOnce({
        currency: 'Bs',
        exchangeRate: null,
        items: [
          {
            name: 'Dexametasona 8mg',
            quantity: 1,
            unitCost: 500, // 500 Bs / 50 rate = 10 USD
            totalCost: 500,
            category: ConsumptionCategory.MEDICAMENTO,
          },
          {
            name: 'Sala de Emergencia',
            quantity: 1,
            unitCost: 2500, // 2500 Bs / 50 rate = 50 USD
            totalCost: 2500,
            category: ConsumptionCategory.SERVICIO,
          },
        ],
        totalMedicamentos: 500,
        totalMateriales: 0,
        totalServicios: 2500,
        totalGeneral: 3000,
      });

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(mockEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === EventualityExtractionDetail) {
              return {
                create: jest.fn().mockImplementation((d) => d),
                save: jest.fn().mockImplementation(async (d) => d),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                find: jest.fn().mockResolvedValue([]),
              };
            }
            return {};
          }),
        };
        return cb(mgr);
      });

      const file = {
        buffer: Buffer.from('consumption sheet bs'),
        originalname: 'consumo-bs.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      const result = await service.processConsumptionFile('eventuality-1', file);

      expect(result.totals.detectedCurrency).toBe('Bs');
      expect(result.totals.appliedExchangeRate).toBe(50);
      expect(result.totals.exchangeRateDate).toBeDefined();
      expect(result.totals.medicamentos).toBe(10);
      expect(result.totals.servicios).toBe(50);
      expect(result.totals.totalCosto).toBe(60); // 10 + 50 USD
      expect(result.totals.totalCoberturaEstimada).toBe(120); // 60 * 2.0
      expect(result.extractedItems[0].unitCostBs).toBe(500);
      expect(result.extractedItems[0].totalCostBs).toBe(500);
      expect(result.extractedItems[1].unitCostBs).toBe(2500);
      expect(result.extractedItems[1].totalCostBs).toBe(2500);
    });

    it('should throw BadRequestException if consumption sheet is in Bs but no exchange rate is found', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.WAITING_INVOICE,
        appliedFactor: 2.0,
        coveragePeriodId: 'period-1',
        reservedCoverageAmount: 100,
        extractionDetails: [],
      } as unknown as Eventuality;

      eventualityRepo.findOne.mockResolvedValue(mockEv);

      ocrService.extractConsumptionItems.mockResolvedValueOnce({
        currency: 'Bs',
        exchangeRate: null,
        items: [
          {
            name: 'Dexametasona 8mg',
            quantity: 1,
            unitCost: 500,
            totalCost: 500,
            category: ConsumptionCategory.MEDICAMENTO,
          },
        ],
        totalMedicamentos: 500,
        totalMateriales: 0,
        totalServicios: 0,
        totalGeneral: 500,
      });

      exchangeRateService.getLatestExchangeRateOnOrBefore.mockResolvedValue(null);

      const file = {
        buffer: Buffer.from('consumption sheet bs without rate'),
        originalname: 'consumo-sin-tasa.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      await expect(service.processConsumptionFile('eventuality-1', file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should recalculate Bs consumption items when exchangeRateDate is changed', async () => {
      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.CLINIC_PROCESS,
        appliedFactor: 2.0,
        consumptionCurrency: 'Bs',
        exchangeRateDate: '2026-10-20',
        appliedExchangeRate: 50,
        coveragePeriodId: 'period-1',
        reservedCoverageAmount: 120,
        totalCost: 60,
        totalCoverageDeducted: 120,
      } as unknown as Eventuality;

      const existingItems: EventualityExtractionDetail[] = [
        {
          id: 'item-1',
          eventualityId: 'eventuality-1',
          itemName: 'Acetaminofén',
          quantity: 2,
          unitCostBs: 250,
          totalCostBs: 500,
          unitCost: 5,
          totalCost: 10,
          calculatedSalePrice: 20,
          category: ConsumptionCategory.MEDICAMENTO,
          status: ExtractionStatus.EXTRACTED,
        } as unknown as EventualityExtractionDetail,
        {
          id: 'item-2',
          eventualityId: 'eventuality-1',
          itemName: 'Sala de Emergencia',
          quantity: 1,
          unitCostBs: 2500,
          totalCostBs: 2500,
          unitCost: 50,
          totalCost: 50,
          calculatedSalePrice: 100,
          category: ConsumptionCategory.SERVICIO,
          status: ExtractionStatus.EXTRACTED,
        } as unknown as EventualityExtractionDetail,
      ];

      (exchangeRateService.getLatestExchangeRateOnOrBefore as jest.Mock).mockResolvedValueOnce({
        rateUsd: 100,
        date: '2026-10-21',
      });

      eventualityRepo.findOne.mockResolvedValue(mockEv);
      extractionDetailRepo.find.mockResolvedValue(existingItems);

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(mockEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === EventualityExtractionDetail) {
              return {
                find: jest.fn().mockResolvedValue(existingItems),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            return {};
          }),
        };
        return cb(mgr);
      });

      const result = await service.recalculateConsumptionByDate('eventuality-1', '2026-10-21');

      expect(exchangeRateService.getLatestExchangeRateOnOrBefore).toHaveBeenCalledWith(
        '2026-10-21',
      );
      expect(result.exchangeRateDate).toBe('2026-10-21');
      expect(result.appliedExchangeRate).toBe(100);
      expect(result.items[0].unitCost).toBe(2.5); // 250 Bs / 100
      expect(result.items[0].totalCost).toBe(5); // 500 Bs / 100
      expect(result.items[1].unitCost).toBe(25); // 2500 Bs / 100
      expect(result.items[1].totalCost).toBe(25);
      expect(result.subtotals.totalCosto).toBe(30); // 5 + 25 USD
      expect(result.subtotals.totalCostoBs).toBe(3000); // 500 + 2500 Bs
      expect(result.subtotals.totalCoberturaConFactor).toBe(60); // 30 * 2.0
    });
  });

  describe('finalizeEmergency', () => {
    it('should generate movements, release lock, deduct definitive coverage and set CLOSED', async () => {
      const items: EventualityExtractionDetail[] = [
        {
          id: 'item-1',
          eventualityId: 'eventuality-1',
          category: ConsumptionCategory.MEDICAMENTO,
          status: ExtractionStatus.EXTRACTED,
          quantity: 2,
          unitCost: 10,
          totalCost: 20,
          calculatedSalePrice: 44, // 20 * 2.2
        } as EventualityExtractionDetail,
        {
          id: 'item-2',
          eventualityId: 'eventuality-1',
          category: ConsumptionCategory.MATERIAL,
          status: ExtractionStatus.EXTRACTED,
          quantity: 3,
          unitCost: 2,
          totalCost: 6,
          calculatedSalePrice: 13.2, // 6 * 2.2
        } as EventualityExtractionDetail,
        {
          id: 'item-3',
          eventualityId: 'eventuality-1',
          category: ConsumptionCategory.SERVICIO,
          status: ExtractionStatus.EXTRACTED,
          quantity: 1,
          unitCost: 50,
          totalCost: 50,
          calculatedSalePrice: 110, // 50 * 2.2
        } as EventualityExtractionDetail,
      ];

      const invoices: EventualityProviderInvoice[] = [
        {
          id: 'inv-1',
          eventualityId: 'eventuality-1',
          invoiceNumber: 'FACT-001',
          controlNumber: 'CTRL-001',
          invoiceDate: new Date('2026-03-15'),
          amount: 76,
        } as unknown as EventualityProviderInvoice,
      ];

      const mockEv = {
        id: 'eventuality-1',
        status: EventualityStatus.UNDER_ADMIN_REVIEW,
        appliedFactor: 2.2,
        coveragePeriodId: 'period-1',
        reservedCoverageAmount: 167.2,
        extractionDetails: items,
        providerInvoices: invoices,
      } as unknown as Eventuality;

      let savedMovements: EventualityMovement[] = [];

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(mockEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === EventualityExtractionDetail) {
              return {
                find: jest.fn().mockResolvedValue(items),
              };
            }
            if (entity === EventualityProviderInvoice) {
              return {
                find: jest.fn().mockResolvedValue(invoices),
              };
            }
            if (entity === EventualityMovement) {
              return {
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                create: jest.fn().mockImplementation((d) => d),
                save: jest.fn().mockImplementation(async (d) => {
                  savedMovements = d;
                  return d;
                }),
              };
            }
            return {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              create: jest.fn().mockImplementation((d) => d),
              save: jest.fn().mockImplementation(async (d) => d),
            };
          }),
        };
        return cb(mgr);
      });

      const result = await service.finalizeEmergency('eventuality-1');

      expect(result.status).toBe(EventualityStatus.CLOSED);
      expect(result.closedAt).toBeDefined();
      expect(savedMovements.length).toBe(3); // 3 consolidated movements: MEDICAMENTO, MATERIAL, SERVICIO
      expect(coveragePeriodService.releaseAndDeductCoverage).toHaveBeenCalledWith(
        'period-1',
        167.2,
        167.2, // total coverage deducted = 44 + 13.2 + 110 = 167.20
        expect.anything(),
      );
    });

    it('should throw BadRequestException if no provider invoice has been registered', async () => {
      const mockEv = {
        id: 'eventuality-1',
        type: EventualityType.EMERGENCY,
        status: EventualityStatus.UNDER_ADMIN_REVIEW,
        extractionDetails: [
          {
            category: ConsumptionCategory.MEDICAMENTO,
            status: ExtractionStatus.EXTRACTED,
            totalCost: 10,
          },
        ],
        providerInvoices: [], // Empty invoices
      } as unknown as Eventuality;

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(mockEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === EventualityExtractionDetail) {
              return {
                find: jest.fn().mockResolvedValue([
                  {
                    category: ConsumptionCategory.MEDICAMENTO,
                    status: ExtractionStatus.EXTRACTED,
                    totalCost: 10,
                  },
                ]),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === EventualityProviderInvoice) {
              return {
                find: jest.fn().mockResolvedValue([]),
              };
            }
            return {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              create: jest.fn().mockImplementation((d) => d),
              save: jest.fn().mockImplementation(async (d) => d),
            };
          }),
        };
        return cb(mgr);
      });

      await expect(service.finalizeEmergency('eventuality-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveEmergency', () => {
    it('should approve emergency in PENDING_APPROVAL, generate numeric claim number, lock coverage and notify WhatsApp', async () => {
      const pendingEv = {
        id: 'ev-pending-1',
        status: EventualityStatus.PENDING_APPROVAL,
        totalCost: 300,
        appliedFactor: 2.2,
        coveragePeriodId: 'period-1',
        clinicName: 'Clínica La Floresta',
        person: mockPerson,
        coveragePeriod: mockCoveragePeriod,
      } as unknown as Eventuality;

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(pendingEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            if (entity === SystemCounter) {
              return {
                findOne: jest.fn().mockResolvedValue({ key: 'claim_number', value: 5 }),
                create: jest.fn().mockReturnValue({ key: 'claim_number', value: 5 }),
                save: jest.fn().mockResolvedValue({ key: 'claim_number', value: 6 }),
              };
            }
            return {
              findOne: jest.fn(),
              save: jest.fn(),
            };
          }),
        };
        return cb(mgr);
      });

      const approved = await service.approveEmergency('ev-pending-1', { userId: 'admin-user' });

      expect(approved.status).toBe(EventualityStatus.CLINIC_PROCESS);
      expect(approved.claimNumber).toBeDefined();
      expect(approved.claimNumber).toMatch(/^\d+$/);
      expect(approved.claimNumber).not.toContain('-');
      expect(approved.approvedBy).toBe('admin-user');
      expect(approved.approvedAt).toBeInstanceOf(Date);
      expect(coveragePeriodService.lockCoverageAmount).toHaveBeenCalledWith(
        'period-1',
        660,
        expect.anything(),
      );
      expect(metaWhatsappService.sendMessage).toHaveBeenCalled();
    });

    it('should throw BadRequestException if eventuality is not in PENDING_APPROVAL', async () => {
      const clinicProcessEv = {
        id: 'ev-1',
        status: EventualityStatus.CLINIC_PROCESS,
      } as unknown as Eventuality;

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return { findOne: jest.fn().mockResolvedValue(clinicProcessEv) };
            }
            return {};
          }),
        };
        return cb(mgr);
      });

      await expect(service.approveEmergency('ev-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectEmergency', () => {
    it('should reject emergency in PENDING_APPROVAL without generating claim number or locking coverage', async () => {
      const pendingEv = {
        id: 'ev-pending-2',
        status: EventualityStatus.PENDING_APPROVAL,
        clinicName: 'Clínica El Ávila',
        person: mockPerson,
      } as unknown as Eventuality;

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return {
                findOne: jest.fn().mockResolvedValue(pendingEv),
                save: jest.fn().mockImplementation(async (d) => d),
              };
            }
            return {};
          }),
        };
        return cb(mgr);
      });

      const rejected = await service.rejectEmergency(
        'ev-pending-2',
        { reason: 'Supera el límite anual no ampliable' },
        { userId: 'admin-1' },
      );

      expect(rejected.status).toBe(EventualityStatus.REJECTED);
      expect(rejected.rejectionReason).toBe('Supera el límite anual no ampliable');
      expect(rejected.claimNumber).toBeUndefined();
      expect(metaWhatsappService.sendMessage).toHaveBeenCalled();
    });

    it('should throw BadRequestException if eventuality to reject is not PENDING_APPROVAL', async () => {
      const clinicProcessEv = {
        id: 'ev-2',
        status: EventualityStatus.CLINIC_PROCESS,
      } as unknown as Eventuality;

      (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const mgr = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Eventuality) {
              return { findOne: jest.fn().mockResolvedValue(clinicProcessEv) };
            }
            return {};
          }),
        };
        return cb(mgr);
      });

      await expect(service.rejectEmergency('ev-2', {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('consumption alert settings', () => {
    it('should get current consumption alert config', async () => {
      const config = await service.getConsumptionAlertConfig();
      expect(config.consumptionThresholdPercentage).toBe(80);
      expect(config.notificationPhones).toEqual(['584141234567', '584249876543']);
      expect(config.enabled).toBe(true);
      expect(config.templateName).toBe('alerta_cobertura_paciente');
    });

    it('should update consumption alert config', async () => {
      const updated = await service.updateConsumptionAlertConfig({
        consumptionThresholdPercentage: 85,
        notificationPhones: ['584120001122'],
        enabled: false,
        templateName: 'custom_coverage_alert',
      });

      expect(updated).toBeDefined();
    });
  });
});
