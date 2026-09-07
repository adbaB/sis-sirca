export interface TitularPdfData {
  name: string;
  typeIdentityCard: string;
  identityCard: string;
  birthDateFormatted: string;
  age: number | string;
  weight: number | string;
  height: number | string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  alternatePhone: string;
  email: string;
  occupation: string;
  legalRepresentative: string;
}

export interface BeneficiaryPdfRow {
  index: string;
  name: string;
  typeIdentityCard: string;
  identityCard: string;
  relationship: string;
  birthDateFormatted: string;
  age: number;
  genderLabel: string;
  weight: number | string;
  height: number | string;
  planName: string;
  coverage: string;
}

export interface HealthQuestionPdfItem {
  id: number;
  title: string;
  description: string;
  hasCondition: boolean;
  affectedDetails: string;
}

export interface TitularSummaryRow {
  name: string;
  typeIdentityCard: string;
  identityCard: string;
  age: number;
  planName: string;
  coverage: string;
  monthlyCost: string;
}

export interface BeneficiarySummaryRow {
  name: string;
  typeIdentityCard: string;
  identityCard: string;
  age: number;
  planName: string;
  coverage: string;
  monthlyCost: string;
}

export interface ContractedPlanSummary {
  name: string;
  count: number;
  coverage: string;
  unitCost: string;
  totalCost: string;
}

export interface ContractMember {
  name: string;
  isPN: boolean;
}

export interface ContractPdfTemplateData {
  [key: string]: unknown;
  contractCode: string;
  affiliationDateFormatted: string;
  logoBase64: string;
  titular: TitularPdfData;
  planName: string;
  beneficiaries: BeneficiaryPdfRow[];
  emptyRows: string[];
  healthQuestions: HealthQuestionPdfItem[];
  advisorName: string;
  dayText: string;
  dayNumber: number;
  monthText: string;
  yearNumber: number;
  titularRow: TitularSummaryRow | null;
  beneficiariesRow: BeneficiarySummaryRow[];
  contractedPlansList: ContractedPlanSummary[];
  allMembers: ContractMember[];
}
