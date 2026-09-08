import { ContractPersonExclusion } from './contract-person-exclusion.entity';
import { ExclusionSource } from './exclusion-source.enum';
import { ContractPerson } from './contract-person.entity';
import { MedicalService } from '../../plans/entities/medical-service.entity';
import { ServiceCategory } from '../../plans/entities/service-category.entity';

describe('ContractPersonExclusion Entity', () => {
  it('should have ExclusionSource enum values defined', () => {
    expect(ExclusionSource.AUTOMATIC).toBe('AUTOMATIC');
    expect(ExclusionSource.MANUAL).toBe('MANUAL');
  });

  it('should instantiate with service-level exclusion', () => {
    const cp = new ContractPerson();
    cp.id = 'cp-uuid-1';

    const service = new MedicalService();
    service.id = 'ms-uuid-1';

    const exclusion = new ContractPersonExclusion();
    exclusion.id = 'ex-uuid-1';
    exclusion.contractPerson = cp;
    exclusion.contractPersonId = cp.id;
    exclusion.medicalService = service;
    exclusion.medicalServiceId = service.id;
    exclusion.reason = 'Exclusión automática por patología cardiovascular';
    exclusion.source = ExclusionSource.AUTOMATIC;
    exclusion.createdAt = new Date();
    exclusion.updatedAt = new Date();
    exclusion.deletedAt = null;

    expect(exclusion.id).toBe('ex-uuid-1');
    expect(exclusion.contractPersonId).toBe('cp-uuid-1');
    expect(exclusion.medicalServiceId).toBe('ms-uuid-1');
    expect(exclusion.serviceCategoryId).toBeUndefined();
    expect(exclusion.reason).toContain('cardiovascular');
    expect(exclusion.source).toBe(ExclusionSource.AUTOMATIC);
  });

  it('should instantiate with category-level exclusion and manual source', () => {
    const category = new ServiceCategory();
    category.id = 'cat-uuid-1';

    const exclusion = new ContractPersonExclusion();
    exclusion.contractPersonId = 'cp-uuid-1';
    exclusion.serviceCategory = category;
    exclusion.serviceCategoryId = category.id;
    exclusion.reason = 'Exclusión manual por evaluación médica previa';
    exclusion.source = ExclusionSource.MANUAL;

    expect(exclusion.serviceCategoryId).toBe('cat-uuid-1');
    expect(exclusion.medicalServiceId).toBeUndefined();
    expect(exclusion.source).toBe(ExclusionSource.MANUAL);
  });
});
