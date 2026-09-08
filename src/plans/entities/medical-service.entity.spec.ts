import { HealthCategory } from '../../contracts/entities/health-declaration.entity';
import { MedicalService } from './medical-service.entity';
import { ServiceCategory } from './service-category.entity';

describe('MedicalService Entity', () => {
  it('should instantiate correctly with assigned properties and linked health categories', () => {
    const service = new MedicalService();
    service.id = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
    service.code = 'HEM-01';
    service.name = 'Hematología Completa';
    service.description = 'Perfil hematológico';
    service.categoryId = 'cat-uuid-1';
    service.linkedHealthCategories = [HealthCategory.CARDIOVASCULAR, HealthCategory.ENDOCRINA];
    service.isActive = true;
    service.createdAt = new Date('2026-01-01');
    service.updatedAt = new Date('2026-01-02');
    service.deletedAt = null;

    expect(service.id).toBe('a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d');
    expect(service.code).toBe('HEM-01');
    expect(service.name).toBe('Hematología Completa');
    expect(service.categoryId).toBe('cat-uuid-1');
    expect(service.linkedHealthCategories).toContain(HealthCategory.CARDIOVASCULAR);
    expect(service.linkedHealthCategories).toContain(HealthCategory.ENDOCRINA);
    expect(service.isActive).toBe(true);
  });

  it('should relate to a ServiceCategory', () => {
    const category = new ServiceCategory();
    category.id = 'cat-uuid-1';
    category.code = 'LAB';
    category.name = 'Laboratorio';

    const service = new MedicalService();
    service.code = 'GLUC';
    service.name = 'Glicemia';
    service.category = category;
    service.categoryId = category.id;

    expect(service.category.code).toBe('LAB');
    expect(service.categoryId).toBe('cat-uuid-1');
  });
});
