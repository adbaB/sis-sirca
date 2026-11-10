import { describe, expect, it } from 'vitest';
import { createSignatureMulterFile } from './doctor-signature.helper';

describe('createSignatureMulterFile', () => {
  it('debe convertir un string base64 a un objeto Express.Multer.File válido', () => {
    const fakeBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = createSignatureMulterFile('12345678', fakeBase64);

    expect(result.fieldname).toBe('signature');
    expect(result.originalname).toBe('signature-12345678.png');
    expect(result.mimetype).toBe('image/png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.size).toBeGreaterThan(0);
    expect(result.stream).toBeDefined();
  });
});
