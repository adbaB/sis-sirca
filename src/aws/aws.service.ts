import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/configurations';
import { ExternalServiceException, ErrorCode } from '../common/exceptions';
import { withRetry } from '../common/utils/retry.util';

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
    customFilename?: string,
  ): Promise<string> {
    try {
      const bucket = this.configService.aws.s3Bucket;
      if (!bucket) {
        throw new Error('AWS_S3_BUCKET is not configured.');
      }

      const fileExtension = file.originalname.split('.').pop();
      const nameWithoutExt = customFilename || uuidv4();

      const isProduction = process.env.NODE_ENV === 'production';
      const actualFolder = isProduction ? folder : `test/${folder}`;
      const fileName = `${actualFolder}/${nameWithoutExt}.${fileExtension}`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await withRetry(() => this.s3Client.send(command), {
        taskName: 'AWS S3 Upload',
        maxAttempts: 3,
        backoffMs: 200,
        jitter: false,
      });

      // Return the public URL of the uploaded file
      const region = this.configService.aws.region;
      return `https://${bucket}.s3.${region}.amazonaws.com/${fileName}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExternalServiceException(
        'AWS S3',
        `Failed to upload file to S3: ${message}`,
        ErrorCode.AWS_S3_ERROR,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
