import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EntityAlreadyExistsException,
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions';
import { CreateServiceCategoryDto } from '../dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from '../dto/update-service-category.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { ServiceCategory } from '../entities/service-category.entity';

@Injectable()
export class ServiceCategoriesService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categoryRepository: Repository<ServiceCategory>,
    @InjectRepository(MedicalService)
    private readonly medicalServiceRepository: Repository<MedicalService>,
  ) {}

  async create(createCategoryDto: CreateServiceCategoryDto): Promise<ServiceCategory> {
    const existing = await this.categoryRepository.findOne({
      where: { code: createCategoryDto.code },
    });

    if (existing) {
      throw new EntityAlreadyExistsException('ServiceCategory', createCategoryDto.code);
    }

    const category = this.categoryRepository.create(createCategoryDto);
    return this.categoryRepository.save(category);
  }

  async findAll(): Promise<ServiceCategory[]> {
    return this.categoryRepository.find({
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ServiceCategory> {
    const category = await this.categoryRepository.findOne({
      where: { id },
    });

    if (!category) {
      throw new EntityNotFoundException('ServiceCategory', id);
    }

    return category;
  }

  async update(id: string, updateCategoryDto: UpdateServiceCategoryDto): Promise<ServiceCategory> {
    const category = await this.findOne(id);

    if (updateCategoryDto.code && updateCategoryDto.code !== category.code) {
      const existing = await this.categoryRepository.findOne({
        where: { code: updateCategoryDto.code },
      });

      if (existing && existing.id !== id) {
        throw new EntityAlreadyExistsException('ServiceCategory', updateCategoryDto.code);
      }
    }

    const updated = Object.assign(category, updateCategoryDto);
    return this.categoryRepository.save(updated);
  }

  async remove(id: string): Promise<ServiceCategory> {
    const category = await this.findOne(id);

    const activeServicesCount = await this.medicalServiceRepository.count({
      where: { categoryId: id },
    });

    if (activeServicesCount > 0) {
      throw new InvalidDomainOperationException(
        'No se puede eliminar la categoría porque tiene servicios activos asociados.',
      );
    }

    return this.categoryRepository.softRemove(category);
  }
}
