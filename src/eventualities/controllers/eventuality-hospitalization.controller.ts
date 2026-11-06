import { Body, Controller, Post } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators';
import { EventualitiesService } from '../services/eventualities.service';
import { CreateHospitalizationDto } from '../dto/create-hospitalization.dto';

@Controller('eventualities')
export class EventualityHospitalizationController {
  constructor(private readonly eventualitiesService: EventualitiesService) {}

  @Post('hospitalization')
  @RequirePermissions('create:eventualities')
  async requestHospitalization(@Body() dto: CreateHospitalizationDto) {
    return this.eventualitiesService.requestHospitalization(dto);
  }
}
