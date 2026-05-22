import { PartialType } from '@nestjs/mapped-types';
import { IsEnum } from 'class-validator';
import { ContractStatus } from '../entities/contract.entity';
import { CreateContractDto } from './create-contract.dto';

export class UpdateContractDto extends PartialType(CreateContractDto) {
  @IsEnum(ContractStatus)
  status?: ContractStatus;
}
