export function isTrustedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const trustedHosts = ['amazonaws.com', 's3.amazonaws.com'];
    return trustedHosts.includes(hostname) || hostname.endsWith('.amazonaws.com');
  } catch {
    return false;
  }
}

export async function fetchSafeImage(
  url: string,
  logger: { warn(msg: string): void },
): Promise<{ contentType: string; base64: string } | null> {
  if (!isTrustedUrl(url)) {
    logger.warn(`[SSRF Blocked] Attempted outbound request to untrusted URL: ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000), // 5 seconds timeout
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';

    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalSize += value.length;
        if (totalSize > MAX_SIZE) {
          await reader.cancel();
          logger.warn(`[Resource Exhaustion Blocked] Image size exceeded limit of 10MB: ${url}`);
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    }

    const buffer = Buffer.concat(chunks);
    const base64 = buffer.toString('base64');
    return { contentType, base64 };
  } catch (err) {
    logger.warn(
      `[fetchSafeImage] Error fetching image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Downloads an image from a URL and returns it as a data URI (base64).
 * Returns null on failure so the template renders without the image.
 */
export async function fetchReceiptAsBase64(
  url: string,
  logger: { warn(msg: string): void },
): Promise<string | null> {
  const result = await fetchSafeImage(url, logger);
  if (!result) return null;
  return `data:${result.contentType};base64,${result.base64}`;
}
