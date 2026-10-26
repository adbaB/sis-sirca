import { Test, TestingModule } from '@nestjs/testing';
import config from '../../config/configurations';
import { EventualityOcrService } from './eventuality-ocr.service';

describe('EventualityOcrService', () => {
  let service: EventualityOcrService;
  let createCompletionMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventualityOcrService,
        {
          provide: config.KEY,
          useValue: {
            env: 'test',
            openrouter: {
              apiKey: 'test-api-key',
            },
          },
        },
      ],
    }).compile();

    service = module.get<EventualityOcrService>(EventualityOcrService);
    createCompletionMock = vi.fn();
    (service as unknown as { openai: { chat: { completions: { create: unknown } } } }).openai = {
      chat: {
        completions: {
          create: createCompletionMock,
        },
      },
    };
  });

  describe('extractMedicalReportData', () => {
    it('should extract all fields from a medical report JSON response', async () => {
      createCompletionMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reportType: 'Informe de Emergencia',
                company: 'Clínica Paraíso',
                doctorFullName: 'María Fernanda Urdaneta',
                doctorIdentityCard: 'V-15888999',
                doctorMs: '77654',
                doctorComezu: '10987',
                doctorSpecialty: 'Medicina Interna',
                admissionDiagnosis: 'Cólico nefrítico derecho',
                medicalReport:
                  'Paciente masculino de 42 años que acude por dolor lumbar intenso irradiado a fosa ilíaca derecha.',
                dischargeDiagnosis: 'Litiasis renal derecha no complicada',
                reportDate: '21/10/2026',
                reportTime: '11:15 AM',
              }),
            },
          },
        ],
      });

      const result = await service.extractMedicalReportData(
        Buffer.from('fake-image-bytes'),
        'image/jpeg',
      );

      expect(createCompletionMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        reportType: 'Informe de Emergencia',
        company: 'Clínica Paraíso',
        doctorFullName: 'María Fernanda Urdaneta',
        doctorIdentityCard: 'V-15888999',
        doctorMs: '77654',
        doctorComezu: '10987',
        doctorSpecialty: 'Medicina Interna',
        admissionDiagnosis: 'Cólico nefrítico derecho',
        medicalReport:
          'Paciente masculino de 42 años que acude por dolor lumbar intenso irradiado a fosa ilíaca derecha.',
        dischargeDiagnosis: 'Litiasis renal derecha no complicada',
        reportDate: '21/10/2026',
        reportTime: '11:15 AM',
      });
    });

    it('should normalize empty or missing fields to null', async () => {
      createCompletionMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '```json\n{"reportType": "  ", "company": "Hospital Clínico"}\n```',
            },
          },
        ],
      });

      const result = await service.extractMedicalReportData(
        'https://s3.amazonaws.com/sirca/report.jpg',
      );

      expect(result.reportType).toBeNull();
      expect(result.company).toBe('Hospital Clínico');
      expect(result.doctorFullName).toBeNull();
      expect(result.doctorComezu).toBeNull();
      expect(result.reportTime).toBeNull();
    });

    it('should send type "file" instead of "image_url" when a PDF buffer or application/pdf mimeType is provided', async () => {
      createCompletionMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reportType: 'Informe Médico de Emergencia',
                company: 'Hospital Coromoto',
              }),
            },
          },
        ],
      });

      const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content');
      const result = await service.extractMedicalReportData(pdfBuffer, 'application/pdf');

      expect(result.reportType).toBe('Informe Médico de Emergencia');
      expect(result.company).toBe('Hospital Coromoto');

      const callArg = createCompletionMock.mock.calls[0][0];
      const userMessageContent = callArg.messages[1].content;
      expect(userMessageContent[1]).toEqual({
        type: 'file',
        file: {
          filename: 'medical-report.pdf',
          file_data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
        },
      });
    });
  });

  describe('extractProviderInvoiceData', () => {
    it('should extract fiscal data from provider invoice JSON response', async () => {
      createCompletionMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                providerName: 'Policlínica San Antonio C.A.',
                providerRif: 'J-30456789-0',
                invoiceNumber: '00045812',
                controlNumber: '00-0045812',
                invoiceDate: '2026-10-22',
                subtotalAmount: 150.5,
                taxAmount: 24.08,
                totalAmount: 174.58,
                currency: 'USD',
              }),
            },
          },
        ],
      });

      const result = await service.extractProviderInvoiceData(
        Buffer.from('fake-invoice-image'),
        'image/jpeg',
      );

      expect(createCompletionMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        providerName: 'Policlínica San Antonio C.A.',
        providerRif: 'J-30456789-0',
        invoiceNumber: '00045812',
        controlNumber: '00-0045812',
        invoiceDate: '2026-10-22',
        subtotalAmount: 150.5,
        taxAmount: 24.08,
        totalAmount: 174.58,
        currency: 'USD',
      });
    });
  });
});
