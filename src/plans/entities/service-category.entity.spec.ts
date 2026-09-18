import { ServiceCategory } from './service-category.entity';

describe('ServiceCategory Entity', () => {
  it('should instantiate correctly with assigned properties', () => {
    const category = new ServiceCategory();
    category.id = 'b9a2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
    category.code = 'LAB';
    category.name = 'Laboratorio Clínico';
    category.description = 'Exámenes y análisis clínicos';
    category.isActive = true;
    category.createdAt = new Date('2026-01-01');
    category.updatedAt = new Date('2026-01-02');
    category.deletedAt = null;

    expect(category.id).toBe('b9a2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d');
    expect(category.code).toBe('LAB');
    expect(category.name).toBe('Laboratorio Clínico');
    expect(category.description).toBe('Exámenes y análisis clínicos');
    expect(category.isActive).toBe(true);
    expect(category.deletedAt).toBeNull();
  });

  it('should handle optional fields and relationships', () => {
    const category = new ServiceCategory();
    category.code = 'CONS';
    category.name = 'Consultas Médicas';
    category.medicalServices = [];

    expect(category.medicalServices).toEqual([]);
    expect(category.description).toBeUndefined();
  });
});
