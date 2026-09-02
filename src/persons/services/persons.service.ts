import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BulkUpdatePersonsDto } from '../dto/bulk-update-persons.dto';
import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';

const PERSON_FIELDS: (keyof Person)[] = [
  'name',
  'typeIdentityCard',
  'identityCard',
  'birthDate',
  'gender',
  'status',
  'phone',
  'alternatePhone',
  'email',
  'address',
  'city',
  'state',
  'postalCode',
  'weight',
  'height',
  'occupation',
  'legalRepresentative',
];

function extractPersonData(dto: Partial<CreatePersonDto>): Partial<Person> {
  const data: Partial<Person> = {};
  for (const key of PERSON_FIELDS) {
    if (dto[key] !== undefined) {
      (data as Record<string, unknown>)[key] = dto[key];
    }
  }
  return data;
}

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private readonly personsRepository: Repository<Person>,
  ) {}

  async create(createPersonDto: CreatePersonDto): Promise<Person> {
    const existingPerson = await this.findByIdentityCard(
      createPersonDto.identityCard,
      createPersonDto.typeIdentityCard,
    );

    if (existingPerson) {
      return existingPerson;
    }

    const newPerson = this.personsRepository.create(extractPersonData(createPersonDto));
    return this.personsRepository.save(newPerson);
  }

  async findAll(): Promise<Person[]> {
    return this.personsRepository.find();
  }

  async findByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Person | null> {
    return this.personsRepository.findOne({
      where: { identityCard, typeIdentityCard },
    });
  }

  async findOne(id: string): Promise<Person> {
    const person = await this.personsRepository.findOne({
      where: { id },
    });
    if (!person) {
      throw new NotFoundException(`Person with ID "${id}" not found`);
    }
    return person;
  }

  async update(id: string, updatePersonDto: UpdatePersonDto): Promise<Person> {
    const person = await this.findOne(id);

    const targetIdentityCard = updatePersonDto.identityCard ?? person.identityCard;
    const targetTypeIdentityCard = updatePersonDto.typeIdentityCard ?? person.typeIdentityCard;

    if (
      targetIdentityCard !== person.identityCard ||
      targetTypeIdentityCard !== person.typeIdentityCard
    ) {
      const existingPerson = await this.personsRepository.findOne({
        where: { identityCard: targetIdentityCard, typeIdentityCard: targetTypeIdentityCard },
        withDeleted: true,
      });

      if (existingPerson && existingPerson.id !== id) {
        throw new BadRequestException(
          `La cédula o RIF ${targetTypeIdentityCard}-${targetIdentityCard} ya está registrada.`,
        );
      }
    }

    this.personsRepository.merge(person, extractPersonData(updatePersonDto));
    return this.personsRepository.save(person);
  }

  async bulkUpdate(bulkUpdatePersonsDto: BulkUpdatePersonsDto): Promise<void> {
    for (const personData of bulkUpdatePersonsDto.persons) {
      const { id, ...updateData } = personData;
      await this.update(id, updateData);
    }
  }

  async remove(id: string): Promise<void> {
    const person = await this.findOne(id);
    await this.personsRepository.softRemove(person);
  }
}
