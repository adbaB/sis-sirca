import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AwsService } from '../../aws/aws.service';
import { Contract } from '../entities/contract.entity';

@Injectable()
export class ContractAttachmentService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    private readonly awsService: AwsService,
  ) {}

  /**
   * Sube un archivo adjunto a AWS S3 dentro del folder 'contracts'.
   * Retorna la URL pública generada por S3.
   */
  async uploadAttachment(file: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo.');
    }

    const lastDotIndex = file.originalname.lastIndexOf('.');
    const originalNameWithoutExt =
      lastDotIndex !== -1 ? file.originalname.substring(0, lastDotIndex) : file.originalname;
    const cleanName = originalNameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');
    const customFilename = `${Date.now()}-${cleanName}`;

    const url = await this.awsService.uploadFile(file, 'contracts', customFilename);
    return { url };
  }

  /**
   * Sube un archivo adjunto a AWS S3 y lo añade directamente al contrato especificado.
   */
  async addAttachment(
    contractId: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; attachments: string[] }> {
    const contract = await this.contractsRepository.findOne({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException(`Contrato con ID "${contractId}" no encontrado.`);
    }

    const { url } = await this.uploadAttachment(file);

    const currentAttachments = contract.attachments || [];
    const updatedAttachments = [...currentAttachments, url];

    await this.contractsRepository.update(contractId, {
      attachments: updatedAttachments,
    });

    return {
      url,
      attachments: updatedAttachments,
    };
  }
}
