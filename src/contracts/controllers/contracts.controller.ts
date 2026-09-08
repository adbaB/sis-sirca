import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import type { JwtPayload } from '../../auth/guards/auth.guard';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { ActivateContractDto } from '../dto/activate-contract.dto';
import { BulkUpdateBeneficiariesDto } from '../dto/bulk-update-beneficiaries.dto';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { GetAffiliationStatsDto } from '../dto/get-affiliation-stats.dto';
import { GetPipelineStatsDto } from '../dto/get-pipeline-stats.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateBeneficiaryDto } from '../dto/update-beneficiary.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { EvaluateHealthExclusionsDto } from '../dto/evaluate-health-exclusions.dto';
import { ContractsService } from '../services/contracts.service';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @RequirePermissions('create:contracts')
  create(@Body() createContractFullDto: CreateContractFullDto) {
    return this.contractsService.createFull(createContractFullDto);
  }

  @Post('evaluate-health-exclusions')
  @RequirePermissions('create:contracts', 'read:contracts')
  evaluateHealthExclusions(@Body() dto: EvaluateHealthExclusionsDto) {
    return this.contractsService.evaluateHealthExclusions(dto);
  }

  @Get()
  @RequirePermissions('read:contracts', 'read:pipeline')
  findAll(@Query() query: FindContractDto) {
    return this.contractsService.findAll(query);
  }

  @Get('pipeline-stats')
  @RequirePermissions('read:contracts', 'read:pipeline')
  getPipelineStats(@Query() query: GetPipelineStatsDto) {
    return this.contractsService.getPipelineStats(query.advisorId, query.month, query.year);
  }

  @Get('affiliation-stats')
  @RequirePermissions('read:contracts')
  getAffiliationStats(@Query() query: GetAffiliationStatsDto) {
    return this.contractsService.getAffiliationStats(
      query.month,
      query.year,
      query.mode ?? 'billing',
    );
  }

  @Get('verify')
  @RequirePermissions('read:contracts', 'read:persons')
  verifyUnified(@Query('q') query?: string) {
    if (!query || !query.trim()) {
      throw new BadRequestException(
        'Debe proporcionar un parámetro de búsqueda "q" (cédula o código de contrato).',
      );
    }
    return this.contractsService.verifyUnified(query);
  }

  @Get('verify/:query')
  @RequirePermissions('read:contracts', 'read:persons')
  verifyUnifiedParam(@Param('query') query: string) {
    return this.contractsService.verifyUnified(query);
  }

  @Get('verify/:type/:number')
  @RequirePermissions('read:contracts', 'read:persons')
  verifyPersonAffiliation(
    @Param('type', new ParseEnumPipe(TypeIdentityCard)) type: TypeIdentityCard,
    @Param('number') number: string,
  ) {
    return this.contractsService.verifyPersonAffiliation(type, number);
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

  @Patch(':id/activate')
  @RequirePermissions('update:contracts')
  activate(
    @Param('id') id: string,
    @Body() dto?: ActivateContractDto,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.contractsService.activate(id, dto, user);
  }

  @Post(':contractId/beneficiaries')
  @RequirePermissions('update:contracts')
  addBeneficiary(
    @Param('contractId') contractId: string,
    @Body() createBeneficiaryDto: CreateBeneficiaryDto,
  ) {
    return this.contractsService.addBeneficiary(contractId, createBeneficiaryDto);
  }

  @Patch(':contractId/beneficiaries')
  @RequirePermissions('update:contracts')
  bulkUpdateBeneficiaries(
    @Param('contractId') contractId: string,
    @Body() bulkDto: BulkUpdateBeneficiariesDto,
  ) {
    return this.contractsService.bulkUpdateBeneficiaries(contractId, bulkDto);
  }

  @Patch(':contractId/beneficiaries/:contractPersonId')
  @RequirePermissions('update:contracts')
  updateBeneficiary(
    @Param('contractId') contractId: string,
    @Param('contractPersonId') contractPersonId: string,
    @Body() updateBeneficiaryDto: UpdateBeneficiaryDto,
  ) {
    return this.contractsService.updateBeneficiary(
      contractId,
      contractPersonId,
      updateBeneficiaryDto,
    );
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
    return this.contractsService.removeAffiliate(contractPersonId, contractId);
  }
}
