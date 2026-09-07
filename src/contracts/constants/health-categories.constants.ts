import { HealthCategory } from '../entities/health-declaration.entity';

export interface HealthCategoryMetadata {
  id: number;
  category: HealthCategory;
  title: string;
  description: string;
}

export const HEALTH_CATEGORIES_METADATA: readonly HealthCategoryMetadata[] = [
  {
    id: 1,
    category: HealthCategory.CARDIOVASCULAR,
    title: 'ENFERMEDADES CARDIOVASCULARES',
    description:
      'Hipertensión Arterial, infarto al Miocardio, Arritmia Cardiaca, Aneurisma, Palitaciones, Angina de Pecho, Fiebre Reumática, Arteriosclerosis, Trastornos Valvulares, Tromboflebitis, Varices.',
  },
  {
    id: 2,
    category: HealthCategory.RESPIRATORIA,
    title: 'ENFERMEDADES DE LAS VÍAS RESPIRATORIAS',
    description:
      'Ronquera, tos Persistente, bronquitis, asma, enfisema, tuberculosis, pleuresía, neumonía, bronconeumonía.',
  },
  {
    id: 3,
    category: HealthCategory.DIGESTIVA,
    title: 'ENFERMEDADES DE LAS VÍAS DIGESTIVAS',
    description:
      'Gastritis, Ulceras, Hepatitis, Cirrosis, Hemorroides o similares, Apendicitis, colitis, Litiasis Vesicular, hernias hiatales, fisura anal.',
  },
  {
    id: 4,
    category: HealthCategory.ENDOCRINA,
    title: 'ENFERMEDADES DEL SISTEMA ENDOCRINO',
    description: 'Diabetes, Obesidad, Tiroides, Paratiroides.',
  },
  {
    id: 5,
    category: HealthCategory.OSTEOMUSCULAR,
    title: 'ENFERMEDADES OSTEOMUSCULARES',
    description:
      'Neuritis, Ciática, Reumatismo, Hernias Discales, Artritis, Osteoporosis, Desviación de la Columna Vertebral, Problemas en las Articulaciones.',
  },
  {
    id: 6,
    category: HealthCategory.GENITOURINARIA,
    title: 'ENFERMEDADES GENITO-URINARIAS',
    description:
      'Cálculos u otra alteración en los riñones, vejiga o próstata, prostatitis, varicocele.',
  },
  {
    id: 7,
    category: HealthCategory.PIEL_OJOS_OIDOS,
    title: 'ENFERMEDADES DE LA PIEL, OJOS, OIDOS, NARIZ, GARGANTA',
    description:
      'Desviación del Tabique Nasal, Sinusitis, Amigdalitis, Rinitis, Otitis, Cataratas, Hipertrofia de Cornetes.',
  },
  {
    id: 8,
    category: HealthCategory.CRONICA_TRANSITORIA,
    title: 'ENFERMEDADES TRANSITORIAS CRÓNICAS O ALGÚN DEFECTOS NO MENCIONADOS ANTERIORMENTE',
    description: 'Cualquier otra condición o defecto crónico o transitorio.',
  },
  {
    id: 9,
    category: HealthCategory.GINECOLOGICA,
    title: 'ENFERMEDADES PROPIAS DE LA MUJER',
    description:
      'Fibroma Uterino, Prolapso, Obstrucción en las Trompas, Ovarios Poliquísticos, Patologías Mamarias, Endometriosis.',
  },
  {
    id: 10,
    category: HealthCategory.QUIRURGICA,
    title:
      'LE HA SIDO INDICADA O PRACTICADA ALGUNA INTERVENCIÓN QUIRÚRGICA O SE HA SOMETIDO A TRATAMIENTO MÉDICO POR ALGUNA ENFERMEDAD O LESIÓN ADICIONAL A LAS ANTERIORES',
    description: 'Cualquier cirugía, hospitalización o tratamiento médico adicional.',
  },
  {
    id: 11,
    category: HealthCategory.OTROS,
    title: 'OTROS',
    description: 'Cualquier otra enfermedad o síntoma no especificado (Alergias, asma, etc.).',
  },
] as const;
