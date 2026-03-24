import * as crypto from 'crypto';

/**
 * Utility functions for encrypting and decrypting WhatsApp Flows Data Exchange requests.
 * Complies with Meta's AES-GCM and RSA-OAEP specifications.
 */
export class FlowsCryptoUtil {
  // WhatsApp Flows Data Exchange con AES-256-GCM puede venir con nonces/IV de 12 o 16 bytes.
  // Usamos ambos porque el cliente observado envía 16 bytes.
  private static readonly ALLOWED_IV_LENGTHS = new Set<number>([12, 16]);

  private static decodeBase64OrBase64Url(input: string): Buffer {
    // Meta puede enviar strings en base64url (caracteres '-' y '_').
    // Convertimos a base64 estándar y agregamos padding si falta.
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = normalized.length % 4;
    const padded = padLen === 0 ? normalized : normalized + '='.repeat(4 - padLen);
    return Buffer.from(padded, 'base64');
  }

  private static getAesGcmAlgorithmByKeyLength(keyLengthBytes: number): string {
    if (keyLengthBytes === 16) return 'aes-128-gcm';
    if (keyLengthBytes === 32) return 'aes-256-gcm';
    throw new Error(`Invalid AES key length: ${keyLengthBytes} bytes. Expected 16 or 32.`);
  }

  /**
   * Decrypts the AES key using the RSA Private Key.
   * @param encryptedAesKey Base64 encoded encrypted AES key from the client.
   * @param privateKey PEM formatted RSA private key of the server.
   * @param passphrase Optional passphrase for the private key.
   * @returns The raw Buffer of the decrypted AES key.
   */
  static decryptAesKey(encryptedAesKey: string, privateKey: string, passphrase?: string): Buffer {
    return crypto.privateDecrypt(
      {
        key: privateKey,
        passphrase,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      FlowsCryptoUtil.decodeBase64OrBase64Url(encryptedAesKey),
    );
  }

  /**
   * Decrypts the incoming payload from WhatsApp Flows using the decrypted AES key.
   * @param decryptedAesKey The raw Buffer of the decrypted AES key.
   * @param encryptedPayload Base64 encoded encrypted JSON payload.
   * @param iv Base64 encoded Initialization Vector.
   * @returns The decrypted JSON payload object.
   */
  static decryptPayload(
    decryptedAesKey: Buffer,
    encryptedPayload: string,
    iv: string,
  ): Record<string, unknown> {
    const ivBuffer = FlowsCryptoUtil.decodeBase64OrBase64Url(iv);
    if (!FlowsCryptoUtil.ALLOWED_IV_LENGTHS.has(ivBuffer.length)) {
      throw new Error(`Invalid IV length. Expected 12 or 16 bytes, got ${ivBuffer.length}`);
    }

    const payloadBuffer = FlowsCryptoUtil.decodeBase64OrBase64Url(encryptedPayload);
    const authTagLength = 16;
    if (payloadBuffer.length <= authTagLength) {
      throw new Error('Encrypted payload is too short to contain a valid AES-GCM auth tag.');
    }

    const ciphertext = payloadBuffer.subarray(0, payloadBuffer.length - authTagLength);
    const authTag = payloadBuffer.subarray(payloadBuffer.length - authTagLength);

    const algorithm = FlowsCryptoUtil.getAesGcmAlgorithmByKeyLength(decryptedAesKey.length);
    const decipher = crypto.createDecipheriv(
      algorithm,
      decryptedAesKey,
      ivBuffer,
    ) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as Record<string, unknown>;
  }

  /**
   * Encrypts the outgoing response for WhatsApp Flows.
   * @param payloadObj The JSON object to send back.
   * @param decryptedAesKey The raw Buffer of the decrypted AES key.
   * @param iv Base64 encoded IV (will be inverted as per Meta spec).
   * @returns Base64 encoded string containing the encrypted response payload.
   */
  static encryptResponse(
    payloadObj: Record<string, unknown>,
    decryptedAesKey: Buffer,
    iv: string,
  ): string {
    const ivBuffer = FlowsCryptoUtil.decodeBase64OrBase64Url(iv);
    if (!FlowsCryptoUtil.ALLOWED_IV_LENGTHS.has(ivBuffer.length)) {
      throw new Error(`Invalid IV length. Expected 12 or 16 bytes, got ${ivBuffer.length}`);
    }

    // Flip the IV per Meta specifications (XOR inverted IV)
    const flippedIv = Buffer.alloc(ivBuffer.length);
    for (let i = 0; i < ivBuffer.length; i++) {
      // Garantiza el comportamiento de byte (0..255)
      flippedIv[i] = ~ivBuffer[i] & 0xff;
    }

    const algorithm = FlowsCryptoUtil.getAesGcmAlgorithmByKeyLength(decryptedAesKey.length);
    const cipher = crypto.createCipheriv(algorithm, decryptedAesKey, flippedIv) as crypto.CipherGCM;

    const jsonString = JSON.stringify(payloadObj);
    const encryptedBuffer = Buffer.concat([cipher.update(jsonString, 'utf8'), cipher.final()]);

    const cipherBuffer = Buffer.concat([encryptedBuffer, cipher.getAuthTag()]);

    return cipherBuffer.toString('base64');
  }
}
