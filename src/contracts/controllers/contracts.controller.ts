import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
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
  create(@Body() createContractDto: CreateContractDto) {
    return this.contractsService.create(createContractDto);
  }

  @Get()
  @RequirePermissions('read:contracts')
  findAll(@Query() query: FindContractDto) {
    return this.contractsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('read:contracts')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
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
