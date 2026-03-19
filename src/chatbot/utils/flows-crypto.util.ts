import * as crypto from 'crypto';

/**
 * Utility functions for encrypting and decrypting WhatsApp Flows Data Exchange requests.
 * Complies with Meta's AES-GCM and RSA-OAEP specifications.
 */
export class FlowsCryptoUtil {
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
      Buffer.from(encryptedAesKey, 'base64'),
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
  ): Record<string, any> {
    const ivBuffer = Buffer.from(iv, 'base64');
    if (ivBuffer.length !== 12) {
      throw new Error(`Invalid IV length. Expected 12 bytes, got ${ivBuffer.length}`);
    }

    const payloadBuffer = Buffer.from(encryptedPayload, 'base64');
    const authTagLength = 16;
    if (payloadBuffer.length <= authTagLength) {
      throw new Error('Encrypted payload is too short to contain a valid AES-GCM auth tag.');
    }

    const ciphertext = payloadBuffer.subarray(0, payloadBuffer.length - authTagLength);
    const authTag = payloadBuffer.subarray(payloadBuffer.length - authTagLength);

    const decipher = crypto.createDecipheriv('aes-256-gcm', decryptedAesKey, ivBuffer);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as Record<string, any>;
  }

  /**
   * Encrypts the outgoing response for WhatsApp Flows.
   * @param payloadObj The JSON object to send back.
   * @param decryptedAesKey The raw Buffer of the decrypted AES key.
   * @param iv Base64 encoded IV (will be inverted as per Meta spec).
   * @returns Base64 encoded string containing the encrypted response payload.
   */
  static encryptResponse(
    payloadObj: Record<string, any>,
    decryptedAesKey: Buffer,
    iv: string,
  ): string {
    const ivBuffer = Buffer.from(iv, 'base64');
    if (ivBuffer.length !== 12) {
      throw new Error(`Invalid IV length. Expected 12 bytes, got ${ivBuffer.length}`);
    }

    // Flip the IV per Meta specifications (XOR inverted IV)
    const flippedIv = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) {
      flippedIv[i] = ~ivBuffer[i];
    }

    const cipher = crypto.createCipheriv('aes-256-gcm', decryptedAesKey, flippedIv);

    const jsonString = JSON.stringify(payloadObj);
    const encryptedBuffer = Buffer.concat([cipher.update(jsonString, 'utf8'), cipher.final()]);

    const cipherBuffer = Buffer.concat([encryptedBuffer, cipher.getAuthTag()]);

    return cipherBuffer.toString('base64');
  }
}
