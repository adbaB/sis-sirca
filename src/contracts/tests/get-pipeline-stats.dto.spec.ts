import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetPipelineStatsDto } from '../dto/get-pipeline-stats.dto';

describe('GetPipelineStatsDto Validation', () => {
  it('should pass when neither month nor year is provided (cumulative mode)', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass when both month and year are valid', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      month: '08',
      year: '2026',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.month).toBe(8);
    expect(dto.year).toBe(2026);
  });

  it('should fail when month is provided without year (one-sided)', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      month: '5',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const yearError = errors.find((e) => e.property === 'year');
    expect(yearError).toBeDefined();
    expect(yearError?.constraints?.isNotEmpty).toBeDefined();
  });

  it('should fail when year is provided without month (one-sided)', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      year: '2026',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const monthError = errors.find((e) => e.property === 'month');
    expect(monthError).toBeDefined();
    expect(monthError?.constraints?.isNotEmpty).toBeDefined();
  });

  it('should fail when month is out of range (> 12)', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      month: '13',
      year: '2026',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const monthError = errors.find((e) => e.property === 'month');
    expect(monthError?.constraints?.max).toBeDefined();
  });

  it('should fail when month is out of range (< 1)', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      month: '0',
      year: '2026',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const monthError = errors.find((e) => e.property === 'month');
    expect(monthError?.constraints?.min).toBeDefined();
  });

  it('should fail when year is out of range (< 1900)', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      month: '5',
      year: '1850',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const yearError = errors.find((e) => e.property === 'year');
    expect(yearError?.constraints?.min).toBeDefined();
  });

  it('should fail when month or year are not numbers', async () => {
    const dto = plainToInstance(GetPipelineStatsDto, {
      month: 'agosto',
      year: 'veinteveinte',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
