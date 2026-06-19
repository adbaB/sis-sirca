import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AwsService } from '../aws.service';

@Controller('files')
export class FilesController {
  constructor(private readonly awsService: AwsService) {}

  @Post('upload-receipt')
  @UseInterceptors(FileInterceptor('file'))
  async uploadReceipt(@UploadedFile() file: Express.Multer.File): Promise<string> {
    return this.awsService.uploadFile(file);
  }
}
