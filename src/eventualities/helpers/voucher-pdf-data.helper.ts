import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import { Eventuality, EventualityType } from '../entities/eventuality.entity';
import { ExtractionStatus } from '../entities/eventuality-extraction-detail.entity';

export interface EventualityVoucherPdfData extends Record<string, unknown> {
  readonly logo: string;
  readonly claimNumber: string;
  readonly isConsultation: boolean;
  readonly headerSubtitle: string;
  readonly headerBadge: string;
  readonly patientName: string;
  readonly patientIdCard: string;
  readonly contractCode: string;
  readonly planName: string;
  readonly clinicName: string;
  readonly admissionDateFormatted: string;
  readonly consultationTitle: string;
  readonly doctorFullName: string;
  readonly doctorSpecialty: string;
  readonly doctorCredentials: string;
  readonly consultationDayFormatted: string;
  readonly consultationTimeFormatted: string;
  readonly reasonLabel: string;
  readonly notes: string;
}

interface PersonNameFallback {
  firstName?: string;
  lastName?: string;
  plan?: { name?: string };
}

export function buildVoucherTemplateData(
  eventuality: Eventuality,
  logo: string,
): EventualityVoucherPdfData {
  const person = eventuality.person;
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
    eventuality.contractPerson?.plan?.name || contractPersonFallback?.plan?.name || 'Plan de Salud';

  const admissionDate = eventuality.admissionDate
    ? new Date(eventuality.admissionDate)
    : new Date();
  const dtCaracas = DateTime.fromJSDate(admissionDate).setZone(CARACAS_ZONE).setLocale('es-VE');

  const admissionDateFormatted = dtCaracas.toLocaleString({
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const consultationDayFormatted = dtCaracas.toFormat("cccc, dd 'de' LLLL 'de' yyyy");
  const consultationTimeFormatted = dtCaracas.toFormat('hh:mm a');

  const isConsultation = eventuality.type === EventualityType.CONSULTATION;
  const doc = eventuality.doctor;
  const mr = eventuality.medicalReport;

  const doctorFullName = doc
    ? `Dr(a). ${doc.firstName} ${doc.lastName}`
    : mr?.doctorFullName
      ? `Dr(a). ${mr.doctorFullName}`
      : 'Por asignar';

  const doctorSpecialty = doc?.specialty || mr?.doctorSpecialty || 'Especialidad Médica';

  const docIdCard = doc
    ? `${doc.typeIdentityCard || 'V'}-${doc.identityCard}`
    : mr?.doctorIdentityCard || '';
  const docMpps = doc?.mpps || mr?.doctorMs || '';
  const docComezu = doc?.comezu || mr?.doctorComezu || '';
  const credentialsParts = [
    docIdCard ? `C.I.: ${docIdCard}` : '',
    docMpps ? `MPPS: ${docMpps}` : '',
    docComezu ? `COMEZU: ${docComezu}` : '',
  ].filter(Boolean);
  const doctorCredentials = credentialsParts.join(' • ');

  const firstServiceItem = (eventuality.extractionDetails || []).find(
    (d) => d.itemName && d.status !== ExtractionStatus.REMOVED,
  );
  const consultationTitle =
    firstServiceItem?.itemName ||
    (doc?.specialty ? `Consulta de ${doc.specialty}` : 'Consulta Médica Especializada');

  return {
    logo,
    claimNumber: eventuality.claimNumber || 'PENDIENTE',
    isConsultation,
    headerSubtitle: isConsultation
      ? 'Orden y Control de Consulta Médica Especializada'
      : 'Apertura y Control de Atención de Emergencias Médicas',
    headerBadge: isConsultation ? 'Orden de Consulta Médica' : 'Comprobante de Ingreso',
    patientName,
    patientIdCard,
    contractCode,
    planName,
    clinicName:
      eventuality.clinicName ||
      (isConsultation && doc
        ? `Consultorio Dr(a). ${doc.firstName} ${doc.lastName}`
        : 'Centro Médico Prestador'),
    admissionDateFormatted,
    consultationTitle,
    doctorFullName,
    doctorSpecialty,
    doctorCredentials,
    consultationDayFormatted,
    consultationTimeFormatted,
    reasonLabel: isConsultation
      ? 'Motivo de la Consulta / Indicaciones'
      : 'Razón de la Emergencia / Motivo de Ingreso',
    notes:
      eventuality.notes ||
      (isConsultation ? consultationTitle : 'Atención de emergencia médica no programada.'),
  };
}
