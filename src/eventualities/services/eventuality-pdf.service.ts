import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import { PdfService } from '../../pdf/services/pdf.service';
import { loadLogoBase64 } from '../../reports/report-utils';
import { Eventuality } from '../entities/eventuality.entity';

export interface EventualityVoucherPdfData extends Record<string, unknown> {
  logo: string;
  claimNumber: string;
  patientName: string;
  patientIdCard: string;
  contractCode: string;
  planName: string;
  clinicName: string;
  admissionDateFormatted: string;
  notes: string;
}

@Injectable()
export class EventualityPdfService {
  private readonly logger = new Logger(EventualityPdfService.name);

  constructor(
    @InjectRepository(Eventuality)
    private readonly eventualityRepo: Repository<Eventuality>,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Genera el PDF del comprobante oficial de siniestro/eventualidad.
   * @param id UUID o número de siniestro
   * @returns Búfer del PDF generado y nombre del archivo
   */
  async generateVoucherPdf(id: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const eventuality = await this.eventualityRepo.findOne({
      where: isUuid ? { id } : { claimNumber: id },
      relations: [
        'person',
        'contractPerson',
        'contractPerson.contract',
        'contractPerson.plan',
        'contractPerson.person',
      ],
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con identificador "${id}" no encontrada.`);
    }

    const logo = await loadLogoBase64(this.logger);

    const person = eventuality.person;
    const patientName =
      person?.name ||
      [
        (person as unknown as { firstName?: string })?.firstName,
        (person as unknown as { lastName?: string })?.lastName,
      ]
        .filter(Boolean)
        .join(' ') ||
      'Afiliado SIRCA';

    const patientIdCard = person
      ? `${person.typeIdentityCard || 'V'}-${person.identityCard || ''}`
      : 'N/A';

    const contractCode = eventuality.contractPerson?.contract?.code || 'N/A';

    const planName =
      eventuality.contractPerson?.plan?.name ||
      (eventuality.contractPerson?.person as { plan?: { name?: string } } | undefined)?.plan
        ?.name ||
      'Plan de Salud';

    const admissionDate = eventuality.admissionDate
      ? new Date(eventuality.admissionDate)
      : new Date();
    const admissionDateFormatted = DateTime.fromJSDate(admissionDate)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({
        dateStyle: 'medium',
        timeStyle: 'short',
      });

    const templateData: EventualityVoucherPdfData = {
      logo,
      claimNumber: eventuality.claimNumber || 'PENDIENTE',
      patientName,
      patientIdCard,
      contractCode,
      planName,
      clinicName: eventuality.clinicName || 'Centro Médico Prestador',
      admissionDateFormatted,
      notes: eventuality.notes || 'Atención de emergencia médica no programada.',
    };

    const pdfBuffer = await this.pdfService.generatePdf('eventuality-voucher', templateData, {
      landscape: false,
      margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' },
      displayHeaderFooter: false,
    });

    const sanitizedClaim = (eventuality.claimNumber || eventuality.id).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );

    const filename = `comprobante-eventualidad-${sanitizedClaim}.pdf`;

    return { pdfBuffer, filename };
  }
}
