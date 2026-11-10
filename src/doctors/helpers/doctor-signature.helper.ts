import { Readable } from 'node:stream';

export function createSignatureMulterFile(
  identityCard: string,
  base64Png: string,
): Express.Multer.File {
  const cleanBase64 = base64Png.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  return {
    fieldname: 'signature',
    originalname: `signature-${identityCard}.png`,
    encoding: '7bit',
    mimetype: 'image/png',
    buffer,
    size: buffer.length,
    stream: new Readable({
      read() {
        this.push(buffer);
        this.push(null);
      },
    }),
    destination: '',
    filename: '',
    path: '',
  };
}
