import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '../../auth/guards/auth.guard';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { EventualityConsultationService } from '../services/eventuality-consultation.service';
import {
  CancelConsultationDto,
  FindDoctorConsultationsCalendarDto,
  RescheduleConsultationDto,
  ScheduleConsultationDto,
} from '../dto/schedule-consultation.dto';

@Controller('eventualities')
export class EventualityConsultationController {
  constructor(private readonly consultationService: EventualityConsultationService) {}

  @Post('consultations')
  @RequirePermissions('create:eventualities', 'create:advisor-payments', 'read:contracts')
  async scheduleConsultation(@Body() dto: ScheduleConsultationDto) {
    return this.consultationService.scheduleConsultation(dto);
  }

  @Patch('consultations/:id/reschedule')
  @RequirePermissions(
    'update:eventualities',
    'create:eventualities',
    'create:advisor-payments',
    'attend:aps',
    'attend:consultations',
  )
  async rescheduleConsultation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleConsultationDto,
  ) {
    return this.consultationService.rescheduleConsultation(id, dto, user?.userId);
  }

  @Patch('consultations/:id/cancel')
  @RequirePermissions(
    'update:eventualities',
    'create:eventualities',
    'create:advisor-payments',
    'attend:aps',
    'attend:consultations',
  )
  async cancelConsultation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelConsultationDto,
  ) {
    return this.consultationService.cancelConsultation(id, dto, user?.userId);
  }

  @Get('doctor/consultations-calendar')
  @RequirePermissions(
    'attend:aps',
    'attend:consultations',
    'audit:medical',
    'read:eventualities',
    'create:advisor-payments',
  )
  async getDoctorConsultationsCalendar(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindDoctorConsultationsCalendarDto,
  ) {
    return this.consultationService.getDoctorConsultationsCalendar(user?.userId, query);
  }
}
