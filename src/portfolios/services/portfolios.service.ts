import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { CreatePortfolioDto } from '../dto/create-portfolio.dto';
import { UpdatePortfolioDto } from '../dto/update-portfolio.dto';
import { Portfolio } from '../entities/portfolio.entity';

@Injectable()
export class PortfoliosService {
  constructor(
    @InjectRepository(Portfolio)
    private readonly portfoliosRepository: Repository<Portfolio>,
  ) {}

  async create(createPortfolioDto: CreatePortfolioDto): Promise<Portfolio> {
    const codeTrimmed = createPortfolioDto.code.trim().toUpperCase();
    if (!codeTrimmed) {
      throw new BadRequestException('El código del portafolio no puede estar vacío');
    }
    const existing = await this.portfoliosRepository.findOne({
      where: { code: ILike(codeTrimmed) },
      withDeleted: true,
    });
    if (existing) {
      throw new BadRequestException(
        `El portafolio con código "${createPortfolioDto.code}" ya existe`,
      );
    }

    const portfolio = this.portfoliosRepository.create({
      ...createPortfolioDto,
      code: codeTrimmed,
    });
    return this.portfoliosRepository.save(portfolio);
  }

  async findAll(): Promise<Portfolio[]> {
    return this.portfoliosRepository.find({
      order: { code: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Portfolio> {
    const portfolio = await this.portfoliosRepository.findOne({ where: { id } });
    if (!portfolio) {
      throw new NotFoundException(`Portafolio con ID "${id}" no encontrado`);
    }
    return portfolio;
  }

  async update(id: string, updatePortfolioDto: UpdatePortfolioDto): Promise<Portfolio> {
    const portfolio = await this.findOne(id);

    const { code, ...rest } = updatePortfolioDto;
    Object.assign(portfolio, rest);

    if (code !== undefined) {
      const codeTrimmed = code.trim().toUpperCase();
      if (!codeTrimmed) {
        throw new BadRequestException('El código del portafolio no puede estar vacío');
      }
      if (codeTrimmed !== portfolio.code) {
        const existing = await this.portfoliosRepository.findOne({
          where: { code: ILike(codeTrimmed) },
          withDeleted: true,
        });
        if (existing && existing.id !== id) {
          throw new BadRequestException(`El portafolio con código "${code}" ya existe`);
        }
        portfolio.code = codeTrimmed;
      }
    }

    return this.portfoliosRepository.save(portfolio);
  }

  async remove(id: string): Promise<void> {
    const portfolio = await this.findOne(id);
    await this.portfoliosRepository.softRemove(portfolio);
  }
}
