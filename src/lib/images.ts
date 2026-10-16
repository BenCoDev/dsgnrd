// A shared bound for model input and dashboard data URLs. Only PNG is emitted by web tools.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export function isScreenshot(data: string, mimeType: string): boolean {
  if (mimeType !== "image/png" || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== data ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 1600 && height <= 1600;
}

// Mobbin previews can be JPEG as well as PNG. Never accept SVG/HTML in saved images.
export function isReferenceImage(data: string, mimeType: string): boolean {
  if (mimeType === 'image/png') return isScreenshot(data, mimeType);
  if (mimeType !== 'image/jpeg' || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data || bytes.length > MAX_IMAGE_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return false;
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 && width <= 1600 && height <= 1600;
    }
    offset += length;
  }
  return false;
}
