import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { NotFoundException } from '@nestjs/common';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('debug-sentry', () => {
    it('should throw error in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        expect(() => appController.getError()).toThrow('My first Sentry error!');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should throw NotFoundException in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => appController.getError()).toThrow(NotFoundException);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
