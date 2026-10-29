import {
  Body,
  Controller,
  Get,
  Param,
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
import { AuthGuard, type JwtPayload } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';

@UseGuards(AuthGuard)
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get('me')
  async getMyProfile(@CurrentUser() user?: JwtPayload) {
    const userId = user?.userId;
    return this.doctorsService.findDoctorByUserId(userId);
  }

  @Put('me')
  async updateMyProfile(@CurrentUser() user?: JwtPayload, @Body() dto?: Partial<CreateDoctorDto>) {
    const userId = user?.userId;
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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.doctorsService.findAll({
      search,
      specialty,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.doctorsService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateDoctorDto) {
    return this.doctorsService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctorsService.update(id, dto);
  }

  @Post(':id/signature')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDoctorSignature(
    @Param('id') id: string,
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
