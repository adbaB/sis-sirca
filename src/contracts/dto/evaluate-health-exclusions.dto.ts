import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { HealthCategory } from '../entities/health-declaration.entity';
import { HealthDeclarationDto } from './health-declaration.dto';
import { CreateContractPersonExclusionDto } from './create-contract-person-exclusion.dto';
import { ExclusionSource } from '../entities/exclusion-source.enum';

export class EvaluateHealthExclusionsDto {
  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HealthDeclarationDto)
  healthDeclarations: HealthDeclarationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateContractPersonExclusionDto)
  manualExclusions?: CreateContractPersonExclusionDto[];
}

export interface EvaluatedExclusionItem {
  medicalServiceId?: string | null;
  medicalServiceCode?: string;
  medicalServiceName?: string;
  serviceCategoryId?: string | null;
  serviceCategoryName?: string;
  healthCategory?: HealthCategory;
  reason: string;
  source: ExclusionSource;
  isManualOverride: boolean;
  inPlan?: boolean;
}

export interface HealthExclusionEvaluationResult {
  suggestedExclusions: EvaluatedExclusionItem[];
  manualExclusions: EvaluatedExclusionItem[];
  allExclusions: EvaluatedExclusionItem[];
  summary: {
    totalConditionsDeclared: number;
    totalServicesExcluded: number;
    hasManualModifications: boolean;
  };
}
