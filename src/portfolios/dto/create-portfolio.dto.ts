import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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
  @Max(100)
  @Type(() => Number)
  percentage: number;
}
