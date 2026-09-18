import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators';
import { UpdateSystemSettingDto } from './dto/update-system-setting.dto';
import { SystemSettingsService } from './system-settings.service';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get()
  @RequirePermissions('read:system-settings', 'manage:system-settings')
  findAll() {
    return this.systemSettingsService.findAll();
  }

  @Get(':key')
  @RequirePermissions('read:system-settings', 'manage:system-settings')
  findOne(@Param('key') key: string) {
    return this.systemSettingsService.findOne(key);
  }

  @Patch(':key')
  @RequirePermissions('manage:system-settings')
  update(@Param('key') key: string, @Body() dto: UpdateSystemSettingDto) {
    return this.systemSettingsService.update(key, dto);
  }
}
