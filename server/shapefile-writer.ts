// @ts-ignore
import archiver from "archiver";
// @ts-ignore
import iconv from "iconv-lite";
import { PassThrough } from "stream";

interface Feature {
  geometryType: string;
  coordinates: any;
  properties: Record<string, unknown>;
}

interface ShapefileResult {
  shp: Buffer;
  shx: Buffer;
  dbf: Buffer;
  prj: string;
  cpg: string;
}

const SHP_HEADER_SIZE = 100;
const SHX_HEADER_SIZE = 100;
const DBF_HEADER_SIZE = 32;
const DBF_FIELD_SIZE = 32;

const SHP_NULL = 0;
const SHP_POINT = 1;
const SHP_POLYLINE = 3;
const SHP_POLYGON = 5;

function getShapeType(geometryType: string): number {
  switch (geometryType) {
    case "Point":
    case "MultiPoint":
      return SHP_POINT;
    case "LineString":
    case "MultiLineString":
      return SHP_POLYLINE;
    case "Polygon":
    case "MultiPolygon":
      return SHP_POLYGON;
    default:
      return SHP_NULL;
  }
}

function flattenCoordinates(geometryType: string, coordinates: any): { parts: number[][]; rings: number[][][] } {
  switch (geometryType) {
    case "Point":
      return { parts: [], rings: [[coordinates]] };
    case "LineString":
      return { parts: [[0]], rings: [coordinates.map((c: number[]) => c)] };
    case "MultiLineString":
      {
        const parts: number[][] = [];
        const allCoords: number[][] = [];
        let offset = 0;
        for (const line of coordinates) {
          parts.push([offset]);
          for (const coord of line) {
            allCoords.push(coord);
          }
          offset += line.length;
        }
        return { parts: parts.map(p => p), rings: [allCoords] };
      }
    case "Polygon":
      {
        const parts: number[] = [];
        const allCoords: number[][] = [];
        let offset = 0;
        for (const ring of coordinates) {
          parts.push(offset);
          for (const coord of ring) {
            allCoords.push(coord);
          }
          offset += ring.length;
        }
        return { parts: [parts], rings: [allCoords] };
      }
    case "MultiPolygon":
      {
        const parts: number[] = [];
        const allCoords: number[][] = [];
        let offset = 0;
        for (const polygon of coordinates) {
          for (const ring of polygon) {
            parts.push(offset);
            for (const coord of ring) {
              allCoords.push(coord);
            }
            offset += ring.length;
          }
        }
        return { parts: [parts], rings: [allCoords] };
      }
    default:
      return { parts: [], rings: [[]] };
  }
}

