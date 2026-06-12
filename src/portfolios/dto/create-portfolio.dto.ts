import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PortfolioStatus } from '../entities/portfolio.entity';
import { Type } from 'class-transformer';

export class CreatePortfolioDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsEnum(PortfolioStatus)
  @IsOptional()
  status?: PortfolioStatus;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  commissionAmount?: number;
}
