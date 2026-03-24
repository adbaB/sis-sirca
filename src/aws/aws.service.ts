import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/configurations';

@Injectable()
export class AwsService {
  private s3Client: S3Client;

  constructor(
    @Inject(config.KEY)
    private readonly configService: ConfigType<typeof config>,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.aws.region,
      credentials: {
        accessKeyId: this.configService.aws.accessKeyId || '',
        secretAccessKey: this.configService.aws.secretAccessKey || '',
      },
    });
  }

  async uploadFile(
    file: Express.Multer.File | { buffer: Buffer; originalname: string; mimetype: string },
    folder: string = 'receipts',
  ): Promise<string> {
    try {
      const bucket = this.configService.aws.s3Bucket;
      if (!bucket) {
        throw new Error('AWS_S3_BUCKET is not configured.');
      }

      const fileExtension = file.originalname.split('.').pop();
      const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      // Return the public URL of the uploaded file
      const region = this.configService.aws.region;
      return `https://${bucket}.s3.${region}.amazonaws.com/${fileName}`;
    } catch (error) {
      throw new InternalServerErrorException(`Failed to upload file to S3: ${error.message}`);
    }
  }
}
