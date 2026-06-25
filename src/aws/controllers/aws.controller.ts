import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AwsService } from '../aws.service';

@Controller('files')
export class FilesController {
  constructor(private readonly awsService: AwsService) {}

  @Post('upload-receipt')
  @UseInterceptors(FileInterceptor('file'))
  async uploadReceipt(@UploadedFile() file: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException('No se ha subido ningún archivo.');
    }
    return this.awsService.uploadFile(file);
  }
}
