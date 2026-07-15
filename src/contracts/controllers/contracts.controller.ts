import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { RequirePermissions } from '../../auth/decorators';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractsService } from '../services/contracts.service';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @RequirePermissions('create:contracts')
  create(@Body() createContractFullDto: CreateContractFullDto) {
    return this.contractsService.createFull(createContractFullDto);
  }

  @Get()
  @RequirePermissions('read:contracts', 'read:pipeline')
  findAll(@Query() query: FindContractDto) {
    return this.contractsService.findAll(query);
  }

  @Get('pipeline-stats')
  @RequirePermissions('read:contracts', 'read:pipeline')
  getPipelineStats(
    @Query('advisorId') advisorId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.contractsService.getPipelineStats(advisorId, month, year);
  }

  @Get('affiliation-stats')
  @RequirePermissions('read:contracts')
  getAffiliationStats(@Query('month') month: string, @Query('year') year: string) {
    const parsedMonth = Number(month);
    const parsedYear = Number(year);

    if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
      throw new BadRequestException('El parámetro month debe ser un número entre 1 y 12.');
    }
    if (isNaN(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
      throw new BadRequestException('El parámetro year debe ser un año de 4 dígitos válido.');
    }

    return this.contractsService.getAffiliationStats(parsedMonth, parsedYear);
  }

  @Get(':id')
  @RequirePermissions('read:contracts', 'read:pipeline')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Get(':id/pdf')
  @RequirePermissions('read:contracts')
  async getContractPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.contractsService.generateContractPdfBuffer(id);
    if (!buffer) {
      throw new NotFoundException('No se pudo generar el PDF del contrato.');
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="contrato-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Patch(':id')
  @RequirePermissions('update:contracts')
  update(@Param('id') id: string, @Body() updateContractDto: UpdateContractDto) {
    return this.contractsService.update(id, updateContractDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:contracts')
  remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }

  @Patch(':id/inactivate')
  @RequirePermissions('update:contracts')
  inactivate(@Param('id') id: string, @Body() dto: InactivateContractDto) {
    return this.contractsService.inactivate(id, dto);
  }

  @Post(':contractId/beneficiaries')
  @RequirePermissions('update:contracts')
  addBeneficiary(
    @Param('contractId') contractId: string,
    @Body() createBeneficiaryDto: CreateBeneficiaryDto,
  ) {
    return this.contractsService.addBeneficiary(contractId, createBeneficiaryDto);
  }

  @Patch(':contractId/set-titular')
  @RequirePermissions('update:contracts')
  setContractTitular(
    @Param('contractId') contractId: string,
    @Body() setContractTitularDto: SetContractTitularDto,
  ) {
    return this.contractsService.setContractTitular(contractId, setContractTitularDto);
  }

  @Patch(':contractId/set-billing-owner')
  @RequirePermissions('update:contracts')
  setBillingOwner(
    @Param('contractId') contractId: string,
    @Body() setBillingOwnerDto: SetBillingOwnerDto,
  ) {
    return this.contractsService.setBillingOwner(contractId, setBillingOwnerDto);
  }

  @Delete(':contractId/beneficiaries/:contractPersonId')
  @RequirePermissions('update:contracts')
  removeBeneficiary(
    @Param('contractId') contractId: string,
    @Param('contractPersonId') contractPersonId: string,
  ) {
    return this.contractsService.removeAffiliate(contractPersonId);
  }
}
