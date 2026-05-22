import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { TypeIdentityCard } from '../entities/person.entity';
import { PersonsService } from '../services/persons.service';

@Controller('persons')
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Post()
  @RequirePermissions('create:contracts', 'create:persons')
  create(@Body() createPersonDto: CreatePersonDto) {
    return this.personsService.create(createPersonDto);
  }

  @Get()
  @RequirePermissions('read:contracts', 'read:persons')
  findAll() {
    return this.personsService.findAll();
  }

  @Get('by-identity/:type/:number')
  @RequirePermissions('read:contracts', 'read:persons')
  async findByIdentityCard(
    @Param('type', new ParseEnumPipe(TypeIdentityCard)) type: string,
    @Param('number') number: string,
  ) {
    const person = await this.personsService.findByIdentityCard(number, type as TypeIdentityCard);
    if (!person) {
      throw new NotFoundException(`Person with cedula ${type}-${number} not found`);
    }
    return person;
  }

  @Get(':id')
  @RequirePermissions('read:contracts', 'read:persons')
  findOne(@Param('id') id: string) {
    return this.personsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('update:contracts', 'update:persons')
  update(@Param('id') id: string, @Body() updatePersonDto: UpdatePersonDto) {
    return this.personsService.update(id, updatePersonDto);
  }

  @Delete(':id')
  @RequirePermissions('delete:contracts', 'delete:persons')
  remove(@Param('id') id: string) {
    return this.personsService.remove(id);
  }
}
