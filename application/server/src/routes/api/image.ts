import { promises as fs } from "fs";
import path from "path";

import { Router } from "express";
import httpErrors from "http-errors";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";

import { UPLOAD_PATH } from "@web-speed-hackathon-2026/server/src/paths";

const EXTENSION = "jpg";

/**
 * EXIF バッファから ImageDescription タグ（0x010E）を抽出する
 */
function extractImageDescription(exifBuffer: Buffer): string {
  try {
    let offset = 0;
    // sharp が返す exif バッファが "Exif\0\0" ヘッダを含む場合はスキップ
    if (exifBuffer.length > 6 && exifBuffer.slice(0, 4).toString("ascii") === "Exif") {
      offset = 6;
    }
    const isLE = exifBuffer.readUInt16BE(offset) === 0x4949; // "II" = little endian
    const r16 = (p: number) => (isLE ? exifBuffer.readUInt16LE(p) : exifBuffer.readUInt16BE(p));
    const r32 = (p: number) => (isLE ? exifBuffer.readUInt32LE(p) : exifBuffer.readUInt32BE(p));

    const ifd0 = offset + r32(offset + 4);
    const count = r16(ifd0);
    for (let i = 0; i < count; i++) {
      const e = ifd0 + 2 + i * 12;
      if (r16(e) !== 0x010e) continue; // ImageDescription
      const byteCount = r32(e + 4);
      const start = byteCount <= 4 ? e + 8 : offset + r32(e + 8);
      return exifBuffer.subarray(start, start + byteCount - 1).toString("utf8");
    }
  } catch {}
  return "";
}

export const imageRouter = Router();

imageRouter.post("/images", async (req, res) => {
  if (req.session.userId === undefined) {
    throw new httpErrors.Unauthorized();
  }
  if (Buffer.isBuffer(req.body) === false) {
    throw new httpErrors.BadRequest();
  }

  // サーバーサイドでJPEGに変換（クライアントWASM不要）
  const converted = await sharp(req.body).jpeg().withMetadata().toBuffer();

  // JPEG に変換後の EXIF から ImageDescription を取得して alt に使用
  const metadata = await sharp(converted).metadata();
  const alt = metadata.exif != null ? extractImageDescription(metadata.exif) : "";

  const imageId = uuidv4();

  const filePath = path.resolve(UPLOAD_PATH, `./images/${imageId}.${EXTENSION}`);
  await fs.mkdir(path.resolve(UPLOAD_PATH, "images"), { recursive: true });
  await fs.writeFile(filePath, converted);

  return res.status(200).type("application/json").send({ id: imageId, alt });
});
