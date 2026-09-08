import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EntityAlreadyExistsException,
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions';
import { HealthCategory } from '../../contracts/entities/health-declaration.entity';
import { CreateMedicalServiceDto } from '../dto/create-medical-service.dto';
import { UpdateMedicalServiceDto } from '../dto/update-medical-service.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { PlanService } from '../entities/plan-service.entity';
import { ServiceCategory } from '../entities/service-category.entity';

@Injectable()
export class MedicalServicesService {
  constructor(
    @InjectRepository(MedicalService)
    private readonly medicalServiceRepository: Repository<MedicalService>,
    @InjectRepository(ServiceCategory)
    private readonly categoryRepository: Repository<ServiceCategory>,
    @InjectRepository(PlanService)
    private readonly planServiceRepository: Repository<PlanService>,
  ) {}

  async create(createMedicalServiceDto: CreateMedicalServiceDto): Promise<MedicalService> {
    const category = await this.categoryRepository.findOne({
      where: { id: createMedicalServiceDto.categoryId },
    });

    if (!category) {
      throw new EntityNotFoundException('ServiceCategory', createMedicalServiceDto.categoryId);
    }

    const existing = await this.medicalServiceRepository.findOne({
      where: { code: createMedicalServiceDto.code },
    });

    if (existing) {
      throw new EntityAlreadyExistsException('MedicalService', createMedicalServiceDto.code);
    }

    const medicalService = this.medicalServiceRepository.create({
      ...createMedicalServiceDto,
      linkedHealthCategories: createMedicalServiceDto.linkedHealthCategories ?? [],
    });

    return this.medicalServiceRepository.save(medicalService);
  }

  async findAll(): Promise<MedicalService[]> {
    return this.medicalServiceRepository.find({
      relations: { category: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<MedicalService> {
    const service = await this.medicalServiceRepository.findOne({
      where: { id },
      relations: { category: true },
    });

    if (!service) {
      throw new EntityNotFoundException('MedicalService', id);
    }

    return service;
  }

  async update(
    id: string,
    updateMedicalServiceDto: UpdateMedicalServiceDto,
  ): Promise<MedicalService> {
    const service = await this.findOne(id);

    if (
      updateMedicalServiceDto.categoryId &&
      updateMedicalServiceDto.categoryId !== service.categoryId
    ) {
      const category = await this.categoryRepository.findOne({
        where: { id: updateMedicalServiceDto.categoryId },
      });

      if (!category) {
        throw new EntityNotFoundException('ServiceCategory', updateMedicalServiceDto.categoryId);
      }
    }

    if (updateMedicalServiceDto.code && updateMedicalServiceDto.code !== service.code) {
      const existing = await this.medicalServiceRepository.findOne({
        where: { code: updateMedicalServiceDto.code },
      });

      if (existing && existing.id !== id) {
        throw new EntityAlreadyExistsException('MedicalService', updateMedicalServiceDto.code);
      }
    }

    const updated = Object.assign(service, updateMedicalServiceDto);
    return this.medicalServiceRepository.save(updated);
  }

  async remove(id: string): Promise<MedicalService> {
    const service = await this.findOne(id);

    const activePlanCount = await this.planServiceRepository.count({
      where: { medicalServiceId: id },
    });

    if (activePlanCount > 0) {
      throw new InvalidDomainOperationException(
        'No se puede eliminar el servicio médico porque está asociado a planes activos.',
      );
    }

    return this.medicalServiceRepository.softRemove(service);
  }

  async findByHealthCategories(categories: HealthCategory[]): Promise<MedicalService[]> {
    if (!categories || categories.length === 0) {
      return [];
    }

    return this.medicalServiceRepository
      .createQueryBuilder('ms')
      .leftJoinAndSelect('ms.category', 'category')
      .where('ms.is_active = :isActive', { isActive: true })
      .andWhere('ms.linked_health_categories && ARRAY[:...categories]::text[]', {
        categories,
      })
      .orderBy('ms.name', 'ASC')
      .getMany();
  }
}
