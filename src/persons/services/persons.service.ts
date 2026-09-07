import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { BulkUpdatePersonsDto } from '../dto/bulk-update-persons.dto';
import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';
import { parseBirthDate } from '../../common/utils/date.util';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { resolveQueryRunner } from '../../common/context/request-context';

const PERSON_FIELDS: (keyof Omit<CreatePersonDto, 'birthDate'> & keyof Person)[] = [
  'name',
  'typeIdentityCard',
  'identityCard',
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
  if (dto.birthDate !== undefined) {
    data.birthDate = parseBirthDate(dto.birthDate);
  }
  return data;
}

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private readonly personsRepository: Repository<Person>,
    private readonly dataSource: DataSource,
  ) {}

  async create(createPersonDto: CreatePersonDto, manager?: EntityManager): Promise<Person> {
    const repo = manager ? manager.getRepository(Person) : this.personsRepository;
    const existingPerson = await this.findByIdentityCard(
      createPersonDto.identityCard,
      createPersonDto.typeIdentityCard,
      manager,
      true,
    );

    if (existingPerson) {
      if (existingPerson.deletedAt) {
        await repo.restore(existingPerson.id);
        existingPerson.deletedAt = null as unknown as Date;
        repo.merge(existingPerson, extractPersonData(createPersonDto));
        return repo.save(existingPerson);
      }
      return existingPerson;
    }

    const newPerson = repo.create(extractPersonData(createPersonDto));
    return repo.save(newPerson);
  }

  async findAll(manager?: EntityManager): Promise<Person[]> {
    const repo = manager ? manager.getRepository(Person) : this.personsRepository;
    return repo.find();
  }

  async findByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
    manager?: EntityManager,
    withDeleted = false,
  ): Promise<Person | null> {
    const repo = manager ? manager.getRepository(Person) : this.personsRepository;
    return repo.findOne({
      where: { identityCard, typeIdentityCard },
      ...(withDeleted ? { withDeleted: true } : {}),
    });
  }

  async findOne(id: string, manager?: EntityManager): Promise<Person> {
    const repo = manager ? manager.getRepository(Person) : this.personsRepository;
    const person = await repo.findOne({
      where: { id },
    });
    if (!person) {
      throw new NotFoundException(`Person with ID "${id}" not found`);
    }
    return person;
  }

  async update(
    id: string,
    updatePersonDto: UpdatePersonDto,
    manager?: EntityManager,
  ): Promise<Person> {
    const repo = manager ? manager.getRepository(Person) : this.personsRepository;
    const person = await this.findOne(id, manager);

    const targetIdentityCard = updatePersonDto.identityCard ?? person.identityCard;
    const targetTypeIdentityCard = updatePersonDto.typeIdentityCard ?? person.typeIdentityCard;

    if (
      targetIdentityCard !== person.identityCard ||
      targetTypeIdentityCard !== person.typeIdentityCard
    ) {
      const existingPerson = await repo.findOne({
        where: { identityCard: targetIdentityCard, typeIdentityCard: targetTypeIdentityCard },
        withDeleted: true,
      });

      if (existingPerson && existingPerson.id !== id) {
        throw new BadRequestException(
          `La cédula o RIF ${targetTypeIdentityCard}-${targetIdentityCard} ya está registrada.`,
        );
      }
    }

    repo.merge(person, extractPersonData(updatePersonDto));
    return repo.save(person);
  }

  @Transactional()
  async bulkUpdate(bulkUpdatePersonsDto: BulkUpdatePersonsDto): Promise<void> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    for (const personData of bulkUpdatePersonsDto.persons) {
      const { id, ...updateData } = personData;
      await this.update(id, updateData, manager);
    }
  }

  async remove(id: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Person) : this.personsRepository;
    const person = await this.findOne(id, manager);
    await repo.softRemove(person);
  }
}
