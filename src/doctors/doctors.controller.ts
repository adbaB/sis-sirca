import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DoctorsService } from './doctors.service';
import { DoctorScheduleService } from './services/doctor-schedule.service';
import { AuthGuard, type JwtPayload } from '../auth/guards/auth.guard';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';

@UseGuards(AuthGuard)
@Controller('doctors')
export class DoctorsController {
  constructor(
    private readonly doctorsService: DoctorsService,
    private readonly doctorScheduleService: DoctorScheduleService,
  ) {}

  @Get('me')
  async getMyProfile(@CurrentUser() user?: JwtPayload) {
    const userId = user?.userId;
    return this.doctorsService.findDoctorByUserId(userId);
  }

  @Put('me')
  async updateMyProfile(@CurrentUser() user?: JwtPayload, @Body() dto?: Partial<CreateDoctorDto>) {
    const userId = user?.userId;
    const existing = await this.doctorsService.findDoctorByUserId(userId);
    if (existing?.isMedicalAuditor) {
      throw new ForbiddenException(
        'El perfil de Médico Auditor es de solo lectura y no permite editar datos profesionales.',
      );
    }
    return this.doctorsService.updateMyProfile(userId, dto || {});
  }

  @Post('me/signature')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMySignature(
    @CurrentUser() user?: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
    @Body('base64') base64?: string,
  ) {
    const userId = user?.userId;
    const doctor = await this.doctorsService.findDoctorByUserId(userId);
    if (!doctor) {
      throw new Error('Primero debes completar tu perfil médico para guardar tu firma digital.');
    }
    if (doctor.isMedicalAuditor) {
      throw new ForbiddenException(
        'El perfil de Médico Auditor es de solo lectura y no permite registrar firmas digitales.',
      );
    }

    if (file) {
      const url = await this.doctorsService.uploadSignature(doctor.id, file);
      return { digitalSignatureUrl: url };
    }

    if (base64) {
      const url = await this.doctorsService.uploadSignatureBase64(doctor.id, base64);
      return { digitalSignatureUrl: url };
    }

    throw new Error('Debe proporcionar un archivo de imagen o una firma en base64.');
  }

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('specialty') specialty?: string,
    @Query('isActive') isActive?: string,
    @Query('canAttendAps') canAttendAps?: string,
    @Query('canScheduleConsultations') canScheduleConsultations?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.doctorsService.findAll({
      search,
      specialty,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      canAttendAps: canAttendAps !== undefined ? canAttendAps === 'true' : undefined,
      canScheduleConsultations:
        canScheduleConsultations !== undefined ? canScheduleConsultations === 'true' : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id/availability')
  async getDoctorAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.doctorScheduleService.getDoctorAvailability(id, startDate, endDate);
  }

  @Put(':id/schedule-config')
  @RequirePermissions('manage:doctors', 'update:users')
  async updateDoctorScheduleConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDoctorScheduleDto,
  ) {
    return this.doctorScheduleService.updateScheduleConfig(id, dto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctorsService.findOne(id);
  }

  @Post()
  @RequirePermissions('manage:doctors', 'create:users')
  async create(@Body() dto: CreateDoctorDto) {
    return this.doctorsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('manage:doctors', 'update:users')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctorsService.update(id, dto);
  }

  @Post(':id/signature')
  @RequirePermissions('manage:doctors', 'update:users')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDoctorSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('base64') base64?: string,
  ) {
    if (file) {
      const url = await this.doctorsService.uploadSignature(id, file);
      return { digitalSignatureUrl: url };
    }

    if (base64) {
      const url = await this.doctorsService.uploadSignatureBase64(id, base64);
      return { digitalSignatureUrl: url };
    }

    throw new Error('Debe proporcionar un archivo de imagen o una firma en base64.');
  }
}
