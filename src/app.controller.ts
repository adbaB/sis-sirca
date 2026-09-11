import { Controller, Get, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/decorators';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('debug-sentry')
  getError() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    throw new Error('My first Sentry error!');
  }
}
