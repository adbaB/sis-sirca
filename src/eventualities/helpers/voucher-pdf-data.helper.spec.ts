import { describe, expect, it } from 'vitest';
import { buildVoucherTemplateData } from './voucher-pdf-data.helper';
import { Eventuality, EventualityStatus, EventualityType } from '../entities/eventuality.entity';

describe('buildVoucherTemplateData', () => {
  it('includes consultation title, doctor full name and consultation day when type is CONSULTATION', () => {
    const evt = {
      id: 'evt-cons-1',
      claimNumber: '2026000888',
      type: EventualityType.CONSULTATION,
      status: EventualityStatus.SCHEDULED,
      admissionDate: new Date('2026-11-16T12:00:00.000Z'), // 08:00 America/Caracas
      clinicName: 'Consultorio Cardiológico SIRCA',
      notes: 'Evaluación preoperatoria cardiovascular',
      person: {
        name: 'Ana Martínez',
        typeIdentityCard: 'V',
        identityCard: '15222333',
      },
      contractPerson: {
        contract: { code: 'SIR-100' },
        plan: { name: 'Plan Plus' },
      },
      doctor: {
        firstName: 'Carlos',
        lastName: 'Rivas',
        typeIdentityCard: 'V',
        identityCard: '9888777',
        specialty: 'Cardiología',
        mpps: '54321',
        comezu: '11223',
      },
      extractionDetails: [],
    } as unknown as Eventuality;

    const data = buildVoucherTemplateData(evt, 'data:image/png;base64,xxx');

    expect(data.isConsultation).toBe(true);
    expect(data.consultationTitle).toBe('Consulta de Cardiología');
    expect(data.doctorFullName).toBe('Dr(a). Carlos Rivas');
    expect(data.doctorSpecialty).toBe('Cardiología');
    expect(data.doctorCredentials).toContain('MPPS: 54321');
    expect(data.consultationDayFormatted).toContain('16');
    expect(data.consultationTimeFormatted).toContain('08:00');
  });
});
