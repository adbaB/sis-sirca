import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { marked } from 'marked';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import { PdfService } from '../../pdf/services/pdf.service';
import { loadLogoBase64 } from '../../reports/report-utils';
import { Eventuality } from '../entities/eventuality.entity';
import { EventualityTreatmentItem } from '../entities/eventuality-treatment-item.entity';
import { EventualityServiceRequest } from '../entities/eventuality-service-request.entity';

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

interface PersonNameFallback {
  firstName?: string;
  lastName?: string;
  plan?: { name?: string };
}

@Injectable()
export class EventualityPdfService {
  private readonly logger = new Logger(EventualityPdfService.name);

  constructor(
    @InjectRepository(Eventuality)
    private readonly eventualityRepo: Repository<Eventuality>,
    @InjectRepository(EventualityTreatmentItem)
    private readonly treatmentItemRepo: Repository<EventualityTreatmentItem>,
    @InjectRepository(EventualityServiceRequest)
    private readonly serviceRequestRepo: Repository<EventualityServiceRequest>,
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

  /**
   * Genera el PDF del Informe Médico con diagnósticos CIE-10, contenido Markdown renderizado
   * y firma digital del médico.
   */
  async generateMedicalReportPdf(id: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const eventuality = await this.eventualityRepo.findOne({
      where: isUuid ? { id } : { claimNumber: id },
      relations: [
        'person',
        'contractPerson',
        'contractPerson.contract',
        'contractPerson.plan',
        'contractPerson.person',
        'medicalReport',
        'doctor',
      ],
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con identificador "${id}" no encontrada.`);
    }

    const mr = eventuality.medicalReport;
    const doc = eventuality.doctor;
    const person = eventuality.person;

    const logo = await loadLogoBase64(this.logger);

    const personFallback = person as unknown as PersonNameFallback | undefined;
    const contractPersonFallback = eventuality.contractPerson?.person as unknown as
      PersonNameFallback | undefined;

    const patientName =
      person?.name ||
      [personFallback?.firstName, personFallback?.lastName].filter(Boolean).join(' ') ||
      'Afiliado SIRCA';
    const patientIdCard = person
      ? `${person.typeIdentityCard || 'V'}-${person.identityCard || ''}`
      : 'N/A';
    const contractCode = eventuality.contractPerson?.contract?.code || 'N/A';
    const planName =
      eventuality.contractPerson?.plan?.name ||
      contractPersonFallback?.plan?.name ||
      'Plan de Salud';

    const admissionDate = eventuality.admissionDate
      ? new Date(eventuality.admissionDate)
      : new Date();
    const admissionDateFormatted = DateTime.fromJSDate(admissionDate)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({ dateStyle: 'medium', timeStyle: 'short' });

    const signedAt = mr?.signedAt ? new Date(mr.signedAt) : new Date();
    const signedAtFormatted = DateTime.fromJSDate(signedAt)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({ dateStyle: 'medium', timeStyle: 'short' });

    // Render markdown fields
    const currentIllnessHtml = mr?.currentIllness ? await marked.parse(mr.currentIllness) : '';
    const physicalExamHtml = mr?.physicalExam ? await marked.parse(mr.physicalExam) : '';
    const medicalReportHtml = mr?.medicalReport ? await marked.parse(mr.medicalReport) : '';

    const doctorFullName = doc
      ? `${doc.firstName} ${doc.lastName}`
      : mr?.doctorFullName || 'Médico Tratante';
    const doctorSpecialty = doc?.specialty || mr?.doctorSpecialty || 'Medicina General';
    const doctorIdCard = doc
      ? `${doc.typeIdentityCard || 'V'}-${doc.identityCard}`
      : mr?.doctorIdentityCard || 'N/A';
    const doctorMs = doc?.mpps || mr?.doctorMs || 'N/A';
    const doctorComezu = doc?.comezu || mr?.doctorComezu || null;
    const doctorSignatureUrl = doc?.digitalSignatureUrl || null;

    const primaryCie10Formatted = mr?.primaryCie10Code
      ? `${mr.primaryCie10Code}${mr.admissionDiagnosis ? ` - ${mr.admissionDiagnosis}` : ''}`
      : mr?.admissionDiagnosis || 'No especificado';

    const secondaryCie10List = mr?.secondaryCie10Codes || [];

    const templateData = {
      logo,
      claimNumber: eventuality.claimNumber || 'PENDIENTE',
      patientName,
      patientIdCard,
      contractCode,
      planName,
      clinicName: eventuality.clinicName || 'Centro Médico SIRCA',
      admissionDateFormatted,
      doctorFullName,
      doctorSpecialty,
      doctorIdCard,
      doctorMs,
      doctorComezu,
      doctorSignatureUrl,
      signedAtFormatted,
      primaryCie10Formatted,
      secondaryCie10List,
      reasonForConsultation: mr?.reasonForConsultation || '',
      currentIllnessHtml,
      physicalExamHtml,
      medicalReportHtml,
    };

    const pdfBuffer = await this.pdfService.generatePdf('medical-report', templateData, {
      landscape: false,
      margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' },
      displayHeaderFooter: false,
    });

    const sanitizedClaim = (eventuality.claimNumber || eventuality.id).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    const filename = `informe-medico-${sanitizedClaim}.pdf`;
    return { pdfBuffer, filename };
  }

  /**
   * Genera el PDF del Récipe e Indicaciones Médicas con firma digital.
   */
  async generatePrescriptionPdf(id: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const eventuality = await this.eventualityRepo.findOne({
      where: isUuid ? { id } : { claimNumber: id },
      relations: [
        'person',
        'contractPerson',
        'contractPerson.contract',
        'contractPerson.plan',
        'medicalReport',
        'doctor',
      ],
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con identificador "${id}" no encontrada.`);
    }

    const mr = eventuality.medicalReport;
    const doc = eventuality.doctor;
    const person = eventuality.person;

    const treatmentItems = await this.treatmentItemRepo.find({
      where: { eventualityId: eventuality.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const logo = await loadLogoBase64(this.logger);

    const personFallback = person as unknown as PersonNameFallback | undefined;
    const patientName =
      person?.name ||
      [personFallback?.firstName, personFallback?.lastName].filter(Boolean).join(' ') ||
      'Afiliado SIRCA';
    const patientIdCard = person
      ? `${person.typeIdentityCard || 'V'}-${person.identityCard || ''}`
      : 'N/A';

    const admissionDate = eventuality.admissionDate
      ? new Date(eventuality.admissionDate)
      : new Date();
    const admissionDateFormatted = DateTime.fromJSDate(admissionDate)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({ dateStyle: 'medium', timeStyle: 'short' });

    const signedAt = mr?.signedAt ? new Date(mr.signedAt) : new Date();
    const signedAtFormatted = DateTime.fromJSDate(signedAt)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({ dateStyle: 'medium', timeStyle: 'short' });

    const generalTreatmentNotesHtml = mr?.generalTreatmentNotes
      ? await marked.parse(mr.generalTreatmentNotes)
      : '';

    const doctorFullName = doc
      ? `${doc.firstName} ${doc.lastName}`
      : mr?.doctorFullName || 'Médico Tratante';
    const doctorSpecialty = doc?.specialty || mr?.doctorSpecialty || 'Medicina General';
    const doctorIdCard = doc
      ? `${doc.typeIdentityCard || 'V'}-${doc.identityCard}`
      : mr?.doctorIdentityCard || 'N/A';
    const doctorMs = doc?.mpps || mr?.doctorMs || 'N/A';
    const doctorComezu = doc?.comezu || mr?.doctorComezu || null;
    const doctorSignatureUrl = doc?.digitalSignatureUrl || null;

    const primaryCie10Formatted = mr?.primaryCie10Code
      ? `${mr.primaryCie10Code}${mr.admissionDiagnosis ? ` - ${mr.admissionDiagnosis}` : ''}`
      : mr?.admissionDiagnosis || '';

    const templateData = {
      logo,
      claimNumber: eventuality.claimNumber || 'PENDIENTE',
      patientName,
      patientIdCard,
      admissionDateFormatted,
      doctorFullName,
      doctorSpecialty,
      doctorIdCard,
      doctorMs,
      doctorComezu,
      doctorSignatureUrl,
      signedAtFormatted,
      primaryCie10Formatted,
      treatmentItems,
      generalTreatmentNotesHtml,
    };

    const pdfBuffer = await this.pdfService.generatePdf('prescription', templateData, {
      landscape: false,
      margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' },
      displayHeaderFooter: false,
    });

    const sanitizedClaim = (eventuality.claimNumber || eventuality.id).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    const filename = `recipe-medico-${sanitizedClaim}.pdf`;
    return { pdfBuffer, filename };
  }

  /**
   * Genera el PDF de Órdenes de Servicio y Estudios Médicos con firma digital.
   */
  async generateServiceOrdersPdf(id: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const eventuality = await this.eventualityRepo.findOne({
      where: isUuid ? { id } : { claimNumber: id },
      relations: [
        'person',
        'contractPerson',
        'contractPerson.contract',
        'contractPerson.plan',
        'medicalReport',
        'doctor',
      ],
    });

    if (!eventuality) {
      throw new NotFoundException(`Eventualidad con identificador "${id}" no encontrada.`);
    }

    const mr = eventuality.medicalReport;
    const doc = eventuality.doctor;
    const person = eventuality.person;

    const serviceRequests = await this.serviceRequestRepo.find({
      where: { eventualityId: eventuality.id },
      order: { createdAt: 'ASC' },
    });

    const logo = await loadLogoBase64(this.logger);

    const personFallback = person as unknown as PersonNameFallback | undefined;
    const contractPersonFallback = eventuality.contractPerson?.person as unknown as
      PersonNameFallback | undefined;

    const patientName =
      person?.name ||
      [personFallback?.firstName, personFallback?.lastName].filter(Boolean).join(' ') ||
      'Afiliado SIRCA';
    const patientIdCard = person
      ? `${person.typeIdentityCard || 'V'}-${person.identityCard || ''}`
      : 'N/A';
    const contractCode = eventuality.contractPerson?.contract?.code || 'N/A';
    const planName =
      eventuality.contractPerson?.plan?.name ||
      contractPersonFallback?.plan?.name ||
      'Plan de Salud';

    const admissionDate = eventuality.admissionDate
      ? new Date(eventuality.admissionDate)
      : new Date();
    const admissionDateFormatted = DateTime.fromJSDate(admissionDate)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({ dateStyle: 'medium', timeStyle: 'short' });

    const signedAt = mr?.signedAt ? new Date(mr.signedAt) : new Date();
    const signedAtFormatted = DateTime.fromJSDate(signedAt)
      .setZone(CARACAS_ZONE)
      .setLocale('es-VE')
      .toLocaleString({ dateStyle: 'medium', timeStyle: 'short' });

    const doctorFullName = doc
      ? `${doc.firstName} ${doc.lastName}`
      : mr?.doctorFullName || 'Médico Tratante';
    const doctorSpecialty = doc?.specialty || mr?.doctorSpecialty || 'Medicina General';
    const doctorIdCard = doc
      ? `${doc.typeIdentityCard || 'V'}-${doc.identityCard}`
      : mr?.doctorIdentityCard || 'N/A';
    const doctorMs = doc?.mpps || mr?.doctorMs || 'N/A';
    const doctorComezu = doc?.comezu || mr?.doctorComezu || null;
    const doctorSignatureUrl = doc?.digitalSignatureUrl || null;

    const primaryCie10Formatted = mr?.primaryCie10Code
      ? `${mr.primaryCie10Code}${mr.admissionDiagnosis ? ` - ${mr.admissionDiagnosis}` : ''}`
      : mr?.admissionDiagnosis || '';

    const formattedServiceRequests = serviceRequests.map((sr) => {
      let typeLabel = (sr.requestType as string) || 'Servicio';
      let badgeClass = 'badge';
      switch (sr.requestType) {
        case 'LABORATORY':
          typeLabel = 'Laboratorio';
          badgeClass = 'badge badge-lab';
          break;
        case 'IMAGING':
          typeLabel = 'Imágenes';
          badgeClass = 'badge badge-img';
          break;
        case 'SPECIAL_STUDY':
          typeLabel = 'Estudio Especial';
          badgeClass = 'badge badge-study';
          break;
        case 'CONSULTATION':
          typeLabel = 'Interconsulta';
          badgeClass = 'badge badge-cons';
          break;
        case 'HOSPITALIZATION':
          typeLabel = 'Hospitalización';
          badgeClass = 'badge badge-hosp';
          break;
      }
      return {
        ...sr,
        typeLabel,
        badgeClass,
        isUrgent: sr.priority === 'URGENT',
      };
    });

    const templateData = {
      logo,
      claimNumber: eventuality.claimNumber || 'PENDIENTE',
      patientName,
      patientIdCard,
      contractCode,
      planName,
      admissionDateFormatted,
      doctorFullName,
      doctorSpecialty,
      doctorIdCard,
      doctorMs,
      doctorComezu,
      doctorSignatureUrl,
      signedAtFormatted,
      primaryCie10Formatted,
      serviceRequests: formattedServiceRequests,
    };

    const pdfBuffer = await this.pdfService.generatePdf('service-orders', templateData, {
      landscape: false,
      margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' },
      displayHeaderFooter: false,
    });

    const sanitizedClaim = (eventuality.claimNumber || eventuality.id).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    const filename = `ordenes-servicios-${sanitizedClaim}.pdf`;
    return { pdfBuffer, filename };
  }
}
