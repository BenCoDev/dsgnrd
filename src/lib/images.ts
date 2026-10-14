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
