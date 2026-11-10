import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Doctor } from './entities/doctor.entity';
import { User } from '../users/entities/user.entity';
import { AwsService } from '../aws/aws.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { createSignatureMulterFile } from './helpers/doctor-signature.helper';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly doctorRepo: Repository<Doctor>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly awsService: AwsService,
  ) {}

  async findAll(options: {
    search?: string;
    specialty?: string;
    isActive?: boolean;
    canAttendAps?: boolean;
    canScheduleConsultations?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const qb = this.doctorRepo.createQueryBuilder('doctor');

    if (options.isActive !== undefined) {
      qb.andWhere('doctor.isActive = :isActive', { isActive: options.isActive });
    }

    if (options.canAttendAps !== undefined) {
      qb.andWhere('doctor.canAttendAps = :canAttendAps', {
        canAttendAps: options.canAttendAps,
      });
    }

    if (options.canScheduleConsultations !== undefined) {
      qb.andWhere('doctor.canScheduleConsultations = :canScheduleConsultations', {
        canScheduleConsultations: options.canScheduleConsultations,
      });
    }

    if (options.specialty) {
      qb.andWhere('doctor.specialty ILIKE :specialty', {
        specialty: `%${options.specialty}%`,
      });
    }

    if (options.search) {
      const q = `%${options.search.trim()}%`;
      qb.andWhere(
        '(doctor.firstName ILIKE :q OR doctor.lastName ILIKE :q OR doctor.identityCard ILIKE :q OR doctor.mpps ILIKE :q)',
        { q },
      );
    }

    qb.orderBy('doctor.lastName', 'ASC').addOrderBy('doctor.firstName', 'ASC');
    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    // Map associated users
    const doctorIds = items.map((d) => d.id);
    const userMap = new Map<string, { id: string; email: string }>();
    if (doctorIds.length > 0) {
      const users = await this.userRepo
        .createQueryBuilder('user')
        .where('user.doctorId IN (:...doctorIds)', { doctorIds })
        .select(['user.id', 'user.email', 'user.doctorId'])
        .getMany();
      users.forEach((u) => {
        if (u.doctorId) userMap.set(u.doctorId, { id: u.id, email: u.email });
      });
    }

    const itemsWithUser = items.map((doc) => ({
      ...doc,
      linkedUser: userMap.get(doc.id) || null,
    }));

    return {
      items: itemsWithUser,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<Doctor> {
    const doctor = await this.doctorRepo.findOne({ where: { id } });
    if (!doctor) {
      throw new NotFoundException(`Médico con ID "${id}" no encontrado.`);
    }
    return doctor;
  }

  async findDoctorByUserId(userId: string): Promise<Doctor | null> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['doctor'],
    });
    return user?.doctor || null;
  }

  async create(dto: CreateDoctorDto): Promise<Doctor> {
    const existing = await this.doctorRepo.findOne({
      where: { identityCard: dto.identityCard.trim() },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un médico registrado con la cédula ${dto.identityCard}.`,
      );
    }

    const doctor = this.doctorRepo.create({
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      typeIdentityCard: (dto.typeIdentityCard || 'V').trim().toUpperCase(),
      identityCard: dto.identityCard.trim(),
      graduationDate: dto.graduationDate || null,
      specialty: dto.specialty.trim(),
      mpps: dto.mpps.trim(),
      comezu: dto.comezu?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim().toLowerCase() || null,
      digitalSignatureUrl: dto.digitalSignatureUrl || null,
      isActive: true,
      canAttendAps: dto.canAttendAps !== undefined ? dto.canAttendAps : true,
      canScheduleConsultations:
        dto.canScheduleConsultations !== undefined ? dto.canScheduleConsultations : true,
      isMedicalAuditor: dto.isMedicalAuditor !== undefined ? dto.isMedicalAuditor : false,
    });

    const saved = await this.doctorRepo.save(doctor);

    if (dto.userId) {
      await this.linkUserToDoctor(dto.userId, saved.id);
    }

    return saved;
  }

  async update(id: string, dto: UpdateDoctorDto): Promise<Doctor> {
    const doctor = await this.findOne(id);

    if (dto.identityCard && dto.identityCard.trim() !== doctor.identityCard) {
      const existing = await this.doctorRepo.findOne({
        where: { identityCard: dto.identityCard.trim() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Ya existe un médico registrado con la cédula ${dto.identityCard}.`,
        );
      }
      doctor.identityCard = dto.identityCard.trim();
    }

    if (dto.firstName !== undefined) doctor.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) doctor.lastName = dto.lastName.trim();
    if (dto.typeIdentityCard !== undefined)
      doctor.typeIdentityCard = dto.typeIdentityCard.trim().toUpperCase();
    if (dto.graduationDate !== undefined) doctor.graduationDate = dto.graduationDate || null;
    if (dto.specialty !== undefined) doctor.specialty = dto.specialty.trim();
    if (dto.mpps !== undefined) doctor.mpps = dto.mpps.trim();
    if (dto.comezu !== undefined) doctor.comezu = dto.comezu?.trim() || null;
    if (dto.phone !== undefined) doctor.phone = dto.phone?.trim() || null;
    if (dto.email !== undefined) doctor.email = dto.email?.trim().toLowerCase() || null;
    if (dto.digitalSignatureUrl !== undefined) doctor.digitalSignatureUrl = dto.digitalSignatureUrl;
    if (dto.isActive !== undefined) doctor.isActive = dto.isActive;
    if (dto.canAttendAps !== undefined) doctor.canAttendAps = dto.canAttendAps;
    if (dto.canScheduleConsultations !== undefined)
      doctor.canScheduleConsultations = dto.canScheduleConsultations;
    if (dto.isMedicalAuditor !== undefined) doctor.isMedicalAuditor = dto.isMedicalAuditor;

    const updated = await this.doctorRepo.save(doctor);

    if (dto.userId !== undefined) {
      if (dto.userId) {
        await this.linkUserToDoctor(dto.userId, updated.id);
      } else {
        await this.userRepo.update({ doctorId: updated.id }, { doctorId: null });
      }
    }

    return updated;
  }

  async updateMyProfile(userId: string, dto: Partial<CreateDoctorDto>): Promise<Doctor> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Usuario no encontrado.`);
    }

    if (user.doctorId) {
      return this.update(user.doctorId, dto);
    }

    // Si aún no tiene perfil de médico creado, se crea automáticamente
    if (!dto.firstName || !dto.lastName || !dto.identityCard || !dto.specialty || !dto.mpps) {
      throw new BadRequestException(
        'Faltan campos obligatorios para completar tu perfil médico (Nombre, Apellido, Cédula, Especialidad, MPPS).',
      );
    }

    const created = await this.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      typeIdentityCard: dto.typeIdentityCard || 'V',
      identityCard: dto.identityCard,
      graduationDate: dto.graduationDate,
      specialty: dto.specialty,
      mpps: dto.mpps,
      comezu: dto.comezu,
      phone: dto.phone,
      email: dto.email || user.email,
      digitalSignatureUrl: dto.digitalSignatureUrl,
      userId: user.id,
    });

    return created;
  }

  async linkUserToDoctor(userId: string, doctorId: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${userId}" no encontrado.`);
    }

    // Remove doctorId from any other user that might have had it
    await this.userRepo.update({ doctorId }, { doctorId: null });
    // Assign to this user
    await this.userRepo.update(userId, { doctorId });
  }

  async uploadSignature(doctorId: string, file: Express.Multer.File): Promise<string> {
    const doctor = await this.findOne(doctorId);

    const uploadedUrl = await this.awsService.uploadFile(
      file,
      'doctors/signatures',
      `signature-${doctor.identityCard}-${Date.now()}`,
    );

    doctor.digitalSignatureUrl = uploadedUrl;
    await this.doctorRepo.save(doctor);

    return uploadedUrl;
  }

  async uploadSignatureBase64(doctorId: string, base64Png: string): Promise<string> {
    const doctor = await this.findOne(doctorId);
    const multerFile = createSignatureMulterFile(doctor.identityCard, base64Png);
    return this.uploadSignature(doctorId, multerFile);
  }
}
