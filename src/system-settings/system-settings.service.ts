import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityNotFoundException } from '../common/exceptions';
import { UpdateSystemSettingDto } from './dto/update-system-setting.dto';
import { SystemSetting } from './entities/system-setting.entity';

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);
  private readonly cache = new Map<string, string>();

  constructor(
    @InjectRepository(SystemSetting)
    private readonly repository: Repository<SystemSetting>,
  ) {}

  async findAll(): Promise<SystemSetting[]> {
    return this.repository.find({
      order: { key: 'ASC' },
    });
  }

  async findOne(key: string): Promise<SystemSetting> {
    const setting = await this.repository.findOne({ where: { key } });
    if (!setting) {
      throw new EntityNotFoundException('SystemSetting', key);
    }
    return setting;
  }

  async get(key: string, defaultValue?: string): Promise<string> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const setting = await this.repository.findOne({ where: { key } });
    if (!setting) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new EntityNotFoundException('SystemSetting', key);
    }

    this.cache.set(key, setting.value);
    return setting.value;
  }

  async getNumeric(key: string, defaultValue?: number): Promise<number> {
    try {
      const valStr = await this.get(
        key,
        defaultValue !== undefined ? String(defaultValue) : undefined,
      );
      const num = Number(valStr);
      if (Number.isNaN(num)) {
        this.logger.warn(
          `Valor para la configuración "${key}" ("${valStr}") no es numérico. Usando default.`,
        );
        return defaultValue ?? 0;
      }
      return num;
    } catch {
      return defaultValue ?? 0;
    }
  }

  async update(key: string, dto: UpdateSystemSettingDto): Promise<SystemSetting> {
    const setting = await this.findOne(key);

    setting.value = dto.value;
    if (dto.description !== undefined) {
      setting.description = dto.description;
    }

    const saved = await this.repository.save(setting);
    this.cache.set(key, saved.value);
    return saved;
  }

  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}
