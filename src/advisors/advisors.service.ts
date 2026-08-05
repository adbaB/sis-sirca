import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { CreateAdvisorDto } from './dto/create-advisor.dto';
import { UpdateAdvisorDto } from './dto/update-advisor.dto';
import { Advisor } from './entities/advisor.entity';
import { EntityNotFoundException } from '../common/exceptions';

@Injectable()
export class AdvisorsService {
  constructor(
    @InjectRepository(Advisor)
    private readonly advisorRepository: Repository<Advisor>,
  ) {}

  create(createAdvisorDto: CreateAdvisorDto) {
    const advisor = this.advisorRepository.create(createAdvisorDto);
    return this.advisorRepository.save(advisor);
  }

  findAll() {
    return this.advisorRepository.find({
      order: {
        codeNumber: 'ASC',
      },
    });
  }

  async findOne(id: string) {
    const advisor = await this.advisorRepository.findOneBy({ id });
    if (!advisor) {
      throw new EntityNotFoundException('Asesor', id);
    }
    return advisor;
  }

  async findByName(name: string): Promise<Advisor | null> {
    if (!name) return null;
    return this.advisorRepository.findOne({
      where: { name: ILike(name.trim()) },
    });
  }

  async searchByName(name: string) {
    if (!name) {
      return [];
    }
    return this.advisorRepository.find({
      where: { name: ILike(`%${name}%`) },
      order: {
        codeNumber: 'ASC',
      },
      take: 20, // Limit results
    });
  }

  async update(id: string, updateAdvisorDto: UpdateAdvisorDto) {
    const advisor = await this.findOne(id);
    this.advisorRepository.merge(advisor, updateAdvisorDto);
    return this.advisorRepository.save(advisor);
  }

  async remove(id: string) {
    const advisor = await this.findOne(id);
    return this.advisorRepository.remove(advisor);
  }
}