function getBbox(features: Feature[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const f of features) {
    visitCoords(f.geometryType, f.coordinates, (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  }

  if (!isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

function visitCoords(geometryType: string, coordinates: any, fn: (x: number, y: number) => void) {
  switch (geometryType) {
    case "Point":
      fn(coordinates[0], coordinates[1]);
      break;
    case "LineString":
      for (const c of coordinates) fn(c[0], c[1]);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const ring of coordinates) for (const c of ring) fn(c[0], c[1]);
      break;
    case "MultiPolygon":
      for (const poly of coordinates) for (const ring of poly) for (const c of ring) fn(c[0], c[1]);
      break;
  }
}

function writeInt32BE(buf: Buffer, val: number, offset: number) {
  buf.writeInt32BE(val, offset);
}

function writeInt32LE(buf: Buffer, val: number, offset: number) {
  buf.writeInt32LE(val, offset);
}

function writeDoubleLE(buf: Buffer, val: number, offset: number) {
  buf.writeDoubleLE(val, offset);
}

function collectFieldInfo(features: Feature[]): { name: string; type: "C" | "N" | "F" | "L"; size: number; decimal: number }[] {
  const fieldMap = new Map<string, { type: "C" | "N" | "F" | "L"; maxLen: number; hasDecimal: boolean }>();

  for (const f of features) {
    if (!f.properties) continue;
    for (const [key, val] of Object.entries(f.properties)) {
      if (key === "id") continue;
      const existing = fieldMap.get(key);
      if (val === null || val === undefined) {
        if (!existing) fieldMap.set(key, { type: "C", maxLen: 1, hasDecimal: false });
        continue;
      }

      const strVal = String(val);
      const len = iconv.encode(strVal, "cp1251").length;

      if (typeof val === "boolean") {
        if (!existing) fieldMap.set(key, { type: "L", maxLen: 1, hasDecimal: false });
      } else if (typeof val === "number") {
        const hasDecimal = !Number.isInteger(val);
        if (!existing) {
          fieldMap.set(key, { type: hasDecimal ? "F" : "N", maxLen: Math.max(len, 10), hasDecimal });
        } else {
          existing.maxLen = Math.max(existing.maxLen, len, 10);
          if (hasDecimal) {
            existing.type = "F";
            existing.hasDecimal = true;
          }
        }
      } else {
        if (!existing) {
          fieldMap.set(key, { type: "C", maxLen: Math.max(len, 1), hasDecimal: false });
        } else {
          existing.type = "C";
          existing.maxLen = Math.max(existing.maxLen, len);
        }
      }
    }
  }

  const fields: { name: string; type: "C" | "N" | "F" | "L"; size: number; decimal: number }[] = [];
  for (const [name, info] of Array.from(fieldMap.entries())) {
    let fieldName = name.substring(0, 10);
    let size: number;
    let decimal = 0;

    switch (info.type) {
      case "C":
        size = Math.min(Math.max(info.maxLen, 1), 254);
        break;
      case "N":
        size = Math.min(Math.max(info.maxLen, 10), 18);
        break;
      case "F":
        size = Math.min(Math.max(info.maxLen, 10), 18);
        decimal = 6;
        break;
      case "L":
        size = 1;
        break;
      default:
        size = Math.min(info.maxLen, 254);
    }

    fields.push({ name: fieldName, type: info.type, size, decimal });
  }

  return fields;
}

function buildShp(features: Feature[], shapeType: number): { shp: Buffer; shx: Buffer } {
  const bbox = getBbox(features);
  const recordBuffers: Buffer[] = [];
  const shxRecords: Buffer[] = [];
  let offset = SHP_HEADER_SIZE / 2;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    let contentBuf: Buffer;

    if (shapeType === SHP_POINT) {
      contentBuf = Buffer.alloc(20);
      writeInt32LE(contentBuf, SHP_POINT, 0);
      const coords = f.geometryType === "Point" ? f.coordinates : f.coordinates[0];
      writeDoubleLE(contentBuf, coords[0], 4);
      writeDoubleLE(contentBuf, coords[1], 12);
    } else {
      const allPoints: number[][] = [];
      const parts: number[] = [];

      if (f.geometryType === "LineString") {
        parts.push(0);
        for (const c of f.coordinates) allPoints.push(c);
      } else if (f.geometryType === "MultiLineString") {
        let off = 0;
        for (const line of f.coordinates) {
          parts.push(off);
          for (const c of line) allPoints.push(c);
          off += line.length;
        }
      } else if (f.geometryType === "Polygon") {
        let off = 0;
        for (const ring of f.coordinates) {
          parts.push(off);
          for (const c of ring) allPoints.push(c);
          off += ring.length;
        }
      } else if (f.geometryType === "MultiPolygon") {
        let off = 0;
        for (const poly of f.coordinates) {
          for (const ring of poly) {
            parts.push(off);
            for (const c of ring) allPoints.push(c);
            off += ring.length;
          }
        }
      }

      let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
      for (const p of allPoints) {
        if (p[0] < fMinX) fMinX = p[0];
        if (p[1] < fMinY) fMinY = p[1];
        if (p[0] > fMaxX) fMaxX = p[0];
        if (p[1] > fMaxY) fMaxY = p[1];
      }

      const contentSize = 4 + 32 + 4 + 4 + parts.length * 4 + allPoints.length * 16;
      contentBuf = Buffer.alloc(contentSize);
      let pos = 0;
      writeInt32LE(contentBuf, shapeType, pos); pos += 4;
      writeDoubleLE(contentBuf, fMinX, pos); pos += 8;
      writeDoubleLE(contentBuf, fMinY, pos); pos += 8;
      writeDoubleLE(contentBuf, fMaxX, pos); pos += 8;
      writeDoubleLE(contentBuf, fMaxY, pos); pos += 8;
      writeInt32LE(contentBuf, parts.length, pos); pos += 4;
      writeInt32LE(contentBuf, allPoints.length, pos); pos += 4;
      for (const p of parts) {
        writeInt32LE(contentBuf, p, pos); pos += 4;
      }
      for (const pt of allPoints) {
        writeDoubleLE(contentBuf, pt[0], pos); pos += 8;
        writeDoubleLE(contentBuf, pt[1], pos); pos += 8;
      }
    }

    const recordHeader = Buffer.alloc(8);
    writeInt32BE(recordHeader, i + 1, 0);
    writeInt32BE(recordHeader, contentBuf.length / 2, 4);

    const shxRecord = Buffer.alloc(8);
    writeInt32BE(shxRecord, offset, 0);
    writeInt32BE(shxRecord, contentBuf.length / 2, 4);

    recordBuffers.push(recordHeader, contentBuf);
    shxRecords.push(shxRecord);

    offset += (8 + contentBuf.length) / 2;
  }

  const shpFileLength = offset;
  const shpHeader = Buffer.alloc(SHP_HEADER_SIZE);
  writeInt32BE(shpHeader, 9994, 0);
  writeInt32BE(shpHeader, shpFileLength, 24);
  writeInt32LE(shpHeader, 1000, 28);
  writeInt32LE(shpHeader, shapeType, 32);
  writeDoubleLE(shpHeader, bbox[0], 36);
  writeDoubleLE(shpHeader, bbox[1], 44);
  writeDoubleLE(shpHeader, bbox[2], 52);
  writeDoubleLE(shpHeader, bbox[3], 60);

  const shxFileLength = (SHX_HEADER_SIZE + shxRecords.length * 8) / 2;
  const shxHeader = Buffer.alloc(SHX_HEADER_SIZE);
  writeInt32BE(shxHeader, 9994, 0);
  writeInt32BE(shxHeader, shxFileLength, 24);
  writeInt32LE(shxHeader, 1000, 28);
  writeInt32LE(shxHeader, shapeType, 32);
  writeDoubleLE(shxHeader, bbox[0], 36);
  writeDoubleLE(shxHeader, bbox[1], 44);
  writeDoubleLE(shxHeader, bbox[2], 52);
  writeDoubleLE(shxHeader, bbox[3], 60);

  const shp = Buffer.concat([shpHeader, ...recordBuffers]);
  const shx = Buffer.concat([shxHeader, ...shxRecords]);

  return { shp, shx };
}

function buildDbf(features: Feature[], fields: { name: string; type: "C" | "N" | "F" | "L"; size: number; decimal: number }[]): Buffer {
  const numRecords = features.length;
  const recordSize = 1 + fields.reduce((sum, f) => sum + f.size, 0);
  const headerSize = DBF_HEADER_SIZE + fields.length * DBF_FIELD_SIZE + 1;

  const header = Buffer.alloc(headerSize);
  header[0] = 0x03;
  header[29] = 0xC9;
  const now = new Date();
  header[1] = now.getFullYear() - 1900;
  header[2] = now.getMonth() + 1;
  header[3] = now.getDate();
  writeInt32LE(header, numRecords, 4);
  header.writeUInt16LE(headerSize, 8);
  header.writeUInt16LE(recordSize, 10);

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const fieldOffset = DBF_HEADER_SIZE + i * DBF_FIELD_SIZE;
    const nameBytes = iconv.encode(field.name, "cp1251");
    nameBytes.copy(header, fieldOffset, 0, Math.min(nameBytes.length, 11));
    header[fieldOffset + 11] = field.type.charCodeAt(0);
    header[fieldOffset + 16] = field.size;
    header[fieldOffset + 17] = field.decimal;
  }
  header[headerSize - 1] = 0x0D;

  const records: Buffer[] = [];
  for (const f of features) {
    const rec = Buffer.alloc(recordSize, 0x20);
    rec[0] = 0x20;
    let pos = 1;
    for (const field of fields) {
      const val = f.properties?.[field.name];
      let strVal: string;

      if (val === null || val === undefined) {
        strVal = "";
      } else if (field.type === "L") {
        strVal = val ? "T" : "F";
      } else if (field.type === "N" || field.type === "F") {
        if (typeof val === "number") {
          strVal = field.type === "F" ? val.toFixed(field.decimal) : String(val);
        } else {
          strVal = String(val);
        }
      } else {
        strVal = String(val);
      }

      const valBuf = iconv.encode(strVal, "cp1251");
      const copyLen = Math.min(valBuf.length, field.size);
      if (field.type === "N" || field.type === "F") {
        const padded = Buffer.alloc(field.size, 0x20);
        valBuf.copy(padded, field.size - copyLen, 0, copyLen);
        padded.copy(rec, pos);
      } else {
        valBuf.copy(rec, pos, 0, copyLen);
      }
      pos += field.size;
    }
    records.push(rec);
  }

  const eof = Buffer.from([0x1A]);
  return Buffer.concat([header, ...records, eof]);
}

const WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

export async function exportShapefile(
  features: Feature[],
  layerName: string,
  geometryType: string
): Promise<Buffer> {
  const shapeType = getShapeType(geometryType);
  const fields = collectFieldInfo(features);
  const { shp, shx } = buildShp(features, shapeType);
  const dbf = buildDbf(features, fields);
  const prj = WGS84_PRJ;
  const cpg = "CP1251";

  const safeName = layerName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, "_");

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    archive.pipe(passthrough);

    archive.append(shp, { name: `${safeName}.shp` });
    archive.append(shx, { name: `${safeName}.shx` });
    archive.append(dbf, { name: `${safeName}.dbf` });
    archive.append(prj, { name: `${safeName}.prj` });
    archive.append(cpg, { name: `${safeName}.cpg` });

    archive.finalize();
  });
}
