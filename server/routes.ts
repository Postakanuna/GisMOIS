import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncSensors, testSensorConnection, restartSensorPolling, stopSensorPolling, setDebugMode } from "./sensor-sync";
import { zuluConnectionSchema, insertTicketSchema, insertEditableLayerSchema, insertDrawnFeatureSchema, attributeFieldSchema, styleConfigSchema, networkTypeSchema, drawnFeatures, editableLayers, type AttributeField } from "@shared/schema";
import * as turf from "@turf/turf";
import ExcelJS from "exceljs";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, seedAdminUser, isAuthenticated, isAdmin, type AuthRequest } from "./auth";
import { isApiAuthenticated, generateApiToken, hashApiToken, type ApiAuthenticatedRequest } from "./auth/api-auth";
import { externalCreatePointSchema, apiKeys, geocodeProviderSchema, auditLog, type GeocodeProvider, bugReportStatusEnum } from "@shared/schema";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq, and, sql, inArray, desc, gte, lte, count } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import { geocodeBatch, reverseGeocodeBatch, type ReverseGeocodeBatchItem } from "./geocoder";
import path from "path";
import os from "os";
import { parseShapefileBuffer, simplifyFeatureGeometry, getSimplifyTolerance, samplePointFeatures } from "./shapefile-parser";
import { transformPropertyKeys } from "@shared/field-labels";
import { refreshFieldLabelsCache } from "./field-labels-cache";
import { searchObjectsForRAG, getLayersSummaryForContext, detectAndFetchLayerData, getReconstructionProgramsForContext, invalidateLayersCache } from "./ai-rag";
import { logAction } from "./audit";
import crypto from "crypto";

const VIEWPORT_CACHE_MAX = 200;
const VIEWPORT_CACHE_TTL_MS = 30_000;

function parseIntParam(value: string | undefined, res: Response): number | null {
  const n = parseInt(value ?? "", 10);
  if (isNaN(n)) {
    res.status(400).json({ message: "Некорректный параметр ID" });
    return null;
  }
  return n;
}

const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB
const LARGE_EXCEL_THRESHOLD = 50 * 1024 * 1024; // 50MB

const uploadRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_UPLOADS = 5;

function checkUploadRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = uploadRateLimits.get(userId) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_UPLOADS) {
    uploadRateLimits.set(userId, recent);
    return false;
  }
  recent.push(now);
  uploadRateLimits.set(userId, recent);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of uploadRateLimits.entries()) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) uploadRateLimits.delete(userId);
    else uploadRateLimits.set(userId, recent);
  }
}, 5 * 60_000);

function validateShapefileBuffer(buffer: Buffer): { valid: boolean; error?: string } {
  if (buffer.length < 4) {
    return { valid: false, error: "Файл слишком мал для шейпфайла" };
  }

  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
  const shpMagic = buffer.readUInt32BE(0);
  const isShp = shpMagic === 9994;

  if (!isZip && !isShp) {
    return { valid: false, error: "Файл не является ZIP-архивом или SHP-файлом" };
  }

  if (isZip) {
    let hasShp = false;
    let offset = 0;
    while (offset < buffer.length - 30) {
      if (buffer[offset] === 0x50 && buffer[offset + 1] === 0x4B &&
          buffer[offset + 2] === 0x03 && buffer[offset + 3] === 0x04) {
        const fnLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);
        if (offset + 30 + fnLen <= buffer.length) {
          const fileName = buffer.toString("utf8", offset + 30, offset + 30 + fnLen).toLowerCase();
          if (fileName.endsWith(".shp")) {
            hasShp = true;
            break;
          }
        }
        const compressedSize = buffer.readUInt32LE(offset + 18);
        offset += 30 + fnLen + extraLen + compressedSize;
      } else {
        break;
      }
    }
    if (!hasShp) {
      return { valid: false, error: "ZIP-архив не содержит SHP-файлов. Загрузите архив с шейпфайлом (.shp, .dbf, .shx)" };
    }
  }

  return { valid: true };
}

interface ViewportCacheEntry {
  data: any;
  etag: string;
  createdAt: number;
}

const viewportCache = new Map<string, ViewportCacheEntry>();

function viewportCacheGet(key: string): ViewportCacheEntry | undefined {
  const entry = viewportCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > VIEWPORT_CACHE_TTL_MS) {
    viewportCache.delete(key);
    return undefined;
  }
  return entry;
}

function viewportCacheSet(key: string, data: any): ViewportCacheEntry {
  if (viewportCache.size >= VIEWPORT_CACHE_MAX) {
    const oldest = viewportCache.keys().next().value;
    if (oldest) viewportCache.delete(oldest);
  }
  const json = JSON.stringify(data);
  const etag = crypto.createHash("md5").update(json).digest("hex").slice(0, 16);
  const entry: ViewportCacheEntry = { data, etag, createdAt: Date.now() };
  viewportCache.set(key, entry);
  return entry;
}

function invalidateViewportCache() {
  viewportCache.clear();
}

function normalizeSvgForColorSupport(svgContent: string): string {
  let svg = svgContent;

  const svgTagMatch = svg.match(/<svg([^>]*)>/i);
  if (svgTagMatch) {
    let attrs = svgTagMatch[1];
    const hasViewBox = /viewBox/i.test(attrs);
    if (!hasViewBox) {
      const wMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
      const hMatch = attrs.match(/\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i);
      if (wMatch && hMatch) {
        attrs += ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`;
      } else {
        attrs += ` viewBox="0 0 24 24"`;
      }
    }

    attrs = attrs.replace(/\bwidth\s*=\s*["'][^"']*["']/gi, '');
    attrs = attrs.replace(/\bheight\s*=\s*["'][^"']*["']/gi, '');
    attrs += ` width="24" height="24"`;

    svg = svg.replace(/<svg[^>]*>/i, `<svg${attrs}>`);
  }

  const preserveColors = new Set(["none", "transparent", "currentcolor", "{color}"]);
  function shouldPreserveColor(value: string): boolean {
    const trimmed = value.trim().toLowerCase();
    if (preserveColors.has(trimmed)) return true;
    if (trimmed.startsWith("url(")) return true;
    return false;
  }

  svg = svg.replace(/(fill|stroke)\s*=\s*"([^"]*)"/gi, (match, prop, value) => {
    if (shouldPreserveColor(value)) return match;
    return `${prop}="currentColor"`;
  });

  svg = svg.replace(/(fill|stroke)\s*:\s*([^;}"']+)/gi, (match, prop, value) => {
    if (shouldPreserveColor(value)) return match;
    return `${prop}: currentColor`;
  });

  svg = svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (styleMatch, cssContent) => {
    const replaced = cssContent.replace(/(fill|stroke)\s*:\s*([^;}"']+)/gi, (_: string, prop: string, value: string) => {
      if (shouldPreserveColor(value)) return `${prop}: ${value}`;
      return `${prop}: currentColor`;
    });
    return styleMatch.replace(cssContent, replaced);
  });

  return svg;
}

const uploadDir = path.join(os.tmpdir(), "gis-uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage: diskStorage,
  limits: { 
    fileSize: 1024 * 1024 * 1024, // 1GB limit
    fieldSize: 1024 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".zip" || ext === ".shp") {
      cb(null, true);
    } else {
      cb(new Error("Only .zip and .shp files are allowed"));
    }
  },
});

const excelUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB limit for Excel files
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".xls" || ext === ".xlsx") {
      cb(null, true);
    } else {
      cb(new Error("Only .xls and .xlsx files are allowed"));
    }
  },
});

const screenshotUploadDir = path.join(os.tmpdir(), "gis-bug-screenshots");
if (!fs.existsSync(screenshotUploadDir)) {
  fs.mkdirSync(screenshotUploadDir, { recursive: true });
}

const screenshotStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, screenshotUploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const screenshotUpload = multer({
  storage: screenshotStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const ZULU_USERNAME = process.env.ZULU_USERNAME || "";
const ZULU_PASSWORD = process.env.ZULU_PASSWORD || "";
const DEFAULT_ZWS_BASE_URL = "https://is.arki.mosreg.ru/zws";

function getFeatureBounds(coordinates: any, geometryType: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!coordinates) return null;
  
  const allCoords: number[][] = [];
  
  function extractCoords(coords: any): void {
    if (typeof coords[0] === 'number') {
      allCoords.push(coords as number[]);
    } else if (Array.isArray(coords)) {
      coords.forEach(extractCoords);
    }
  }
  
  extractCoords(coordinates);
  
  if (allCoords.length === 0) return null;
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allCoords.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  
  return { minX, minY, maxX, maxY };
}

function normalizeGeometryType(type: string): "Point" | "LineString" | "Polygon" {
  if (type.includes("Polygon") || type === "MultiPolygon") return "Polygon";
  if (type.includes("Line") || type === "MultiLineString") return "LineString";
  return "Point";
}

async function getUserFromSession(req: Request): Promise<{ id: string; role: string } | null> {
  if (!req.session.userId) {
    return null;
  }
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, req.session.userId), eq(users.isActive, "true")));
  return user || null;
}

function getBasicAuthHeader(): string {
  const credentials = Buffer.from(`${ZULU_USERNAME}:${ZULU_PASSWORD}`).toString("base64");
  return `Basic ${credentials}`;
}

// ============================================================
// ZWS Helper Functions
// ============================================================

function xmlEscape(str: string): string {
  return String(str).replace(/[<>&"']/g, (c: string) =>
    (({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" } as Record<string, string>)[c] || c)
  );
}

function zwsXmlWrap(innerXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<zulu-server service="zws" version="1.0.0">\n  <Command>\n${innerXml}\n  </Command>\n</zulu-server>`;
}

async function zwsPost(
  baseUrl: string,
  command: string,
  xmlBody: string,
  timeoutMs = 30000
): Promise<{ text: string; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/${command}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Authorization: getBasicAuthHeader(),
      },
      body: xmlBody,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await response.text();
    return { text, ok: response.ok, status: response.status };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      const e: any = new Error("ZWS request timeout");
      e.isTimeout = true;
      throw e;
    }
    throw err;
  }
}

function parseZwsRetVal(xml: string): number {
  const m = xml.match(/<RetVal>(-?\d+)<\/RetVal>/);
  return m ? parseInt(m[1], 10) : -999;
}

function parseZwsLayerList(xml: string): Array<{ name: string; title: string }> {
  const layers: Array<{ name: string; title: string }> = [];
  // Try <Name>…</Name> … <Title>…</Title>
  const re1 = /<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<Title>([^<]*)<\/Title>[\s\S]*?<\/Layer>/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(xml)) !== null) {
    layers.push({ name: m[1].trim(), title: (m[2] || m[1]).trim() });
  }
  if (layers.length === 0) {
    // Try reversed order: <Title> before <Name>
    const re2 = /<Layer[^>]*>[\s\S]*?<Title>([^<]*)<\/Title>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<\/Layer>/gi;
    while ((m = re2.exec(xml)) !== null) {
      layers.push({ name: m[2].trim(), title: (m[1] || m[2]).trim() });
    }
  }
  if (layers.length === 0) {
    // Minimal: just Name
    const re3 = /<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<\/Layer>/gi;
    while ((m = re3.exec(xml)) !== null) {
      layers.push({ name: m[1].trim(), title: m[1].trim() });
    }
  }
  return layers;
}

function parseZwsBaseInfo(xml: string): { fields: Array<{ name: string; userName: string; type: string }> } {
  const fields: Array<{ name: string; userName: string; type: string }> = [];
  const re = /<Field>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<UserName>([^<]*)<\/UserName>[\s\S]*?<Type>([^<]+)<\/Type>[\s\S]*?<\/Field>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    fields.push({ name: m[1].trim(), userName: m[2].trim(), type: m[3].trim() });
  }
  return { fields };
}

// ============================================================

async function migrateUploadsTable() {
  try {
    await db.execute(sql`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS layer_id INTEGER`);
    await db.execute(sql`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS total_features INTEGER`);
    await db.execute(sql`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS processed_features INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS scene_id INTEGER`);
    await db.execute(sql`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS color TEXT`);
    if (process.env.NODE_ENV !== "production") console.log("[Migration] uploads table columns OK");
  } catch (error) {
    console.error("[Migration] uploads table error:", error);
  }
}

async function backfillBboxColumns() {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM drawn_features WHERE bbox_min_x IS NULL`);
    const count = Number((result as any).rows?.[0]?.cnt || 0);
    if (count === 0) {
      if (process.env.NODE_ENV !== "production") console.log("[Bbox Backfill] All features already have bbox values");
      return;
    }
    if (process.env.NODE_ENV !== "production") console.log(`[Bbox Backfill] Backfilling ${count} features...`);
    const batchSize = 500;
    let processed = 0;
    while (processed < count) {
      const rows = await db.execute(sql`SELECT id, coordinates, geometry_type FROM drawn_features WHERE bbox_min_x IS NULL LIMIT ${batchSize}`);
      const features = (rows as any).rows || [];
      if (features.length === 0) break;
      for (const f of features) {
        const coords = typeof f.coordinates === 'string' ? JSON.parse(f.coordinates) : f.coordinates;
        const bbox = getFeatureBounds(coords, f.geometry_type);
        if (bbox) {
          await db.execute(sql`UPDATE drawn_features SET bbox_min_x = ${bbox.minX}, bbox_min_y = ${bbox.minY}, bbox_max_x = ${bbox.maxX}, bbox_max_y = ${bbox.maxY} WHERE id = ${f.id}`);
        }
      }
      processed += features.length;
      if (process.env.NODE_ENV !== "production") console.log(`[Bbox Backfill] ${processed}/${count} features processed`);
    }
    if (process.env.NODE_ENV !== "production") console.log("[Bbox Backfill] Complete");
  } catch (error) {
    console.error("[Bbox Backfill] Error:", error);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Health check endpoint for deployment - must respond quickly
  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  setupAuth(app);
  registerAuthRoutes(app);
  await seedAdminUser();

  app.post("/api/editable-layers/clear-viewport-cache", isAuthenticated as any, (_req: Request, res: Response) => {
    invalidateViewportCache();
    res.json({ ok: true });
  });

  migrateUploadsTable();
  backfillBboxColumns();

  app.post("/api/zulu/zws/layers", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const xml = zwsXmlWrap("    <GetLayerList/>");
      const { text, ok, status } = await zwsPost(DEFAULT_ZWS_BASE_URL, "GetLayerList", xml, 15000);
      if (!ok) {
        console.error("ZWS GetLayerList error:", text.slice(0, 300));
        return res.status(status).json({ message: "ZWS GetLayerList failed", details: text.slice(0, 500) });
      }
      const retVal = parseZwsRetVal(text);
      if (retVal < 0) {
        console.error("ZWS GetLayerList retVal:", retVal, text.slice(0, 300));
        return res.status(502).json({ message: `ZWS error: RetVal=${retVal}`, raw: text.slice(0, 500) });
      }
      const layers = parseZwsLayerList(text);
      return res.json({ layers, version: "1.0.0", connected: true });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "ZWS request timeout" });
      console.error("ZWS layers error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/zulu/zws/custom/layers", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { baseUrl } = req.body;
      if (!baseUrl) return res.status(400).json({ message: "URL сервера обязателен" });

      const xml = zwsXmlWrap("    <GetLayerList/>");
      const { text, ok, status } = await zwsPost(baseUrl, "GetLayerList", xml, 15000);
      if (!ok) {
        console.error("Custom ZWS GetLayerList error:", text.slice(0, 300));
        return res.status(status).json({ message: "ZWS GetLayerList failed", details: text.slice(0, 500) });
      }
      const retVal = parseZwsRetVal(text);
      if (retVal < 0) {
        return res.status(502).json({ message: `ZWS error: RetVal=${retVal}`, raw: text.slice(0, 500) });
      }
      const layers = parseZwsLayerList(text);
      return res.json({ layers, version: "1.0.0", baseUrl, connected: true });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "ZWS request timeout" });
      console.error("Custom ZWS layers error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/zulu/zws/query", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, query, crs, baseUrl, bbox } = req.body;
      if (!layer) return res.status(400).json({ message: "Layer is required" });

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;
      const projection = crs || "EPSG:4326";

      let command: string;
      let innerXml: string;

      if (bbox && bbox.minx !== undefined && bbox.miny !== undefined && bbox.maxx !== undefined && bbox.maxy !== undefined) {
        // Spatial filtering via LayerIntersectByBox
        command = "LayerIntersectByBox";
        const bboxCrs = bbox.crs || projection;
        innerXml = `    <LayerIntersectByBox>
      <Layer>${xmlEscape(layer)}</Layer>
      <CRS>${xmlEscape(bboxCrs)}</CRS>
      <BoundingBox CRS="${xmlEscape(bboxCrs)}" minx="${bbox.minx}" miny="${bbox.miny}" maxx="${bbox.maxx}" maxy="${bbox.maxy}"/>
      <Geometry>Yes</Geometry>
      <Attr>Yes</Attr>
    </LayerIntersectByBox>`;
      } else {
        // Full attribute query via LayerExecSQL
        command = "LayerExecSQL";
        const sqlQuery = query || "SELECT *, Geometry.AsText()";
        innerXml = `    <LayerExecSql>
      <Layer>${xmlEscape(layer)}</Layer>
      <Query>${xmlEscape(sqlQuery)}</Query>
      <CRS>${xmlEscape(projection)}</CRS>
    </LayerExecSql>`;
      }

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, command, xml, 60000);

      if (!ok) {
        console.error("ZWS query error:", text.slice(0, 300));
        return res.status(status).json({ message: "ZWS query failed", details: text.slice(0, 500) });
      }

      return res.json({ raw: text, layer, command, success: true });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Query timeout" });
      console.error("ZWS query error:", error);
      return res.status(502).json({ message: "Failed to execute ZWS query" });
    }
  });

  app.get("/api/zulu/zws/status", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const hasCredentials = ZULU_USERNAME && ZULU_PASSWORD;
      if (!hasCredentials) {
        return res.json({ configured: false, message: "ZWS credentials not configured" });
      }
      return res.json({ configured: true, baseUrl: DEFAULT_ZWS_BASE_URL, username: ZULU_USERNAME });
    } catch (error) {
      console.error("ZWS status error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/zulu/zws/tile/:z/:x/:y", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { z, x, y } = req.params;
      const { layer, baseUrl } = req.query as { layer?: string; baseUrl?: string };

      if (!layer) {
        return res.status(400).json({ message: "Layer parameter is required" });
      }

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;
      const innerXml = `    <GetLayerTile>
      <X>${x}</X>
      <Y>${y}</Y>
      <Z>${z}</Z>
      <Layer>${xmlEscape(layer)}</Layer>
    </GetLayerTile>`;

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, "GetLayerTile", xml, 30000);

      if (!ok) {
        console.error("ZWS tile error:", status, text.substring(0, 200));
        return res.status(status).json({ message: `ZWS tile error: ${status}` });
      }

      // If the response is XML (error), return JSON error
      if (text.trimStart().startsWith("<?xml") || text.trimStart().startsWith("<")) {
        return res.status(502).json({ message: "ZWS returned XML instead of image", raw: text.slice(0, 300) });
      }

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "max-age=3600");
      return res.send(Buffer.from(text, "binary"));
    } catch (error: any) {
      if (error.isTimeout) {
        return res.status(504).json({ message: "ZWS tile request timeout" });
      }
      console.error("ZWS tile error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
  
  // ---- ZWS: Layer schema (GetLayerBaseInfo) ----
  app.get("/api/zulu/zws/layer-info", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, baseUrl } = req.query as { layer?: string; baseUrl?: string };
      if (!layer) return res.status(400).json({ message: "Layer is required" });

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;
      const innerXml = `    <GetLayerBaseInfo>\n      <Layer>${xmlEscape(layer)}</Layer>\n    </GetLayerBaseInfo>`;
      const xml = zwsXmlWrap(innerXml);

      const { text, ok, status } = await zwsPost(zwsBaseUrl, "GetLayerBaseInfo", xml, 15000);
      if (!ok) {
        return res.status(status).json({ message: "ZWS GetLayerBaseInfo failed", raw: text.slice(0, 500) });
      }
      const info = parseZwsBaseInfo(text);
      return res.json({ ...info, success: true });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Request timeout" });
      console.error("ZWS layer info error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ---- ZWS: Spatial features query (LayerIntersectByBox) ----
  app.post("/api/zulu/zws/features", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, bbox, crs, baseUrl } = req.body;
      if (!layer) return res.status(400).json({ message: "Layer is required" });
      if (!bbox || bbox.minx === undefined || bbox.miny === undefined || bbox.maxx === undefined || bbox.maxy === undefined) {
        return res.status(400).json({ message: "bbox with minx/miny/maxx/maxy is required" });
      }

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;
      const bboxCrs = bbox.crs || crs || "EPSG:4326";

      const innerXml = `    <LayerIntersectByBox>
      <Layer>${xmlEscape(layer)}</Layer>
      <CRS>${xmlEscape(bboxCrs)}</CRS>
      <BoundingBox CRS="${xmlEscape(bboxCrs)}" minx="${bbox.minx}" miny="${bbox.miny}" maxx="${bbox.maxx}" maxy="${bbox.maxy}"/>
      <Geometry>Yes</Geometry>
      <Attr>Yes</Attr>
    </LayerIntersectByBox>`;

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, "LayerIntersectByBox", xml, 60000);

      if (!ok) {
        console.error("ZWS features error:", text.slice(0, 300));
        return res.status(status).json({ message: "ZWS LayerIntersectByBox failed", details: text.slice(0, 500) });
      }

      return res.json({ raw: text, layer, success: true });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Query timeout" });
      console.error("ZWS features error:", error);
      return res.status(502).json({ message: "Failed to query ZWS features" });
    }
  });

  // ---- ZWS: Create element (LayerAddPolyline / LayerAddSymbol / LayerAddPolygon) ----
  app.post("/api/zulu/zws/element", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, geometryType, typeId, modeNum, coordinates, crs, baseUrl } = req.body;
      if (!layer || typeId === undefined || modeNum === undefined || !coordinates || !geometryType) {
        return res.status(400).json({ message: "layer, geometryType, typeId, modeNum, coordinates are required" });
      }

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;
      const projection = crs || "EPSG:4326";

      // Build coordinate string: [[lon,lat], ...] or [lon, lat]
      const coordsStr = Array.isArray(coordinates[0])
        ? (coordinates as number[][]).map((c) => `${c[0]},${c[1]}`).join("\n")
        : `${coordinates[0]},${coordinates[1]}`;

      let command: string;
      let innerXml: string;

      if (geometryType === "Point") {
        command = "LayerAddSymbol";
        const lx = Array.isArray(coordinates[0]) ? coordinates[0][0] : coordinates[0];
        const ly = Array.isArray(coordinates[0]) ? coordinates[0][1] : coordinates[1];
        innerXml = `    <LayerAddSymbol>
      <Layer>${xmlEscape(layer)}</Layer>
      <TypeID>${typeId}</TypeID>
      <ModeNum>${modeNum}</ModeNum>
      <X>${lx}</X>
      <Y>${ly}</Y>
      <CRS>${xmlEscape(projection)}</CRS>
    </LayerAddSymbol>`;
      } else if (geometryType === "Polygon") {
        command = "LayerAddPolygon";
        innerXml = `    <LayerAddPolygon>
      <Layer>${xmlEscape(layer)}</Layer>
      <TypeID>${typeId}</TypeID>
      <ModeNum>${modeNum}</ModeNum>
      <CRS>${xmlEscape(projection)}</CRS>
      <coordinates>${coordsStr}</coordinates>
    </LayerAddPolygon>`;
      } else {
        command = "LayerAddPolyline";
        innerXml = `    <LayerAddPolyline>
      <Layer>${xmlEscape(layer)}</Layer>
      <TypeID>${typeId}</TypeID>
      <ModeNum>${modeNum}</ModeNum>
      <CRS>${xmlEscape(projection)}</CRS>
      <coordinates>${coordsStr}</coordinates>
    </LayerAddPolyline>`;
      }

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, command, xml, 30000);

      if (!ok) {
        console.error("ZWS create element error:", text.slice(0, 300));
        return res.status(status).json({ message: "ZWS create element failed", details: text.slice(0, 500) });
      }

      const retVal = parseZwsRetVal(text);
      if (retVal < 0) {
        return res.status(502).json({ message: `ZWS error: RetVal=${retVal}`, raw: text.slice(0, 500) });
      }

      // On success, RetVal contains the new element ID
      return res.json({ elemId: retVal, success: true });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Request timeout" });
      console.error("ZWS create element error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ---- ZWS: Update element attributes (UpdateElemAttributes) ----
  app.put("/api/zulu/zws/element/attributes", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, elemId, fields, baseUrl } = req.body;
      if (!layer || elemId === undefined || !fields || typeof fields !== "object") {
        return res.status(400).json({ message: "layer, elemId, fields (object) are required" });
      }

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;

      const fieldXml = Object.entries(fields)
        .map(
          ([name, value]) =>
            `        <Field>\n          <Name>${xmlEscape(name)}</Name>\n          <Value>${xmlEscape(String(value ?? ""))}</Value>\n        </Field>`
        )
        .join("\n");

      const innerXml = `    <UpdateElemAttributes>
      <Layer>${xmlEscape(layer)}</Layer>
      <Element>
        <Key>
          <Name>Sys</Name>
          <Value>${elemId}</Value>
        </Key>
${fieldXml}
      </Element>
    </UpdateElemAttributes>`;

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, "UpdateElemAttributes", xml, 30000);

      if (!ok) {
        return res.status(status).json({ message: "ZWS UpdateElemAttributes failed", details: text.slice(0, 500) });
      }

      const retVal = parseZwsRetVal(text);
      if (retVal !== 0) {
        return res.status(502).json({ message: `ZWS error: RetVal=${retVal}`, raw: text.slice(0, 500) });
      }

      return res.json({ success: true, elemId });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Request timeout" });
      console.error("ZWS update attributes error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ---- ZWS: Update element geometry (LayerUpdateGeometry) ----
  app.put("/api/zulu/zws/element/geometry", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, elemId, coordinates, crs, baseUrl } = req.body;
      if (!layer || elemId === undefined || !coordinates) {
        return res.status(400).json({ message: "layer, elemId, coordinates are required" });
      }

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;
      const projection = crs || "EPSG:4326";

      const coordsStr = Array.isArray(coordinates[0])
        ? (coordinates as number[][]).map((c) => `${c[0]},${c[1]}`).join("\n")
        : `${coordinates[0]},${coordinates[1]}`;

      const innerXml = `    <LayerUpdateGeometry>
      <Layer>${xmlEscape(layer)}</Layer>
      <ElemID>${elemId}</ElemID>
      <CRS>${xmlEscape(projection)}</CRS>
      <coordinates>${coordsStr}</coordinates>
    </LayerUpdateGeometry>`;

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, "LayerUpdateGeometry", xml, 30000);

      if (!ok) {
        return res.status(status).json({ message: "ZWS LayerUpdateGeometry failed", details: text.slice(0, 500) });
      }

      const retVal = parseZwsRetVal(text);
      if (retVal !== 0) {
        return res.status(502).json({ message: `ZWS error: RetVal=${retVal}`, raw: text.slice(0, 500) });
      }

      return res.json({ success: true, elemId });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Request timeout" });
      console.error("ZWS update geometry error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ---- ZWS: Delete element (LayerDeleteElement) ----
  app.delete("/api/zulu/zws/element", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layer, elemId, baseUrl } = req.body;
      if (!layer || elemId === undefined) {
        return res.status(400).json({ message: "layer and elemId are required" });
      }

      const zwsBaseUrl = baseUrl || DEFAULT_ZWS_BASE_URL;

      const innerXml = `    <LayerDeleteElement>
      <Layer>${xmlEscape(layer)}</Layer>
      <ElemID>${elemId}</ElemID>
    </LayerDeleteElement>`;

      const xml = zwsXmlWrap(innerXml);
      const { text, ok, status } = await zwsPost(zwsBaseUrl, "LayerDeleteElement", xml, 30000);

      if (!ok) {
        return res.status(status).json({ message: "ZWS LayerDeleteElement failed", details: text.slice(0, 500) });
      }

      const retVal = parseZwsRetVal(text);
      if (retVal !== 0) {
        return res.status(502).json({ message: `ZWS error: RetVal=${retVal}`, raw: text.slice(0, 500) });
      }

      return res.json({ success: true, elemId });
    } catch (error: any) {
      if (error.isTimeout) return res.status(504).json({ message: "Request timeout" });
      console.error("ZWS delete element error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/zulu/capabilities", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = zuluConnectionSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid connection parameters",
          errors: parseResult.error.errors,
        });
      }

      const { host, port, layerName } = parseResult.data;
      const wmsUrl = `http://${host}:${port}/ZuluServer/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(wmsUrl, {
          signal: controller.signal,
          headers: {
            "Accept": "application/xml, text/xml, */*",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return res.status(502).json({
            message: `ZuluServer returned error: ${response.status} ${response.statusText}`,
          });
        }

        const xmlText = await response.text();

        const layers: { name: string; title: string }[] = [];

        const layerRegex = /<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?(?:<Title>([^<]*)<\/Title>)?[\s\S]*?<\/Layer>/gi;
        let layerMatch;
        while ((layerMatch = layerRegex.exec(xmlText)) !== null) {
          const name = layerMatch[1];
          const title = layerMatch[2] || name;
          if (name && !name.includes("WMS") && name !== "root") {
            if (!layerName || name.toLowerCase().includes(layerName.toLowerCase())) {
              layers.push({ name, title });
            }
          }
        }

        if (layers.length === 0) {
          layers.push({
            name: layerName || "default",
            title: layerName || "Default Layer",
          });
        }

        return res.json({
          layers,
          version: "1.1.1",
          title: "ZuluServer WMS",
        });
      } catch (fetchError: any) {
        if (fetchError.name === "AbortError") {
          return res.status(504).json({
            message: "Connection timeout - ZuluServer did not respond",
          });
        }

        console.error("ZuluServer connection error:", fetchError);
        return res.status(502).json({
          message: `Cannot connect to ZuluServer at ${host}:${port}. Make sure the server is running and accessible.`,
        });
      }
    } catch (error) {
      console.error("Capabilities error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/zulu/wms", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { host, port, ...wmsParams } = req.query;

      if (!host || !port) {
        return res.status(400).json({ message: "Host and port are required" });
      }

      const params = new URLSearchParams();
      params.set("SERVICE", "WMS");
      params.set("VERSION", (wmsParams.VERSION as string) || "1.1.1");
      params.set("REQUEST", (wmsParams.REQUEST as string) || "GetMap");

      Object.entries(wmsParams).forEach(([key, value]) => {
        if (key !== "host" && key !== "port" && value) {
          params.set(key.toUpperCase(), String(value));
        }
      });

      const wmsUrl = `http://${host}:${port}/ZuluServer/wms?${params.toString()}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(wmsUrl, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return res.status(response.status).json({
            message: `WMS error: ${response.statusText}`,
          });
        }

        const contentType = response.headers.get("content-type") || "image/png";
        res.setHeader("Content-Type", contentType);

        const buffer = await response.arrayBuffer();
        return res.send(Buffer.from(buffer));
      } catch (fetchError: any) {
        if (fetchError.name === "AbortError") {
          return res.status(504).json({ message: "WMS request timeout" });
        }
        console.error("WMS proxy error:", fetchError);
        return res.status(502).json({ message: "Failed to fetch from WMS server" });
      }
    } catch (error) {
      console.error("WMS error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/zulu/feature-info", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { connection, coordinate, resolution, projection, layers } = req.body;

      if (!connection || !coordinate || !resolution || !layers) {
        return res.status(400).json({
          message: "Missing required parameters",
        });
      }

      const { host, port } = connection;
      const [x, y] = coordinate;

      const size = [256, 256];
      const halfWidth = resolution * size[0] / 2;
      const halfHeight = resolution * size[1] / 2;
      const bbox = [x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight].join(",");

      const params = new URLSearchParams({
        SERVICE: "WMS",
        VERSION: "1.1.1",
        REQUEST: "GetFeatureInfo",
        LAYERS: layers.join(","),
        QUERY_LAYERS: layers.join(","),
        STYLES: "",
        BBOX: bbox,
        WIDTH: String(size[0]),
        HEIGHT: String(size[1]),
        SRS: projection || "EPSG:3857",
        X: String(Math.round(size[0] / 2)),
        Y: String(Math.round(size[1] / 2)),
        INFO_FORMAT: "application/json",
        FEATURE_COUNT: "10",
      });

      const featureInfoUrl = `http://${host}:${port}/ZuluServer/wms?${params.toString()}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(featureInfoUrl, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return res.status(response.status).json({
            message: `Feature info error: ${response.statusText}`,
          });
        }

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const data = await response.json();
          return res.json(data);
        }

        const text = await response.text();

        const features: any[] = [];
        const featureIdMatch = text.match(/id[=:]["']?([^"'\s<>]+)/i);
        const properties: Record<string, string> = {};

        const propRegex = /(\w+)[=:]["']?([^"'\n<>]+)/g;
        let propMatch;
        while ((propMatch = propRegex.exec(text)) !== null) {
          properties[propMatch[1]] = propMatch[2].trim();
        }

        if (Object.keys(properties).length > 0) {
          features.push({
            id: featureIdMatch ? featureIdMatch[1] : "feature-1",
            layerName: layers[0],
            properties,
          });
        }

        return res.json({ features });
      } catch (fetchError: any) {
        if (fetchError.name === "AbortError") {
          return res.status(504).json({ message: "Feature info request timeout" });
        }
        console.error("Feature info proxy error:", fetchError);
        return res.status(502).json({ message: "Failed to get feature info" });
      }
    } catch (error) {
      console.error("Feature info error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tickets", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const tickets = await storage.getTickets();
      return res.json(tickets);
    } catch (error) {
      console.error("Get tickets error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/tickets", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = insertTicketSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid ticket data",
          errors: parseResult.error.errors,
        });
      }
      const ticket = await storage.createTicket(parseResult.data);
      return res.status(201).json(ticket);
    } catch (error) {
      console.error("Create ticket error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/tickets/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ticket ID" });
      }
      const deleted = await storage.deleteTicket(id);
      if (!deleted) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Delete ticket error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // OSRM routing proxy
  app.post("/api/routing", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { start, end } = req.body;
      
      if (!start || !end || !Array.isArray(start) || !Array.isArray(end)) {
        return res.status(400).json({ message: "Start and end coordinates are required" });
      }

      const [startLon, startLat] = start;
      const [endLon, endLat] = end;

      // Use OSRM public demo server for routing
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(osrmUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": "GIS-Application/1.0",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error("OSRM error:", response.status);
          // Fallback to straight line
          return res.json({
            success: false,
            fallback: true,
            coordinates: [[startLon, startLat], [endLon, endLat]],
            message: "OSRM unavailable, using straight line",
          });
        }

        const data = await response.json();

        if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
          return res.json({
            success: false,
            fallback: true,
            coordinates: [[startLon, startLat], [endLon, endLat]],
            message: "No route found, using straight line",
          });
        }

        const route = data.routes[0];
        return res.json({
          success: true,
          coordinates: route.geometry.coordinates,
          distance: route.distance,
          duration: route.duration,
        });
      } catch (fetchError: any) {
        if (fetchError.name === "AbortError") {
          return res.json({
            success: false,
            fallback: true,
            coordinates: [[startLon, startLat], [endLon, endLat]],
            message: "OSRM timeout, using straight line",
          });
        }
        console.error("OSRM fetch error:", fetchError);
        return res.json({
          success: false,
          fallback: true,
          coordinates: [[startLon, startLat], [endLon, endLat]],
          message: "OSRM error, using straight line",
        });
      }
    } catch (error) {
      console.error("Routing error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Universal object-to-object tracing endpoint
  const traceRouteSchema = z.object({
    sourceCoords: z.tuple([z.number(), z.number()]),
    targetLayerId: z.number(),
    sysAttributeName: z.string().optional(),
  });

  app.post("/api/trace-route", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = traceRouteSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request data", errors: parseResult.error.errors });
      }

      const { sourceCoords, targetLayerId, sysAttributeName } = parseResult.data;

      // Get all features from target layer
      const targetFeatures = await storage.getDrawnFeatures(targetLayerId);
      
      if (targetFeatures.length === 0) {
        return res.status(404).json({ message: "Target layer has no features" });
      }

      // Find nearest feature in target layer
      let nearestFeature = null;
      let minDistance = Infinity;
      let nearestCoords: [number, number] | null = null;

      for (const feature of targetFeatures) {
        const coords = feature.coordinates as unknown;
        let featurePoint: [number, number] | null = null;

        // Extract centroid based on geometry type
        if (feature.geometryType === "Point") {
          featurePoint = coords as [number, number];
        } else if (feature.geometryType === "LineString") {
          const lineCoords = coords as [number, number][];
          if (lineCoords.length > 0) {
            // Use midpoint of line
            const midIndex = Math.floor(lineCoords.length / 2);
            featurePoint = lineCoords[midIndex];
          }
        } else if (feature.geometryType === "Polygon") {
          const polyCoords = coords as [number, number][][];
          if (polyCoords.length > 0 && polyCoords[0].length > 0) {
            // Calculate centroid
            const ring = polyCoords[0];
            let sumX = 0, sumY = 0;
            for (const pt of ring) {
              sumX += pt[0];
              sumY += pt[1];
            }
            featurePoint = [sumX / ring.length, sumY / ring.length];
          }
        }

        if (featurePoint) {
          // Calculate distance using turf (meters)
          const from = turf.point(sourceCoords);
          const to = turf.point(featurePoint);
          const distance = turf.distance(from, to, { units: "meters" });

          if (distance < minDistance) {
            minDistance = distance;
            nearestFeature = feature;
            nearestCoords = featurePoint;
          }
        }
      }

      if (!nearestCoords || !nearestFeature) {
        return res.status(404).json({ message: "Could not find nearest feature" });
      }

      // Build route using OSRM
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${sourceCoords[0]},${sourceCoords[1]};${nearestCoords[0]},${nearestCoords[1]}?overview=full&geometries=geojson`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const osrmResponse = await fetch(osrmUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "GIS-Application/1.0" },
        });

        clearTimeout(timeoutId);

        if (!osrmResponse.ok) {
          return res.json({
            success: false,
            fallback: true,
            coordinates: [sourceCoords, nearestCoords],
            targetFeature: nearestFeature,
            distance: minDistance,
            message: "OSRM unavailable, using straight line",
          });
        }

        const osrmData = await osrmResponse.json();

        if (osrmData.code !== "Ok" || !osrmData.routes || osrmData.routes.length === 0) {
          return res.json({
            success: false,
            fallback: true,
            coordinates: [sourceCoords, nearestCoords],
            targetFeature: nearestFeature,
            distance: minDistance,
            message: "No route found, using straight line",
          });
        }

        const route = osrmData.routes[0];
        return res.json({
          success: true,
          coordinates: route.geometry.coordinates,
          routeDistance: route.distance,
          routeDuration: route.duration,
          targetFeature: nearestFeature,
          straightLineDistance: minDistance,
        });
      } catch (fetchError: any) {
        return res.json({
          success: false,
          fallback: true,
          coordinates: [sourceCoords, nearestCoords],
          targetFeature: nearestFeature,
          distance: minDistance,
          message: fetchError.name === "AbortError" ? "OSRM timeout" : "OSRM error",
        });
      }
    } catch (error) {
      console.error("Trace route error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  const autoTraceSchema = z.object({
    consumerCoords: z.tuple([z.number(), z.number()]),
    sceneId: z.number(),
    consumer: z.object({
      name: z.string(),
      address: z.string().optional(),
      buildingType: z.string().optional(),
      floors: z.number().optional(),
      qo: z.number().optional(),
      qgv: z.number().optional(),
      qsv: z.number().optional(),
    }),
  });

  app.post("/api/auto-trace", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = autoTraceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request data", errors: parseResult.error.errors });
      }

      const { consumerCoords, sceneId, consumer } = parseResult.data;

      if (process.env.NODE_ENV !== "production") console.log(`[AutoTrace] Starting auto-trace for consumer "${consumer.name}" at [${consumerCoords}] in scene ${sceneId}`);

      const { findNearestConnectionPoint, analyzeRouteGeometry, placeHeatChambers, analyzeCapacity } = await import("./network-graph");

      const { connectionPoint, graph } = await findNearestConnectionPoint(consumerCoords, sceneId);

      if (!connectionPoint) {
        return res.json({
          success: false,
          message: "Не найдена тепловая сеть в данной сцене. Убедитесь, что загружены слои с участками тепловой сети.",
        });
      }

      if (process.env.NODE_ENV !== "production") console.log(`[AutoTrace] Found connection point: "${connectionPoint.name}" (${connectionPoint.type}) at distance ${Math.round(connectionPoint.distance)}m`);

      let routeCoords: [number, number][] = [consumerCoords, connectionPoint.coordinates];
      let routeDistance = connectionPoint.distance;
      let usedOsrm = false;

      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${consumerCoords[0]},${consumerCoords[1]};${connectionPoint.coordinates[0]},${connectionPoint.coordinates[1]}?overview=full&geometries=geojson`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const osrmResponse = await fetch(osrmUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "GIS-Application/1.0" },
        });
        clearTimeout(timeoutId);

        if (osrmResponse.ok) {
          const osrmData = await osrmResponse.json();
          if (osrmData.code === "Ok" && osrmData.routes && osrmData.routes.length > 0) {
            const osrmRoute = osrmData.routes[0];
            routeCoords = osrmRoute.geometry.coordinates as [number, number][];
            routeDistance = osrmRoute.distance;
            usedOsrm = true;
            if (process.env.NODE_ENV !== "production") console.log(`[AutoTrace] OSRM route: ${Math.round(routeDistance)}m, ${routeCoords.length} points`);
          }
        }
      } catch (osrmErr: any) {
        console.warn(`[AutoTrace] OSRM unavailable (${osrmErr.name === "AbortError" ? "timeout" : osrmErr.message}), using straight line`);
      }

      const route = analyzeRouteGeometry(routeCoords, routeDistance);

      const heatChambers = placeHeatChambers(route);

      if (process.env.NODE_ENV !== "production") console.log(`[AutoTrace] Route: ${Math.round(route.totalLength)}m, ${route.segments.length} segments, ${route.turningAngles.length} turns, ${heatChambers.length} heat chambers, OSRM=${usedOsrm}`);

      let capacityAnalysis = null;
      const totalLoad = (consumer.qo || 0) + (consumer.qgv || 0) + (consumer.qsv || 0);

      if (connectionPoint.nodeKey && totalLoad > 0) {
        try {
          capacityAnalysis = await analyzeCapacity(graph, connectionPoint.nodeKey, totalLoad);
        } catch (capErr: any) {
          console.warn(`[AutoTrace] Capacity analysis failed: ${capErr.message}`);
        }
      }

      let aiParams = null;

      if (totalLoad > 0) {
        const turnsDetail = route.turningAngles.map(t => `${Math.abs(Math.round(t.angle))}°`).join(", ") || "нет";
        const segmentsDetail = route.segments.map((s, i) => `${i + 1}: ${Math.round(s.length)}м`).join("; ");

        try {
          const aiProvider = await storage.getDefaultAiProvider();

          if (aiProvider && aiProvider.isActive && aiProvider.baseUrl && aiProvider.apiKey && aiProvider.model) {
            const OpenAI = (await import("openai")).default;
            const openai = new OpenAI({ apiKey: aiProvider.apiKey, baseURL: aiProvider.baseUrl });

            const refDiam = heuristicDiameter(totalLoad);
            const prompt = `Ты инженер-теплотехник. Рассчитай параметры трубопровода для подключения нового потребителя к тепловой сети.
Трасса проложена вдоль дорог (маршрутизация OSRM: ${usedOsrm ? "да" : "нет, прямая линия"}).

Исходные данные:
- Тепловая нагрузка на отопление (Qо): ${consumer.qo || 0} Гкал/ч
- Тепловая нагрузка на ГВС (Qгв): ${consumer.qgv || 0} Гкал/ч
- Тепловая нагрузка на вентиляцию (Qсв): ${consumer.qsv || 0} Гкал/ч
- СУММАРНАЯ НАГРУЗКА: ${totalLoad.toFixed(3)} Гкал/ч
- Протяжённость трассы (по дорогам): ${Math.round(route.totalLength)} м
- Количество участков: ${route.segments.length}
- Детали участков: ${segmentsDetail}
- Количество поворотов: ${route.turningAngles.length}
- Углы поворотов: ${turnsDetail}
- Количество тепловых камер: ${heatChambers.length}
- Тип здания: ${consumer.buildingType || "жилой дом"}
- Этажность: ${consumer.floors || 5}
- Температурный график: 95/70°С
- Точка подключения: ${connectionPoint.name} (${connectionPoint.type})

ВАЖНО — таблица соответствия нагрузка → диаметр (стандартный ряд):
≤0.02 Гкал/ч → Ду 32, ≤0.05 → Ду 40, ≤0.1 → Ду 50, ≤0.2 → Ду 57, ≤0.5 → Ду 76, ≤1.0 → Ду 89, ≤2.0 → Ду 108, ≤3.5 → Ду 133, ≤5.0 → Ду 159, ≤8.0 → Ду 194, ≤12.0 → Ду 219, ≤20.0 → Ду 273, ≤35.0 → Ду 325, ≤50.0 → Ду 377, ≤80.0 → Ду 426, ≤120.0 → Ду 530, >120 → Ду 630.
При суммарной нагрузке ${totalLoad.toFixed(3)} Гкал/ч рекомендуемый диаметр = ${refDiam}.
Диаметр подающей и обратной трубы ДОЛЖЕН быть ОДИНАКОВЫМ и соответствовать таблице выше.
Расход = Q × 1000 / (1 × ΔT), где ΔT = 95-70 = 25°С.

Ответь СТРОГО в формате JSON (без markdown, без комментариев):
{
  "pipeDiameterSupply": "${refDiam}",
  "pipeDiameterReturn": "${refDiam}",
  "pipeType": "тип трубы",
  "layingMethod": "способ прокладки",
  "flowRate": расход_т_ч,
  "velocity": скорость_м_с,
  "pressureLoss": потери_давления_м_в_ст,
  "compensators": количество_компенсаторов,
  "valves": количество_задвижек,
  "recommendations": ["рекомендация 1", "рекомендация 2"]
}`;

            if (process.env.NODE_ENV !== "production") console.log(`[AutoTrace] Requesting AI calculation via provider "${aiProvider.name}" (model: ${aiProvider.model})...`);

            const completion = await openai.chat.completions.create({
              model: aiProvider.model,
              messages: [
                { role: "system", content: "Ты опытный инженер-теплотехник. Отвечай только валидным JSON." },
                { role: "user", content: prompt },
              ],
              temperature: 0.2,
              max_tokens: 1000,
            });

            const aiText = completion.choices?.[0]?.message?.content || "";
            if (process.env.NODE_ENV !== "production") console.log("[AutoTrace] AI response received");

            try {
              const cleaned = aiText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
              aiParams = JSON.parse(cleaned);
            } catch (parseErr) {
              console.error("[AutoTrace] Failed to parse AI response:", aiText.substring(0, 200));
            }
          } else {
            if (process.env.NODE_ENV !== "production") console.log("[AutoTrace] No active AI provider configured, using heuristic calculation");
            aiParams = calculateHeuristicParams(totalLoad, route.totalLength, route.turningAngles.length);
          }
        } catch (aiError: any) {
          console.error("[AutoTrace] AI calculation error:", aiError.message);
          aiParams = calculateHeuristicParams(totalLoad, route.totalLength, route.turningAngles.length);
        }
      }

      return res.json({
        success: true,
        consumerCoords,
        connectionPoint: {
          name: connectionPoint.name,
          type: connectionPoint.type,
          coordinates: connectionPoint.coordinates,
          distance: connectionPoint.distance,
          featureId: connectionPoint.featureId,
          layerId: connectionPoint.layerId,
        },
        route: {
          coordinates: route.coordinates,
          totalLength: route.totalLength,
          turningAngles: route.turningAngles,
          segments: route.segments,
        },
        heatChambers,
        aiParams,
        capacityAnalysis,
        usedOsrm,
      });
    } catch (error: any) {
      console.error("Auto-trace error:", error);
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  const coordPair = z.array(z.number()).min(2).transform(arr => [arr[0], arr[1]] as [number, number]);

  const saveTraceSchema = z.object({
    sceneId: z.number(),
    layerName: z.string().min(1),
    route: z.object({
      coordinates: z.array(coordPair),
      totalLength: z.number(),
      turningAngles: z.any().optional(),
      segments: z.any().optional(),
    }),
    heatChambers: z.array(z.object({
      coordinates: coordPair,
      name: z.string(),
      reason: z.string(),
    })),
    consumerCoords: coordPair,
    connectionPoint: z.object({
      name: z.string(),
      type: z.string(),
      coordinates: coordPair,
      distance: z.number().optional(),
      featureId: z.number().optional(),
      layerId: z.number().optional(),
    }),
    aiParams: z.any().optional(),
    consumer: z.object({
      name: z.string(),
      address: z.string().optional(),
      buildingType: z.string().optional(),
      floors: z.number().optional(),
      qo: z.number().optional(),
      qgv: z.number().optional(),
      qsv: z.number().optional(),
    }).optional(),
  });

  app.post("/api/auto-trace/save-layer", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = saveTraceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request data", errors: parseResult.error.errors });
      }

      const { sceneId, layerName, route, heatChambers, consumerCoords, connectionPoint, aiParams, consumer } = parseResult.data;

      const maxOrder = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${editableLayers.displayOrder}), 0)` })
        .from(editableLayers)
        .where(eq(editableLayers.sceneId, sceneId));
      const nextOrder = (maxOrder[0]?.maxOrder || 0) + 1;

      const lineLayer = await storage.createEditableLayer({
        name: `${layerName} — Трасса`,
        sceneId,
        geometryType: "LineString",
        color: "#e53e3e",
        pointStyle: "circle",
        lineStyle: "solid",
        visible: true,
        opacity: 1,
        source: "user",
        crs: "EPSG:4326",
        displayOrder: nextOrder,
      });

      await storage.createDrawnFeature({
        layerId: lineLayer.id,
        geometryType: "LineString",
        coordinates: route.coordinates,
        properties: {
          Name: layerName,
          Length: Math.round(route.totalLength),
          Begin_uch: consumer?.name || "Потребитель",
          End_uch: connectionPoint.name,
          Diam_pod: aiParams?.pipeDiameterSupply || "",
          Diam_obr: aiParams?.pipeDiameterReturn || "",
          Tip_prok: aiParams?.layingMethod || "",
          Tip_trub: aiParams?.pipeType || "",
          Rashod: aiParams?.flowRate || 0,
          Skorost: aiParams?.velocity || 0,
          Poteri: aiParams?.pressureLoss || 0,
        },
      });

      if (heatChambers.length > 0) {
        const pointLayer = await storage.createEditableLayer({
          name: `${layerName} — ТК`,
          sceneId,
          geometryType: "Point",
          color: "#3182ce",
          pointStyle: "heat-chamber",
          lineStyle: "solid",
          visible: true,
          opacity: 1,
          source: "user",
          crs: "EPSG:4326",
          displayOrder: nextOrder + 1,
        });

        for (const chamber of heatChambers) {
          await storage.createDrawnFeature({
            layerId: pointLayer.id,
            geometryType: "Point",
            coordinates: chamber.coordinates,
            properties: {
              Name: chamber.name,
              Reason: chamber.reason,
            },
          });
        }

        await storage.createDrawnFeature({
          layerId: pointLayer.id,
          geometryType: "Point",
          coordinates: consumerCoords,
          properties: {
            Name: consumer?.name || "Потребитель",
            Adres: consumer?.address || "",
            Tip: "consumer",
            Qo_r: consumer?.qo || 0,
            Qgv_r: consumer?.qgv || 0,
            Qsv_r: consumer?.qsv || 0,
          },
        });

        return res.json({
          success: true,
          lineLayerId: lineLayer.id,
          pointLayerId: pointLayer.id,
          message: `Создано 2 слоя: "${lineLayer.name}" и "${pointLayer.name}"`,
        });
      }

      return res.json({
        success: true,
        lineLayerId: lineLayer.id,
        message: `Создан слой: "${lineLayer.name}"`,
      });
    } catch (error: any) {
      console.error("Save trace layer error:", error);
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  const saveReconSchema = z.object({
    sceneId: z.number(),
    layerName: z.string().min(1),
    pipeIssues: z.array(z.object({
      featureId: z.number(),
      layerId: z.number(),
      name: z.string(),
      coordinates: z.any(),
      currentDpod: z.number(),
      currentDobr: z.number(),
      requiredDiameter: z.number(),
      length: z.number(),
    })),
    consumerName: z.string(),
  });

  app.post("/api/auto-trace/save-reconstruction", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = saveReconSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request data", errors: parseResult.error.errors });
      }

      const { sceneId, layerName, pipeIssues, consumerName } = parseResult.data;

      const maxOrder = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${editableLayers.displayOrder}), 0)` })
        .from(editableLayers)
        .where(eq(editableLayers.sceneId, sceneId));
      const nextOrder = (maxOrder[0]?.maxOrder || 0) + 1;

      const reconLayer = await storage.createEditableLayer({
        name: layerName,
        sceneId,
        geometryType: "LineString",
        color: "#e53935",
        pointStyle: "circle",
        lineStyle: "dashed",
        visible: true,
        opacity: 0.8,
        source: "user",
        crs: "EPSG:4326",
        displayOrder: nextOrder,
      });

      for (const issue of pipeIssues) {
        const coords = issue.coordinates;
        let featureCoords: any;
        if (Array.isArray(coords) && coords.length > 0) {
          if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
            featureCoords = coords;
          } else if (typeof coords[0] === "number") {
            featureCoords = [coords, coords];
          } else {
            featureCoords = coords;
          }
        } else {
          featureCoords = [[0, 0], [0, 0]];
        }

        await storage.createDrawnFeature({
          layerId: reconLayer.id,
          geometryType: "LineString",
          coordinates: featureCoords,
          properties: {
            Name: issue.name,
            Dpod_tek: issue.currentDpod,
            Dobr_tek: issue.currentDobr,
            Dpod_treb: issue.requiredDiameter,
            Dobr_treb: issue.requiredDiameter,
            Dlina: Math.round(issue.length),
            Prichina: `Подключение: ${consumerName}`,
            Tip: "reconstruction",
            FeatureRef: issue.featureId,
            LayerRef: issue.layerId,
          },
        });
      }

      return res.json({
        success: true,
        layerId: reconLayer.id,
        message: `Создан слой реконструкции: "${reconLayer.name}" (${pipeIssues.length} участков)`,
      });
    } catch (error: any) {
      console.error("Save reconstruction layer error:", error);
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  function heuristicDiameter(loadGcal: number): string {
    if (loadGcal <= 0.02) return "Ду 32";
    if (loadGcal <= 0.05) return "Ду 40";
    if (loadGcal <= 0.1) return "Ду 50";
    if (loadGcal <= 0.2) return "Ду 57";
    if (loadGcal <= 0.5) return "Ду 76";
    if (loadGcal <= 1.0) return "Ду 89";
    if (loadGcal <= 2.0) return "Ду 108";
    if (loadGcal <= 3.5) return "Ду 133";
    if (loadGcal <= 5.0) return "Ду 159";
    if (loadGcal <= 8.0) return "Ду 194";
    if (loadGcal <= 12.0) return "Ду 219";
    if (loadGcal <= 20.0) return "Ду 273";
    if (loadGcal <= 35.0) return "Ду 325";
    if (loadGcal <= 50.0) return "Ду 377";
    if (loadGcal <= 80.0) return "Ду 426";
    if (loadGcal <= 120.0) return "Ду 530";
    return "Ду 630";
  }

  function calculateHeuristicParams(totalLoad: number, routeLength: number, turnsCount: number) {
    const diameter = heuristicDiameter(totalLoad);

    const flowRate = totalLoad * 1000 / (1 * (95 - 70));
    const diamNum = parseInt(diameter.replace("Ду ", "")) || 100;
    const areaSqM = Math.PI * Math.pow(diamNum / 2000, 2);
    const velocity = areaSqM > 0 ? (flowRate / 3600 / 1000) / areaSqM : 1.0;
    const pressureLoss = routeLength * 0.05;
    const compensators = Math.max(0, Math.floor(routeLength / 60) - 1);
    const valves = Math.max(2, Math.ceil(routeLength / 200) + 1);

    const recommendations: string[] = [];
    if (routeLength > 500) recommendations.push("Рекомендуется установка дополнительных компенсаторов");
    if (totalLoad > 1) recommendations.push("Рекомендуется установка ИТП с автоматическим регулированием");
    if (turnsCount > 3) recommendations.push("Наличие множества поворотов — предусмотреть П-образные компенсаторы");
    recommendations.push("Предусмотреть теплоизоляцию из пенополиуретана (ППУ)");

    return {
      pipeDiameterSupply: diameter,
      pipeDiameterReturn: diameter,
      pipeType: "Стальная в ППУ изоляции",
      layingMethod: "Подземная бесканальная",
      flowRate: Math.round(flowRate * 100) / 100,
      velocity: Math.round(Math.min(Math.max(velocity, 0.3), 3.5) * 100) / 100,
      pressureLoss: Math.round(pressureLoss * 10) / 10,
      compensators,
      valves,
      heatChambers: [],
      recommendations,
    };
  }

  app.get("/api/zulu/wfs", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { host, port, ...wfsParams } = req.query;

      if (!host || !port) {
        return res.status(400).json({ message: "Host and port are required" });
      }

      const params = new URLSearchParams();
      params.set("SERVICE", "WFS");
      params.set("VERSION", (wfsParams.VERSION as string) || "1.0.0");
      params.set("REQUEST", (wfsParams.REQUEST as string) || "GetFeature");

      Object.entries(wfsParams).forEach(([key, value]) => {
        if (key !== "host" && key !== "port" && value) {
          params.set(key.toUpperCase(), String(value));
        }
      });

      const wfsUrl = `http://${host}:${port}/ZuluServer/wfs?${params.toString()}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(wfsUrl, {
          signal: controller.signal,
          headers: {
            "Accept": "application/json, application/xml, */*",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return res.status(response.status).json({
            message: `WFS error: ${response.statusText}`,
          });
        }

        const contentType = response.headers.get("content-type") || "";
        res.setHeader("Content-Type", contentType);

        if (contentType.includes("application/json")) {
          const data = await response.json();
          return res.json(data);
        }

        const text = await response.text();
        return res.send(text);
      } catch (fetchError: any) {
        if (fetchError.name === "AbortError") {
          return res.status(504).json({ message: "WFS request timeout" });
        }
        console.error("WFS proxy error:", fetchError);
        return res.status(502).json({ message: "Failed to fetch from WFS server" });
      }
    } catch (error) {
      console.error("WFS error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Import shapefile as editable layer with features
  app.post("/api/editable-layers/import", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (!checkUploadRateLimit(user.id)) {
        return res.status(429).json({ message: "Слишком много загрузок. Подождите минуту и попробуйте снова." });
      }

      const contentLength = parseInt(req.headers["content-length"] || "0", 10);
      if (contentLength > LARGE_FILE_THRESHOLD && user.role !== "admin") {
        return res.status(403).json({ message: `Импорт данных размером более 100 МБ доступен только администраторам.` });
      }

      const { name, geometryType, geojson, sourceFileName, color, pointStyle, lineStyle } = req.body;
      
      if (!name || !geometryType || !geojson) {
        return res.status(400).json({ 
          message: "Missing required fields: name, geometryType, geojson" 
        });
      }
      
      // Create the editable layer with source: import
      const layer = await storage.createEditableLayer({
        name,
        geometryType,
        color: color || "#3B82F6",
        pointStyle: pointStyle || "circle",
        lineStyle: lineStyle || "solid",
        visible: true,
        opacity: 1,
        source: "import",
        sourceFileName,
        crs: "EPSG:4326",
      });
      
      // Create layer schema from feature properties
      const features = geojson.features || [];
      if (features.length > 0) {
        const sampleProps = features[0].properties || {};
        const fields = Object.keys(sampleProps).map((key) => ({
          name: key,
          type: "text" as const,
          required: false,
        }));
        
        if (fields.length > 0) {
          await storage.createLayerSchema({
            layerId: layer.id,
            fields,
          });
        }
      }
      
      // Batch create features for the layer
      const insertFeatures = features.map((feature: any, index: number) => ({
        layerId: layer.id,
        geometryType: feature.geometry?.type || geometryType,
        coordinates: feature.geometry?.coordinates || [],
        properties: feature.properties || {},
      }));
      
      if (insertFeatures.length > 0) {
        await storage.createDrawnFeaturesBatch(insertFeatures);
      }
      
      // Fetch updated layer with correct feature count
      const updatedLayer = await storage.getEditableLayer(layer.id);
      
      logAction({ action: "layer_import", entityType: "layer", entityId: layer.id, details: { name: layer.name, source: "shapefile" } });
      return res.status(201).json(updatedLayer);
    } catch (error) {
      console.error("Import layer error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
  
  // ============================================
  // EXCEL IMPORT API (Universal XLS/XLSX parser for points)
  // ============================================

  // Parse Excel file and return columns/preview data
  app.post("/api/parse-excel", isAuthenticated as any, excelUpload.single("file"), async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (!checkUploadRateLimit(user.id)) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(429).json({ message: "Слишком много загрузок. Подождите минуту и попробуйте снова." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (req.file.size > LARGE_EXCEL_THRESHOLD && user.role !== "admin") {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(403).json({ message: `Excel-файлы размером более 50 МБ доступны только администраторам. Размер вашего файла: ${(req.file.size / (1024 * 1024)).toFixed(0)} МБ` });
      }

      const filePath = req.file.path;
      const workbook = new ExcelJS.Workbook();
      
      try {
        if (req.file.originalname.toLowerCase().endsWith(".xlsx")) {
          await workbook.xlsx.readFile(filePath);
        } else {
          // For .xls files, try xlsx first as ExcelJS can sometimes handle them
          await workbook.xlsx.readFile(filePath);
        }
      } catch (readError) {
        console.error("Error reading Excel file:", readError);
        return res.status(400).json({ message: "Не удалось прочитать файл Excel. Убедитесь, что файл не повреждён." });
      }

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ message: "Файл Excel не содержит листов" });
      }

      // Get column headers from first row
      const headerRow = worksheet.getRow(1);
      const columns: { index: number; name: string; detectedType: string }[] = [];
      
      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const cellValue = cell.value?.toString() || `Колонка ${colNumber}`;
        columns.push({
          index: colNumber,
          name: cellValue,
          detectedType: "text",
        });
      });

      if (columns.length === 0) {
        return res.status(400).json({ message: "Файл Excel не содержит данных в первой строке" });
      }

      // Detect coordinate columns by name patterns
      const latPatterns = /^(lat|latitude|широта|широт|ш|y|lat_wgs|latitude_wgs)$/i;
      const lonPatterns = /^(lon|lng|longitude|долгота|долгот|д|x|lon_wgs|longitude_wgs|long)$/i;

      for (const col of columns) {
        if (latPatterns.test(col.name.trim())) {
          col.detectedType = "latitude";
        } else if (lonPatterns.test(col.name.trim())) {
          col.detectedType = "longitude";
        }
      }

      // Get ALL rows (not just preview) for full import capability
      const allRows: Record<string, unknown>[] = [];
      const totalRows = worksheet.rowCount - 1; // Exclude header

      for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const rowData: Record<string, unknown> = {};
        let hasData = false;
        
        for (const col of columns) {
          const cell = row.getCell(col.index);
          let value: unknown = null;
          
          if (cell.value !== null && cell.value !== undefined) {
            if (typeof cell.value === "object" && "result" in cell.value) {
              value = (cell.value as any).result;
            } else if (typeof cell.value === "object" && "text" in cell.value) {
              value = (cell.value as any).text;
            } else {
              value = cell.value;
            }
            hasData = true;
          }
          
          rowData[col.name] = value;
        }
        
        // Only add rows that have at least some data
        if (hasData) {
          allRows.push(rowData);
        }
      }

      // Clean up temp file
      fs.unlink(filePath, () => {});

      // Return preview (first 100) and all rows for import
      return res.json({
        fileName: req.file.originalname,
        columns,
        previewRows: allRows.slice(0, 100),
        allRows,
        totalRows: allRows.length,
      });
    } catch (error) {
      console.error("Parse Excel error:", error);
      return res.status(500).json({ message: "Ошибка при обработке файла Excel" });
    }
  });

  const excelImportSchema = z.object({
    name: z.string().min(1, "Layer name is required"),
    rows: z.array(z.record(z.string(), z.unknown())).min(1, "At least one row is required"),
    columnMapping: z.object({
      latitudeColumn: z.string().optional().default(""),
      longitudeColumn: z.string().optional().default(""),
      addressColumn: z.string().optional().default(""),
      attributes: z.array(z.object({
        sourceColumn: z.string(),
        targetName: z.string(),
      })).optional().default([]),
    }),
    sceneId: z.number().nullable().optional(),
    color: z.string().optional(),
    pointStyle: z.string().optional(),
  });

  app.post("/api/editable-layers/import-excel", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parseResult = excelImportSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation error",
          errors: parseResult.error.issues,
        });
      }

      const { name, rows, columnMapping, sceneId, color, pointStyle } = parseResult.data;
      const { latitudeColumn, longitudeColumn, addressColumn, attributes } = columnMapping;

      const useGeocoding = !!addressColumn && addressColumn.length > 0;
      const useCoordinates = !!latitudeColumn && latitudeColumn.length > 0 && !!longitudeColumn && longitudeColumn.length > 0;

      if (!useGeocoding && !useCoordinates) {
        return res.status(400).json({
          message: "Укажите колонки координат (широта/долгота) или колонку адреса для геокодирования",
        });
      }

      const excludeColumns = [latitudeColumn, longitudeColumn, addressColumn].filter(Boolean);
      const filteredAttributes = (attributes || []).filter(
        attr => !excludeColumns.includes(attr.sourceColumn)
      );

      const layer = await storage.createEditableLayer({
        sceneId: sceneId || null,
        name,
        geometryType: "Point",
        color: color || "#3B82F6",
        pointStyle: pointStyle || "circle",
        lineStyle: "solid",
        visible: true,
        opacity: 1,
        source: "import",
        sourceFileName: `${name}.xlsx`,
        crs: "EPSG:4326",
      });

      const schemaFields = filteredAttributes.map((attr) => ({
        name: attr.targetName,
        type: "text" as const,
        required: false,
      }));

      let excelGeoProvider: GeocodeProvider = "yandex";
      let excelGeoApiKey: string | undefined;

      if (useGeocoding) {
        const providerSetting = await storage.getAppSetting("geocode_provider");
        excelGeoProvider = providerSetting === "dadata" ? "dadata" : "yandex";

        if (excelGeoProvider === "dadata") {
          excelGeoApiKey = (await storage.getAppSetting("geocode_dadata_api_key")) || process.env.DADATA_API_KEY;
          if (!excelGeoApiKey) {
            await storage.deleteEditableLayer(layer.id);
            return res.status(400).json({
              message: "API-ключ DaData не настроен. Добавьте ключ в Администрирование → Геокодирование.",
            });
          }
        } else {
          excelGeoApiKey = (await storage.getAppSetting("geocode_yandex_api_key")) || process.env.YANDEX_GEOCODER_API_KEY;
          if (!excelGeoApiKey) {
            await storage.deleteEditableLayer(layer.id);
            return res.status(400).json({
              message: "API-ключ Яндекс Геокодера не настроен. Добавьте ключ в Администрирование → Геокодирование.",
            });
          }
        }

        schemaFields.push({
          name: "geocoded_address",
          type: "text" as const,
          required: false,
        });
        schemaFields.push({
          name: "geocode_precision",
          type: "text" as const,
          required: false,
        });
        if (excelGeoProvider === "dadata") {
          schemaFields.push({
            name: "fias_id",
            type: "text" as const,
            required: false,
          });
        }
      }

      if (schemaFields.length > 0) {
        await storage.createLayerSchema({
          layerId: layer.id,
          fields: schemaFields,
        });
      }

      const validFeatures: any[] = [];
      const invalidRows: { row: number; reason: string }[] = [];

      if (useGeocoding) {
        const addressEntries = rows.map((row, i) => ({
          index: i,
          address: String(row[addressColumn!] || ""),
        }));

        let geocodeResults;
        try {
          geocodeResults = await geocodeBatch(addressEntries, excelGeoApiKey!, undefined, excelGeoProvider);
        } catch (error: any) {
          await storage.deleteEditableLayer(layer.id);
          return res.status(400).json({
            message: error.message || "Ошибка геокодирования",
          });
        }

        for (const gr of geocodeResults) {
          if (!gr.result) {
            invalidRows.push({
              row: gr.index + 2,
              reason: gr.error || "Адрес не найден",
            });
            continue;
          }

          const properties: Record<string, unknown> = {};
          for (const attr of filteredAttributes) {
            properties[attr.targetName] = rows[gr.index][attr.sourceColumn];
          }
          properties["geocoded_address"] = gr.result.formattedAddress;
          properties["geocode_precision"] = gr.result.precision;
          if (excelGeoProvider === "dadata" && gr.result.fiasId) {
            properties["fias_id"] = gr.result.fiasId;
          }

          validFeatures.push({
            layerId: layer.id,
            geometryType: "Point",
            coordinates: [gr.result.lon, gr.result.lat],
            properties,
          });
        }
      } else {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const latValue = row[latitudeColumn!];
          const lonValue = row[longitudeColumn!];

          const lat = typeof latValue === "string" ? parseFloat(latValue.replace(",", ".")) : Number(latValue);
          const lon = typeof lonValue === "string" ? parseFloat(lonValue.replace(",", ".")) : Number(lonValue);

          if (isNaN(lat) || isNaN(lon)) {
            invalidRows.push({ row: i + 2, reason: "Невалидные координаты" });
            continue;
          }

          if (lat < -90 || lat > 90) {
            invalidRows.push({ row: i + 2, reason: `Широта вне диапазона: ${lat}` });
            continue;
          }

          if (lon < -180 || lon > 180) {
            invalidRows.push({ row: i + 2, reason: `Долгота вне диапазона: ${lon}` });
            continue;
          }

          const properties: Record<string, unknown> = {};
          for (const attr of filteredAttributes) {
            properties[attr.targetName] = row[attr.sourceColumn];
          }

          validFeatures.push({
            layerId: layer.id,
            geometryType: "Point",
            coordinates: [lon, lat],
            properties,
          });
        }
      }

      if (validFeatures.length > 0) {
        await storage.createDrawnFeaturesBatch(validFeatures);
      }

      const updatedLayer = await storage.getEditableLayer(layer.id);

      return res.status(201).json({
        layer: updatedLayer,
        importedCount: validFeatures.length,
        skippedCount: invalidRows.length,
        invalidRows: invalidRows.slice(0, 20),
        geocoded: useGeocoding,
      });
    } catch (error) {
      console.error("Import Excel error:", error);
      return res.status(500).json({ message: "Ошибка при импорте данных из Excel" });
    }
  });

  // ============================================
  // ATTRIBUTE JOIN FROM EXCEL (Enrich layer with XLSX data)
  // ============================================

  app.post("/api/parse-excel-for-join", isAuthenticated as any, excelUpload.single("file"), async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      if (!checkUploadRateLimit(user.id)) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(429).json({ message: "Слишком много загрузок. Подождите минуту и попробуйте снова." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Файл не загружен" });
      }

      if (req.file.size > LARGE_EXCEL_THRESHOLD && user.role !== "admin") {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(403).json({ message: `Excel-файлы размером более 50 МБ доступны только администраторам.` });
      }

      const filePath = req.file.path;
      const workbook = new ExcelJS.Workbook();

      try {
        await workbook.xlsx.readFile(filePath);
      } catch (readError) {
        console.error("Error reading Excel file for join:", readError);
        return res.status(400).json({ message: "Не удалось прочитать файл Excel. Убедитесь, что файл не повреждён." });
      }

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ message: "Файл Excel не содержит листов" });
      }

      const headerRow = worksheet.getRow(1);
      const columns: { index: number; name: string }[] = [];

      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const cellValue = cell.value?.toString() || `Колонка ${colNumber}`;
        columns.push({ index: colNumber, name: cellValue });
      });

      if (columns.length === 0) {
        return res.status(400).json({ message: "Файл Excel не содержит данных в первой строке" });
      }

      const allRows: Record<string, unknown>[] = [];

      for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const rowData: Record<string, unknown> = {};
        let hasData = false;

        for (const col of columns) {
          const cell = row.getCell(col.index);
          let value: unknown = null;

          if (cell.value !== null && cell.value !== undefined) {
            if (typeof cell.value === "object" && "result" in cell.value) {
              value = (cell.value as any).result;
            } else if (typeof cell.value === "object" && "text" in cell.value) {
              value = (cell.value as any).text;
            } else {
              value = cell.value;
            }
            hasData = true;
          }

          rowData[col.name] = value;
        }

        if (hasData) {
          allRows.push(rowData);
        }
      }

      fs.unlink(filePath, () => {});

      return res.json({
        fileName: req.file.originalname,
        columns: columns.map(c => c.name),
        rows: allRows,
        totalRows: allRows.length,
        previewRows: allRows.slice(0, 10),
      });
    } catch (error) {
      console.error("Parse Excel for join error:", error);
      return res.status(500).json({ message: "Ошибка при обработке файла Excel" });
    }
  });

  const joinPreviewSchema = z.object({
    layerKeyField: z.string().min(1),
    excelKeyColumn: z.string().min(1),
    rows: z.array(z.record(z.string(), z.unknown())).min(1),
  });

  app.post("/api/editable-layers/:layerId/join-preview", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const parsed = joinPreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Некорректные параметры", errors: parsed.error.issues });
      }

      const { layerKeyField, excelKeyColumn, rows: excelRows } = parsed.data;

      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ message: "Слой не найден" });
      }

      const features = await storage.getDrawnFeatures(layerId);

      const excelKeyMap = new Map<string, number>();
      for (const row of excelRows) {
        const keyVal = String(row[excelKeyColumn] ?? "").trim();
        if (keyVal) {
          excelKeyMap.set(keyVal, (excelKeyMap.get(keyVal) || 0) + 1);
        }
      }

      let matchedFeatures = 0;
      let unmatchedFeatures = 0;
      const matchedExcelKeys = new Set<string>();

      for (const feature of features) {
        const props = (feature.properties || {}) as Record<string, unknown>;
        const featureKeyVal = String(props[layerKeyField] ?? "").trim();
        if (featureKeyVal && excelKeyMap.has(featureKeyVal)) {
          matchedFeatures++;
          matchedExcelKeys.add(featureKeyVal);
        } else {
          unmatchedFeatures++;
        }
      }

      const unmatchedExcelRows = excelRows.filter(row => {
        const keyVal = String(row[excelKeyColumn] ?? "").trim();
        return keyVal && !matchedExcelKeys.has(keyVal);
      }).length;

      const emptyKeyExcelRows = excelRows.filter(row => {
        const keyVal = String(row[excelKeyColumn] ?? "").trim();
        return !keyVal;
      }).length;

      return res.json({
        totalFeatures: features.length,
        matchedFeatures,
        unmatchedFeatures,
        totalExcelRows: excelRows.length,
        unmatchedExcelRows,
        emptyKeyExcelRows,
        uniqueExcelKeys: excelKeyMap.size,
        uniqueMatchedKeys: matchedExcelKeys.size,
      });
    } catch (error) {
      console.error("Join preview error:", error);
      return res.status(500).json({ message: "Ошибка при предпросмотре обогащения" });
    }
  });

  const joinExcelSchema = z.object({
    layerKeyField: z.string().min(1),
    excelKeyColumn: z.string().min(1),
    rows: z.array(z.record(z.string(), z.unknown())).min(1),
    columnsToJoin: z.array(z.object({
      sourceColumn: z.string(),
      targetName: z.string(),
    })).min(1),
  });

  app.post("/api/editable-layers/:layerId/join-excel", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const parsed = joinExcelSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Некорректные параметры", errors: parsed.error.issues });
      }

      const { layerKeyField, excelKeyColumn, rows: excelRows, columnsToJoin } = parsed.data;

      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ message: "Слой не найден" });
      }

      const excelByKey = new Map<string, Record<string, unknown>>();
      for (const row of excelRows) {
        const keyVal = String(row[excelKeyColumn] ?? "").trim();
        if (keyVal && !excelByKey.has(keyVal)) {
          excelByKey.set(keyVal, row);
        }
      }

      const features = await storage.getDrawnFeatures(layerId);
      const updates: { id: number; properties: Record<string, unknown> }[] = [];
      let enrichedCount = 0;

      for (const feature of features) {
        const props = { ...((feature.properties || {}) as Record<string, unknown>) };
        const featureKeyVal = String(props[layerKeyField] ?? "").trim();

        if (featureKeyVal && excelByKey.has(featureKeyVal)) {
          const excelRow = excelByKey.get(featureKeyVal)!;
          for (const col of columnsToJoin) {
            const val = excelRow[col.sourceColumn];
            if (val !== null && val !== undefined) {
              props[col.targetName] = val;
            }
          }
          updates.push({ id: feature.id, properties: props });
          enrichedCount++;
        }
      }

      if (updates.length > 0) {
        await storage.updateDrawnFeaturesBatch(updates);
      }

      const schema = await storage.getLayerSchema(layerId);
      if (schema) {
        const existingFieldNames = new Set(schema.fields.map(f => f.name));
        const newFields = columnsToJoin
          .filter(col => !existingFieldNames.has(col.targetName))
          .map(col => ({ name: col.targetName, type: "text" as const, required: false }));

        if (newFields.length > 0) {
          const updatedFields = [...schema.fields, ...newFields];
          await storage.updateLayerSchema(layerId, updatedFields);
        }
      } else {
        const newFields = columnsToJoin.map(col => ({
          name: col.targetName,
          type: "text" as const,
          required: false,
        }));
        await storage.createLayerSchema({ layerId, fields: newFields });
      }

      return res.json({
        enrichedCount,
        totalFeatures: features.length,
        skippedCount: features.length - enrichedCount,
      });
    } catch (error) {
      console.error("Join Excel error:", error);
      return res.status(500).json({ message: "Ошибка при обогащении слоя" });
    }
  });

  // Batch create features endpoint
  app.post("/api/editable-layers/:id/features/batch", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid layer ID" });
      }
      
      const layer = await storage.getEditableLayer(id);
      if (!layer) {
        return res.status(404).json({ message: "Layer not found" });
      }
      
      if (!Array.isArray(req.body)) {
        return res.status(400).json({ message: "Request body must be an array of features" });
      }
      
      const insertFeatures = req.body.map((feature: any) => ({
        layerId: id,
        geometryType: feature.geometry?.type || feature.geometryType,
        coordinates: feature.geometry?.coordinates || feature.coordinates || [],
        properties: feature.properties || {},
      }));
      
      const createdFeatures = await storage.createDrawnFeaturesBatch(insertFeatures);
      return res.status(201).json(createdFeatures);
    } catch (error) {
      console.error("Batch create features error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/analytics/accident-pipeline", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { accidentLayerId, pipelineLayerId, maxDistanceMeters = 15 } = req.body;

      if (!accidentLayerId || !pipelineLayerId) {
        return res.status(400).json({ message: "accidentLayerId and pipelineLayerId are required" });
      }

      const accidentLayer = await storage.getEditableLayer(accidentLayerId);
      const pipelineLayer = await storage.getEditableLayer(pipelineLayerId);

      if (!accidentLayer) {
        return res.status(404).json({ message: "Accident layer not found" });
      }
      if (!pipelineLayer) {
        return res.status(404).json({ message: "Pipeline layer not found" });
      }

      const accidentFeaturesRaw = await storage.getDrawnFeatures(accidentLayerId);
      const pipelineFeaturesRaw = await storage.getDrawnFeatures(pipelineLayerId);
      
      // Convert to GeoJSON-like format for processing
      const accidentFeatures = accidentFeaturesRaw.map(f => ({
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: f.properties,
      }));
      const pipelineFeatures = pipelineFeaturesRaw.map(f => ({
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: f.properties,
      }));

      if (accidentFeatures.length === 0) {
        return res.status(422).json({ message: "Accident layer has no features" });
      }
      if (pipelineFeatures.length === 0) {
        return res.status(422).json({ message: "Pipeline layer has no features" });
      }

      const pipelineAccidentCounts: Map<number, number> = new Map();
      let unmatchedCount = 0;

      for (const accidentFeature of accidentFeatures) {
        if (!accidentFeature.geometry || accidentFeature.geometry.type !== "Point") {
          continue;
        }

        const accidentPoint = turf.point(accidentFeature.geometry.coordinates);
        let nearestPipelineIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < pipelineFeatures.length; i++) {
          const pipelineFeature = pipelineFeatures[i];
          if (!pipelineFeature.geometry) continue;

          const geomType = pipelineFeature.geometry.type;
          if (geomType !== "LineString" && geomType !== "MultiLineString") {
            continue;
          }

          try {
            let minDistForThisLine = Infinity;
            
            if (geomType === "LineString") {
              const line = turf.lineString(pipelineFeature.geometry.coordinates);
              const nearestPoint = turf.nearestPointOnLine(line, accidentPoint);
              if (nearestPoint.properties.dist !== undefined) {
                minDistForThisLine = nearestPoint.properties.dist;
              }
            } else {
              const coords = pipelineFeature.geometry.coordinates as number[][][];
              for (const lineCoords of coords) {
                if (lineCoords.length < 2) continue;
                const line = turf.lineString(lineCoords);
                const nearestPoint = turf.nearestPointOnLine(line, accidentPoint);
                if (nearestPoint.properties.dist !== undefined && nearestPoint.properties.dist < minDistForThisLine) {
                  minDistForThisLine = nearestPoint.properties.dist;
                }
              }
            }

            if (minDistForThisLine < nearestDistance) {
              nearestDistance = minDistForThisLine;
              nearestPipelineIndex = i;
            }
          } catch (e) {
            continue;
          }
        }

        const distanceInMeters = nearestDistance * 1000;

        if (nearestPipelineIndex >= 0 && distanceInMeters <= maxDistanceMeters) {
          const currentCount = pipelineAccidentCounts.get(nearestPipelineIndex) || 0;
          pipelineAccidentCounts.set(nearestPipelineIndex, currentCount + 1);
        } else {
          unmatchedCount++;
        }
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Участки трубопроводов");

      worksheet.columns = [
        { header: "Sys", key: "sys", width: 15 },
        { header: "Begin_uch", key: "begin_uch", width: 20 },
        { header: "End_uch", key: "end_uch", width: 20 },
        { header: "L (м)", key: "l", width: 12 },
        { header: "Dpod (мм)", key: "dpod", width: 12 },
        { header: "Dobr (мм)", key: "dobr", width: 12 },
        { header: "Кол-во аварий", key: "accident_count", width: 15 },
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      const rows: any[] = [];
      for (let i = 0; i < pipelineFeatures.length; i++) {
        const feature = pipelineFeatures[i];
        const props = feature.properties || {};
        const accidentCount = pipelineAccidentCounts.get(i) || 0;

        rows.push({
          sys: props.Sys || props.sys || props.SYS || "",
          begin_uch: props.Begin_uch || props.begin_uch || props.BEGIN_UCH || "",
          end_uch: props.End_uch || props.end_uch || props.END_UCH || "",
          l: props.L || props.l || "",
          dpod: props.Dpod || props.dpod || props.DPOD || "",
          dobr: props.Dobr || props.dobr || props.DOBR || "",
          accident_count: accidentCount,
        });
      }

      const filteredRows = rows.filter(r => r.accident_count > 0);
      filteredRows.sort((a, b) => b.accident_count - a.accident_count);

      for (const row of filteredRows) {
        worksheet.addRow(row);
      }

      const metaSheet = workbook.addWorksheet("Метаданные");
      metaSheet.columns = [
        { header: "Параметр", key: "param", width: 30 },
        { header: "Значение", key: "value", width: 40 },
      ];
      metaSheet.getRow(1).font = { bold: true };

      metaSheet.addRow({ param: "Дата анализа", value: new Date().toLocaleString("ru-RU") });
      metaSheet.addRow({ param: "Слой аварий", value: accidentLayer.name });
      metaSheet.addRow({ param: "Слой трубопроводов", value: pipelineLayer.name });
      metaSheet.addRow({ param: "Порог расстояния (м)", value: maxDistanceMeters });
      metaSheet.addRow({ param: "Всего аварий", value: accidentFeatures.length });
      metaSheet.addRow({ param: "Привязано аварий", value: accidentFeatures.length - unmatchedCount });
      metaSheet.addRow({ param: "Непривязано аварий", value: unmatchedCount });
      metaSheet.addRow({ param: "Всего участков", value: pipelineFeatures.length });
      metaSheet.addRow({ 
        param: "Участков с авариями", 
        value: Array.from(pipelineAccidentCounts.values()).filter(c => c > 0).length 
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="accident_analysis_${Date.now()}.xlsx"`);
      return res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Accident pipeline analysis error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // ACCIDENT ANALYSIS API (Spatial binding of accidents to network segments)
  // ============================================

  app.post("/api/analytics/accident-analysis", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const {
        networkLayerId,
        accidentLayerId,
        maxDistanceMeters = 50,
        attributeFilter,
        networkFilters,
        accidentFilters,
        runSimulation = false,
        consumerLayerId,
        residentField,
        sceneId,
      } = req.body;

      if (!networkLayerId || !accidentLayerId) {
        return res.status(400).json({ message: "networkLayerId and accidentLayerId are required" });
      }

      const networkLayer = await storage.getEditableLayer(networkLayerId);
      const accidentLayer = await storage.getEditableLayer(accidentLayerId);

      if (!networkLayer) {
        return res.status(404).json({ message: "Network layer not found" });
      }
      if (!accidentLayer) {
        return res.status(404).json({ message: "Accident layer not found" });
      }

      const networkFeaturesRaw = await storage.getDrawnFeatures(networkLayerId);
      const accidentFeaturesRaw = await storage.getDrawnFeatures(accidentLayerId);

      let networkFeatures = networkFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));

      let accidentFeatures = accidentFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));

      if (accidentFeatures.length === 0) {
        return res.status(422).json({ message: "Accident layer has no features" });
      }
      if (networkFeatures.length === 0) {
        return res.status(422).json({ message: "Network layer has no features" });
      }

      const resolvedNetworkFilters: { field: string; value: string }[] = Array.isArray(networkFilters)
        ? networkFilters.filter((f: any) => f.field && f.value !== undefined && f.value !== null && f.value !== "")
        : (attributeFilter && attributeFilter.field && attributeFilter.value !== undefined && attributeFilter.value !== null && attributeFilter.value !== "")
          ? [attributeFilter]
          : [];

      if (resolvedNetworkFilters.length > 0) {
        networkFeatures = networkFeatures.filter(f =>
          resolvedNetworkFilters.every(({ field, value }) => {
            const propVal = f.properties[field];
            if (propVal === undefined || propVal === null) return false;
            return String(propVal) === String(value);
          })
        );
        if (networkFeatures.length === 0) {
          return res.status(422).json({ message: "No network features match the attribute filter" });
        }
      }

      const resolvedAccidentFilters: { field: string; value: string }[] = Array.isArray(accidentFilters)
        ? accidentFilters.filter((f: any) => f.field && f.value !== undefined && f.value !== null && f.value !== "")
        : [];

      if (resolvedAccidentFilters.length > 0) {
        accidentFeatures = accidentFeatures.filter(f =>
          resolvedAccidentFilters.every(({ field, value }) => {
            const propVal = f.properties[field];
            if (propVal === undefined || propVal === null) return false;
            return String(propVal) === String(value);
          })
        );
        if (accidentFeatures.length === 0) {
          return res.status(422).json({ message: "No accident features match the attribute filter" });
        }
      }

      const segmentAccidentMap: Map<number, { feature: typeof networkFeatures[0]; accidents: typeof accidentFeatures }> = new Map();
      let boundCount = 0;
      let unboundCount = 0;

      for (const accidentFeature of accidentFeatures) {
        if (!accidentFeature.geometry) {
          unboundCount++;
          continue;
        }

        let accidentCoords: number[];
        if (accidentFeature.geometry.type === "Point") {
          accidentCoords = accidentFeature.geometry.coordinates as number[];
        } else {
          unboundCount++;
          continue;
        }

        const accidentPoint = turf.point(accidentCoords);
        let nearestNetworkIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < networkFeatures.length; i++) {
          const netFeature = networkFeatures[i];
          if (!netFeature.geometry) continue;

          const geomType = netFeature.geometry.type;
          if (geomType !== "LineString" && geomType !== "MultiLineString") continue;

          try {
            let minDist = Infinity;
            if (geomType === "LineString") {
              const line = turf.lineString(netFeature.geometry.coordinates as number[][]);
              const np = turf.nearestPointOnLine(line, accidentPoint);
              if (np.properties.dist !== undefined) minDist = np.properties.dist;
            } else {
              const coords = netFeature.geometry.coordinates as number[][][];
              for (const lineCoords of coords) {
                if (lineCoords.length < 2) continue;
                const line = turf.lineString(lineCoords);
                const np = turf.nearestPointOnLine(line, accidentPoint);
                if (np.properties.dist !== undefined && np.properties.dist < minDist) {
                  minDist = np.properties.dist;
                }
              }
            }
            if (minDist < nearestDistance) {
              nearestDistance = minDist;
              nearestNetworkIndex = i;
            }
          } catch (e) {
            continue;
          }
        }

        const distMeters = nearestDistance * 1000;
        if (nearestNetworkIndex >= 0 && distMeters <= maxDistanceMeters) {
          const netFeature = networkFeatures[nearestNetworkIndex];
          if (!segmentAccidentMap.has(nearestNetworkIndex)) {
            segmentAccidentMap.set(nearestNetworkIndex, { feature: netFeature, accidents: [] });
          }
          segmentAccidentMap.get(nearestNetworkIndex)!.accidents.push(accidentFeature);
          boundCount++;
        } else {
          unboundCount++;
        }
      }

      const baseSegments = Array.from(segmentAccidentMap.entries())
        .map(([, data]) => {
          const props = data.feature.properties;
          return {
            featureId: data.feature.id,
            geometry: data.feature.geometry,
            properties: props,
            dpod: props.Dpod ?? props.dpod ?? props.DPOD ?? null,
            dobr: props.Dobr ?? props.dobr ?? props.DOBR ?? null,
            length: props.L ?? props.l ?? null,
            sys: props.Sys ?? props.sys ?? props.SYS ?? null,
            beginUch: props.Begin_uch ?? props.begin_uch ?? null,
            endUch: props.End_uch ?? props.end_uch ?? null,
            accidentCount: data.accidents.length,
            accidentFeatures: data.accidents.map(a => ({
              id: a.id,
              geometry: a.geometry,
              properties: a.properties,
            })),
            consumerCount: null as number | null,
            residentCount: null as number | null,
          };
        })
        .sort((a, b) => b.accidentCount - a.accidentCount);

      // Run disconnection simulation once per unique segment if requested
      if (runSimulation && sceneId) {
        const { buildSpatialNetworkGraph, simulateSpatialDisconnection } = await import("./network-graph");
        const accidentGraph = await buildSpatialNetworkGraph(Number(sceneId));
        // Load consumer features once if residentField is provided
        let consumerFeatures: Array<{ id: number; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }> = [];
        if (consumerLayerId && residentField) {
          const consumerFeaturesRaw = await storage.getDrawnFeatures(Number(consumerLayerId));
          consumerFeatures = consumerFeaturesRaw.map(f => ({
            id: f.id,
            geometry: { type: f.geometryType, coordinates: f.coordinates },
            properties: (f.properties || {}) as Record<string, unknown>,
          }));
        }

        // Build a fast featureId → properties lookup map for resident counting
        const consumerPropsMap = new Map<number, Record<string, unknown>>();
        for (const cf of consumerFeatures) {
          consumerPropsMap.set(cf.id, cf.properties);
        }

        for (const seg of baseSegments) {
          let simResult: Awaited<ReturnType<typeof simulateSpatialDisconnection>> | null = null;
          try {
            simResult = await simulateSpatialDisconnection(seg.featureId, Number(networkLayerId), Number(sceneId), accidentGraph);
            seg.consumerCount = simResult.stats?.totalConsumers ?? simResult.affectedConsumers?.length ?? 0;
          } catch (simErr) {
            console.warn(`[accident-analysis] simulation failed for featureId=${seg.featureId}:`, (simErr as Error).message);
            seg.consumerCount = 0;
          }

          // Sum residents using simulation-identified consumers (featureId lookup)
          if (simResult) {
            if (consumerLayerId && residentField && consumerFeatures.length > 0) {
              let resTotal = 0;
              for (const consumer of simResult.affectedConsumers) {
                const props = consumerPropsMap.get(consumer.featureId);
                if (props) {
                  const val = props[residentField as string];
                  const num = typeof val === "number" ? val : Number(val);
                  if (!isNaN(num)) resTotal += num;
                }
              }
              seg.residentCount = resTotal;
            } else {
              // Fall back to residents read directly from graph node properties (Njil)
              seg.residentCount = simResult.stats?.totalResidents ?? 0;
            }
          }
        }
      }

      const segments = baseSegments;

      return res.json({
        networkLayerName: networkLayer.name,
        accidentLayerName: accidentLayer.name,
        totalAccidents: accidentFeatures.length,
        boundAccidents: boundCount,
        unboundAccidents: unboundCount,
        segmentsWithAccidents: segments.length,
        segments,
      });
    } catch (error) {
      console.error("Accident analysis error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/analytics/accident-analysis/stream", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    const sendEvent = (type: string, data: Record<string, unknown>) => {
      try {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        (res as any).flush?.();
      } catch { /* client disconnected */ }
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const {
        networkLayerId,
        accidentLayerId,
        maxDistanceMeters = 50,
        attributeFilter,
        networkFilters,
        accidentFilters,
        runSimulation = false,
        consumerLayerId,
        residentField,
        sceneId,
      } = req.body;

      if (!networkLayerId || !accidentLayerId) {
        sendEvent("error", { message: "networkLayerId and accidentLayerId are required" });
        return res.end();
      }

      const networkLayer = await storage.getEditableLayer(networkLayerId);
      const accidentLayer = await storage.getEditableLayer(accidentLayerId);
      if (!networkLayer || !accidentLayer) {
        sendEvent("error", { message: "Layer not found" });
        return res.end();
      }

      const networkFeaturesRaw = await storage.getDrawnFeatures(networkLayerId);
      const accidentFeaturesRaw = await storage.getDrawnFeatures(accidentLayerId);

      let networkFeatures = networkFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));

      let accidentFeatures = accidentFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));

      if (accidentFeatures.length === 0 || networkFeatures.length === 0) {
        sendEvent("error", { message: "One of the layers has no features" });
        return res.end();
      }

      const resolvedNetworkFilters: { field: string; value: string }[] = Array.isArray(networkFilters)
        ? networkFilters.filter((f: any) => f.field && f.value !== undefined && f.value !== null && f.value !== "")
        : (attributeFilter && attributeFilter.field && attributeFilter.value !== undefined && attributeFilter.value !== null && attributeFilter.value !== "")
          ? [attributeFilter]
          : [];

      if (resolvedNetworkFilters.length > 0) {
        networkFeatures = networkFeatures.filter(f =>
          resolvedNetworkFilters.every(({ field, value }) => {
            const propVal = f.properties[field];
            if (propVal === undefined || propVal === null) return false;
            return String(propVal) === String(value);
          })
        );
        if (networkFeatures.length === 0) {
          sendEvent("error", { message: "No network features match the attribute filter" });
          return res.end();
        }
      }

      const resolvedAccidentFilters: { field: string; value: string }[] = Array.isArray(accidentFilters)
        ? accidentFilters.filter((f: any) => f.field && f.value !== undefined && f.value !== null && f.value !== "")
        : [];

      if (resolvedAccidentFilters.length > 0) {
        accidentFeatures = accidentFeatures.filter(f =>
          resolvedAccidentFilters.every(({ field, value }) => {
            const propVal = f.properties[field];
            if (propVal === undefined || propVal === null) return false;
            return String(propVal) === String(value);
          })
        );
        if (accidentFeatures.length === 0) {
          sendEvent("error", { message: "No accident features match the attribute filter" });
          return res.end();
        }
      }

      // --- Step 1: Spatial binding ---
      const segmentAccidentMap: Map<number, { feature: typeof networkFeatures[0]; accidents: typeof accidentFeatures }> = new Map();
      let boundCount = 0;
      let unboundCount = 0;

      for (const accidentFeature of accidentFeatures) {
        if (!accidentFeature.geometry || accidentFeature.geometry.type !== "Point") {
          unboundCount++;
          continue;
        }
        const accidentCoords = accidentFeature.geometry.coordinates as number[];
        const accidentPoint = turf.point(accidentCoords);
        let nearestNetworkIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < networkFeatures.length; i++) {
          const netFeature = networkFeatures[i];
          if (!netFeature.geometry) continue;
          const geomType = netFeature.geometry.type;
          if (geomType !== "LineString" && geomType !== "MultiLineString") continue;
          try {
            let minDist = Infinity;
            if (geomType === "LineString") {
              const np = turf.nearestPointOnLine(turf.lineString(netFeature.geometry.coordinates as number[][]), accidentPoint);
              if (np.properties.dist !== undefined) minDist = np.properties.dist;
            } else {
              for (const lineCoords of netFeature.geometry.coordinates as number[][][]) {
                if (lineCoords.length < 2) continue;
                const np = turf.nearestPointOnLine(turf.lineString(lineCoords), accidentPoint);
                if (np.properties.dist !== undefined && np.properties.dist < minDist) minDist = np.properties.dist;
              }
            }
            if (minDist < nearestDistance) { nearestDistance = minDist; nearestNetworkIndex = i; }
          } catch { continue; }
        }

        const distMeters = nearestDistance * 1000;
        if (nearestNetworkIndex >= 0 && distMeters <= maxDistanceMeters) {
          const netFeature = networkFeatures[nearestNetworkIndex];
          if (!segmentAccidentMap.has(nearestNetworkIndex)) {
            segmentAccidentMap.set(nearestNetworkIndex, { feature: netFeature, accidents: [] });
          }
          segmentAccidentMap.get(nearestNetworkIndex)!.accidents.push(accidentFeature);
          boundCount++;
        } else {
          unboundCount++;
        }
      }

      const baseSegments = Array.from(segmentAccidentMap.entries())
        .map(([, data]) => {
          const props = data.feature.properties;
          return {
            featureId: data.feature.id,
            geometry: data.feature.geometry,
            properties: props,
            dpod: props.Dpod ?? props.dpod ?? props.DPOD ?? null,
            dobr: props.Dobr ?? props.dobr ?? props.DOBR ?? null,
            length: props.L ?? props.l ?? null,
            sys: props.Sys ?? props.sys ?? props.SYS ?? null,
            beginUch: props.Begin_uch ?? props.begin_uch ?? null,
            endUch: props.End_uch ?? props.end_uch ?? null,
            accidentCount: data.accidents.length,
            accidentFeatures: data.accidents.map(a => ({ id: a.id, geometry: a.geometry, properties: a.properties })),
            consumerCount: null as number | null,
            residentCount: null as number | null,
          };
        })
        .sort((a, b) => b.accidentCount - a.accidentCount);

      // Send binding results
      sendEvent("binding", {
        boundAccidents: boundCount,
        unboundAccidents: unboundCount,
        totalAccidents: accidentFeatures.length,
        segmentsWithAccidents: baseSegments.length,
        networkLayerName: networkLayer.name,
        accidentLayerName: accidentLayer.name,
      });

      // --- Step 2 & 3: Graph + simulation (optional) ---
      if (runSimulation && sceneId) {
        const { buildSpatialNetworkGraph, simulateSpatialDisconnection } = await import("./network-graph");

        sendEvent("graph_building", { message: "Построение графа сети..." });
        const spatialGraph = await buildSpatialNetworkGraph(Number(sceneId));
        sendEvent("graph_ready", {
          nodeCount: spatialGraph.nodes.size,
          edgeCount: spatialGraph.edges.length,
        });

        // Load consumer features once
        let consumerFeatures: Array<{ id: number; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }> = [];
        if (consumerLayerId && residentField) {
          const raw = await storage.getDrawnFeatures(Number(consumerLayerId));
          consumerFeatures = raw.map(f => ({
            id: f.id,
            geometry: { type: f.geometryType, coordinates: f.coordinates },
            properties: (f.properties || {}) as Record<string, unknown>,
          }));
          sendEvent("consumers_loaded", { consumerCount: consumerFeatures.length });
        }

        // Build a fast featureId → properties lookup map for resident counting
        const consumerPropsMap = new Map<number, Record<string, unknown>>();
        for (const cf of consumerFeatures) {
          consumerPropsMap.set(cf.id, cf.properties);
        }

        const total = baseSegments.length;
        for (let i = 0; i < baseSegments.length; i++) {
          const seg = baseSegments[i];

          // Simulation
          let simResult: Awaited<ReturnType<typeof simulateSpatialDisconnection>> | null = null;
          try {
            simResult = await simulateSpatialDisconnection(seg.featureId, Number(networkLayerId), Number(sceneId), spatialGraph);
            seg.consumerCount = simResult.stats?.totalConsumers ?? simResult.affectedConsumers?.length ?? 0;
          } catch {
            seg.consumerCount = 0;
          }

          // Sum residents using simulation-identified consumers (featureId lookup)
          if (simResult) {
            if (consumerLayerId && residentField && consumerFeatures.length > 0) {
              let resTotal = 0;
              for (const consumer of simResult.affectedConsumers) {
                const props = consumerPropsMap.get(consumer.featureId);
                if (props) {
                  const val = props[residentField as string];
                  const num = typeof val === "number" ? val : Number(val);
                  if (!isNaN(num)) resTotal += num;
                }
              }
              seg.residentCount = resTotal;
            } else {
              // Fall back to residents read directly from graph node properties (Njil)
              seg.residentCount = simResult.stats?.totalResidents ?? 0;
            }
          }

          // Send progress after each segment
          sendEvent("simulation_progress", {
            current: i + 1,
            total,
            segment: seg,
          });
        }
      }

      // --- Final result ---
      sendEvent("complete", {
        networkLayerName: networkLayer.name,
        accidentLayerName: accidentLayer.name,
        totalAccidents: accidentFeatures.length,
        boundAccidents: boundCount,
        unboundAccidents: unboundCount,
        segmentsWithAccidents: baseSegments.length,
        segments: baseSegments,
      });

      return res.end();
    } catch (error: any) {
      console.error("[accident-analysis/stream] error:", error);
      sendEvent("error", { message: error.message || "Internal server error" });
      return res.end();
    }
  });

  app.post("/api/analytics/accident-analysis/save-buffer", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { segments, targetLayerId, bufferMeters = 5 } = req.body;

      if (!Array.isArray(segments) || segments.length === 0) {
        return res.status(400).json({ message: "segments array is required" });
      }
      if (!targetLayerId) {
        return res.status(400).json({ message: "targetLayerId is required" });
      }

      const targetLayer = await storage.getEditableLayer(Number(targetLayerId));
      if (!targetLayer) {
        return res.status(404).json({ message: "Target layer not found" });
      }

      const GEOM_TYPE_MAP: Record<string, string> = {
        linestring: "LineString", multilinestring: "MultiLineString",
        point: "Point", multipoint: "MultiPoint",
        polygon: "Polygon", multipolygon: "MultiPolygon",
      };

      const features: Array<{ layerId: number; geometryType: string; coordinates: any; properties: Record<string, unknown> }> = [];
      let errorCount = 0;

      for (const seg of segments) {
        try {
          const geom = seg.geometry;
          if (!geom || !geom.type) {
            console.warn(`[save-buffer] featureId=${seg.featureId}: missing geometry, skip`);
            errorCount++;
            continue;
          }

          // 1. Нормализовать тип геометрии
          const normalizedType = GEOM_TYPE_MAP[geom.type.toLowerCase()] ?? geom.type;

          // 2. Распарсить координаты, если строка
          let coords = geom.coordinates;
          if (typeof coords === "string") {
            try { coords = JSON.parse(coords); } catch { coords = []; }
          }
          if (!coords || (Array.isArray(coords) && coords.length === 0)) {
            console.warn(`[save-buffer] featureId=${seg.featureId}: empty coordinates, skip`);
            errorCount++;
            continue;
          }

          // 3. Нормализовать геометрию под буферизацию
          const isValidPt = (p: any) => Array.isArray(p) && p.length >= 2 && p.every((n: any) => typeof n === "number" && isFinite(n));
          let geomToBuffer: any;

          if (normalizedType === "LineString") {
            const cleaned = (coords as any[]).filter(isValidPt);
            if (cleaned.length === 0) {
              console.warn(`[save-buffer] featureId=${seg.featureId}: LineString no valid points, skip`);
              errorCount++;
              continue;
            }
            geomToBuffer = cleaned.length === 1
              ? { type: "Point", coordinates: cleaned[0] }
              : { type: "LineString", coordinates: cleaned };
          } else if (normalizedType === "MultiLineString") {
            const cleanedParts = (coords as any[][])
              .map(part => (Array.isArray(part) ? part : []).filter(isValidPt))
              .filter(part => part.length >= 2);
            if (cleanedParts.length === 0) {
              const firstPt = (coords as any[][])?.[0]?.[0];
              if (firstPt && isValidPt(firstPt)) {
                geomToBuffer = { type: "Point", coordinates: firstPt };
              } else {
                console.warn(`[save-buffer] featureId=${seg.featureId}: MultiLineString no valid parts, skip`);
                errorCount++;
                continue;
              }
            } else {
              geomToBuffer = { type: "MultiLineString", coordinates: cleanedParts };
            }
          } else {
            geomToBuffer = { type: normalizedType, coordinates: coords };
          }

          // 4. Буферизация
          const geoFeature = turf.feature(geomToBuffer);
          const buffered = turf.buffer(geoFeature, Number(bufferMeters), { units: "meters" });

          if (!buffered || !buffered.geometry || !Array.isArray(buffered.geometry.coordinates) || buffered.geometry.coordinates.length === 0) {
            console.warn(`[save-buffer] featureId=${seg.featureId}, type=${normalizedType}, coordsLen=${Array.isArray(coords) ? coords.length : "n/a"}: buffer returned empty`);
            errorCount++;
            continue;
          }

          const props: Record<string, unknown> = {
            Sys: seg.sys ?? "",
            Begin_uch: seg.beginUch ?? "",
            End_uch: seg.endUch ?? "",
            Dpod: seg.dpod ?? "",
            Dobr: seg.dobr ?? "",
            L: seg.length ?? "",
            AccidentCount: seg.accidentCount ?? 0,
          };
          if (seg.consumerCount !== null && seg.consumerCount !== undefined) {
            props.Kol_potreb = seg.consumerCount;
          }
          if (seg.residentCount !== null && seg.residentCount !== undefined) {
            props.Kol_zhit = seg.residentCount;
          }
          features.push({
            layerId: Number(targetLayerId),
            geometryType: buffered.geometry.type,
            coordinates: buffered.geometry.coordinates,
            properties: props,
          });
        } catch (segErr: any) {
          console.warn(`[save-buffer] Unexpected error featureId=${seg.featureId}:`, segErr.message);
          errorCount++;
        }
      }

      if (features.length === 0) {
        return res.status(422).json({ message: `Не удалось буферизовать ни одного участка. Ошибок: ${errorCount}. Возможно, координаты не в WGS84.` });
      }

      const created = await storage.createDrawnFeaturesBatch(features);

      // Mark layer as accident analysis result layer in metadata
      try {
        const existingMeta = (targetLayer.metadata as Record<string, unknown>) || {};
        await storage.updateEditableLayer(Number(targetLayerId), {
          metadata: {
            ...existingMeta,
            analysisType: "accident_analysis",
            analysisDate: new Date().toISOString(),
          },
        });
      } catch (metaErr: any) {
        console.warn("[save-buffer] Metadata update failed (non-fatal):", metaErr.message);
      }

      // Update layer schema so attribute table shows all saved fields
      try {
        // Determine which fields are present across all saved segments
        const allPropKeys = new Set<string>();
        for (const f of features) {
          Object.keys(f.properties).forEach(k => allPropKeys.add(k));
        }

        // Define field types for known accident-analysis attributes
        const knownTypes: Record<string, "text" | "number"> = {
          Sys: "text",
          Begin_uch: "text",
          End_uch: "text",
          Dpod: "text",
          Dobr: "text",
          L: "number",
          AccidentCount: "number",
          Kol_potreb: "number",
          Kol_zhit: "number",
        };

        const newFields: AttributeField[] = Array.from(allPropKeys).map(key => ({
          name: key,
          type: (knownTypes[key] ?? "text") as "text" | "number",
          required: false,
        }));

        const existingSchema = await storage.getLayerSchema(Number(targetLayerId));
        if (existingSchema) {
          const existingNames = new Set(existingSchema.fields.map((f: AttributeField) => f.name));
          const toAdd = newFields.filter(f => !existingNames.has(f.name));
          if (toAdd.length > 0) {
            await storage.updateLayerSchema(Number(targetLayerId), [...existingSchema.fields as AttributeField[], ...toAdd]);
          }
        } else {
          await storage.createLayerSchema({ layerId: Number(targetLayerId), fields: newFields });
        }
      } catch (schemaErr: any) {
        console.warn("[save-buffer] Schema update failed (non-fatal):", schemaErr.message);
      }

      return res.json({ saved: created.length, errors: errorCount, layerName: targetLayer.name, layerId: Number(targetLayerId) });
    } catch (error: any) {
      console.error("Buffer-save error:", error);
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  // ============================================
  // GEOSPATIAL ANALYSIS API (Advanced spatial analysis with filtering)
  // ============================================

  interface FilterCondition {
    attribute: string;
    operator: string;
    value: string;
  }

  function applyFilters(
    features: { geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }[],
    filters: FilterCondition[]
  ) {
    if (!filters || filters.length === 0) return features;

    return features.filter(feature => {
      return filters.every(condition => {
        if (!condition.attribute || condition.value === "") return true;

        const propValue = feature.properties?.[condition.attribute];
        const filterValue = condition.value;

        if (propValue === undefined || propValue === null) {
          return condition.operator === "!=" || condition.operator === "not_contains";
        }

        const propStr = String(propValue);
        const propNum = parseFloat(propStr);
        const filterNum = parseFloat(filterValue);

        switch (condition.operator) {
          case "=":
            return propStr === filterValue;
          case "!=":
            return propStr !== filterValue;
          case ">":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum > filterNum;
          case "<":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum < filterNum;
          case ">=":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum >= filterNum;
          case "<=":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum <= filterNum;
          case "contains":
            return propStr.toLowerCase().includes(filterValue.toLowerCase());
          case "not_contains":
            return !propStr.toLowerCase().includes(filterValue.toLowerCase());
          default:
            return true;
        }
      });
    });
  }

  function isFeatureNearLines(
    feature: { geometry: { type: string; coordinates: any } },
    lineFeatures: { geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }[],
    bufferDistanceMeters: number,
    mode: "inside" | "outside"
  ): boolean {
    try {
      const featureGeom = feature.geometry;
      let turfFeature: ReturnType<typeof turf.point> | ReturnType<typeof turf.lineString> | ReturnType<typeof turf.polygon> | ReturnType<typeof turf.multiLineString> | ReturnType<typeof turf.multiPolygon>;
      
      if (featureGeom.type === "Point") {
        turfFeature = turf.point(featureGeom.coordinates);
      } else if (featureGeom.type === "LineString") {
        turfFeature = turf.lineString(featureGeom.coordinates);
      } else if (featureGeom.type === "Polygon") {
        turfFeature = turf.polygon(featureGeom.coordinates);
      } else if (featureGeom.type === "MultiLineString") {
        turfFeature = turf.multiLineString(featureGeom.coordinates);
      } else if (featureGeom.type === "MultiPolygon") {
        turfFeature = turf.multiPolygon(featureGeom.coordinates);
      } else {
        return mode === "outside";
      }
      
      for (const lineFeature of lineFeatures) {
        try {
          let turfLine: ReturnType<typeof turf.lineString> | ReturnType<typeof turf.multiLineString>;
          
          if (lineFeature.geometry.type === "LineString") {
            turfLine = turf.lineString(lineFeature.geometry.coordinates);
          } else if (lineFeature.geometry.type === "MultiLineString") {
            turfLine = turf.multiLineString(lineFeature.geometry.coordinates);
          } else {
            continue;
          }
          
          const bufferedLine = turf.buffer(turfLine, bufferDistanceMeters, { units: "meters" });
          if (!bufferedLine) continue;
          
          let intersects = false;
          
          if (featureGeom.type === "Point") {
            intersects = turf.booleanPointInPolygon(turfFeature as ReturnType<typeof turf.point>, bufferedLine);
          } else {
            try {
              intersects = turf.booleanIntersects(turfFeature, bufferedLine);
            } catch {
              const centroid = turf.centroid(turfFeature);
              intersects = turf.booleanPointInPolygon(centroid, bufferedLine);
            }
          }
          
          if (intersects) {
            return mode === "inside";
          }
        } catch (e) {
          continue;
        }
      }
      
      return mode === "outside";
    } catch (e) {
      return mode === "outside";
    }
  }

  function isFeatureInBoundary(
    feature: { geometry: { type: string; coordinates: any } },
    polygonFeatures: { geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }[],
    mode: "inside" | "outside"
  ): boolean {
    try {
      const featureGeom = feature.geometry;
      let turfFeature: turf.Feature<any>;
      
      if (featureGeom.type === "Point") {
        turfFeature = turf.point(featureGeom.coordinates);
      } else if (featureGeom.type === "LineString") {
        turfFeature = turf.lineString(featureGeom.coordinates);
      } else if (featureGeom.type === "Polygon") {
        turfFeature = turf.polygon(featureGeom.coordinates);
      } else if (featureGeom.type === "MultiLineString") {
        turfFeature = turf.multiLineString(featureGeom.coordinates);
      } else if (featureGeom.type === "MultiPolygon") {
        turfFeature = turf.multiPolygon(featureGeom.coordinates);
      } else {
        return mode === "outside";
      }
      
      for (const boundary of polygonFeatures) {
        try {
          let turfBoundary: turf.Feature<turf.Polygon | turf.MultiPolygon>;
          
          if (boundary.geometry.type === "Polygon") {
            turfBoundary = turf.polygon(boundary.geometry.coordinates);
          } else if (boundary.geometry.type === "MultiPolygon") {
            turfBoundary = turf.multiPolygon(boundary.geometry.coordinates);
          } else {
            continue;
          }
          
          let intersects = false;
          
          if (featureGeom.type === "Point") {
            intersects = turf.booleanPointInPolygon(turfFeature as turf.Feature<turf.Point>, turfBoundary);
          } else {
            try {
              intersects = turf.booleanIntersects(turfFeature, turfBoundary);
            } catch {
              const centroid = turf.centroid(turfFeature);
              intersects = turf.booleanPointInPolygon(centroid, turfBoundary);
            }
          }
          
          if (intersects) {
            return mode === "inside";
          }
        } catch (e) {
          continue;
        }
      }
      
      return mode === "outside";
    } catch (e) {
      return mode === "outside";
    }
  }

  function getFeatureCentroid(
    feature: { geometry: { type: string; coordinates: any } }
  ): [number, number] | null {
    try {
      const geomType = feature.geometry.type;
      const coords = feature.geometry.coordinates;
      
      if (geomType === "Point") {
        return coords as [number, number];
      } else if (geomType === "LineString") {
        const line = turf.lineString(coords);
        const centroid = turf.centroid(line);
        return centroid.geometry.coordinates as [number, number];
      } else if (geomType === "Polygon") {
        const polygon = turf.polygon(coords);
        const centroid = turf.centroid(polygon);
        return centroid.geometry.coordinates as [number, number];
      } else if (geomType === "MultiLineString") {
        const multiLine = turf.multiLineString(coords);
        const centroid = turf.centroid(multiLine);
        return centroid.geometry.coordinates as [number, number];
      } else if (geomType === "MultiPolygon") {
        const multiPolygon = turf.multiPolygon(coords);
        const centroid = turf.centroid(multiPolygon);
        return centroid.geometry.coordinates as [number, number];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  app.post("/api/analytics/geospatial", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const {
        sourceLayerIds = [],
        sourceFilters = {},
        targetLayerId = null,
        targetFilters = [],
        boundaryLayerId,
        boundaryFilters = [],
        boundaryMode = "none",
        boundaryType = "polygon",
        bufferDistanceMeters = 10,
        maxDistanceMeters = 15,
        reportConfig = {},
      } = req.body;

      const {
        includeAttributes = {},
        includeSummary = true,
        format = "xlsx",
      } = reportConfig;

      if (!Array.isArray(sourceLayerIds) || sourceLayerIds.length === 0) {
        return res.status(400).json({ message: "sourceLayerIds must be a non-empty array" });
      }

      const isDistanceBinding = targetLayerId != null;

      if (!isDistanceBinding) {
        if (!boundaryLayerId || boundaryMode === "none") {
          return res.status(400).json({ message: "Boundary must be enabled when no target layer is selected" });
        }
      }

      if (boundaryType === "line" && boundaryMode !== "none" && boundaryLayerId) {
        const bufferNum = Number(bufferDistanceMeters);
        if (isNaN(bufferNum) || bufferNum <= 0) {
          return res.status(400).json({ message: "bufferDistanceMeters must be a positive number for line constraints" });
        }
      }

      let targetLayer: Awaited<ReturnType<typeof storage.getEditableLayer>> = null;
      let targetFeatures: { id: number; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }[] = [];

      if (isDistanceBinding) {
        targetLayer = await storage.getEditableLayer(targetLayerId);
        if (!targetLayer) {
          return res.status(404).json({ message: "Target layer not found" });
        }

        const targetFeaturesRaw = await storage.getDrawnFeatures(targetLayerId);
        targetFeatures = targetFeaturesRaw.map(f => ({
          id: f.id,
          geometry: { type: f.geometryType, coordinates: f.coordinates },
          properties: f.properties || {},
        }));
        targetFeatures = applyFilters(targetFeatures, targetFilters) as typeof targetFeatures;
      }

      let boundaryFeatures: { geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }[] = [];
      let boundaryLayer = null;

      if (boundaryLayerId && boundaryMode !== "none") {
        boundaryLayer = await storage.getEditableLayer(boundaryLayerId);
        if (boundaryLayer) {
          const boundaryFeaturesRaw = await storage.getDrawnFeatures(boundaryLayerId);
          boundaryFeatures = boundaryFeaturesRaw.map(f => ({
            geometry: { type: f.geometryType, coordinates: f.coordinates },
            properties: f.properties || {},
          }));
          boundaryFeatures = applyFilters(boundaryFeatures, boundaryFilters);
        }
      }

      if (isDistanceBinding && boundaryFeatures.length > 0 && (boundaryMode === "inside" || boundaryMode === "outside")) {
        if (boundaryType === "line") {
          targetFeatures = targetFeatures.filter(feature => {
            return isFeatureNearLines(feature, boundaryFeatures, bufferDistanceMeters, boundaryMode as "inside" | "outside");
          });
        } else {
          targetFeatures = targetFeatures.filter(feature => {
            return isFeatureInBoundary(feature, boundaryFeatures, boundaryMode as "inside" | "outside");
          });
        }
      }

      if (isDistanceBinding && targetFeatures.length === 0) {
        return res.status(422).json({ message: "No target features match the filters" });
      }

      if (isDistanceBinding) {
        const targetMatchCounts: Map<number, Map<string, number>> = new Map();
        const allSourceMatches: { sourceLayerId: number; sourceLayerName: string; sourceIdx: number; sourceFeature: any; targetIdx: number; distance: number }[] = [];
        let totalUnmatched = 0;
        let totalSourceCount = 0;

        const layerSummaries: { layerId: number; layerName: string; geometryType: string; totalCount: number; matchedCount: number }[] = [];

        const allSourcePropKeys = new Set<string>();

        for (const srcLayerId of sourceLayerIds) {
          const sourceLayer = await storage.getEditableLayer(srcLayerId);
          if (!sourceLayer) continue;

          const sourceFeaturesRaw = await storage.getDrawnFeatures(srcLayerId);
          let sourceFeatures = sourceFeaturesRaw.map(f => ({
            id: f.id,
            geometry: { type: f.geometryType, coordinates: f.coordinates },
            properties: f.properties || {},
          }));

          const layerFilters: FilterCondition[] = sourceFilters[String(srcLayerId)] || [];
          sourceFeatures = applyFilters(sourceFeatures, layerFilters) as typeof sourceFeatures;

          if (boundaryFeatures.length > 0 && (boundaryMode === "inside" || boundaryMode === "outside")) {
            if (boundaryType === "line") {
              sourceFeatures = sourceFeatures.filter(feature => {
                return isFeatureNearLines(feature, boundaryFeatures, bufferDistanceMeters, boundaryMode as "inside" | "outside");
              });
            } else {
              sourceFeatures = sourceFeatures.filter(feature => {
                return isFeatureInBoundary(feature, boundaryFeatures, boundaryMode as "inside" | "outside");
              });
            }
          }

          for (const feature of sourceFeatures) {
            Object.keys(feature.properties).forEach(k => allSourcePropKeys.add(k));
          }

          totalSourceCount += sourceFeatures.length;
          let layerMatchedCount = 0;

          for (let srcIdx = 0; srcIdx < sourceFeatures.length; srcIdx++) {
            const sourceFeature = sourceFeatures[srcIdx];
            const sourceCentroid = getFeatureCentroid(sourceFeature);

            if (!sourceCentroid) {
              totalUnmatched++;
              continue;
            }

            const sourcePoint = turf.point(sourceCentroid);
            let nearestTargetIndex = -1;
            let nearestDistance = Infinity;

            for (let tgtIdx = 0; tgtIdx < targetFeatures.length; tgtIdx++) {
              const targetFeature = targetFeatures[tgtIdx];

              try {
                let minDistForThisTarget = Infinity;
                const geomType = targetFeature.geometry.type;

                if (geomType === "Point") {
                  const targetPoint = turf.point(targetFeature.geometry.coordinates);
                  minDistForThisTarget = turf.distance(sourcePoint, targetPoint);
                } else if (geomType === "LineString") {
                  const line = turf.lineString(targetFeature.geometry.coordinates);
                  const nearestPoint = turf.nearestPointOnLine(line, sourcePoint);
                  if (nearestPoint.properties.dist !== undefined) {
                    minDistForThisTarget = nearestPoint.properties.dist;
                  }
                } else if (geomType === "MultiLineString") {
                  const coords = targetFeature.geometry.coordinates as number[][][];
                  for (const lineCoords of coords) {
                    if (lineCoords.length < 2) continue;
                    const line = turf.lineString(lineCoords);
                    const nearestPoint = turf.nearestPointOnLine(line, sourcePoint);
                    if (nearestPoint.properties.dist !== undefined && nearestPoint.properties.dist < minDistForThisTarget) {
                      minDistForThisTarget = nearestPoint.properties.dist;
                    }
                  }
                } else if (geomType === "Polygon") {
                  const polygon = turf.polygon(targetFeature.geometry.coordinates);
                  const targetCentroid = turf.centroid(polygon);
                  minDistForThisTarget = turf.distance(sourcePoint, targetCentroid);
                } else if (geomType === "MultiPolygon") {
                  const multiPolygon = turf.multiPolygon(targetFeature.geometry.coordinates);
                  const targetCentroid = turf.centroid(multiPolygon);
                  minDistForThisTarget = turf.distance(sourcePoint, targetCentroid);
                }

                if (minDistForThisTarget < nearestDistance) {
                  nearestDistance = minDistForThisTarget;
                  nearestTargetIndex = tgtIdx;
                }
              } catch (e) {
                continue;
              }
            }

            const distanceInMeters = nearestDistance * 1000;

            if (nearestTargetIndex >= 0 && distanceInMeters <= maxDistanceMeters) {
              if (!targetMatchCounts.has(nearestTargetIndex)) {
                targetMatchCounts.set(nearestTargetIndex, new Map());
              }
              const layerCounts = targetMatchCounts.get(nearestTargetIndex)!;
              layerCounts.set(String(srcLayerId), (layerCounts.get(String(srcLayerId)) || 0) + 1);

              allSourceMatches.push({
                sourceLayerId: srcLayerId,
                sourceLayerName: sourceLayer.name,
                sourceIdx: srcIdx,
                sourceFeature,
                targetIdx: nearestTargetIndex,
                distance: distanceInMeters,
              });
              layerMatchedCount++;
            } else {
              totalUnmatched++;
            }
          }

          layerSummaries.push({
            layerId: srcLayerId,
            layerName: sourceLayer.name,
            geometryType: sourceLayer.geometryType,
            totalCount: sourceFeatures.length,
            matchedCount: layerMatchedCount,
          });
        }

        if (format === "json") {
          const details: Record<string, any> = {};
          for (const ls of layerSummaries) {
            const layerMatchesForThis = allSourceMatches.filter(m => m.sourceLayerId === ls.layerId);
            const featuresOut = layerMatchesForThis.map(m => ({
              id: m.sourceFeature.id,
              properties: m.sourceFeature.properties,
            }));
            const allKeys = new Set<string>();
            for (const m of layerMatchesForThis) {
              Object.keys(m.sourceFeature.properties).forEach(k => allKeys.add(k));
            }
            details[String(ls.layerId)] = {
              layerName: ls.layerName,
              geometryType: ls.geometryType,
              availableAttributes: Array.from(allKeys).sort(),
              features: featuresOut,
            };
          }

          return res.json({
            mode: "distance-binding",
            summary: {
              totalObjects: totalSourceCount,
              boundaryLayerName: boundaryLayer ? boundaryLayer.name : null,
              boundaryCount: boundaryFeatures.length,
              targetLayerName: targetLayer ? targetLayer.name : null,
              byLayer: layerSummaries,
            },
            details,
          });
        }

        const workbook = new ExcelJS.Workbook();

        const resultsSheet = workbook.addWorksheet("Результаты привязки");

        const targetPropKeys = new Set<string>();
        for (const feature of targetFeatures) {
          Object.keys(feature.properties).forEach(k => targetPropKeys.add(k));
        }
        const targetPropKeysArr = Array.from(targetPropKeys).sort();

        const sourceLayerNames = layerSummaries.map(ls => ls.layerName);

        const columns = [
          { header: "ID объекта", key: "id", width: 12 },
          ...targetPropKeysArr.map(k => ({ header: k, key: k, width: 15 })),
          { header: "Количество привязок (всего)", key: "match_count_total", width: 22 },
          ...sourceLayerNames.map((name, idx) => ({ header: `Привязки: ${name}`, key: `match_layer_${idx}`, width: 20 })),
        ];
        resultsSheet.columns = columns;

        resultsSheet.getRow(1).font = { bold: true };
        resultsSheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" },
        };

        const rows: any[] = [];
        for (let i = 0; i < targetFeatures.length; i++) {
          const feature = targetFeatures[i];
          const layerCounts = targetMatchCounts.get(i);
          let totalCount = 0;

          const row: Record<string, any> = {
            id: (feature as any).id || i + 1,
          };

          for (const key of targetPropKeysArr) {
            row[key] = feature.properties[key] ?? "";
          }

          for (let idx = 0; idx < layerSummaries.length; idx++) {
            const cnt = layerCounts ? (layerCounts.get(String(layerSummaries[idx].layerId)) || 0) : 0;
            row[`match_layer_${idx}`] = cnt;
            totalCount += cnt;
          }

          row.match_count_total = totalCount;
          rows.push(row);
        }

        const filteredRows = rows.filter(r => r.match_count_total > 0);
        filteredRows.sort((a, b) => b.match_count_total - a.match_count_total);

        for (const row of filteredRows) {
          resultsSheet.addRow(row);
        }

        const detailsSheet = workbook.addWorksheet("Детали привязок");

        const sourcePropKeysArr = Array.from(allSourcePropKeys).sort();

        detailsSheet.columns = [
          { header: "Слой", key: "source_layer", width: 20 },
          { header: "Исходный ID", key: "source_id", width: 12 },
          ...sourcePropKeysArr.map(k => ({ header: `Исх: ${k}`, key: `src_${k}`, width: 15 })),
          { header: "Целевой ID", key: "target_id", width: 12 },
          ...targetPropKeysArr.map(k => ({ header: `Цел: ${k}`, key: `tgt_${k}`, width: 15 })),
          { header: "Расстояние (м)", key: "distance", width: 15 },
        ];

        detailsSheet.getRow(1).font = { bold: true };
        detailsSheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" },
        };

        for (const match of allSourceMatches) {
          const targetFeature = targetFeatures[match.targetIdx];

          const detailRow: Record<string, any> = {
            source_layer: match.sourceLayerName,
            source_id: match.sourceFeature.id || 0,
            target_id: (targetFeature as any).id || match.targetIdx + 1,
            distance: Math.round(match.distance * 100) / 100,
          };

          for (const key of sourcePropKeysArr) {
            detailRow[`src_${key}`] = match.sourceFeature.properties[key] ?? "";
          }
          for (const key of targetPropKeysArr) {
            detailRow[`tgt_${key}`] = targetFeature.properties[key] ?? "";
          }

          detailsSheet.addRow(detailRow);
        }

        const metaSheet = workbook.addWorksheet("Метаданные");
        metaSheet.columns = [
          { header: "Параметр", key: "param", width: 35 },
          { header: "Значение", key: "value", width: 50 },
        ];
        metaSheet.getRow(1).font = { bold: true };

        metaSheet.addRow({ param: "Дата анализа", value: new Date().toLocaleString("ru-RU") });
        metaSheet.addRow({ param: "Исходные слои", value: layerSummaries.map(ls => ls.layerName).join(", ") });
        for (const ls of layerSummaries) {
          const layerFilters: FilterCondition[] = sourceFilters[String(ls.layerId)] || [];
          metaSheet.addRow({ param: `Фильтры слоя "${ls.layerName}"`, value: layerFilters.length > 0 ? layerFilters.map((f: FilterCondition) => `${f.attribute} ${f.operator} ${f.value}`).join("; ") : "Без фильтров" });
        }
        metaSheet.addRow({ param: "Целевой слой", value: targetLayer!.name });
        metaSheet.addRow({ param: "Фильтры целевого слоя", value: targetFilters.length > 0 ? targetFilters.map((f: FilterCondition) => `${f.attribute} ${f.operator} ${f.value}`).join("; ") : "Без фильтров" });

        if (boundaryLayer && boundaryMode !== "none") {
          metaSheet.addRow({ param: "Ограничивающий слой", value: boundaryLayer.name });
          metaSheet.addRow({ param: "Тип ограничения", value: boundaryType === "line" ? "Линейный" : "Полигональный" });
          if (boundaryType === "line") {
            metaSheet.addRow({ param: "Буферная зона (м)", value: bufferDistanceMeters });
            metaSheet.addRow({ param: "Режим ограничения", value: boundaryMode === "inside" ? "Вблизи линий" : "Вдали от линий" });
          } else {
            metaSheet.addRow({ param: "Режим ограничения", value: boundaryMode === "inside" ? "Внутри полигонов" : "Вне полигонов" });
          }
          metaSheet.addRow({ param: "Фильтры ограничивающего слоя", value: boundaryFilters.length > 0 ? boundaryFilters.map((f: FilterCondition) => `${f.attribute} ${f.operator} ${f.value}`).join("; ") : "Без фильтров" });
        }

        metaSheet.addRow({ param: "Порог расстояния (м)", value: maxDistanceMeters });
        metaSheet.addRow({ param: "Всего исходных объектов (после фильтров)", value: totalSourceCount });
        metaSheet.addRow({ param: "Всего целевых объектов (после фильтров)", value: targetFeatures.length });
        metaSheet.addRow({ param: "Привязано объектов", value: totalSourceCount - totalUnmatched });
        metaSheet.addRow({ param: "Непривязано объектов", value: totalUnmatched });
        metaSheet.addRow({
          param: "Целевых объектов с привязками",
          value: Array.from(targetMatchCounts.keys()).length,
        });

        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="geospatial_analysis_${Date.now()}.xlsx"`);
        return res.send(Buffer.from(buffer));
      }

      const layerResults: {
        layerId: number;
        layerName: string;
        geometryType: string;
        totalCount: number;
        matchedCount: number;
        features: { id: number; properties: Record<string, unknown> }[];
        availableAttributes: string[];
      }[] = [];

      let totalMatchedObjects = 0;

      for (const srcLayerId of sourceLayerIds) {
        const sourceLayer = await storage.getEditableLayer(srcLayerId);
        if (!sourceLayer) continue;

        const featuresRaw = await storage.getDrawnFeatures(srcLayerId);
        let features = featuresRaw.map(f => ({
          id: f.id,
          geometry: { type: f.geometryType, coordinates: f.coordinates },
          properties: f.properties || {},
        }));

        const layerFilters: FilterCondition[] = sourceFilters[String(srcLayerId)] || [];
        features = applyFilters(features, layerFilters) as typeof features;

        const totalCount = features.length;

        const matchedFeatures = features.filter(feature =>
          isFeatureInBoundary(feature, boundaryFeatures, boundaryMode as "inside" | "outside")
        );

        const allPropKeys = new Set<string>();
        for (const f of featuresRaw) {
          if (f.properties) {
            Object.keys(f.properties).forEach(k => allPropKeys.add(k));
          }
        }
        const availableAttributes = Array.from(allPropKeys).sort();

        const selectedAttrs: string[] | null = includeAttributes[String(srcLayerId)];
        const outputFeatures = matchedFeatures.map(f => {
          let props = f.properties;
          if (selectedAttrs && selectedAttrs.length > 0) {
            const filtered: Record<string, unknown> = {};
            for (const attr of selectedAttrs) {
              if (attr in props) {
                filtered[attr] = props[attr];
              }
            }
            props = filtered;
          }
          return { id: f.id, properties: props };
        });

        totalMatchedObjects += matchedFeatures.length;

        layerResults.push({
          layerId: srcLayerId,
          layerName: sourceLayer.name,
          geometryType: sourceLayer.geometryType,
          totalCount,
          matchedCount: matchedFeatures.length,
          features: outputFeatures,
          availableAttributes,
        });
      }

      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();

        if (includeSummary) {
          const summarySheet = workbook.addWorksheet("Сводка");
          summarySheet.columns = [
            { header: "Слой", key: "layer", width: 30 },
            { header: "Тип геометрии", key: "geomType", width: 18 },
            { header: "Всего объектов", key: "total", width: 16 },
            { header: "Попало в полигон", key: "matched", width: 18 },
          ];
          summarySheet.getRow(1).font = { bold: true };
          summarySheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

          for (const lr of layerResults) {
            summarySheet.addRow({
              layer: lr.layerName,
              geomType: lr.geometryType === "Point" ? "Точка" : lr.geometryType === "LineString" ? "Линия" : "Полигон",
              total: lr.totalCount,
              matched: lr.matchedCount,
            });
          }

          summarySheet.addRow({});
          summarySheet.addRow({ layer: "ИТОГО", matched: totalMatchedObjects });
        }

        for (const lr of layerResults) {
          if (lr.matchedCount === 0) continue;

          const sheetName = lr.layerName.substring(0, 31).replace(/[\\/*?:\[\]]/g, "_");
          const detailSheet = workbook.addWorksheet(sheetName);

          const propKeys = new Set<string>();
          for (const f of lr.features) {
            Object.keys(f.properties).forEach(k => propKeys.add(k));
          }
          const propKeysArr = Array.from(propKeys).sort();

          detailSheet.columns = [
            { header: "ID", key: "id", width: 10 },
            ...propKeysArr.map(k => ({ header: k, key: k, width: 18 })),
          ];
          detailSheet.getRow(1).font = { bold: true };
          detailSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

          for (const f of lr.features) {
            const row: Record<string, any> = { id: f.id };
            for (const k of propKeysArr) {
              row[k] = f.properties[k] ?? "";
            }
            detailSheet.addRow(row);
          }
        }

        const metaSheet = workbook.addWorksheet("Метаданные");
        metaSheet.columns = [
          { header: "Параметр", key: "param", width: 35 },
          { header: "Значение", key: "value", width: 50 },
        ];
        metaSheet.getRow(1).font = { bold: true };
        metaSheet.addRow({ param: "Дата анализа", value: new Date().toLocaleString("ru-RU") });
        metaSheet.addRow({ param: "Ограничивающий слой (полигоны)", value: boundaryLayer ? boundaryLayer.name : "" });
        metaSheet.addRow({ param: "Количество полигонов", value: boundaryFeatures.length });
        metaSheet.addRow({ param: "Режим ограничения", value: boundaryMode === "inside" ? "Внутри полигонов" : "Вне полигонов" });
        metaSheet.addRow({ param: "Анализируемые слои", value: layerResults.map(lr => lr.layerName).join(", ") });
        metaSheet.addRow({ param: "Всего найдено объектов", value: totalMatchedObjects });

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="geospatial_analysis_${Date.now()}.xlsx"`);
        return res.send(Buffer.from(buffer));
      }

      return res.json({
        mode: "boundary-only",
        summary: {
          totalObjects: totalMatchedObjects,
          boundaryLayerName: boundaryLayer ? boundaryLayer.name : null,
          boundaryCount: boundaryFeatures.length,
          targetLayerName: null,
          byLayer: layerResults.map(lr => ({
            layerId: lr.layerId,
            layerName: lr.layerName,
            geometryType: lr.geometryType,
            totalCount: lr.totalCount,
            matchedCount: lr.matchedCount,
          })),
        },
        details: Object.fromEntries(
          layerResults.map(lr => [
            lr.layerId,
            {
              layerName: lr.layerName,
              geometryType: lr.geometryType,
              availableAttributes: lr.availableAttributes,
              features: lr.features,
            },
          ])
        ),
      });
    } catch (error) {
      console.error("Geospatial analysis error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // EDITABLE LAYERS API (User-created layers for drawing)
  // ============================================

  app.get("/api/editable-layers", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const layers = await storage.getEditableLayers();
      return res.json(layers);
    } catch (error) {
      console.error("Error fetching editable layers:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get editable layers for a scene
  app.get("/api/scenes/:sceneId/editable-layers", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const layers = await storage.getEditableLayersByScene(sceneId);
      return res.json(layers);
    } catch (error) {
      console.error("Error fetching scene editable layers:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/scenes/:sceneId/extent", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;

      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }

      const result = await db.execute(sql`
        SELECT 
          MIN(df.bbox_min_x) as min_x,
          MIN(df.bbox_min_y) as min_y,
          MAX(df.bbox_max_x) as max_x,
          MAX(df.bbox_max_y) as max_y,
          COUNT(*)::int as feature_count
        FROM drawn_features df
        INNER JOIN editable_layers el ON df.layer_id = el.id
        WHERE el.scene_id = ${sceneId}
          AND df.bbox_min_x IS NOT NULL
          AND df.bbox_min_y IS NOT NULL
          AND df.bbox_max_x IS NOT NULL
          AND df.bbox_max_y IS NOT NULL
      `);

      const row = result.rows[0] as any;
      if (!row || row.min_x == null || row.feature_count === 0) {
        return res.json({ extent: null, featureCount: 0 });
      }

      return res.json({
        extent: [
          parseFloat(row.min_x),
          parseFloat(row.min_y),
          parseFloat(row.max_x),
          parseFloat(row.max_y),
        ],
        featureCount: row.feature_count,
      });
    } catch (error) {
      console.error("Error fetching scene extent:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Layer folders endpoints
  app.get("/api/scenes/:sceneId/folders", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      const folders = await storage.getLayerFolders(sceneId);
      return res.json(folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scenes/:sceneId/folders", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      const folder = await storage.createLayerFolder({ sceneId, name: name.trim() });
      return res.json(folder);
    } catch (error) {
      console.error("Error creating folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/folders/:folderId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = parseIntParam(req.params.folderId, res);
      if (folderId === null) return;
      const { name, visible } = req.body;
      const updates: Partial<{ name: string; visible: number }> = {};
      if (name !== undefined) updates.name = name;
      if (visible !== undefined) updates.visible = visible ? 1 : 0;
      const folder = await storage.updateLayerFolder(folderId, updates);
      if (!folder) return res.status(404).json({ message: "Folder not found" });
      return res.json(folder);
    } catch (error) {
      console.error("Error updating folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/folders/:folderId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = parseIntParam(req.params.folderId, res);
      if (folderId === null) return;
      const deleted = await storage.deleteLayerFolder(folderId);
      if (!deleted) return res.status(404).json({ message: "Folder not found" });
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/folders/:folderId/toggle-visibility", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = parseIntParam(req.params.folderId, res);
      if (folderId === null) return;
      const { visible } = req.body;
      await storage.toggleFolderVisibility(folderId, !!visible);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error toggling folder visibility:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/editable-layers/:id/folder", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const layerId = parseIntParam(req.params.id, res);
      if (layerId === null) return;
      const { folderId, displayOrder } = req.body;
      const layer = await storage.setLayerFolder(layerId, folderId ?? null, displayOrder);
      if (!layer) return res.status(404).json({ message: "Layer not found" });
      return res.json(layer);
    } catch (error) {
      console.error("Error setting layer folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/editable-layers/reorder", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { layerIds, displayOrders } = req.body;
      if (!Array.isArray(layerIds) || layerIds.some((id: unknown) => typeof id !== "number")) {
        return res.status(400).json({ message: "layerIds must be an array of numbers" });
      }
      const orders = Array.isArray(displayOrders) && displayOrders.length === layerIds.length ? displayOrders : undefined;
      await storage.reorderLayers(layerIds, orders);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error reordering layers:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/layer-folders/reorder", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { folderIds, displayOrders } = req.body;
      if (!Array.isArray(folderIds) || folderIds.some((id: unknown) => typeof id !== "number")) {
        return res.status(400).json({ message: "folderIds must be an array of numbers" });
      }
      const orders = Array.isArray(displayOrders) && displayOrders.length === folderIds.length ? displayOrders : undefined;
      await storage.reorderFolders(folderIds, orders);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error reordering folders:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/viewport-batch", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { layerIds, minX, minY, maxX, maxY, zoom, limit, forceRefresh } = req.query;
      if (!layerIds || !minX || !minY || !maxX || !maxY) {
        return res.status(400).json({ message: "Missing required parameters: layerIds, minX, minY, maxX, maxY" });
      }

      const ids = (layerIds as string).split(",").map(Number).filter(n => !isNaN(n));
      if (ids.length === 0) {
        return res.json({ layers: {} });
      }

      const featureLimit = limit ? parseInt(limit as string) : 10000;
      const zoomLevel = zoom ? parseInt(zoom as string) : 10;
      const isForceRefresh = forceRefresh === "1";

      const roundedBbox = {
        minX: Math.floor(parseFloat(minX as string) * 100) / 100,
        minY: Math.floor(parseFloat(minY as string) * 100) / 100,
        maxX: Math.ceil(parseFloat(maxX as string) * 100) / 100,
        maxY: Math.ceil(parseFloat(maxY as string) * 100) / 100,
      };

      const simplifyGroup = zoomLevel >= 14 ? 14 : zoomLevel >= 12 ? 12 : zoomLevel >= 10 ? 10 : zoomLevel >= 9 ? 9 : zoomLevel >= 8 ? 8 : zoomLevel >= 7 ? 7 : zoomLevel >= 6 ? 6 : zoomLevel >= 5 ? 5 : zoomLevel >= 4 ? 4 : 0;
      const cacheKey = `${ids.sort().join(",")}_${roundedBbox.minX}_${roundedBbox.minY}_${roundedBbox.maxX}_${roundedBbox.maxY}_${simplifyGroup}_${featureLimit}`;

      if (!isForceRefresh) {
        const cached = viewportCacheGet(cacheKey);
        if (cached) {
          const clientEtag = req.headers["if-none-match"];
          if (clientEtag === `"${cached.etag}"`) {
            return res.status(304).end();
          }
          res.set("ETag", `"${cached.etag}"`);
          res.set("Cache-Control", "private, max-age=15");
          return res.json(cached.data);
        }
      }

      const tolerance = getSimplifyTolerance(zoomLevel);

      const bbox = {
        minX: parseFloat(minX as string),
        minY: parseFloat(minY as string),
        maxX: parseFloat(maxX as string),
        maxY: parseFloat(maxY as string),
      };

      const featuresByLayer = await storage.getDrawnFeaturesByViewport(ids, bbox, featureLimit);

      const result: Record<number, { features: any[]; total: number; limited: boolean }> = {};
      for (const id of ids) {
        const features = featuresByLayer[id] || [];
        const { sampled, totalPoints, samplingRate } = samplePointFeatures(features, zoomLevel);
        const simplified = sampled.map(feature => {
          const coords = (tolerance > 0 && feature.geometryType !== "Point")
            ? simplifyFeatureGeometry(feature.coordinates, feature.geometryType, tolerance)
            : feature.coordinates;
          return {
            id: feature.id,
            layerId: feature.layerId,
            geometryType: feature.geometryType,
            coordinates: coords,
            properties: feature.properties || {},
          };
        });
        result[id] = {
          features: simplified,
          total: features.length,
          limited: features.length >= featureLimit,
        };
      }

      const responseData = { layers: result, zoom: zoomLevel };
      const entry = viewportCacheSet(cacheKey, responseData);
      res.set("ETag", `"${entry.etag}"`);
      res.set("Cache-Control", "private, max-age=15");
      return res.json(responseData);
    } catch (error) {
      console.error("Batch viewport features error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:id/field-stats", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const field = req.query.field as string;
      if (!field) {
        return res.status(400).json({ message: "Missing field parameter" });
      }
      const features = await storage.getDrawnFeatures(id);
      const nums: number[] = [];
      for (const f of features) {
        const raw = (f.properties as Record<string, unknown>)?.[field];
        if (raw !== undefined && raw !== null) {
          const n = Number(raw);
          if (!isNaN(n)) nums.push(n);
        }
      }
      if (nums.length === 0) {
        return res.json({ min: 0, max: 100, count: 0 });
      }
      nums.sort((a, b) => a - b);
      return res.json({
        min: nums[0],
        max: nums[nums.length - 1],
        count: nums.length,
      });
    } catch (error) {
      console.error("Error fetching field stats:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:id/unique-values", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const field = req.query.field as string;
      if (!field) {
        return res.status(400).json({ message: "Missing field parameter" });
      }
      const features = await storage.getDrawnFeatures(id);
      const valueSet = new Set<string>();
      for (const f of features) {
        const val = (f.properties as Record<string, unknown>)?.[field];
        if (val !== undefined && val !== null) {
          valueSet.add(String(val));
        }
      }
      const values = Array.from(valueSet).sort();
      return res.json({ values });
    } catch (error) {
      console.error("Error fetching unique values:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const layer = await storage.getEditableLayer(id);
      if (!layer) {
        return res.status(404).json({ message: "Layer not found" });
      }
      return res.json(layer);
    } catch (error) {
      console.error("Error fetching editable layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/editable-layers", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertEditableLayerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid layer data", errors: parsed.error.errors });
      }
      const layer = await storage.createEditableLayer(parsed.data);
      logAction({ action: "layer_create", entityType: "layer", entityId: layer.id, sceneId: parsed.data.sceneId ?? undefined, details: { name: parsed.data.name, geometryType: parsed.data.geometryType } });
      return res.status(201).json(layer);
    } catch (error) {
      console.error("Error creating editable layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/editable-layers/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      if (req.body.styleConfig !== undefined) {
        const parsed = styleConfigSchema.safeParse(req.body.styleConfig);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid styleConfig", errors: parsed.error.errors });
        }
        req.body.styleConfig = parsed.data;
      }
      if (req.body.networkType !== undefined && req.body.networkType !== null) {
        const parsed = networkTypeSchema.safeParse(req.body.networkType);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid networkType", errors: parsed.error.errors });
        }
        req.body.networkType = parsed.data;
      }
      const layer = await storage.updateEditableLayer(id, req.body);
      if (!layer) {
        return res.status(404).json({ message: "Layer not found" });
      }
      return res.json(layer);
    } catch (error) {
      console.error("Error updating editable layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/editable-layers/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteEditableLayer(id);
      if (!deleted) {
        return res.status(404).json({ message: "Layer not found" });
      }
      logAction({ action: "layer_delete", entityType: "layer", entityId: id });
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting editable layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // DRAWN FEATURES API (Features within editable layers)
  // ============================================

  app.get("/api/editable-layers/:layerId/features", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const features = await storage.getDrawnFeatures(layerId);
      return res.json(features);
    } catch (error) {
      console.error("Error fetching drawn features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:layerId/attributes", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const features = await storage.getDrawnFeatures(layerId);
      const attrSet = new Set<string>();
      const sampleSize = Math.min(features.length, 100);
      for (let i = 0; i < sampleSize; i++) {
        if (features[i].properties) {
          Object.keys(features[i].properties as Record<string, unknown>).forEach(k => attrSet.add(k));
        }
      }
      return res.json(Array.from(attrSet).sort());
    } catch (error) {
      console.error("Error fetching layer attributes:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:layerId/attribute-values", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const features = await storage.getDrawnFeatures(layerId);
      const attrSet = new Set<string>();
      const valuesMap: Record<string, Set<string>> = {};

      for (const feature of features) {
        if (feature.properties) {
          for (const [key, val] of Object.entries(feature.properties as Record<string, unknown>)) {
            attrSet.add(key);
            if (!valuesMap[key]) valuesMap[key] = new Set();
            if (val !== null && val !== undefined && val !== "" && valuesMap[key].size < 200) {
              const strVal = String(val).trim();
              if (strVal !== "") valuesMap[key].add(strVal);
            }
          }
        }
      }

      const result: Record<string, string[]> = {};
      for (const [key, valSet] of Object.entries(valuesMap)) {
        result[key] = Array.from(valSet).sort();
      }

      return res.json({
        attrs: Array.from(attrSet).sort(),
        values: result,
        totalFeatures: features.length,
      });
    } catch (error) {
      console.error("Error fetching attribute values:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/editable-layers/:layerId/count-filtered", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const { filters = [] } = req.body;
      const featuresRaw = await storage.getDrawnFeatures(layerId);
      const features = featuresRaw.map(f => ({
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));
      const filtered = applyFilters(features, filters);
      return res.json({ count: filtered.length, total: features.length });
    } catch (error) {
      console.error("Error counting filtered features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/features/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const source = req.query.source as string | undefined;
      
      if (source === "dataset") {
        const datasetFeature = await storage.getDatasetFeature(id);
        if (datasetFeature) return res.json(datasetFeature);
      } else {
        const feature = await storage.getDrawnFeature(id);
        if (feature) return res.json(feature);
        const datasetFeature = await storage.getDatasetFeature(id);
        if (datasetFeature) return res.json(datasetFeature);
      }
      return res.status(404).json({ message: "Feature not found" });
    } catch (error) {
      console.error("Error fetching feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/editable-layers/:layerId/features", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const parsed = insertDrawnFeatureSchema.safeParse({ ...req.body, layerId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid feature data", errors: parsed.error.errors });
      }
      const feature = await storage.createDrawnFeature(parsed.data);
      invalidateViewportCache();
      logAction({ action: "feature_create", entityType: "feature", entityId: feature.id, details: { layerId } });
      return res.status(201).json(feature);
    } catch (error) {
      console.error("Error creating drawn feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Batch routes must be defined BEFORE routes with :id parameter to avoid matching "batch" as id
  app.post("/api/features/batch-delete", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid request: ids must be a non-empty array" });
      }
      const result = await storage.deleteDrawnFeaturesBatch(ids);
      invalidateViewportCache();
      logAction({ action: "feature_batch_delete", entityType: "feature", details: { count: ids.length } });
      return res.json(result);
    } catch (error) {
      console.error("Error batch deleting features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/features/batch", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: "Invalid request: updates must be a non-empty array" });
      }
      
      const validUpdates = updates.filter((u: any) => 
        typeof u.id === 'number' && !isNaN(u.id) && u.properties && typeof u.properties === 'object'
      );
      if (validUpdates.length === 0) {
        return res.status(400).json({ message: "No valid updates provided" });
      }
      const result = await storage.updateDrawnFeaturesBatch(validUpdates);
      invalidateViewportCache();
      logAction({ action: "feature_batch_update", entityType: "feature", details: { count: validUpdates.length } });
      return res.json(result);
    } catch (error) {
      console.error("Error batch updating features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/features/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const feature = await storage.updateDrawnFeature(id, req.body);
      if (!feature) {
        return res.status(404).json({ message: "Feature not found" });
      }
      invalidateViewportCache();
      logAction({ action: "feature_update", entityType: "feature", entityId: id });
      return res.json(feature);
    } catch (error) {
      console.error("Error updating drawn feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/features/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteDrawnFeature(id);
      if (!deleted) {
        return res.status(404).json({ message: "Feature not found" });
      }
      invalidateViewportCache();
      logAction({ action: "feature_delete", entityType: "feature", entityId: id });
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting drawn feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete feature by layerId and featureId (alternative endpoint for map-viewer)
  app.delete("/api/editable-layers/:layerId/features/:featureId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const featureId = parseInt(req.params.featureId);
      
      if (isNaN(layerId) || isNaN(featureId)) {
        return res.status(400).json({ message: "Invalid layer or feature ID" });
      }
      
      const deleted = await storage.deleteDrawnFeature(featureId);
      if (!deleted) {
        return res.status(404).json({ message: "Feature not found" });
      }
      invalidateViewportCache();
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting feature from layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // LAYER SCHEMA API (Attribute definitions for layers)
  // ============================================

  app.get("/api/editable-layers/:layerId/schema", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const schema = await storage.getLayerSchema(layerId);
      if (!schema) {
        // Return empty fields if no schema defined yet
        return res.json({ layerId, fields: [] });
      }
      return res.json(schema);
    } catch (error) {
      console.error("Error fetching layer schema:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  const handleUpsertLayerSchema = async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const fieldsSchema = z.array(attributeFieldSchema);
      const parsed = fieldsSchema.safeParse(req.body.fields);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid schema data", errors: parsed.error.errors });
      }

      // Check if schema exists
      let schema = await storage.getLayerSchema(layerId);
      if (schema) {
        schema = await storage.updateLayerSchema(layerId, parsed.data);
      } else {
        schema = await storage.createLayerSchema({ layerId, fields: parsed.data });
      }

      return res.json(schema);
    } catch (error) {
      console.error("Error updating layer schema:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };
  app.put("/api/editable-layers/:layerId/schema", isAuthenticated as any, handleUpsertLayerSchema);
  app.patch("/api/editable-layers/:layerId/schema", isAuthenticated as any, handleUpsertLayerSchema);

  // ============================================
  // EXPORT API (Export layers to various formats)
  // ============================================

  app.get("/api/editable-layers/:layerId/export/:format", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const format = req.params.format.toLowerCase();
      
      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ message: "Layer not found" });
      }

      const features = await storage.getDrawnFeatures(layerId);
      
      if (format === "geojson") {
        const geojson = {
          type: "FeatureCollection",
          features: features.map(f => ({
            type: "Feature",
            geometry: {
              type: f.geometryType,
              coordinates: f.coordinates,
            },
            properties: { ...f.properties, id: f.id },
          })),
        };
        
        res.setHeader("Content-Type", "application/geo+json");
        res.setHeader("Content-Disposition", `attachment; filename="${layer.name}.geojson"`);
        return res.json(geojson);
      }
      
      if (format === "shapefile" || format === "shp") {
        const { exportShapefile } = await import("./shapefile-writer");
        const exportFeatures = features.map(f => ({
          geometryType: f.geometryType,
          coordinates: f.coordinates,
          properties: f.properties as Record<string, unknown>,
        }));
        const zipBuffer = await exportShapefile(exportFeatures, layer.name, layer.geometryType);
        
        const encodedName = encodeURIComponent(layer.name);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${encodedName}.zip"; filename*=UTF-8''${encodedName}.zip`);
        return res.send(zipBuffer);
      }

      return res.status(400).json({ message: `Unsupported format: ${format}. Supported: geojson, shapefile` });
    } catch (error) {
      console.error("Error exporting layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // APP SETTINGS API
  // ============================================

  app.get("/api/settings/geocode-provider", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const value = await storage.getAppSetting("geocode_provider");
      return res.json({ provider: value || "yandex" });
    } catch (error) {
      console.error("Error getting geocode provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/settings/geocode-provider", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = geocodeProviderSchema.safeParse(req.body?.provider);
      if (!parsed.success) {
        return res.status(400).json({ message: "Некорректный провайдер. Допустимые значения: yandex, dadata" });
      }
      await storage.setAppSetting("geocode_provider", parsed.data);
      return res.json({ provider: parsed.data });
    } catch (error) {
      console.error("Error setting geocode provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // ADMIN API KEYS MANAGEMENT
  // ============================================

  const MANAGED_KEYS = [
    "geocode_yandex_api_key",
    "geocode_dadata_api_key",
  ] as const;

  function maskSecret(value: string): string {
    if (value.length <= 4) return "****";
    return "****" + value.slice(-4);
  }

  app.get("/api/settings/keys", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result: Record<string, { masked: string; isSet: boolean }> = {};
      for (const key of MANAGED_KEYS) {
        const value = await storage.getAppSetting(key);
        if (value) {
          result[key] = { masked: maskSecret(value), isSet: true };
        } else {
          result[key] = { masked: "", isSet: false };
        }
      }
      return res.json(result);
    } catch (error) {
      console.error("Error getting keys:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/settings/keys", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { key, value } = req.body;
      if (!key || typeof key !== "string" || !MANAGED_KEYS.includes(key as any)) {
        return res.status(400).json({ message: "Недопустимый ключ" });
      }
      if (typeof value !== "string") {
        return res.status(400).json({ message: "Значение должно быть строкой" });
      }
      if (value.trim() === "") {
        return res.status(400).json({ message: "Значение не может быть пустым" });
      }
      await storage.setAppSetting(key, value.trim());
      return res.json({ success: true, masked: maskSecret(value.trim()) });
    } catch (error) {
      console.error("Error setting key:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/settings/keys/:key", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const key = req.params.key;
      if (!MANAGED_KEYS.includes(key as any)) {
        return res.status(400).json({ message: "Недопустимый ключ" });
      }
      await storage.deleteAppSetting(key);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting key:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/settings/ai-enabled", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const value = await storage.getAppSetting("ai_enabled");
      return res.json({ enabled: value === "true" });
    } catch (error) {
      console.error("Error getting AI enabled:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/settings/ai-enabled", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const enabled = !!req.body?.enabled;
      await storage.setAppSetting("ai_enabled", String(enabled));
      return res.json({ enabled });
    } catch (error) {
      console.error("Error setting AI enabled:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/ai-providers", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const providers = await storage.getAiProviders();
      const masked = providers.map(p => ({
        ...p,
        apiKey: p.apiKey ? "****" + p.apiKey.slice(-4) : null,
      }));
      return res.json(masked);
    } catch (error) {
      console.error("Error getting AI providers:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/ai-providers", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { name, baseUrl, apiKey, model, isActive, isDefault } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "Название провайдера обязательно" });
      }
      const provider = await storage.createAiProvider({
        name: name.trim(),
        baseUrl: baseUrl?.trim() || null,
        apiKey: apiKey?.trim() || null,
        model: model?.trim() || null,
        isActive: isActive ?? true,
        isDefault: isDefault ?? false,
      });
      return res.status(201).json({
        ...provider,
        apiKey: provider.apiKey ? "****" + provider.apiKey.slice(-4) : null,
      });
    } catch (error) {
      console.error("Error creating AI provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/admin/ai-providers/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Некорректный ID" });
      }
      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = req.body.name.trim();
      if (req.body.baseUrl !== undefined) updates.baseUrl = req.body.baseUrl?.trim() || null;
      if (req.body.apiKey !== undefined) updates.apiKey = req.body.apiKey?.trim() || null;
      if (req.body.model !== undefined) updates.model = req.body.model?.trim() || null;
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      if (req.body.isDefault !== undefined) updates.isDefault = req.body.isDefault;

      if (updates.isDefault === true) {
        const allProviders = await storage.getAiProviders();
        for (const p of allProviders) {
          if (p.id !== id && p.isDefault) {
            await storage.updateAiProvider(p.id, { isDefault: false });
          }
        }
      }

      const provider = await storage.updateAiProvider(id, updates as any);
      if (!provider) {
        return res.status(404).json({ message: "Провайдер не найден" });
      }
      return res.json({
        ...provider,
        apiKey: provider.apiKey ? "****" + provider.apiKey.slice(-4) : null,
      });
    } catch (error) {
      console.error("Error updating AI provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/admin/ai-providers/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Некорректный ID" });
      }
      const deleted = await storage.deleteAiProvider(id);
      if (!deleted) {
        return res.status(404).json({ message: "Провайдер не найден" });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting AI provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/ai-providers/test", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      let { baseUrl, apiKey, model, providerId } = req.body;

      if (!apiKey && providerId) {
        const existingProvider = await storage.getAiProvider(parseInt(providerId));
        if (existingProvider) {
          apiKey = existingProvider.apiKey;
          if (!baseUrl) baseUrl = existingProvider.baseUrl;
          if (!model) model = existingProvider.model;
        }
      }

      if (!baseUrl || !apiKey) {
        return res.status(400).json({ success: false, message: "Base URL и API-ключ обязательны для тестирования" });
      }

      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 15000 });

      const completion = await client.chat.completions.create({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: "Ответь одним словом: работает" }],
        max_tokens: 10,
      });

      const text = completion.choices?.[0]?.message?.content;
      if (text) {
        return res.json({ success: true, message: `Соединение успешно. Ответ модели: "${text}"` });
      } else {
        return res.json({ success: false, message: "Модель не вернула ответ" });
      }
    } catch (error: any) {
      console.error("AI provider test error:", error);
      let message = "Ошибка подключения";
      if (error.status === 401 || error.code === "authentication_error") {
        message = "Ошибка авторизации: неверный API-ключ";
      } else if (error.status === 404) {
        message = "Модель не найдена или неверный Base URL";
      } else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        message = "Сервер недоступен: проверьте Base URL";
      } else if (error.message) {
        message = error.message.substring(0, 200);
      }
      return res.json({ success: false, message });
    }
  });

  // ============================================
  // AUDIT LOG API (Admin only)
  // ============================================

  app.get("/api/admin/audit-log", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const conditions: any[] = [];

      if (req.query.userId && typeof req.query.userId === "string") {
        conditions.push(eq(auditLog.userId, req.query.userId));
      }
      if (req.query.action && typeof req.query.action === "string") {
        conditions.push(eq(auditLog.action, req.query.action));
      }
      if (req.query.entityType && typeof req.query.entityType === "string") {
        conditions.push(eq(auditLog.entityType, req.query.entityType));
      }
      if (req.query.dateFrom && typeof req.query.dateFrom === "string") {
        conditions.push(gte(auditLog.createdAt, new Date(req.query.dateFrom)));
      }
      if (req.query.dateTo && typeof req.query.dateTo === "string") {
        const dateTo = new Date(req.query.dateTo);
        dateTo.setDate(dateTo.getDate() + 1);
        conditions.push(lte(auditLog.createdAt, dateTo));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalResult] = await db
        .select({ total: count() })
        .from(auditLog)
        .where(whereClause);

      const entries = await db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset);

      return res.json({
        entries,
        total: totalResult?.total || 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult?.total || 0) / limit),
      });
    } catch (error) {
      console.error("Error fetching audit log:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/audit-log/actions", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const actions = await db
        .selectDistinct({ action: auditLog.action })
        .from(auditLog)
        .orderBy(auditLog.action);
      return res.json(actions.map((a) => a.action));
    } catch (error) {
      console.error("Error fetching audit actions:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // REVERSE GEOCODING API (Address landmarks)
  // ============================================

  const activeGeocodeLayers = new Set<number>();

  app.post("/api/editable-layers/:layerId/geocode", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    const layerId = parseIntParam(req.params.layerId, res);
    if (layerId === null) return;
    let keepaliveInterval: ReturnType<typeof setInterval> | undefined;

    try {
      if (activeGeocodeLayers.has(layerId)) {
        return res.status(409).json({ message: "Геокодирование этого слоя уже выполняется. Дождитесь завершения." });
      }

      const forceOverwrite = req.body?.forceOverwrite === true;
      const providerSetting = await storage.getAppSetting("geocode_provider");
      const provider: GeocodeProvider = providerSetting === "dadata" ? "dadata" : "yandex";

      let apiKey: string | undefined;
      if (provider === "dadata") {
        apiKey = (await storage.getAppSetting("geocode_dadata_api_key")) || process.env.DADATA_API_KEY;
        if (!apiKey) {
          return res.status(500).json({ message: "DaData API ключ не настроен. Добавьте ключ в Администрирование → Геокодирование." });
        }
      } else {
        apiKey = (await storage.getAppSetting("geocode_yandex_api_key")) || process.env.YANDEX_GEOCODER_API_KEY;
        if (!apiKey) {
          return res.status(500).json({ message: "Яндекс Геокодер API ключ не настроен. Добавьте ключ в Администрирование → Геокодирование." });
        }
      }
      const useDadata = provider === "dadata";

      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ message: "Слой не найден" });
      }

      const features = await storage.getDrawnFeatures(layerId);
      if (features.length === 0) {
        return res.status(400).json({ message: "В слое нет объектов" });
      }

      const isLine = layer.geometryType === "LineString" || layer.geometryType === "MultiLineString";
      const isPoint = layer.geometryType === "Point" || layer.geometryType === "MultiPoint";

      if (!isLine && !isPoint) {
        return res.status(400).json({ message: `Геокодирование не поддерживается для геометрии типа ${layer.geometryType}` });
      }

      try {
        const existingSchema = await storage.getLayerSchema(layerId);
        const existingFields: AttributeField[] = existingSchema ? (existingSchema.fields as AttributeField[]) : [];
        const existingNames = new Set(existingFields.map((f: AttributeField) => f.name));

        const newFields: AttributeField[] = [];
        if (isLine) {
          if (!existingNames.has("addr_begin")) {
            newFields.push({ name: "addr_begin", type: "text", required: false });
          }
          if (!existingNames.has("addr_end")) {
            newFields.push({ name: "addr_end", type: "text", required: false });
          }
          if (useDadata) {
            if (!existingNames.has("fias_begin")) {
              newFields.push({ name: "fias_begin", type: "text", required: false });
            }
            if (!existingNames.has("fias_end")) {
              newFields.push({ name: "fias_end", type: "text", required: false });
            }
          }
        } else {
          if (!existingNames.has("addr_point")) {
            newFields.push({ name: "addr_point", type: "text", required: false });
          }
          if (useDadata) {
            if (!existingNames.has("fias_point")) {
              newFields.push({ name: "fias_point", type: "text", required: false });
            }
          }
        }

        if (newFields.length > 0) {
          const updatedFields = [...existingFields, ...newFields];
          if (existingSchema) {
            await storage.updateLayerSchema(layerId, updatedFields);
          } else {
            await storage.createLayerSchema({ layerId, fields: updatedFields });
          }
          console.log(`[Geocoder] Schema updated for layer ${layerId}: added fields ${newFields.map(f => f.name).join(", ")}`);
        }
      } catch (schemaErr) {
        console.error("Error updating layer schema with geocode fields:", schemaErr);
      }

      activeGeocodeLayers.add(layerId);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let clientConnected = true;
      const abortController = new AbortController();

      req.on("close", () => {
        clientConnected = false;
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        abortController.abort();
        console.log(`[Geocoder] Client disconnected for layer ${layerId}`);
      });

      keepaliveInterval = setInterval(() => {
        if (clientConnected) {
          try {
            res.write(`:keepalive\n\n`);
          } catch {}
        }
      }, 5000);

      const sendSSE = (data: any) => {
        if (!clientConnected) return;
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {}
      };

      const batchItems: ReverseGeocodeBatchItem[] = [];
      const featureMap = new Map<number, { feature: typeof features[0]; skipBegin: boolean; skipEnd: boolean; skipPoint: boolean }>();

      for (const feature of features) {
        const props = (feature.properties || {}) as Record<string, unknown>;
        const coords = feature.coordinates as any;

        if (isLine) {
          const skipBegin = !forceOverwrite && typeof props.addr_begin === "string" && props.addr_begin.length > 0;
          const skipEnd = !forceOverwrite && typeof props.addr_end === "string" && props.addr_end.length > 0;

          if (skipBegin && skipEnd) continue;

          let firstCoord: number[] | null = null;
          let lastCoord: number[] | null = null;

          if (feature.geometryType === "MultiLineString" && Array.isArray(coords) && coords.length > 0) {
            const firstSegment = coords[0];
            const lastSegment = coords[coords.length - 1];
            if (Array.isArray(firstSegment) && firstSegment.length > 0) {
              firstCoord = firstSegment[0];
            }
            if (Array.isArray(lastSegment) && lastSegment.length > 0) {
              lastCoord = lastSegment[lastSegment.length - 1];
            }
          } else if (Array.isArray(coords) && coords.length >= 2) {
            firstCoord = coords[0];
            lastCoord = coords[coords.length - 1];
          }

          if (!firstCoord && !lastCoord) continue;

          const coordsToGeocode: { lon: number; lat: number }[] = [];
          if (!skipBegin && firstCoord) {
            coordsToGeocode.push({ lon: firstCoord[0], lat: firstCoord[1] });
          }
          if (!skipEnd && lastCoord) {
            coordsToGeocode.push({ lon: lastCoord[0], lat: lastCoord[1] });
          }

          if (coordsToGeocode.length === 0) continue;

          featureMap.set(feature.id, { feature, skipBegin, skipEnd, skipPoint: false });
          batchItems.push({ featureId: feature.id, coords: coordsToGeocode });
        } else {
          const skipPoint = !forceOverwrite && typeof props.addr_point === "string" && props.addr_point.length > 0;
          if (skipPoint) continue;

          let lon: number, lat: number;
          if (feature.geometryType === "MultiPoint" && Array.isArray(coords) && coords.length > 0) {
            [lon, lat] = coords[0];
          } else if (Array.isArray(coords)) {
            [lon, lat] = coords;
          } else {
            continue;
          }

          featureMap.set(feature.id, { feature, skipBegin: false, skipEnd: false, skipPoint: false });
          batchItems.push({ featureId: feature.id, coords: [{ lon, lat }] });
        }
      }

      if (batchItems.length === 0) {
        activeGeocodeLayers.delete(layerId);
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        sendSSE({ type: "complete", processed: 0, total: 0, success: 0, skipped: features.length, saved: 0 });
        res.end();
        return;
      }

      let totalRequests = 0;
      for (const item of batchItems) {
        totalRequests += item.coords.length;
      }

      const CHUNK_SIZE = 50;
      const totalChunks = Math.ceil(batchItems.length / CHUNK_SIZE);
      let globalProcessed = 0;
      let successCount = 0;
      let errorCount = 0;

      sendSSE({ type: "start", total: totalRequests, features: batchItems.length, totalFeatures: features.length });

      let lastSSETime = Date.now();
      const SSE_THROTTLE_MS = 2000;

      try {
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          if (abortController.signal.aborted) break;

          const chunkStart = chunkIdx * CHUNK_SIZE;
          const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, batchItems.length);
          const chunk = batchItems.slice(chunkStart, chunkEnd);

          const chunkResults = await reverseGeocodeBatch(
            chunk,
            apiKey,
            (processed, total) => {
              const now = Date.now();
              if (now - lastSSETime >= SSE_THROTTLE_MS) {
                sendSSE({ type: "progress", processed: globalProcessed + processed, total: totalRequests, saved: successCount });
                lastSSETime = now;
              }
            },
            abortController.signal,
            provider
          );

          let chunkCoordsCount = 0;
          for (const item of chunk) {
            chunkCoordsCount += item.coords.length;
          }

          for (const result of chunkResults) {
            const info = featureMap.get(result.featureId);
            if (!info) continue;

            const props = { ...((info.feature.properties || {}) as Record<string, unknown>) };
            let updated = false;

            if (isLine) {
              let addrIdx = 0;
              if (!info.skipBegin && result.addresses[addrIdx] !== undefined) {
                props.addr_begin = result.addresses[addrIdx] || "";
                if (useDadata && result.fiasIds[addrIdx]) {
                  props.fias_begin = result.fiasIds[addrIdx];
                }
                addrIdx++;
                updated = true;
              }
              if (!info.skipEnd && result.addresses[addrIdx] !== undefined) {
                props.addr_end = result.addresses[addrIdx] || "";
                if (useDadata && result.fiasIds[addrIdx]) {
                  props.fias_end = result.fiasIds[addrIdx];
                }
                updated = true;
              }
            } else {
              if (result.addresses[0] !== undefined) {
                props.addr_point = result.addresses[0] || "";
                if (useDadata && result.fiasIds[0]) {
                  props.fias_point = result.fiasIds[0];
                }
                updated = true;
              }
            }

            if (updated) {
              await storage.updateDrawnFeature(result.featureId, { properties: props });
              successCount++;
            }

            if (result.error) {
              errorCount++;
            }
          }

          globalProcessed += chunkCoordsCount;

          sendSSE({ type: "progress", processed: globalProcessed, total: totalRequests, saved: successCount });
          lastSSETime = Date.now();
          console.log(`[Geocoder] Chunk ${chunkIdx + 1}/${totalChunks} saved: ${successCount} total saved, ${globalProcessed}/${totalRequests} processed`);
        }
      } catch (error: any) {
        console.error(`[Geocoder] Error during geocoding layer ${layerId}: ${error.message}. Saved ${successCount} objects before error.`);
        activeGeocodeLayers.delete(layerId);
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        sendSSE({ type: "error", message: error.message || "Ошибка геокодирования", saved: successCount, processed: globalProcessed, total: totalRequests });
        res.end();
        return;
      }

      activeGeocodeLayers.delete(layerId);
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      sendSSE({
        type: "complete",
        processed: totalRequests,
        total: totalRequests,
        success: successCount,
        errors: errorCount,
        skipped: features.length - batchItems.length,
        saved: successCount,
      });
      res.end();
    } catch (error) {
      activeGeocodeLayers.delete(layerId);
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      console.error("Error in reverse geocoding:", error);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Internal server error" });
      }
      res.end();
    }
  });

  app.get("/api/editable-layers/:layerId/geocode-info", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ message: "Слой не найден" });
      }

      const providerSetting = await storage.getAppSetting("geocode_provider");
      const provider: GeocodeProvider = providerSetting === "dadata" ? "dadata" : "yandex";

      const features = await storage.getDrawnFeatures(layerId);
      const isLine = layer.geometryType === "LineString" || layer.geometryType === "MultiLineString";
      const isPoint = layer.geometryType === "Point" || layer.geometryType === "MultiPoint";

      let alreadyGeocoded = 0;
      let needsGeocoding = 0;
      let requestsNeeded = 0;

      for (const feature of features) {
        const props = (feature.properties || {}) as Record<string, unknown>;
        if (isLine) {
          const hasBegin = typeof props.addr_begin === "string" && props.addr_begin.length > 0;
          const hasEnd = typeof props.addr_end === "string" && props.addr_end.length > 0;
          if (hasBegin && hasEnd) {
            alreadyGeocoded++;
          } else {
            needsGeocoding++;
            if (!hasBegin) requestsNeeded++;
            if (!hasEnd) requestsNeeded++;
          }
        } else if (isPoint) {
          if (typeof props.addr_point === "string" && props.addr_point.length > 0) {
            alreadyGeocoded++;
          } else {
            needsGeocoding++;
            requestsNeeded++;
          }
        }
      }
      const rps = provider === "dadata" ? 10 : 40;
      const estimatedSeconds = Math.ceil(requestsNeeded / rps) + 1;

      let fields: string[];
      if (isLine) {
        fields = provider === "dadata"
          ? ["addr_begin", "addr_end", "fias_begin", "fias_end"]
          : ["addr_begin", "addr_end"];
      } else {
        fields = provider === "dadata"
          ? ["addr_point", "fias_point"]
          : ["addr_point"];
      }

      return res.json({
        layerId,
        layerName: layer.name,
        geometryType: layer.geometryType,
        isLine,
        isPoint,
        totalFeatures: features.length,
        alreadyGeocoded,
        needsGeocoding,
        requestsNeeded,
        estimatedSeconds,
        fields,
        provider,
      });
    } catch (error) {
      console.error("Error getting geocode info:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // SCENE FOLDERS API
  // ============================================

  app.get("/api/scene-folders", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const folders = await storage.getSceneFolders();

      if (user.role === "admin") {
        return res.json(folders);
      }

      const userScenes = await storage.getScenesForUser(user.id);
      const directFolderIds = new Set(
        userScenes.map(s => s.folderId).filter((id): id is number => id !== null && id !== undefined)
      );

      const folderMap = new Map(folders.map(f => [f.id, f]));
      const visibleFolderIds = new Set<number>();

      for (const folder of folders) {
        if (folder.createdBy === user.id || directFolderIds.has(folder.id)) {
          let current: typeof folder | undefined = folder;
          while (current && !visibleFolderIds.has(current.id)) {
            visibleFolderIds.add(current.id);
            current = current.parentId ? folderMap.get(current.parentId) : undefined;
          }
        }
      }

      const visibleFolders = folders.filter(folder => visibleFolderIds.has(folder.id));
      return res.json(visibleFolders);
    } catch (error) {
      console.error("Error getting scene folders:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scene-folders", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { name, parentId } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "Name is required" });
      }
      const folder = await storage.createSceneFolder({ name, parentId: parentId ?? null, createdBy: user.id });
      return res.status(201).json(folder);
    } catch (error) {
      console.error("Error creating scene folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/scene-folders/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const folderId = parseIntParam(req.params.id, res);
      if (folderId === null) return;
      const existingFolder = await storage.getSceneFolder(folderId);
      if (!existingFolder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      if (existingFolder.createdBy !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      const { name, parentId } = req.body;
      const updates: Partial<{ name: string; parentId: number | null }> = {};
      if (name !== undefined) updates.name = name;
      if (parentId !== undefined) updates.parentId = parentId;
      const folder = await storage.updateSceneFolder(folderId, updates);
      return res.json(folder);
    } catch (error) {
      console.error("Error updating scene folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/scene-folders/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const folderId = parseIntParam(req.params.id, res);
      if (folderId === null) return;
      const existingFolder = await storage.getSceneFolder(folderId);
      if (!existingFolder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      if (existingFolder.createdBy !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteSceneFolder(folderId);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scene folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // SCENES API
  // ============================================

  // Get scenes for current user
  app.get("/api/scenes", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Admin sees all scenes
      if (user.role === "admin") {
        const allScenes = await storage.getScenes();
        const scenesWithRole = await Promise.all(allScenes.map(async scene => {
          const membership = await storage.getSceneMember(scene.id, user.id);
          return { ...scene, role: membership?.role || "owner" };
        }));
        return res.json(scenesWithRole);
      }
      
      const scenes = await storage.getScenesForUser(user.id);
      return res.json(scenes);
    } catch (error) {
      console.error("Error getting scenes:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get single scene
  app.get("/api/scenes/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.id, res);
      if (sceneId === null) return;
      
      const scene = await storage.getScene(sceneId);
      if (!scene) {
        return res.status(404).json({ message: "Scene not found" });
      }
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      return res.json({ ...scene, role: membership?.role || "owner" });
    } catch (error) {
      console.error("Error getting scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create scene
  app.post("/api/scenes", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { name, description, folderId } = req.body;
      
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const scene = await storage.createScene({ name, description, folderId: folderId ?? null, createdBy: user.id });
      logAction({ userId: user.id, action: "scene_create", entityType: "scene", entityId: scene.id, details: { name } });
      return res.status(201).json({ ...scene, role: "owner" });
    } catch (error) {
      console.error("Error creating scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update scene
  app.patch("/api/scenes/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.id, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      if (membership?.role === "viewer") {
        return res.status(403).json({ message: "Viewers cannot edit scenes" });
      }
      
      const { name, description, folderId } = req.body;
      const updates: Partial<{ name: string; description: string; folderId: number | null }> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (folderId !== undefined) updates.folderId = folderId;
      const scene = await storage.updateScene(sceneId, updates);
      return res.json(scene);
    } catch (error) {
      console.error("Error updating scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete scene
  app.delete("/api/scenes/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.id, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (membership?.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ message: "Only owners can delete scenes" });
      }
      
      await storage.deleteScene(sceneId);
      logAction({ userId: user.id, action: "scene_delete", entityType: "scene", entityId: sceneId });
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // SCENE MEMBERS API
  // ============================================

  // Get scene members
  app.get("/api/scenes/:sceneId/members", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const members = await storage.getSceneMembers(sceneId);
      return res.json(members);
    } catch (error) {
      console.error("Error getting scene members:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Add scene member
  app.post("/api/scenes/:sceneId/members", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (membership?.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ message: "Only owners can add members" });
      }
      
      const { userId: newUserId, role } = req.body;
      if (!newUserId || !role) {
        return res.status(400).json({ message: "userId and role are required" });
      }
      
      const existing = await storage.getSceneMember(sceneId, newUserId);
      if (existing) {
        return res.status(400).json({ message: "User is already a member" });
      }
      
      const member = await storage.addSceneMember(sceneId, newUserId, role);
      logAction({ userId: user.id, action: "scene_member_add", entityType: "scene", entityId: sceneId, sceneId, details: { memberId: newUserId, role } });
      return res.status(201).json(member);
    } catch (error) {
      console.error("Error adding scene member:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update member role
  app.patch("/api/scenes/:sceneId/members/:memberId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      const memberId = req.params.memberId;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (membership?.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ message: "Only owners can update member roles" });
      }
      
      const { role } = req.body;
      const member = await storage.updateSceneMemberRole(sceneId, memberId, role);
      return res.json(member);
    } catch (error) {
      console.error("Error updating member role:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Remove member
  app.delete("/api/scenes/:sceneId/members/:memberId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      const memberId = req.params.memberId;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (membership?.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ message: "Only owners can remove members" });
      }
      
      await storage.removeSceneMember(sceneId, memberId);
      logAction({ userId: user.id, action: "scene_member_remove", entityType: "scene", entityId: sceneId, sceneId });
      return res.json({ success: true });
    } catch (error) {
      console.error("Error removing member:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // DATASETS API
  // ============================================

  // Get all datasets
  app.get("/api/datasets", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasets = await storage.getDatasets();
      return res.json(datasets);
    } catch (error) {
      console.error("Error getting datasets:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Import shapefile as editable layer (unified with drawing layers)
  app.post("/api/datasets/import", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { name, geometryType, geojson, sourceFileName, sourceFiles, crs, sceneId, color } = req.body;
      
      if (!name || !geometryType || !geojson) {
        return res.status(400).json({ 
          message: "Missing required fields: name, geometryType, geojson" 
        });
      }
      
      const features = geojson.features || [];
      
      // Extract field schema from first feature properties
      let fieldSchema: Array<{ name: string; type: string; required: boolean }> = [];
      if (features.length > 0 && features[0].properties) {
        fieldSchema = Object.keys(features[0].properties).map(key => ({
          name: key,
          type: typeof features[0].properties[key] === 'number' ? 'number' : 'text',
          required: false
        }));
      }
      
      // Create editable layer (unified approach)
      const layer = await storage.createEditableLayer({
        sceneId: sceneId || null,
        name,
        geometryType,
        color: color || "#1976D2",
        pointStyle: "circle",
        lineStyle: "solid",
        visible: true,
        opacity: 1,
        source: "import",
        sourceFileName: sourceFileName || name,
        sourceFiles: sourceFiles || [],
        crs: crs || "EPSG:4326",
      });
      
      // Create layer schema from shapefile fields
      if (fieldSchema.length > 0) {
        await storage.createLayerSchema({
          layerId: layer.id,
          fields: fieldSchema as any,
        });
      }
      
      // Batch create drawn features in chunks to avoid PostgreSQL 65535 parameter limit
      if (features.length > 0) {
        const BATCH_SIZE = 1000;
        for (let i = 0; i < features.length; i += BATCH_SIZE) {
          const batch = features.slice(i, i + BATCH_SIZE);
          const insertFeatures = batch.map((feature: any) => ({
            layerId: layer.id,
            geometryType: feature.geometry?.type || geometryType,
            coordinates: feature.geometry?.coordinates || [],
            properties: feature.properties || {},
          }));
          await storage.createDrawnFeaturesBatch(insertFeatures);
        }
      }
      
      // Fetch updated layer with correct feature count
      const updatedLayer = await storage.getEditableLayer(layer.id);
      
      return res.status(201).json(updatedLayer);
    } catch (error) {
      console.error("Import layer error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Background shapefile processing function
  async function processShapefileInBackground(uploadId: number, filePath: string, originalName: string, sceneId: number | null, color: string) {
    try {
      await storage.updateUpload(uploadId, { status: "processing", progress: 5 });

      const fileBuffer = fs.readFileSync(filePath);

      const validation = validateShapefileBuffer(fileBuffer);
      if (!validation.valid) {
        await storage.updateUpload(uploadId, { status: "failed", error: validation.error || "Невалидный шейпфайл", progress: 0 });
        return;
      }

      await storage.updateUpload(uploadId, { progress: 10 });

      const parseResult = await parseShapefileBuffer(fileBuffer);
      const baseName = originalName.replace(/\.zip$/i, "");

      await storage.updateUpload(uploadId, { progress: 30, totalFeatures: parseResult.features.length });

      let fieldSchema: Array<{ name: string; type: string; required: boolean }> = [];
      if (parseResult.features.length > 0 && parseResult.features[0].properties) {
        fieldSchema = Object.keys(parseResult.features[0].properties).map(key => ({
          name: key,
          type: typeof parseResult.features[0].properties[key] === 'number' ? 'number' : 'text',
          required: false
        }));
      }

      const normalizedType = normalizeGeometryType(parseResult.geometryType);
      const layer = await storage.createEditableLayer({
        sceneId,
        name: baseName,
        geometryType: normalizedType,
        color: color || "#1976D2",
        pointStyle: "circle",
        lineStyle: "solid",
        visible: true,
        opacity: 1,
        source: "import",
        sourceFileName: originalName,
        sourceFiles: parseResult.fileList,
        crs: parseResult.crs,
      });

      if (fieldSchema.length > 0) {
        await storage.createLayerSchema({
          layerId: layer.id,
          fields: fieldSchema as any,
        });
      }

      await storage.updateUpload(uploadId, { progress: 40, layerId: layer.id });

      const BATCH_SIZE = 1000;
      const totalFeatures = parseResult.features.length;
      let processedFeatures = 0;

      for (let i = 0; i < totalFeatures; i += BATCH_SIZE) {
        const batch = parseResult.features.slice(i, i + BATCH_SIZE);
        const insertFeatures = batch.map((feature) => ({
          layerId: layer.id,
          geometryType: feature.geometry?.type || parseResult.geometryType,
          coordinates: feature.geometry?.coordinates || [],
          properties: feature.properties || {},
        }));
        await storage.createDrawnFeaturesBatch(insertFeatures);

        processedFeatures += batch.length;
        const progress = Math.round(40 + (processedFeatures / totalFeatures) * 55);
        await storage.updateUpload(uploadId, { progress, processedFeatures });
      }

      await storage.updateUpload(uploadId, { status: "completed", progress: 100, processedFeatures: totalFeatures, layerId: layer.id });
    } catch (error: any) {
      console.error(`[Upload ${uploadId}] Background processing error:`, error);
      await storage.updateUpload(uploadId, { status: "failed", error: error?.message || "Ошибка обработки шейпфайла" });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }
  }

  // Server-side shapefile upload — returns immediately, processes in background
  app.post("/api/datasets/upload", isAuthenticated as any, (req: AuthRequest, res: Response, next: any) => {
    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);
    next();
  }, upload.single("file"), async (req: AuthRequest, res: Response) => {
    let filePath: string | null = null;
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (!checkUploadRateLimit(user.id)) {
        return res.status(429).json({ message: "Слишком много загрузок. Подождите минуту и попробуйте снова." });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (file.size > LARGE_FILE_THRESHOLD && user.role !== "admin") {
        if (file.path && fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
        }
        return res.status(403).json({ message: `Файлы размером более 100 МБ доступны только администраторам. Размер вашего файла: ${(file.size / (1024 * 1024)).toFixed(0)} МБ` });
      }

      filePath = file.path;
      const { sceneId, color } = req.body;
      const originalName = file.originalname;

      const uploadRecord = await storage.createUpload({
        filename: path.basename(filePath),
        originalFilename: originalName,
        createdBy: user.id,
        sceneId: sceneId ? parseInt(sceneId) : null,
        color: color || null,
      });

      processShapefileInBackground(uploadRecord.id, filePath, originalName, sceneId ? parseInt(sceneId) : null, color || "#1976D2");

      return res.status(202).json({ uploadId: uploadRecord.id, message: "Файл принят в обработку" });
    } catch (error: any) {
      console.error("Upload shapefile error:", error);
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
      const errorMessage = error?.message || "Failed to process shapefile";
      return res.status(500).json({ message: errorMessage });
    }
  });

  // SSE endpoint for upload progress
  app.get("/api/uploads/:id/progress", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    const user = await getUserFromSession(req);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ message: "Invalid upload ID" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    req.on("close", () => { closed = true; });

    const sendEvent = (data: Record<string, unknown>) => {
      if (!closed) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const poll = async () => {
      while (!closed) {
        try {
          const upload = await storage.getUpload(uploadId);
          if (!upload) {
            sendEvent({ status: "failed", error: "Загрузка не найдена", progress: 0 });
            break;
          }

          sendEvent({
            status: upload.status,
            progress: upload.progress,
            totalFeatures: upload.totalFeatures,
            processedFeatures: upload.processedFeatures,
            layerId: upload.layerId,
            error: upload.error,
          });

          if (upload.status === "completed" || upload.status === "failed") {
            break;
          }
        } catch (err) {
          console.error(`[Upload SSE ${uploadId}] Error:`, err);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!closed) {
        res.end();
      }
    };

    poll();
  });

  // Get features by viewport (bbox) with geometry simplification
  app.get("/api/editable-layers/:id/features/viewport", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const layerId = parseIntParam(req.params.id, res);
      if (layerId === null) return;
      const { minX, minY, maxX, maxY, zoom, limit } = req.query;
      const featureLimit = limit ? parseInt(limit as string) : 5000; // Default limit 5000 features

      // Get all features for the layer
      const allFeatures = await storage.getDrawnFeatures(layerId);
      
      // If no bbox provided, return all (for compatibility)
      if (!minX || !minY || !maxX || !maxY) {
        const limitedFeatures = allFeatures.slice(0, featureLimit);
        return res.json({
          features: limitedFeatures,
          total: allFeatures.length,
          limited: allFeatures.length > featureLimit,
        });
      }

      const bbox = {
        minX: parseFloat(minX as string),
        minY: parseFloat(minY as string),
        maxX: parseFloat(maxX as string),
        maxY: parseFloat(maxY as string),
      };

      const zoomLevel = zoom ? parseInt(zoom as string) : 10;
      const tolerance = getSimplifyTolerance(zoomLevel);

      // Filter features by bbox and simplify geometry
      const filteredFeatures = allFeatures.filter(feature => {
        const coords = feature.coordinates;
        if (!coords) return false;

        // Get feature bounds
        const bounds = getFeatureBounds(coords, feature.geometryType);
        if (!bounds) return true; // Include if can't determine bounds

        // Check intersection with viewport
        const intersects = !(bounds.maxX < bbox.minX || bounds.minX > bbox.maxX ||
                 bounds.maxY < bbox.minY || bounds.minY > bbox.maxY);
        
        return intersects;
      });

      // Apply limit before simplification for performance
      const limitedFeatures = filteredFeatures.slice(0, featureLimit);

      // Apply point sampling based on zoom level (GIS-style approach)
      const { sampled: sampledFeatures, totalPoints, samplingRate } = samplePointFeatures(limitedFeatures, zoomLevel);

      const simplifiedFeatures = sampledFeatures.map(feature => {
        const coords = (tolerance > 0 && feature.geometryType !== "Point")
          ? simplifyFeatureGeometry(feature.coordinates, feature.geometryType, tolerance)
          : feature.coordinates;
        return {
          id: feature.id,
          layerId: feature.layerId,
          geometryType: feature.geometryType,
          coordinates: coords,
        };
      });

      return res.json({
        features: simplifiedFeatures,
        total: filteredFeatures.length,
        limited: filteredFeatures.length > featureLimit,
        pointSampling: {
          totalPoints,
          sampledPoints: samplingRate === Infinity ? 0 : Math.ceil(totalPoints / samplingRate),
          samplingRate: samplingRate === Infinity ? 0 : samplingRate,
          isFullData: samplingRate === 1,
        },
      });
    } catch (error) {
      console.error("Get viewport features error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get dataset
  app.get("/api/datasets/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseIntParam(req.params.id, res);
      if (datasetId === null) return;
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).json({ message: "Dataset not found" });
      }
      return res.json(dataset);
    } catch (error) {
      console.error("Error getting dataset:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete dataset
  app.delete("/api/datasets/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseIntParam(req.params.id, res);
      if (datasetId === null) return;
      await storage.deleteDataset(datasetId);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting dataset:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get dataset features
  app.get("/api/datasets/:id/features", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseIntParam(req.params.id, res);
      if (datasetId === null) return;
      const features = await storage.getDatasetFeatures(datasetId);
      return res.json(features);
    } catch (error) {
      console.error("Error getting dataset features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get dataset features by viewport (bbox) with geometry simplification
  app.get("/api/datasets/:id/features/viewport", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const datasetId = parseIntParam(req.params.id, res);
      if (datasetId === null) return;
      const { minX, minY, maxX, maxY, zoom, limit } = req.query;
      const featureLimit = limit ? parseInt(limit as string) : 5000; // Default limit 5000 features

      // Get all features for the dataset
      const allFeatures = await storage.getDatasetFeatures(datasetId);
      
      // If no bbox provided, return all (for compatibility)
      if (!minX || !minY || !maxX || !maxY) {
        const limitedFeatures = allFeatures.slice(0, featureLimit);
        return res.json({
          features: limitedFeatures,
          total: allFeatures.length,
          limited: allFeatures.length > featureLimit,
        });
      }

      const bbox = {
        minX: parseFloat(minX as string),
        minY: parseFloat(minY as string),
        maxX: parseFloat(maxX as string),
        maxY: parseFloat(maxY as string),
      };

      const zoomLevel = zoom ? parseInt(zoom as string) : 10;
      const tolerance = getSimplifyTolerance(zoomLevel);

      // Filter features by bbox and simplify geometry
      const filteredFeatures = allFeatures.filter(feature => {
        const coords = feature.coordinates;
        if (!coords) return false;

        // Get feature bounds
        const bounds = getFeatureBounds(coords, feature.geometryType);
        if (!bounds) return true; // Include if can't determine bounds

        // Check intersection with viewport
        return !(bounds.maxX < bbox.minX || bounds.minX > bbox.maxX ||
                 bounds.maxY < bbox.minY || bounds.minY > bbox.maxY);
      });

      // Apply limit before simplification for performance
      const limitedFeatures = filteredFeatures.slice(0, featureLimit);

      // Apply point sampling based on zoom level (GIS-style approach)
      const { sampled: sampledFeatures, totalPoints, samplingRate } = samplePointFeatures(limitedFeatures, zoomLevel);

      const simplifiedFeatures = sampledFeatures.map(feature => {
        const coords = (tolerance > 0 && feature.geometryType !== "Point")
          ? simplifyFeatureGeometry(feature.coordinates, feature.geometryType, tolerance)
          : feature.coordinates;
        return {
          id: feature.id,
          datasetId: feature.datasetId,
          geometryType: feature.geometryType,
          coordinates: coords,
        };
      });

      return res.json({
        features: simplifiedFeatures,
        total: filteredFeatures.length,
        limited: filteredFeatures.length > featureLimit,
        pointSampling: {
          totalPoints,
          sampledPoints: samplingRate === Infinity ? 0 : Math.ceil(totalPoints / samplingRate),
          samplingRate: samplingRate === Infinity ? 0 : samplingRate,
          isFullData: samplingRate === 1,
        },
      });
    } catch (error) {
      console.error("Get viewport dataset features error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create dataset feature
  app.post("/api/datasets/:id/features", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseIntParam(req.params.id, res);
      if (datasetId === null) return;
      const { geometryType, coordinates, properties } = req.body;
      
      if (!geometryType || !coordinates) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const feature = await storage.createDatasetFeature({
        datasetId,
        geometryType,
        coordinates,
        properties: properties || {},
      });
      return res.status(201).json(feature);
    } catch (error) {
      console.error("Error creating dataset feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update dataset feature
  app.patch("/api/datasets/:datasetId/features/:featureId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const featureId = parseIntParam(req.params.featureId, res);
      if (featureId === null) return;
      const { geometryType, coordinates, properties } = req.body;
      
      // Validate that if coordinates are being updated, geometryType must also be provided
      if (coordinates !== undefined && geometryType === undefined) {
        return res.status(400).json({ message: "geometryType is required when updating coordinates" });
      }
      
      const feature = await storage.updateDatasetFeature(featureId, { geometryType, coordinates, properties });
      if (!feature) {
        return res.status(404).json({ message: "Feature not found" });
      }
      return res.json(feature);
    } catch (error) {
      console.error("Error updating dataset feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete dataset feature
  app.delete("/api/datasets/:datasetId/features/:featureId", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const featureId = parseIntParam(req.params.featureId, res);
      if (featureId === null) return;
      
      const result = await storage.deleteDatasetFeature(featureId);
      if (!result.deleted) {
        return res.status(404).json({ message: "Feature not found" });
      }
      return res.json({ success: true, datasetId: result.datasetId });
    } catch (error) {
      console.error("Error deleting dataset feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // SCENE DATASETS API
  // ============================================

  // Get datasets for a scene
  app.get("/api/scenes/:sceneId/datasets", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const sceneDatasets = await storage.getSceneDatasets(sceneId);
      return res.json(sceneDatasets);
    } catch (error) {
      console.error("Error getting scene datasets:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Add dataset to scene
  app.post("/api/scenes/:sceneId/datasets", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      if (membership?.role === "viewer") {
        return res.status(403).json({ message: "Viewers cannot add datasets" });
      }
      
      const { datasetId, layerName, color, opacity } = req.body;
      if (!datasetId) {
        return res.status(400).json({ message: "datasetId is required" });
      }
      
      const sceneDataset = await storage.addDatasetToScene(sceneId, datasetId, { layerName, color, opacity });
      return res.status(201).json(sceneDataset);
    } catch (error) {
      console.error("Error adding dataset to scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update scene dataset
  app.patch("/api/scenes/:sceneId/datasets/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      if (membership?.role === "viewer") {
        return res.status(403).json({ message: "Viewers cannot update datasets" });
      }
      
      const sceneDataset = await storage.updateSceneDataset(id, req.body);
      return res.json(sceneDataset);
    } catch (error) {
      console.error("Error updating scene dataset:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Remove dataset from scene
  app.delete("/api/scenes/:sceneId/datasets/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (!membership && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      if (membership?.role === "viewer") {
        return res.status(403).json({ message: "Viewers cannot remove datasets" });
      }
      
      await storage.removeDatasetFromScene(id);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error removing dataset from scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // UPLOADS API
  // ============================================

  // Get uploads
  app.get("/api/uploads", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const uploads = user.role === "admin" 
        ? await storage.getUploads() 
        : await storage.getUploads(user.id);
      return res.json(uploads);
    } catch (error) {
      console.error("Error getting uploads:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // API KEYS MANAGEMENT (for external integrations)
  // ============================================

  // Get user's API keys
  app.get("/api/api-keys", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const keys = await storage.getApiKeys(user.id);
      const safeKeys = keys.map(k => ({
        id: k.id,
        name: k.name,
        sceneId: k.sceneId,
        permissions: k.permissions,
        isActive: k.isActive === 1,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      }));
      return res.json(safeKeys);
    } catch (error) {
      console.error("Error getting API keys:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create new API key
  app.post("/api/api-keys", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const { name, sceneId, permissions } = req.body;

      if (!name || typeof name !== "string" || name.length < 1) {
        return res.status(400).json({ message: "Name is required" });
      }

      const token = generateApiToken();
      const tokenHash = await hashApiToken(token);

      const apiKey = await storage.createApiKey({
        userId: user.id,
        name,
        tokenHash,
        sceneId: sceneId || undefined,
        permissions: permissions || ["create_point"],
      });

      return res.json({
        id: apiKey.id,
        name: apiKey.name,
        token, // Show token only once!
        sceneId: apiKey.sceneId,
        permissions: apiKey.permissions,
        createdAt: apiKey.createdAt,
        message: "Сохраните токен! Он больше не будет показан.",
      });
    } catch (error) {
      console.error("Error creating API key:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Revoke API key
  app.delete("/api/api-keys/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      
      const apiKey = await storage.getApiKey(id);
      if (!apiKey) {
        return res.status(404).json({ message: "API key not found" });
      }
      if (apiKey.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.revokeApiKey(id);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error revoking API key:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // CUSTOM ICONS API
  // ============================================

  app.get("/api/custom-icons", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const icons = await storage.getCustomIcons();
      return res.json(icons);
    } catch (error) {
      console.error("Error fetching custom icons:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/custom-icons/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const icon = await storage.getCustomIcon(id);
      if (!icon) {
        return res.status(404).json({ message: "Icon not found" });
      }
      return res.json(icon);
    } catch (error) {
      console.error("Error fetching custom icon:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/custom-icons/:id/svg", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const color = (req.query.color as string) || "#000000";
      const icon = await storage.getCustomIcon(id);
      if (!icon) {
        return res.status(404).json({ message: "Icon not found" });
      }
      let svg = icon.svgContent;
      svg = svg.replace(/\{color\}/g, color);
      svg = svg.replace(/currentColor/g, color);
      res.setHeader("Content-Type", "image/svg+xml");
      return res.send(svg);
    } catch (error) {
      console.error("Error fetching custom icon SVG:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/custom-icons", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { name, svgContent, category } = req.body;
      if (!name || !svgContent) {
        return res.status(400).json({ message: "Name and svgContent are required" });
      }
      if (!svgContent.includes("<svg")) {
        return res.status(400).json({ message: "Invalid SVG content" });
      }
      const normalizedSvg = normalizeSvgForColorSupport(svgContent);
      const icon = await storage.createCustomIcon({
        name,
        svgContent: normalizedSvg,
        category: category || "custom",
      });
      return res.status(201).json(icon);
    } catch (error) {
      console.error("Error creating custom icon:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/custom-icons/:id", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteCustomIcon(id);
      if (!deleted) {
        return res.status(404).json({ message: "Icon not found" });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting custom icon:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // EXTERNAL API (for Telegram bot and other integrations)
  // ============================================

  // Get available scenes for API key
  app.get("/api/external/scenes", isApiAuthenticated("read_scenes"), async (req: ApiAuthenticatedRequest, res: Response) => {
    try {
      const apiKey = req.apiKey!;
      const apiUser = req.apiUser!;

      let scenes;
      if (apiKey.sceneId) {
        const scene = await storage.getScene(apiKey.sceneId);
        scenes = scene ? [scene] : [];
      } else {
        scenes = await storage.getScenesForUser(apiUser.id);
      }

      return res.json(scenes.map(s => ({
        id: s.id,
        name: s.name,
        description: (s as any).description || null,
      })));
    } catch (error) {
      console.error("External API error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get layers for a scene
  app.get("/api/external/scenes/:sceneId/layers", isApiAuthenticated("read_layers"), async (req: ApiAuthenticatedRequest, res: Response) => {
    try {
      const apiKey = req.apiKey!;
      const apiUser = req.apiUser!;
      const sceneId = parseIntParam(req.params.sceneId, res);
      if (sceneId === null) return;

      if (apiKey.sceneId && apiKey.sceneId !== sceneId) {
        return res.status(403).json({ error: "Forbidden", message: "API key restricted to different scene" });
      }

      if (!apiKey.sceneId) {
        const membership = await storage.getSceneMember(sceneId, apiUser.id);
        if (!membership && apiUser.role !== "admin") {
          return res.status(403).json({ error: "Forbidden", message: "Access denied to this scene" });
        }
      }

      const geometryTypeFilter = req.query.geometryType ? String(req.query.geometryType) : null;

      const layers = await storage.getEditableLayersByScene(sceneId);
      const filteredLayers = geometryTypeFilter
        ? layers.filter(l => l.geometryType === geometryTypeFilter)
        : layers;

      return res.json(filteredLayers.map(l => ({
        id: l.id,
        name: l.name,
        geometryType: l.geometryType,
        featureCount: l.featureCount,
        sceneId: l.sceneId,
      })));
    } catch (error) {
      console.error("External API error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create point (main endpoint for Telegram bot)
  app.post("/api/external/points", isApiAuthenticated("create_point"), async (req: ApiAuthenticatedRequest, res: Response) => {
    try {
      const apiKey = req.apiKey!;
      const apiUser = req.apiUser!;

      const parsed = externalCreatePointSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Validation error", 
          details: parsed.error.issues 
        });
      }

      const { sceneId, layerId, coordinates, properties } = parsed.data;

      if (apiKey.sceneId && apiKey.sceneId !== sceneId) {
        return res.status(403).json({ error: "Forbidden", message: "API key restricted to different scene" });
      }

      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ error: "Layer not found" });
      }
      if (layer.sceneId !== sceneId) {
        return res.status(400).json({ error: "Layer does not belong to specified scene" });
      }
      if (layer.geometryType !== "Point") {
        return res.status(400).json({ error: "Layer must be of type Point" });
      }

      const membership = await storage.getSceneMember(sceneId, apiUser.id);
      if (!membership && apiUser.role !== "admin") {
        return res.status(403).json({ error: "Access denied to scene" });
      }
      if (membership?.role === "viewer") {
        return res.status(403).json({ error: "Viewers cannot create features" });
      }

      const feature = await storage.createDrawnFeature({
        layerId,
        geometryType: "Point",
        coordinates,
        properties: {
          ...properties,
          _source: "external_api",
          _createdBy: apiUser.username,
          _createdAt: new Date().toISOString(),
        },
      });

      return res.status(201).json({
        success: true,
        feature: {
          id: feature.id,
          layerId: feature.layerId,
          coordinates: feature.coordinates,
          properties: transformPropertyKeys((feature.properties || {}) as Record<string, unknown>),
          createdAt: feature.createdAt,
        },
      });
    } catch (error) {
      console.error("External API error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/external/layers/:layerId/features-in-polygon/:featureId", isApiAuthenticated("spatial_query"), async (req: ApiAuthenticatedRequest, res: Response) => {
    try {
      const apiKey = req.apiKey!;
      const layerId = parseIntParam(req.params.layerId, res);
      if (layerId === null) return;
      const featureIdParam = req.params.featureId;

      if (isNaN(layerId)) {
        return res.status(400).json({ error: "Bad request", message: "Invalid layerId" });
      }

      if (!featureIdParam || featureIdParam.trim() === "") {
        return res.status(400).json({ error: "Bad request", message: "featureId is required" });
      }

      const featureId = parseInt(featureIdParam);
      if (isNaN(featureId)) {
        return res.status(404).json({ error: "Not found", message: `Feature with id '${featureIdParam}' not found in layer ${layerId}` });
      }

      const boundaryLayer = await storage.getEditableLayer(layerId);
      if (!boundaryLayer) {
        return res.status(404).json({ error: "Not found", message: "Layer not found" });
      }

      if (apiKey.sceneId && boundaryLayer.sceneId !== apiKey.sceneId) {
        return res.status(403).json({ error: "Forbidden", message: "API key restricted to different scene" });
      }

      if (!boundaryLayer.sceneId) {
        return res.status(400).json({ error: "Bad request", message: "Global layers are not supported for spatial queries. Layer must belong to a scene." });
      }

      const apiUser = req.apiUser!;
      if (!apiKey.sceneId) {
        const membership = await storage.getSceneMember(boundaryLayer.sceneId, apiUser.id);
        if (!membership && apiUser.role !== "admin") {
          return res.status(403).json({ error: "Forbidden", message: "Access denied to this scene" });
        }
      }

      if (boundaryLayer.geometryType !== "Polygon" && boundaryLayer.geometryType !== "MultiPolygon") {
        return res.status(400).json({ error: "Bad request", message: "Layer must be of type Polygon or MultiPolygon" });
      }

      const boundaryFeatureRaw = await storage.getDrawnFeature(featureId);
      if (!boundaryFeatureRaw || boundaryFeatureRaw.layerId !== layerId) {
        return res.status(404).json({ error: "Not found", message: `Feature with id '${featureIdParam}' not found in layer ${layerId}` });
      }

      const boundaryFeature = {
        geometry: { type: boundaryFeatureRaw.geometryType, coordinates: boundaryFeatureRaw.coordinates },
        properties: boundaryFeatureRaw.properties || {},
      };
      const boundaryFeatures = [boundaryFeature];

      const crossScene = req.query.crossScene === "true";
      const sourceSceneIdsParam = req.query.sourceSceneIds;
      let allowedSceneIds: number[] = [boundaryLayer.sceneId];

      if (crossScene && !apiKey.sceneId) {
        if (sourceSceneIdsParam) {
          const raw = Array.isArray(sourceSceneIdsParam) ? sourceSceneIdsParam : [sourceSceneIdsParam];
          const requestedSceneIds = raw.map(v => parseInt(String(v))).filter(v => !isNaN(v));
          for (const sid of requestedSceneIds) {
            if (sid === boundaryLayer.sceneId) continue;
            const membership = await storage.getSceneMember(sid, apiUser.id);
            if (membership || apiUser.role === "admin") {
              allowedSceneIds.push(sid);
            }
          }
        } else {
          const userScenes = await storage.getScenesForUser(apiUser.id);
          allowedSceneIds = userScenes.map(s => s.id);
        }
      }

      const sourceLayerIdsParam = req.query.sourceLayerIds;
      let sourceLayerIds: number[] = [];

      if (sourceLayerIdsParam) {
        const raw = Array.isArray(sourceLayerIdsParam) ? sourceLayerIdsParam : [sourceLayerIdsParam];
        sourceLayerIds = raw.map(v => parseInt(String(v))).filter(v => !isNaN(v));
      }

      if (sourceLayerIds.length === 0) {
        for (const sid of allowedSceneIds) {
          const sceneLayers = await storage.getEditableLayersByScene(sid);
          sourceLayerIds.push(...sceneLayers.filter(l => l.id !== layerId).map(l => l.id));
        }
      }

      if (sourceLayerIds.length === 0) {
        return res.json({
          boundaryLayer: { id: boundaryLayer.id, name: boundaryLayer.name, featureCount: 1 },
          boundaryFeature: {
            id: String(boundaryFeatureRaw.id),
            properties: boundaryFeature.properties,
            geometry: boundaryFeature.geometry,
          },
          results: [],
          meta: { analyzedAt: new Date().toISOString(), totalLayersAnalyzed: 0, totalFeaturesMatched: 0, crossScene, scenesSearched: allowedSceneIds },
        });
      }

      const includeAttrsParam = req.query.includeAttributes;
      let includeAttributes: string[] | null = null;
      if (includeAttrsParam) {
        const raw = Array.isArray(includeAttrsParam) ? includeAttrsParam : [includeAttrsParam];
        includeAttributes = raw.map(v => String(v));
      }

      const MAX_FEATURES = 10000;
      let totalFeaturesMatched = 0;
      const results: {
        layerId: number;
        layerName: string;
        sceneId: number | null;
        geometryType: string;
        totalCount: number;
        matchedCount: number;
        features: { id: number; properties: Record<string, unknown>; geometry: { type: string; coordinates: any } }[];
      }[] = [];

      for (const srcLayerId of sourceLayerIds) {
        const sourceLayer = await storage.getEditableLayer(srcLayerId);
        if (!sourceLayer) continue;

        if (apiKey.sceneId && sourceLayer.sceneId !== apiKey.sceneId) continue;
        if (!sourceLayer.sceneId) continue;
        if (!allowedSceneIds.includes(sourceLayer.sceneId)) continue;

        const sourceFeaturesRaw = await storage.getDrawnFeatures(srcLayerId);
        const sourceFeatures = sourceFeaturesRaw.map(f => ({
          id: f.id,
          geometry: { type: f.geometryType, coordinates: f.coordinates },
          properties: f.properties || {},
        }));

        const matched = sourceFeatures.filter(feature =>
          isFeatureInBoundary(feature, boundaryFeatures, "inside")
        );

        let featureResults = matched.map(f => {
          let props = f.properties;
          if (includeAttributes) {
            const filtered: Record<string, unknown> = {};
            for (const attr of includeAttributes) {
              if (attr in props) filtered[attr] = props[attr];
            }
            props = filtered;
          }
          return { id: f.id, properties: transformPropertyKeys(props as Record<string, unknown>), geometry: f.geometry };
        });

        if (totalFeaturesMatched + featureResults.length > MAX_FEATURES) {
          featureResults = featureResults.slice(0, MAX_FEATURES - totalFeaturesMatched);
        }

        totalFeaturesMatched += featureResults.length;

        results.push({
          layerId: sourceLayer.id,
          layerName: sourceLayer.name,
          sceneId: sourceLayer.sceneId,
          geometryType: sourceLayer.geometryType,
          totalCount: sourceFeatures.length,
          matchedCount: matched.length,
          features: featureResults,
        });

        if (totalFeaturesMatched >= MAX_FEATURES) break;
      }

      return res.json({
        boundaryLayer: {
          id: boundaryLayer.id,
          name: boundaryLayer.name,
          featureCount: 1,
        },
        boundaryFeature: {
          id: String(boundaryFeatureRaw.id),
          properties: transformPropertyKeys(boundaryFeature.properties as Record<string, unknown>),
          geometry: boundaryFeature.geometry,
        },
        results,
        meta: {
          analyzedAt: new Date().toISOString(),
          totalLayersAnalyzed: results.length,
          totalFeaturesMatched,
          crossScene,
          scenesSearched: allowedSceneIds,
        },
      });
    } catch (error) {
      console.error("External spatial query (single feature) API error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/external/layers/:layerId/features-in-polygon", isApiAuthenticated("spatial_query"), async (req: ApiAuthenticatedRequest, res: Response) => {
    try {
      const apiKey = req.apiKey!;
      const layerId = parseInt(req.params.layerId);

      if (isNaN(layerId)) {
        return res.status(400).json({ error: "Bad request", message: "Invalid layerId" });
      }

      const boundaryLayer = await storage.getEditableLayer(layerId);
      if (!boundaryLayer) {
        return res.status(404).json({ error: "Not found", message: "Layer not found" });
      }

      if (apiKey.sceneId && boundaryLayer.sceneId !== apiKey.sceneId) {
        return res.status(403).json({ error: "Forbidden", message: "API key restricted to different scene" });
      }

      if (!boundaryLayer.sceneId) {
        return res.status(400).json({ error: "Bad request", message: "Global layers are not supported for spatial queries. Layer must belong to a scene." });
      }

      const apiUser = req.apiUser!;
      if (!apiKey.sceneId) {
        const membership = await storage.getSceneMember(boundaryLayer.sceneId, apiUser.id);
        if (!membership && apiUser.role !== "admin") {
          return res.status(403).json({ error: "Forbidden", message: "Access denied to this scene" });
        }
      }

      if (boundaryLayer.geometryType !== "Polygon" && boundaryLayer.geometryType !== "MultiPolygon") {
        return res.status(400).json({ error: "Bad request", message: "Layer must be of type Polygon or MultiPolygon" });
      }

      const boundaryFeaturesRaw = await storage.getDrawnFeatures(layerId);
      if (boundaryFeaturesRaw.length === 0) {
        return res.status(422).json({ error: "Unprocessable", message: "Boundary layer has no features" });
      }

      const boundaryFeatures = boundaryFeaturesRaw.map(f => ({
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: f.properties || {},
      }));

      const crossScene = req.query.crossScene === "true";
      const sourceSceneIdsParam = req.query.sourceSceneIds;
      let allowedSceneIds: number[] = [boundaryLayer.sceneId];

      if (crossScene && !apiKey.sceneId) {
        if (sourceSceneIdsParam) {
          const raw = Array.isArray(sourceSceneIdsParam) ? sourceSceneIdsParam : [sourceSceneIdsParam];
          const requestedSceneIds = raw.map(v => parseInt(String(v))).filter(v => !isNaN(v));
          for (const sid of requestedSceneIds) {
            if (sid === boundaryLayer.sceneId) continue;
            const membership = await storage.getSceneMember(sid, apiUser.id);
            if (membership || apiUser.role === "admin") {
              allowedSceneIds.push(sid);
            }
          }
        } else {
          const userScenes = await storage.getScenesForUser(apiUser.id);
          allowedSceneIds = userScenes.map(s => s.id);
        }
      }

      const sourceLayerIdsParam = req.query.sourceLayerIds;
      let sourceLayerIds: number[] = [];

      if (sourceLayerIdsParam) {
        const raw = Array.isArray(sourceLayerIdsParam) ? sourceLayerIdsParam : [sourceLayerIdsParam];
        sourceLayerIds = raw.map(v => parseInt(String(v))).filter(v => !isNaN(v));
      }

      if (sourceLayerIds.length === 0) {
        for (const sid of allowedSceneIds) {
          const sceneLayers = await storage.getEditableLayersByScene(sid);
          sourceLayerIds.push(...sceneLayers.filter(l => l.id !== layerId).map(l => l.id));
        }
      }

      if (sourceLayerIds.length === 0) {
        return res.json({
          boundaryLayer: { id: boundaryLayer.id, name: boundaryLayer.name, featureCount: boundaryFeaturesRaw.length },
          results: [],
          meta: { analyzedAt: new Date().toISOString(), totalLayersAnalyzed: 0, totalFeaturesMatched: 0, crossScene, scenesSearched: allowedSceneIds },
        });
      }

      const includeAttrsParam = req.query.includeAttributes;
      let includeAttributes: string[] | null = null;
      if (includeAttrsParam) {
        const raw = Array.isArray(includeAttrsParam) ? includeAttrsParam : [includeAttrsParam];
        includeAttributes = raw.map(v => String(v));
      }

      const MAX_FEATURES = 10000;
      let totalFeaturesMatched = 0;
      const results: {
        layerId: number;
        layerName: string;
        sceneId: number | null;
        geometryType: string;
        totalCount: number;
        matchedCount: number;
        features: { id: number; properties: Record<string, unknown>; geometry: { type: string; coordinates: any } }[];
      }[] = [];

      for (const srcLayerId of sourceLayerIds) {
        const sourceLayer = await storage.getEditableLayer(srcLayerId);
        if (!sourceLayer) continue;

        if (apiKey.sceneId && sourceLayer.sceneId !== apiKey.sceneId) continue;
        if (!sourceLayer.sceneId) continue;
        if (!allowedSceneIds.includes(sourceLayer.sceneId)) continue;

        const sourceFeaturesRaw = await storage.getDrawnFeatures(srcLayerId);
        const sourceFeatures = sourceFeaturesRaw.map(f => ({
          id: f.id,
          geometry: { type: f.geometryType, coordinates: f.coordinates },
          properties: f.properties || {},
        }));

        const matched = sourceFeatures.filter(feature =>
          isFeatureInBoundary(feature, boundaryFeatures, "inside")
        );

        let featureResults = matched.map(f => {
          let props = f.properties;
          if (includeAttributes) {
            const filtered: Record<string, unknown> = {};
            for (const attr of includeAttributes) {
              if (attr in props) filtered[attr] = props[attr];
            }
            props = filtered;
          }
          return { id: f.id, properties: transformPropertyKeys(props as Record<string, unknown>), geometry: f.geometry };
        });

        if (totalFeaturesMatched + featureResults.length > MAX_FEATURES) {
          featureResults = featureResults.slice(0, MAX_FEATURES - totalFeaturesMatched);
        }

        totalFeaturesMatched += featureResults.length;

        results.push({
          layerId: sourceLayer.id,
          layerName: sourceLayer.name,
          sceneId: sourceLayer.sceneId,
          geometryType: sourceLayer.geometryType,
          totalCount: sourceFeatures.length,
          matchedCount: matched.length,
          features: featureResults,
        });

        if (totalFeaturesMatched >= MAX_FEATURES) break;
      }

      return res.json({
        boundaryLayer: {
          id: boundaryLayer.id,
          name: boundaryLayer.name,
          featureCount: boundaryFeaturesRaw.length,
        },
        results,
        meta: {
          analyzedAt: new Date().toISOString(),
          totalLayersAnalyzed: results.length,
          totalFeaturesMatched,
          crossScene,
          scenesSearched: allowedSceneIds,
        },
      });
    } catch (error) {
      console.error("External spatial query API error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // API health check
  app.get("/api/external/health", (req: Request, res: Response) => {
    return res.json({ status: "ok", version: "1.0.0" });
  });

  app.post("/api/network-graph/validate-topology", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { sceneId } = req.body;
      if (!sceneId) return res.status(400).json({ error: "sceneId is required" });
      const { validateTopology } = await import("./network-graph");
      const result = await validateTopology(Number(sceneId));
      return res.json(result);
    } catch (error: any) {
      console.error("Topology validation error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/network-graph/fix-topology", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { fixes } = req.body;
      if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
        return res.status(400).json({ error: "fixes array is required" });
      }
      const { applyTopologyFixes } = await import("./network-graph");
      const result = await applyTopologyFixes(fixes);
      return res.json(result);
    } catch (error: any) {
      console.error("Topology fix error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/network-graph/recalculate-bindings", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { sceneId } = req.body;
      if (!sceneId) return res.status(400).json({ error: "sceneId is required" });
      const { recalculateBindings } = await import("./network-graph");
      const result = await recalculateBindings(Number(sceneId));
      return res.json(result);
    } catch (error: any) {
      console.error("Recalculate bindings error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/network-graph/apply-recalculated-bindings", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { fixes } = req.body;
      if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
        return res.status(400).json({ error: "fixes array is required" });
      }
      const { applyTopologyFixes } = await import("./network-graph");
      const result = await applyTopologyFixes(fixes);
      return res.json(result);
    } catch (error: any) {
      console.error("Apply recalculated bindings error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/network-graph/simulate-spatial", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { featureId, layerId, sceneId } = req.body;

      if (!featureId || !layerId || !sceneId) {
        return res.status(400).json({ error: "featureId, layerId, and sceneId are required" });
      }

      const { simulateSpatialDisconnection } = await import("./network-graph");
      const result = await simulateSpatialDisconnection(
        Number(featureId),
        Number(layerId),
        Number(sceneId)
      );

      return res.json(result);
    } catch (error: any) {
      console.error("Spatial network graph simulation error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/network-graph/simulate/export", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { featureId, layerId, sceneId } = req.body;

      if (!featureId || !layerId || !sceneId) {
        return res.status(400).json({ error: "featureId, layerId, and sceneId are required" });
      }

      const { simulateSpatialDisconnection } = await import("./network-graph");
      const result = await simulateSpatialDisconnection(
        Number(featureId),
        Number(layerId),
        Number(sceneId)
      );

      const consumerIds = result.affectedConsumers.map(c => c.featureId);
      const segmentIds = result.affectedSegments.map(s => s.featureId);
      const ctpIds = result.affectedCTPs.map(c => c.featureId);
      const nodeIds = result.affectedNodes.map(n => n.featureId);
      const allIds = [...consumerIds, ...segmentIds, ...ctpIds, ...nodeIds];

      let fullFeatures: Array<{ id: number; layerId: number; properties: Record<string, unknown> }> = [];
      if (allIds.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < allIds.length; i += batchSize) {
          const batch = allIds.slice(i, i + batchSize);
          const rows = await db
            .select({ id: drawnFeatures.id, layerId: drawnFeatures.layerId, properties: drawnFeatures.properties })
            .from(drawnFeatures)
            .where(inArray(drawnFeatures.id, batch));
          fullFeatures.push(...(rows as any[]));
        }
      }

      const propsMap = new Map<number, Record<string, unknown>>();
      for (const f of fullFeatures) {
        propsMap.set(f.id, (f.properties as Record<string, unknown>) || {});
      }

      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet("Сводка");
      summarySheet.columns = [
        { header: "Параметр", key: "param", width: 40 },
        { header: "Значение", key: "value", width: 50 },
      ];
      const headerRow = summarySheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

      summarySheet.addRow({ param: "Режим анализа", value: "Пространственная симуляция" });
      summarySheet.addRow({ param: "Объект анализа", value: result.failurePoint.name });
      summarySheet.addRow({ param: "Тип объекта", value: result.failurePoint.type === "segment" ? "Участок сети" : "Узел/объект" });
      if (result.source) {
        summarySheet.addRow({ param: "Источник", value: result.source.name });
        summarySheet.addRow({ param: "Номер источника (Nist)", value: result.source.nist });
      }
      summarySheet.addRow({ param: "", value: "" });
      summarySheet.addRow({ param: "Затронутые потребители", value: result.stats.totalConsumers });
      summarySheet.addRow({ param: "Затронутые ЦТП", value: result.stats.totalCTPs });
      summarySheet.addRow({ param: "Затронутые участки сети", value: result.stats.totalSegments });
      summarySheet.addRow({ param: "Затронутые узлы", value: result.stats.totalNodes });
      summarySheet.addRow({ param: "Общая длина сетей (м)", value: result.stats.totalLengthM });

      const addDetailSheet = (
        sheetName: string,
        items: Array<{ featureId: number; name?: string; address?: string; from?: string; to?: string; length?: number }>,
        extraBaseCols: Array<{ header: string; key: string; width: number }>,
        getBaseRow: (item: any) => Record<string, unknown>
      ) => {
        if (items.length === 0) return;

        const allPropKeys = new Set<string>();
        for (const item of items) {
          const props = propsMap.get(item.featureId);
          if (props) {
            Object.keys(props).forEach(k => allPropKeys.add(k));
          }
        }

        const propKeysArr = Array.from(allPropKeys).sort();

        const columns = [
          { header: "ID", key: "featureId", width: 10 },
          ...extraBaseCols,
          ...propKeysArr.map(k => ({ header: k, key: `prop_${k}`, width: 18 })),
        ];

        const sheet = workbook.addWorksheet(sheetName);
        sheet.columns = columns;

        const hRow = sheet.getRow(1);
        hRow.font = { bold: true };
        hRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

        for (const item of items) {
          const baseRow = getBaseRow(item);
          const props = propsMap.get(item.featureId) || {};
          const propRow: Record<string, unknown> = {};
          for (const k of propKeysArr) {
            const val = props[k];
            propRow[`prop_${k}`] = val !== null && val !== undefined ? val : "";
          }
          sheet.addRow({ featureId: item.featureId, ...baseRow, ...propRow });
        }
      };

      addDetailSheet(
        "Потребители",
        result.affectedConsumers,
        [
          { header: "Имя", key: "name", width: 30 },
          { header: "Адрес", key: "address", width: 40 },
        ],
        (item) => ({ name: item.name, address: item.address })
      );

      addDetailSheet(
        "Участки сети",
        result.affectedSegments,
        [
          { header: "Начало", key: "from", width: 25 },
          { header: "Конец", key: "to", width: 25 },
          { header: "Длина (м)", key: "length", width: 12 },
        ],
        (item) => ({ from: item.from, to: item.to, length: item.length })
      );

      addDetailSheet(
        "ЦТП",
        result.affectedCTPs,
        [
          { header: "Имя", key: "name", width: 30 },
          { header: "Адрес", key: "address", width: 40 },
        ],
        (item) => ({ name: item.name, address: item.address })
      );

      addDetailSheet(
        "Узлы",
        result.affectedNodes,
        [
          { header: "Имя", key: "name", width: 30 },
        ],
        (item) => ({ name: item.name })
      );

      const buffer = await workbook.xlsx.writeBuffer();
      const failureName = result.failurePoint.name.replace(/[^\w\sа-яА-ЯёЁ]/gi, "").substring(0, 50);
      const filename = encodeURIComponent(`Симуляция_${failureName}.xlsx`);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (error: any) {
      console.error("Simulation export error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/complaint-analysis", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { complaintLayerId, sceneId, dateFieldName, addressFieldName, matchRadius, clusterRadius, mode, complaintLayers } = req.body;

      let layersInput: Array<{ layerId: number; dateField: string; addressField: string }>;
      if (complaintLayers && Array.isArray(complaintLayers) && complaintLayers.length > 0) {
        layersInput = complaintLayers.map((l: any) => ({
          layerId: Number(l.layerId),
          dateField: String(l.dateField || ""),
          addressField: String(l.addressField || ""),
        }));
      } else if (complaintLayerId) {
        layersInput = [{
          layerId: Number(complaintLayerId),
          dateField: String(dateFieldName || ""),
          addressField: String(addressFieldName || ""),
        }];
      } else {
        return res.status(400).json({ error: "complaintLayers or complaintLayerId is required" });
      }

      if (layersInput.length === 0) {
        return res.status(400).json({ error: "At least one complaint layer is required" });
      }
      if (layersInput.length > 5) {
        return res.status(400).json({ error: "Maximum 5 complaint layers allowed" });
      }

      if (mode === "no_topology") {
        const { analyzeComplaintsNoTopology } = await import("./complaint-analysis");
        const result = await analyzeComplaintsNoTopology(
          layersInput,
          Number(matchRadius) || 250
        );
        return res.json(result);
      }

      if (!sceneId) {
        return res.status(400).json({ error: "sceneId is required for topology mode" });
      }

      const { analyzeComplaints } = await import("./complaint-analysis");
      const result = await analyzeComplaints(
        layersInput,
        Number(sceneId),
        Number(matchRadius) || 100,
        Number(clusterRadius) || 500
      );

      return res.json(result);
    } catch (error: any) {
      console.error("Complaint analysis error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/complaint-analysis/export", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { complaintLayerId, sceneId, dateFieldName, addressFieldName, matchRadius, clusterRadius, complaintLayers } = req.body;

      let layersInput: Array<{ layerId: number; dateField: string; addressField: string }>;
      if (complaintLayers && Array.isArray(complaintLayers) && complaintLayers.length > 0) {
        layersInput = complaintLayers.map((l: any) => ({
          layerId: Number(l.layerId),
          dateField: String(l.dateField || ""),
          addressField: String(l.addressField || ""),
        }));
      } else if (complaintLayerId && sceneId) {
        layersInput = [{
          layerId: Number(complaintLayerId),
          dateField: String(dateFieldName || ""),
          addressField: String(addressFieldName || ""),
        }];
      } else {
        return res.status(400).json({ error: "complaintLayers or (complaintLayerId + sceneId) required" });
      }

      if (!sceneId) {
        return res.status(400).json({ error: "sceneId is required for export" });
      }

      const { analyzeComplaints } = await import("./complaint-analysis");
      const result = await analyzeComplaints(
        layersInput,
        Number(sceneId),
        Number(matchRadius) || 100,
        Number(clusterRadius) || 500
      );

      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet("Сводка");
      summarySheet.columns = [
        { header: "Дата", key: "date", width: 15 },
        { header: "Кластер", key: "clusterId", width: 10 },
        { header: "Источник", key: "sourceName", width: 30 },
        { header: "Кол-во жалоб", key: "complaintCount", width: 15 },
        { header: "Уник. потребителей", key: "uniqueConsumerCount", width: 20 },
        { header: "Кол-во потребителей", key: "consumerCount", width: 20 },
        { header: "Вероятный узел аварии", key: "failureNode", width: 35 },
        { header: "Тип узла", key: "nodeType", width: 15 },
        { header: "Участок (от-до)", key: "segment", width: 40 },
        { header: "Вероятность (%)", key: "probability", width: 15 },
        { header: "Уверенность", key: "confidence", width: 15 },
        { header: "Потребителей ниже аварии", key: "downstream", width: 25 },
      ];
      const hRow = summarySheet.getRow(1);
      hRow.font = { bold: true };
      hRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

      for (const group of result.dateGroups) {
        if (group.failureZones && group.failureZones.length > 0) {
          for (const zone of group.failureZones) {
            summarySheet.addRow({
              date: group.date,
              clusterId: group.clusterId || "",
              sourceName: group.sourceName,
              complaintCount: group.complaintCount,
              uniqueConsumerCount: group.uniqueConsumerCount || group.consumers.length,
              consumerCount: group.consumers.length,
              failureNode: zone.zoneName || "—",
              nodeType: translateNodeType(zone.zoneType),
              segment: zone.incomingSegment ? `${zone.incomingSegment.from} → ${zone.incomingSegment.to}` : "—",
              probability: (zone as any).probability ?? "—",
              confidence: translateConfidence(zone.confidence),
              downstream: zone.downstreamConsumerCount,
            });
          }
        } else {
          summarySheet.addRow({
            date: group.date,
            clusterId: group.clusterId || "",
            sourceName: group.sourceName,
            complaintCount: group.complaintCount,
            uniqueConsumerCount: group.uniqueConsumerCount || group.consumers.length,
            consumerCount: group.consumers.length,
            failureNode: "—",
            nodeType: "—",
            segment: "—",
            probability: "—",
            confidence: "—",
            downstream: "—",
          });
        }
      }

      const statsSheet = workbook.addWorksheet("Статистика");
      statsSheet.columns = [
        { header: "Параметр", key: "param", width: 40 },
        { header: "Значение", key: "value", width: 20 },
      ];
      const hRow2 = statsSheet.getRow(1);
      hRow2.font = { bold: true };
      hRow2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
      statsSheet.addRow({ param: "Всего жалоб", value: result.totalComplaints });
      statsSheet.addRow({ param: "Привязано к потребителям", value: result.totalMatched });
      statsSheet.addRow({ param: "Не привязано", value: result.totalUnmatched });
      statsSheet.addRow({ param: "Кластеров (дата+близость)", value: result.dateGroups.length });
      if (result.unclustered) {
        statsSheet.addRow({ param: "Единичных жалоб (не кластеризованы)", value: result.unclustered.length });
      }

      const usedSheetNames = new Set<string>();
      for (let gi = 0; gi < result.dateGroups.length; gi++) {
        const group = result.dateGroups[gi];
        if (group.consumers.length === 0) continue;
        let sheetName = `${group.date}_кл${group.clusterId || gi + 1}`.substring(0, 31);
        let counter = 1;
        while (usedSheetNames.has(sheetName)) {
          const suffix = `_${counter}`;
          sheetName = `${group.date}_кл${group.clusterId || gi + 1}`.substring(0, 31 - suffix.length) + suffix;
          counter++;
        }
        usedSheetNames.add(sheetName);
        const detailSheet = workbook.addWorksheet(sheetName);
        detailSheet.columns = [
          { header: "Потребитель", key: "name", width: 35 },
          { header: "Адрес", key: "address", width: 40 },
          { header: "Жалоб", key: "count", width: 10 },
          { header: "Расстояние (м)", key: "distance", width: 15 },
          { header: "Тип привязки", key: "matchType", width: 20 },
        ];
        const dh = detailSheet.getRow(1);
        dh.font = { bold: true };
        dh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

        for (const c of group.consumers) {
          detailSheet.addRow({
            name: c.name,
            address: c.address,
            count: c.complaintCount,
            distance: c.distance,
            matchType: c.matchType === "address+proximity" ? "Адрес + близость" : "Только близость",
          });
        }

        if (group.failureZones && group.failureZones.length > 0) {
          for (let zi = 0; zi < group.failureZones.length; zi++) {
            const zone = group.failureZones[zi];
            detailSheet.addRow({});
            detailSheet.addRow({ name: `--- Зона аварии ${zi + 1}: ${zone.zoneName} ---` });
            detailSheet.addRow({ name: "Тип узла", address: translateNodeType(zone.zoneType) });
            if (zone.incomingSegment) {
              detailSheet.addRow({ name: "Участок", address: `${zone.incomingSegment.from} → ${zone.incomingSegment.to} (${zone.incomingSegment.length}м)` });
            }
            detailSheet.addRow({ name: "Уверенность", address: translateConfidence(zone.confidence) });
            detailSheet.addRow({ name: "Жалоб в зоне", address: String(zone.complaintCount) });
            detailSheet.addRow({ name: "Потребителей ниже", address: String(zone.downstreamConsumerCount) });

            if (zone.affectedConsumers.length > 0) {
              detailSheet.addRow({ name: "Затронутые потребители:" });
              for (const ac of zone.affectedConsumers) {
                detailSheet.addRow({ name: `  ${ac.name}`, address: ac.address });
              }
            }
          }
        }
      }

      if (result.unmatchedComplaints.length > 0) {
        const unmatchedSheet = workbook.addWorksheet("Без привязки");
        unmatchedSheet.columns = [
          { header: "ID жалобы", key: "id", width: 15 },
          { header: "Адрес", key: "address", width: 40 },
          { header: "Дата", key: "date", width: 15 },
          { header: "Причина", key: "reason", width: 40 },
        ];
        const uh = unmatchedSheet.getRow(1);
        uh.font = { bold: true };
        uh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
        for (const u of result.unmatchedComplaints) {
          unmatchedSheet.addRow({ id: u.complaintId, address: u.address, date: u.date, reason: u.reason });
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = encodeURIComponent("Анализ_жалоб.xlsx");

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (error: any) {
      console.error("Complaint analysis export error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/complaint-analysis/save-as-layer", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { mode, sceneId, layerName, topologyResult, noTopologyResult, analysisParams } = req.body;

      if (!mode || !layerName) {
        return res.status(400).json({ error: "mode and layerName are required" });
      }

      const features: Array<{ geometryType: string; coordinates: any; properties: Record<string, unknown> }> = [];

      if (mode === "no_topology" && noTopologyResult) {
        for (const cluster of noTopologyResult.clusters) {
          if (!cluster.polygon || cluster.polygon.length < 3) continue;
          const ring = [...cluster.polygon, cluster.polygon[0]];
          const complaintDetails = cluster.complaints.map((c: any, idx: number) => {
            const parts = [`Жалоба ${idx + 1}`];
            if (c.address) parts.push(`адрес: ${c.address}`);
            if (c.featureId) parts.push(`ID: ${c.featureId}`);
            const propEntries = Object.entries(c.properties || {});
            for (const [key, val] of propEntries) {
              if (val !== null && val !== undefined && val !== "" && key !== "id") {
                parts.push(`${key}: ${String(val)}`);
              }
            }
            return parts.join(", ");
          });
          const addresses = cluster.complaints
            .map((c: any) => c.address)
            .filter(Boolean);
          const uniqueAddresses = [...new Set(addresses)];

          const layerBreakdown = cluster.layerBreakdown || {};
          const breakdownStr = Object.entries(layerBreakdown)
            .map(([name, count]) => `${name}: ${count}`)
            .join("; ");
          const sourceLayerNames = Object.keys(layerBreakdown);

          const props: Record<string, unknown> = {
            cluster_id: cluster.id,
            date: cluster.date || "Все даты",
            complaint_count: cluster.complaintCount,
            source_layers: sourceLayerNames.join("; "),
            layer_breakdown: breakdownStr,
            radius_m: Math.round(cluster.radiusM),
            centroid_lon: cluster.centroid[0],
            centroid_lat: cluster.centroid[1],
            addresses: uniqueAddresses.join("; "),
            address_count: uniqueAddresses.length,
          };

          cluster.complaints.forEach((c: any, idx: number) => {
            const num = idx + 1;
            props[`complaint_${num}_address`] = c.address || "";
            props[`complaint_${num}_layer`] = c.layerName || "";
            props[`complaint_${num}_lon`] = c.lon;
            props[`complaint_${num}_lat`] = c.lat;
            if (c.featureId) props[`complaint_${num}_id`] = c.featureId;
            if (c.properties) {
              for (const [key, val] of Object.entries(c.properties)) {
                if (val !== null && val !== undefined && val !== "" && key !== "id") {
                  props[`complaint_${num}_${key}`] = val;
                }
              }
            }
          });

          features.push({
            geometryType: "Polygon",
            coordinates: [ring],
            properties: props,
          });
        }
      } else if (mode === "topology" && topologyResult) {
        for (const group of topologyResult.dateGroups) {
          if (!group.failureZones) continue;
          for (const zone of group.failureZones) {
            const allCoords: number[][] = [];
            if (zone.zoneCoordinates) {
              allCoords.push(zone.zoneCoordinates);
            }
            if (zone.affectedConsumers) {
              for (const ac of zone.affectedConsumers) {
                if (ac.coordinates) allCoords.push(ac.coordinates);
              }
            }
            if (zone.affectedSegments) {
              for (const seg of zone.affectedSegments) {
                if (seg.coordinates && Array.isArray(seg.coordinates)) {
                  if (Array.isArray(seg.coordinates[0])) {
                    for (const pt of seg.coordinates) allCoords.push(pt);
                  } else {
                    allCoords.push(seg.coordinates);
                  }
                }
              }
            }

            const confidenceMap: Record<string, string> = { high: "Высокая", medium: "Средняя", low: "Низкая" };
            const nodeTypeMap: Record<string, string> = { source: "Источник", ctp: "ЦТП", consumer: "Потребитель", node: "Узел", valve: "Задвижка", pump: "Насос" };

            const zoneProps: Record<string, unknown> = {
              zone_name: zone.zoneName || "",
              zone_type: nodeTypeMap[zone.zoneType] || zone.zoneType || "",
              date: group.date || "",
              cluster_id: group.clusterId || "",
              source_name: group.sourceName || "",
              probability: (zone as any).probability ?? null,
              confidence: confidenceMap[zone.confidence] || zone.confidence || "",
              complaint_count: zone.complaintCount || 0,
              downstream_consumer_count: zone.downstreamConsumerCount || 0,
              complaint_consumers: zone.complaintConsumers?.join("; ") || "",
              segment: zone.incomingSegment ? `${zone.incomingSegment.from} → ${zone.incomingSegment.to}` : "",
              segment_length_m: zone.incomingSegment?.length || 0,
              affected_segments_count: zone.affectedSegments?.length || 0,
              affected_consumers_count: zone.affectedConsumers?.length || 0,
              affected_segments_length_m: zone.affectedSegments?.reduce((s: number, seg: any) => s + (seg.length || 0), 0) || 0,
            };

            if (group.layerBreakdown) {
              zoneProps.layer_breakdown = JSON.stringify(group.layerBreakdown);
            }

            if (zone.affectedConsumers) {
              const consumerNames = zone.affectedConsumers.map((ac: any) => ac.name).filter(Boolean);
              const consumerAddresses = zone.affectedConsumers.map((ac: any) => ac.address).filter(Boolean);
              zoneProps.consumer_names = consumerNames.join("; ");
              zoneProps.consumer_addresses = [...new Set(consumerAddresses)].join("; ");
              zone.affectedConsumers.forEach((ac: any, idx: number) => {
                const num = idx + 1;
                zoneProps[`consumer_${num}_name`] = ac.name || "";
                zoneProps[`consumer_${num}_address`] = ac.address || "";
              });
            }

            if (zone.affectedSegments) {
              const segDetails = zone.affectedSegments.map((seg: any) => `${seg.from} → ${seg.to} (${seg.length}м)`);
              zoneProps.segments_detail = segDetails.join("; ");
            }

            if (group.consumers) {
              const groupConsumers = group.consumers.map((c: any) => {
                const parts = [c.name || ""];
                if (c.address) parts.push(c.address);
                parts.push(`жалоб: ${c.complaintCount}`);
                parts.push(`${c.distance}м`);
                return parts.join(", ");
              });
              zoneProps.group_complaint_count = group.complaintCount || 0;
              zoneProps.group_consumers = groupConsumers.join("; ");
            }

            const addFeature = (ring: number[][]) => {
              features.push({
                geometryType: "Polygon",
                coordinates: [ring],
                properties: zoneProps,
              });
            };

            if (allCoords.length < 3) {
              if (allCoords.length === 1) {
                const [lon, lat] = allCoords[0];
                const d = 0.002;
                addFeature([
                  [lon - d, lat - d], [lon + d, lat - d],
                  [lon + d, lat + d], [lon - d, lat + d],
                  [lon - d, lat - d],
                ]);
              } else if (allCoords.length === 2) {
                const [p1, p2] = allCoords;
                const dx = (p2[0] - p1[0]);
                const dy = (p2[1] - p1[1]);
                const nx = -dy * 0.3;
                const ny = dx * 0.3;
                const d = 0.001;
                addFeature([
                  [p1[0] + nx * d / Math.max(Math.abs(nx), 0.0001), p1[1] + ny * d / Math.max(Math.abs(ny), 0.0001)],
                  [p2[0] + nx * d / Math.max(Math.abs(nx), 0.0001), p2[1] + ny * d / Math.max(Math.abs(ny), 0.0001)],
                  [p2[0] - nx * d / Math.max(Math.abs(nx), 0.0001), p2[1] - ny * d / Math.max(Math.abs(ny), 0.0001)],
                  [p1[0] - nx * d / Math.max(Math.abs(nx), 0.0001), p1[1] - ny * d / Math.max(Math.abs(ny), 0.0001)],
                  [p1[0] + nx * d / Math.max(Math.abs(nx), 0.0001), p1[1] + ny * d / Math.max(Math.abs(ny), 0.0001)],
                ]);
              }
              continue;
            }

            const sorted = [...allCoords];
            const center = sorted.reduce((acc, p) => [acc[0] + p[0] / sorted.length, acc[1] + p[1] / sorted.length], [0, 0]);
            sorted.sort((a, b) => Math.atan2(a[1] - center[1], a[0] - center[0]) - Math.atan2(b[1] - center[1], b[0] - center[0]));
            addFeature([...sorted, sorted[0]]);
          }
        }
      }

      if (features.length === 0) {
        return res.status(422).json({ error: "No features with valid geometry to save" });
      }

      const layerMetadata: Record<string, unknown> = {
        analysisType: "complaint_analysis",
        analysisMode: mode === "topology" ? "Топологический анализ" : "Кластерный анализ",
        analysisDate: new Date().toISOString(),
      };

      if (mode === "topology" && topologyResult) {
        layerMetadata.totalComplaints = topologyResult.totalComplaints || 0;
        layerMetadata.totalMatched = topologyResult.totalMatched || 0;
        layerMetadata.totalUnmatched = topologyResult.totalUnmatched || 0;
        layerMetadata.clusterCount = topologyResult.dateGroups?.length || 0;
        layerMetadata.unclusteredCount = topologyResult.unclustered?.length || 0;
        layerMetadata.failureZoneCount = features.length;
      } else if (mode === "no_topology" && noTopologyResult) {
        layerMetadata.totalComplaints = noTopologyResult.totalComplaints || 0;
        layerMetadata.totalClustered = noTopologyResult.totalClustered || 0;
        layerMetadata.totalUnclustered = noTopologyResult.totalUnclustered || 0;
        layerMetadata.clusterCount = features.length;
      }

      if (analysisParams) {
        if (analysisParams.complaintLayerName) layerMetadata.complaintLayerName = analysisParams.complaintLayerName;
        if (analysisParams.sourceLayerNames && Array.isArray(analysisParams.sourceLayerNames)) {
          layerMetadata.sourceLayerNames = analysisParams.sourceLayerNames;
        }
        if (analysisParams.matchRadius !== undefined && analysisParams.matchRadius !== null) layerMetadata.matchRadius = analysisParams.matchRadius;
        if (analysisParams.dateFieldName) layerMetadata.dateFieldName = analysisParams.dateFieldName;
        if (analysisParams.addressFieldName) layerMetadata.addressFieldName = analysisParams.addressFieldName;
      }

      const layer = await storage.createEditableLayer({
        sceneId: sceneId ? Number(sceneId) : null,
        name: layerName,
        geometryType: "Polygon",
        color: mode === "topology" ? "#E65100" : "#AD1457",
        source: "import" as const,
        visible: true as any,
        opacity: 0.6,
        metadata: layerMetadata,
      } as any);

      const insertFeatures = features.map(f => ({
        layerId: layer.id,
        geometryType: f.geometryType as "Point" | "LineString" | "Polygon",
        coordinates: f.coordinates,
        properties: f.properties,
      }));

      await storage.createDrawnFeaturesBatch(insertFeatures);

      const allPropertyKeys = new Set<string>();
      for (const f of features) {
        for (const key of Object.keys(f.properties)) {
          allPropertyKeys.add(key);
        }
      }

      const schemaFields = Array.from(allPropertyKeys).map(key => {
        const sampleValue = features.find(f => f.properties[key] !== null && f.properties[key] !== undefined)?.properties[key];
        let fieldType: "text" | "number" = "text";
        if (typeof sampleValue === "number") fieldType = "number";

        return {
          name: key,
          type: fieldType,
          required: false,
        };
      });

      try {
        await storage.createLayerSchema({
          layerId: layer.id,
          fields: schemaFields,
        });
      } catch (schemaErr: any) {
        console.error("Failed to create layer schema for complaint analysis:", schemaErr);
      }

      return res.status(201).json({
        layerId: layer.id,
        layerName: layer.name,
        featureCount: features.length,
        metadata: layerMetadata,
      });
    } catch (error: any) {
      console.error("Save complaint analysis as layer error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.get("/api/ai/providers", isAuthenticated as any, async (_req: AuthRequest, res: Response) => {
    try {
      const aiEnabled = await storage.getAppSetting("ai_enabled");
      if (aiEnabled !== "true") {
        return res.json({ enabled: false, providers: [], default: null });
      }
      const allProviders = await storage.getAiProviders();
      const activeProviders = allProviders.filter(p => p.isActive && p.baseUrl && p.apiKey && p.model);
      const providers = activeProviders.map(p => ({
        id: String(p.id),
        name: p.name,
        available: true,
      }));
      const defaultProvider = allProviders.find(p => p.isDefault && p.isActive && p.baseUrl && p.apiKey && p.model);
      return res.json({
        enabled: true,
        providers,
        default: defaultProvider ? String(defaultProvider.id) : (activeProviders.length > 0 ? String(activeProviders[0].id) : null),
      });
    } catch (error) {
      console.error("Error getting AI providers:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/ai/chat", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const aiEnabled = await storage.getAppSetting("ai_enabled");
      if (aiEnabled !== "true") {
        return res.status(403).json({ error: "ИИ-агент отключён администратором системы, обратитесь в техническую поддержку." });
      }

      const { messages, provider: providerIdStr, sceneId } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages is required and must be a non-empty array" });
      }

      let selectedProvider;
      if (providerIdStr) {
        selectedProvider = await storage.getAiProvider(parseInt(providerIdStr));
      }
      if (!selectedProvider) {
        selectedProvider = await storage.getDefaultAiProvider();
      }
      if (!selectedProvider || !selectedProvider.baseUrl || !selectedProvider.apiKey || !selectedProvider.model) {
        return res.status(500).json({ error: "ИИ-агент отключён администратором системы, обратитесь в техническую поддержку." });
      }

      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";

      let ragContext = "";
      let layersSummary = "";
      let layerDataContext = "";
      let programsContext = "";
      try {
        const parsedSceneId = sceneId ? parseInt(sceneId) : null;
        const [ragResult, layersResult, layerDataResult, programsResult] = await Promise.all([
          searchObjectsForRAG(lastUserMessage, parsedSceneId),
          getLayersSummaryForContext(parsedSceneId),
          detectAndFetchLayerData(lastUserMessage, parsedSceneId),
          getReconstructionProgramsForContext(parsedSceneId),
        ]);
        ragContext = ragResult;
        layersSummary = layersResult;
        layerDataContext = layerDataResult;
        programsContext = programsResult;
      } catch (e) {
        console.error("[RAG] Error during search:", e);
      }

      const systemMessage = {
        role: "system",
        content: `Ты — ИИ-агент ГИС МО "Инженерные сети". Помогай пользователю с вопросами об инженерных сетях, теплоснабжении, объектах инфраструктуры. Отвечай на русском языке, кратко и по делу. Ты разбираешься в тепловых сетях, потребителях, источниках теплоснабжения, ЦТП, задвижках, узлах учёта. Можешь помочь с анализом данных, поиском проблемных участков и планированием обслуживания.

СТРОГОЕ ПРАВИЛО ФОРМАТИРОВАНИЯ: Никогда не используй двойные звёздочки (**) в своих ответах. Не используй разметку Markdown для жирного текста. Не используй заглавные буквы для выделения. Для структурирования информации используй тире или нумерованные списки.

ИНСТРУМЕНТ СИМУЛЯЦИИ ОТКЛЮЧЕНИЯ:
СТРОГО: Используй этот инструмент ТОЛЬКО если пользователь явно просит смоделировать или проверить аварию/отключение. Триггерные слова и фразы: "симуляция", "симулируй", "симулировать", "отключение", "отключи", "отключить", "авария на", "зона аварии", "зона отключения", "кого затронет", "что будет если отключить", "что произойдёт если отключить", "кто останется без тепла", "зона поражения".

НЕ добавляй маркер [ACTION:SIMULATION_SEARCH] если пользователь:
- спрашивает характеристики, параметры, состояние или данные объекта
- просит показать информацию об объекте
- задаёт общие вопросы об объекте — даже если называет конкретный объект по имени
- использует слова: "характеристики", "параметры", "данные", "состояние", "информация", "расскажи", "покажи", "какие"

Если нет триггерных слов — отвечай на вопрос по существу используя данные из БД. Никаких маркеров.

Если запрос ДЕЙСТВИТЕЛЬНО про симуляцию:
1. Определи из запроса тип объекта и сопоставь с кодом типа сети (бейджем слоя):
   - котельная / ТЭЦ / ГРЭС / источник / бойлерная → source
   - ЦТП / ИТП / тепловой пункт / теплопункт → ctp
   - потребитель / абонент / здание / жилой дом / дом → consumer
   - участок / трубопровод / труба / магистраль / сеть → segment
   - задвижка / вентиль / кран / запорная арматура → valve
   - узел / камера / узловая точка → node
   - насос / насосная → pump
   - если тип объекта не ясен → _any_
2. Определи идентификатор объекта: название, номер, адрес (улица, дом).
3. Составь краткий поисковый запрос только из идентификатора (без слова "задвижка" и т.п. — оно учтено в типе).
4. Ответь пользователю что ищешь объект и готовишь симуляцию.
5. В САМОМ КОНЦЕ добавь маркер: [ACTION:SIMULATION_SEARCH:ПОИСКОВЫЙ_ЗАПРОС:NETWORK_TYPE_КОД]
   Например: [ACTION:SIMULATION_SEARCH:Котельная №1:source]
   Например: [ACTION:SIMULATION_SEARCH:ЦТП-12:ctp]
   Например: [ACTION:SIMULATION_SEARCH:Ленина 15:valve]
   Например: [ACTION:SIMULATION_SEARCH:насосная №3:pump]
   Например: [ACTION:SIMULATION_SEARCH:объект:_any_]
6. Если пользователь не указал конкретный объект (улицу, номер, название) — уточни у него. НЕ добавляй маркер.

ИНСТРУМЕНТ АНАЛИЗА ЖАЛОБ:
Если пользователь просит проанализировать жалобы, найти кластеры жалоб, или что-то связанное с анализом обращений/жалоб:
1. Проанализируй список доступных слоёв (ниже) и найди слой, который содержит жалобы (по названию слоя — ключевые слова: "жалоб", "обращен", "заявк", "complaint").
2. Если нашёл подходящий слой — посмотри его атрибуты и определи:
   а) Столбец с датами (ключевые слова: "дат", "date", "Date", "Дат", "дата", "created", "время").
   б) Столбец с адресами (ключевые слова: "адрес", "адр", "address", "addr", "Adres", "place", "location", "место", "улиц", "street").
3. Ответь пользователю, указав какой слой нашёл, какой столбец дат и какой столбец адресов определил, и что можешь запустить анализ.
4. В САМОМ КОНЦЕ ответа добавь технический маркер в формате: [ACTION:COMPLAINT_ANALYSIS:ID_СЛОЯ:ПОЛЕ_ДАТЫ:ПОЛЕ_АДРЕСА]
   Например: [ACTION:COMPLAINT_ANALYSIS:42:Дата_жалобы:Адрес]
   Если столбец дат не найден, используй _none_: [ACTION:COMPLAINT_ANALYSIS:42:_none_:Адрес]
   Если столбец адреса не найден, используй _none_: [ACTION:COMPLAINT_ANALYSIS:42:Дата_жалобы:_none_]
5. Если подходящий слой не найден — сообщи об этом и попроси пользователя уточнить название слоя. НЕ добавляй маркер в этом случае.

ИНСТРУМЕНТ АНАЛИЗА АВАРИЙНОСТИ:
Если пользователь просит проанализировать аварии на сетях, найти проблемные участки по авариям, узнать где больше всего аварий на трубопроводах — запусти следующий сценарий (строго по шагам, не пропускай шаги):

Шаг 1. Уточни тип сети (если пользователь не указал явно):
"Вас интересуют тепловые сети (ТС), горячее водоснабжение (ГВС) или все сети сразу?"
- Ответ ТС / тепловые → zMode = "1"
- Ответ ГВС / горячее водоснабжение → zMode = "2"
- Ответ все / без разницы → zMode = "" (пустая строка)

Шаг 2. Уточни фильтр по диаметру подачи (поле Dpod, значения в метрах):
"Нужен ли фильтр по диаметру подачи? Например, анализировать только участки с Dpod свыше 100 мм (0,1 м)?"
- Если пользователь указал диаметр в мм (например "100 мм") → dpodMin = значение/1000 (т.е. 0.1)
- Если пользователь указал в метрах (например "0,1 м") → dpodMin = 0.1
- Если фильтр не нужен → dpodMin = "" (пустая строка)

Шаг 3. Запроси подтверждение:
"Хотите, чтобы я выполнил анализ аварийности?"

Шаг 4. Только после положительного ответа пользователя — в САМОМ КОНЦЕ ответа добавь маркер:
[ACTION:ACCIDENT_ANALYSIS:zMode:dpodMin]
Примеры:
[ACTION:ACCIDENT_ANALYSIS:1:]     - ТС, без фильтра диаметра
[ACTION:ACCIDENT_ANALYSIS:2:0.1]  - ГВС, Dpod > 0.1 м
[ACTION:ACCIDENT_ANALYSIS::]      - все сети, без фильтра
[ACTION:ACCIDENT_ANALYSIS::0.2]   - все сети, Dpod > 0.2 м

НЕ добавляй маркер [ACTION:ACCIDENT_ANALYSIS] если пользователь ещё не подтвердил запуск.
НЕ используй этот инструмент для справочных вопросов об авариях (сроки устранения, нормативы и т.д.).

АНАЛИТИКА ПО РЕЗУЛЬТАТАМ АНАЛИЗА АВАРИЙНОСТИ:
В списке слоёв могут присутствовать слои с пометкой [РЕЗУЛЬТАТ АНАЛИЗА АВАРИЙНОСТИ]. Эти слои содержат сохранённые итоги ранее выполненного анализа аварийности с полями: AccidentCount (количество аварий), Begin_uch/End_uch (начало и конец участка), Dpod (диаметр подачи), L (длина), Sys (система), Kol_potreb (количество потребителей), Kol_zhit (количество жителей).
Если пользователь задаёт вопросы об авариях, проблемных участках, рейтинге аварийности — сначала ищи такой слой среди доступных и используй его данные как первичный источник. Явно указывай пользователю, из какого слоя взята информация.
Если ниже в разделе "ДАННЫЕ СЛОЯ" приведены фактические данные участков из слоя аварийности — используй их для ответа на вопросы об участках, диаметрах, длинах, количестве аварий.

ИНСТРУМЕНТ "ПРОГРАММА РЕКОНСТРУКЦИИ":
В системе существует модуль "Программа реконструкции", который позволяет:
- Автоматически рассчитать стоимость замены участков по справочнику удельных стоимостей (учитывает тип работ, диаметр, тип прокладки)
- Ранжировать участки по скорингу критичности (удельная аварийность 35%, жители 25%, потребители 20%, аварии 15%, диаметр 5%)
- Распределить работы по годам с учётом годового бюджетного лимита
- Выгрузить итоговый план в Excel

Ниже могут быть указаны уже существующие программы реконструкции для текущей сцены.

Если пользователь просит:
- сформировать план реконструкции / перекладки
- составить список участков под реконструкцию с учётом бюджета
- ранжировать участки по приоритету
- рассчитать стоимость ремонта участков
- создать программу реконструкции

Тогда (строго по шагам):
Шаг 1. Убедись, что в сцене есть слой с результатами анализа аварийности [РЕЗУЛЬТАТ АНАЛИЗА АВАРИЙНОСТИ]. Если нет — предложи сначала выполнить анализ аварийности.
Шаг 2. Уточни у пользователя (если не указано):
  а) Название программы (по умолчанию: "Программа реконструкции <текущий год>")
  б) Период программы (начальный и конечный год, например 2025–2030)
  в) Годовой бюджет в млн руб. (или общий бюджет)
  г) Тип работ: капитальный ремонт или реконструкция (по умолчанию: капитальный ремонт)
Шаг 3. Подтверди параметры с пользователем.
Шаг 4. После подтверждения — в САМОМ КОНЦЕ ответа добавь маркер:
[ACTION:RECONSTRUCTION_PROGRAM:LAYER_ID:PROGRAM_NAME:PERIOD_FROM:PERIOD_TO:ANNUAL_BUDGET_THOUSANDS:WORK_TYPE]
Где:
- LAYER_ID — ID слоя с результатами анализа аварийности (из списка слоёв)
- PROGRAM_NAME — название программы (без двоеточий)
- PERIOD_FROM — начальный год (число)
- PERIOD_TO — конечный год (число)
- ANNUAL_BUDGET_THOUSANDS — годовой бюджет в тыс. руб. (например, 100000 для 100 млн; если не указан — пустая строка)
- WORK_TYPE — overhaul (кап. ремонт) или reconstruction (реконструкция)
Пример: [ACTION:RECONSTRUCTION_PROGRAM:387:Программа реконструкции 2025:2025:2030:100000:overhaul]

НЕ добавляй маркер [ACTION:RECONSTRUCTION_PROGRAM] если пользователь ещё не подтвердил параметры.

ВАЖНО: Если ниже приведены данные из базы или данные слоя — используй их для ответа. Ссылайся на конкретные значения параметров. Если данных нет — отвечай на основе общих знаний, но предупреди, что это общая информация, а не данные из системы.${layersSummary}${programsContext}${layerDataContext}${ragContext}`,
      };

      const apiMessages = [systemMessage, ...messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      }))];

      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: selectedProvider.apiKey, baseURL: selectedProvider.baseUrl });

      const completion = await client.chat.completions.create({
        model: selectedProvider.model,
        messages: apiMessages as any,
        temperature: 0.3,
        max_tokens: 2000,
      });

      const aiText = completion.choices?.[0]?.message?.content || "Нет ответа от модели";
      return res.json({ content: aiText, provider: selectedProvider.name });
    } catch (error: any) {
      console.error("AI chat error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.get("/api/ai/search-features", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { sceneId, query, networkType } = req.query;
      if (!sceneId) return res.status(400).json({ error: "sceneId is required" });
      if (!query || String(query).trim().length < 2) return res.json([]);

      const q = String(query).trim();
      const sceneIdNum = Number(sceneId);
      const nt = networkType && String(networkType) !== "_any_" ? String(networkType) : null;

      const layersRows = nt
        ? await db.execute(sql`
            SELECT id, name, network_type FROM editable_layers
            WHERE scene_id = ${sceneIdNum} AND feature_count > 0 AND network_type = ${nt}
          `)
        : await db.execute(sql`
            SELECT id, name, network_type FROM editable_layers
            WHERE scene_id = ${sceneIdNum} AND feature_count > 0
          `);
      const layers = (layersRows as any).rows || [];
      if (layers.length === 0) return res.json([]);

      const layerIds: number[] = layers.map((l: any) => Number(l.id));
      const layerMap = new Map<number, string>(layers.map((l: any) => [Number(l.id), l.name]));

      const likePattern = `%${q}%`;
      const features = await db
        .select({ id: drawnFeatures.id, layer_id: drawnFeatures.layerId, properties: drawnFeatures.properties })
        .from(drawnFeatures)
        .where(and(
          inArray(drawnFeatures.layerId, layerIds),
          sql`${drawnFeatures.properties}::text ILIKE ${likePattern}`
        ))
        .orderBy(
          sql`CASE WHEN lower(${drawnFeatures.properties}->>'Name') = lower(${q}) THEN 0 WHEN lower(${drawnFeatures.properties}->>'Name') LIKE lower(${q + '%'}) THEN 1 ELSE 2 END`,
          drawnFeatures.id
        )
        .limit(10);

      const NAME_KEYS = ["name", "Наименование", "наименование", "название", "Название", "Имя", "имя", "Name"];
      const ADDR_KEYS = ["Адрес", "адрес", "address", "Address", "addr", "Adres", "adres", "место", "Место"];

      const result = features.map((f: any) => {
        const props = typeof f.properties === "string" ? JSON.parse(f.properties) : (f.properties || {});
        let featureName = "";
        for (const k of NAME_KEYS) { if (props[k]) { featureName = String(props[k]); break; } }
        if (!featureName) {
          const keys = Object.keys(props);
          featureName = keys.length > 0 ? String(props[keys[0]]) : `Объект #${f.id}`;
        }
        let featureAddress = "";
        for (const k of ADDR_KEYS) { if (props[k]) { featureAddress = String(props[k]); break; } }
        return {
          featureId: f.id,
          layerId: f.layer_id,
          layerName: layerMap.get(f.layer_id) || "",
          featureName,
          featureAddress,
        };
      });

      return res.json(result);
    } catch (error: any) {
      console.error("AI search-features error:", error);
      return res.status(500).json({ error: error.message || "Ошибка поиска" });
    }
  });

  app.post("/api/ai/run-simulation", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { featureId, layerId, sceneId } = req.body;
      if (!featureId || !layerId || !sceneId) {
        return res.status(400).json({ error: "featureId, layerId и sceneId обязательны" });
      }
      const { simulateSpatialDisconnection } = await import("./network-graph");
      const result = await simulateSpatialDisconnection(Number(featureId), Number(layerId), Number(sceneId));
      return res.json(result);
    } catch (error: any) {
      console.error("AI run-simulation error:", error);
      return res.status(500).json({ error: error.message || "Ошибка симуляции" });
    }
  });

  app.post("/api/ai/run-complaint-analysis", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layerId, dateField, addressField } = req.body;

      if (!layerId) {
        return res.status(400).json({ error: "layerId is required" });
      }

      const layer = await storage.getEditableLayer(Number(layerId));
      if (!layer) {
        return res.status(404).json({ error: "Слой не найден" });
      }

      const { analyzeComplaintsNoTopology } = await import("./complaint-analysis");
      const result = await analyzeComplaintsNoTopology(
        [{ layerId: Number(layerId), dateField: dateField || "_none_", addressField: addressField || "" }],
        250
      );

      return res.json(result);
    } catch (error: any) {
      console.error("AI complaint analysis error:", error);
      return res.status(500).json({ error: error.message || "Ошибка анализа жалоб" });
    }
  });

  app.post("/api/ai/run-accident-analysis", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { zMode, dpodMin, sceneId } = req.body;

      if (!sceneId) {
        return res.status(400).json({ error: "sceneId is required" });
      }

      const sceneLayers = await storage.getEditableLayersByScene(Number(sceneId));

      const networkLayer = sceneLayers.find(l => l.networkType === "segment");
      const accidentLayer = sceneLayers.find(l => l.networkType === "accident");

      if (!networkLayer) {
        return res.status(422).json({ error: "Не найден слой с типом «Участок» (networkType=segment). Назначьте тип слою сетей в настройках слоёв." });
      }
      if (!accidentLayer) {
        return res.status(422).json({ error: "Не найден слой с типом «Авария» (networkType=accident). Назначьте тип слою аварий в настройках слоёв." });
      }

      const networkFeaturesRaw = await storage.getDrawnFeatures(networkLayer.id);
      const accidentFeaturesRaw = await storage.getDrawnFeatures(accidentLayer.id);

      let networkFeatures = networkFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));

      const accidentFeatures = accidentFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: (f.properties || {}) as Record<string, unknown>,
      }));

      if (accidentFeatures.length === 0) {
        return res.status(422).json({ error: "Слой аварий не содержит объектов" });
      }

      if (zMode && zMode !== "") {
        networkFeatures = networkFeatures.filter(f => {
          const val = f.properties["ZMode"] ?? f.properties["zMode"] ?? f.properties["ZMODE"];
          return val !== undefined && String(val) === String(zMode);
        });
      }

      if (dpodMin !== undefined && dpodMin !== "" && dpodMin !== null) {
        const dpodMinNum = Number(dpodMin);
        if (!isNaN(dpodMinNum) && dpodMinNum > 0) {
          networkFeatures = networkFeatures.filter(f => {
            const val = f.properties["Dpod"] ?? f.properties["dpod"] ?? f.properties["DPOD"];
            return val !== undefined && Number(val) > dpodMinNum;
          });
        }
      }

      if (networkFeatures.length === 0) {
        return res.status(422).json({ error: "После применения фильтров в слое сетей не осталось объектов" });
      }

      const maxDistanceMeters = 15;
      const segmentAccidentMap: Map<number, { feature: typeof networkFeatures[0]; accidents: typeof accidentFeatures }> = new Map();
      let boundCount = 0;
      let unboundCount = 0;

      for (const accidentFeature of accidentFeatures) {
        if (!accidentFeature.geometry || accidentFeature.geometry.type !== "Point") {
          unboundCount++;
          continue;
        }

        const accidentPoint = turf.point(accidentFeature.geometry.coordinates as number[]);
        let nearestNetworkIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < networkFeatures.length; i++) {
          const netFeature = networkFeatures[i];
          if (!netFeature.geometry) continue;
          const geomType = netFeature.geometry.type;
          if (geomType !== "LineString" && geomType !== "MultiLineString") continue;

          try {
            let minDist = Infinity;
            if (geomType === "LineString") {
              const line = turf.lineString(netFeature.geometry.coordinates as number[][]);
              const np = turf.nearestPointOnLine(line, accidentPoint);
              if (np.properties.dist !== undefined) minDist = np.properties.dist;
            } else {
              const coords = netFeature.geometry.coordinates as number[][][];
              for (const lineCoords of coords) {
                if (lineCoords.length < 2) continue;
                const line = turf.lineString(lineCoords);
                const np = turf.nearestPointOnLine(line, accidentPoint);
                if (np.properties.dist !== undefined && np.properties.dist < minDist) {
                  minDist = np.properties.dist;
                }
              }
            }
            if (minDist < nearestDistance) {
              nearestDistance = minDist;
              nearestNetworkIndex = i;
            }
          } catch (e) {
            continue;
          }
        }

        const distMeters = nearestDistance * 1000;
        if (nearestNetworkIndex >= 0 && distMeters <= maxDistanceMeters) {
          const netFeature = networkFeatures[nearestNetworkIndex];
          if (!segmentAccidentMap.has(nearestNetworkIndex)) {
            segmentAccidentMap.set(nearestNetworkIndex, { feature: netFeature, accidents: [] });
          }
          segmentAccidentMap.get(nearestNetworkIndex)!.accidents.push(accidentFeature);
          boundCount++;
        } else {
          unboundCount++;
        }
      }

      const segments = Array.from(segmentAccidentMap.entries())
        .map(([, data]) => {
          const props = data.feature.properties;
          return {
            featureId: data.feature.id,
            geometry: data.feature.geometry,
            properties: props,
            dpod: props.Dpod ?? props.dpod ?? props.DPOD ?? null,
            dobr: props.Dobr ?? props.dobr ?? props.DOBR ?? null,
            length: props.L ?? props.l ?? null,
            sys: props.Sys ?? props.sys ?? props.SYS ?? null,
            beginUch: props.Begin_uch ?? props.begin_uch ?? null,
            endUch: props.End_uch ?? props.end_uch ?? null,
            accidentCount: data.accidents.length,
            accidentFeatures: data.accidents.map(a => ({
              id: a.id,
              geometry: a.geometry,
              properties: a.properties,
            })),
          };
        })
        .sort((a, b) => b.accidentCount - a.accidentCount);

      return res.json({
        networkLayerName: networkLayer.name,
        accidentLayerName: accidentLayer.name,
        totalAccidents: accidentFeatures.length,
        boundAccidents: boundCount,
        unboundAccidents: unboundCount,
        segmentsWithAccidents: segments.length,
        segments,
      });
    } catch (error: any) {
      console.error("AI accident analysis error:", error);
      return res.status(500).json({ error: error.message || "Ошибка анализа аварийности" });
    }
  });

  // ─── AI: Run Reconstruction Program from Accident Layer ──────────────────────
  app.post("/api/ai/run-reconstruction-from-layer", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layerId, sceneId, programName, periodFrom, periodTo, annualBudgetThousands, workType } = req.body;

      if (!layerId || !sceneId) {
        return res.status(400).json({ error: "layerId и sceneId обязательны" });
      }

      const layer = await storage.getEditableLayer(Number(layerId));
      if (!layer) {
        return res.status(404).json({ error: `Слой с ID ${layerId} не найден` });
      }

      const features = await storage.getDrawnFeatures(Number(layerId));
      if (!features || features.length === 0) {
        return res.status(422).json({ error: "Слой не содержит объектов" });
      }

      const name = programName || `Программа реконструкции ${new Date().getFullYear()}`;
      const from = parseInt(String(periodFrom)) || new Date().getFullYear();
      const to = parseInt(String(periodTo)) || from + 4;
      const wType = workType || "overhaul";

      const program = await storage.createReconstructionProgram({
        sceneId: Number(sceneId),
        name,
        periodFrom: from,
        periodTo: to,
        baseYear: from,
        inflationRate: "5",
        status: "draft",
        createdBy: (req as AuthRequest).user!.id,
      });

      const objects: any[] = features.map(f => {
        const p = (f.properties || {}) as Record<string, any>;
        const dpodM = parseFloat(p["Dpod"] ?? p["dpod"] ?? "0") || 0;
        const diameterMm = dpodM > 0 ? Math.round(dpodM * 1000) : null;
        const lengthM = parseFloat(p["L"] ?? p["l"] ?? "0") || null;
        const accidentCount = parseInt(p["AccidentCount"] ?? p["accidentCount"] ?? "0") || null;
        const residentCount = parseInt(p["Kol_zhit"] ?? p["kol_zhit"] ?? "0") || null;
        const consumerCount = parseInt(p["Kol_potreb"] ?? p["kol_potreb"] ?? "0") || null;
        const beginUch = p["Begin_uch"] ?? "";
        const endUch = p["End_uch"] ?? "";
        const objectName = [beginUch, endUch].filter(Boolean).join(" – ") || `Участок #${f.id}`;
        return {
          objectType: "pipe",
          objectName,
          diameterMm,
          lengthM,
          layingType: "underground",
          workType: wType,
          accidentCount,
          residentCount,
          consumerCount,
          featureId: f.id,
        };
      });

      const batchResponse = await fetch(`http://localhost:${process.env.PORT || 5000}/api/reconstruction-programs/${program.id}/objects/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie || "" },
        body: JSON.stringify({ objects }),
      });
      if (!batchResponse.ok) {
        const err = await batchResponse.json().catch(() => ({}));
        throw new Error(err.message || "Ошибка импорта объектов в программу");
      }

      const calcResponse = await fetch(`http://localhost:${process.env.PORT || 5000}/api/reconstruction-programs/${program.id}/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie || "" },
        body: JSON.stringify({}),
      });
      if (!calcResponse.ok) {
        const err = await calcResponse.json().catch(() => ({}));
        throw new Error(err.message || "Ошибка расчёта стоимости");
      }
      const calcData = await calcResponse.json();

      const schedBody: Record<string, any> = {};
      if (annualBudgetThousands && Number(annualBudgetThousands) > 0) {
        schedBody.annualBudget = Number(annualBudgetThousands) * 1000;
      }
      const schedResponse = await fetch(`http://localhost:${process.env.PORT || 5000}/api/reconstruction-programs/${program.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie || "" },
        body: JSON.stringify(schedBody),
      });
      if (!schedResponse.ok) {
        const err = await schedResponse.json().catch(() => ({}));
        throw new Error(err.message || "Ошибка расчёта расписания");
      }
      const schedData = await schedResponse.json();

      const refreshed = await storage.getReconstructionProgram(program.id);
      const totalBaseCostM = refreshed?.totalBaseCost ? (parseFloat(refreshed.totalBaseCost) / 1_000_000).toFixed(1) : "—";
      const allObjects: any[] = schedData.objects ?? [];
      const objectsScheduled = allObjects.filter((o: any) => o.plannedYear !== null).length;
      const objectsExcluded = allObjects.length - objectsScheduled;

      invalidateLayersCache(Number(sceneId));

      return res.json({
        programId: program.id,
        programName: name,
        totalObjects: features.length,
        objectsScheduled,
        objectsExcluded,
        totalBaseCostMln: totalBaseCostM,
        periodFrom: from,
        periodTo: to,
        annualBudgetThousands: annualBudgetThousands || null,
        scheduleComment: schedData.comment || "",
      });
    } catch (error: any) {
      console.error("AI run-reconstruction-from-layer error:", error);
      return res.status(500).json({ error: error.message || "Ошибка создания программы реконструкции" });
    }
  });

  // ============================================
  // ADMIN LAYER MANAGER API
  // ============================================

  app.get("/api/admin/layer-matrix", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allLayers = await storage.getEditableLayers();
      const allScenes = await storage.getScenes();

      const layerGroups = new Map<string, {
        name: string;
        geometryType: string;
        source: string;
        sourceFileName?: string;
        networkType?: string | null;
        adminGroupId?: number | null;
        metadata?: any;
        instances: Array<{
          layerId: number;
          sceneId: number | null;
          sceneName: string | null;
          color: string;
          pointStyle: string;
          lineStyle: string;
          opacity: number;
          visible: boolean;
          featureCount: number;
          styleConfig?: any;
          networkType?: string | null;
        }>;
      }>();

      for (const layer of allLayers) {
        const groupKey = `${layer.name}__${layer.geometryType}`;
        if (!layerGroups.has(groupKey)) {
          layerGroups.set(groupKey, {
            name: layer.name,
            geometryType: layer.geometryType,
            source: layer.source,
            sourceFileName: layer.sourceFileName,
            networkType: null,
            adminGroupId: layer.adminGroupId ?? null,
            metadata: layer.metadata ?? null,
            instances: [],
          });
        }
        const scene = layer.sceneId ? allScenes.find(s => s.id === layer.sceneId) : null;
        layerGroups.get(groupKey)!.instances.push({
          layerId: layer.id,
          sceneId: layer.sceneId ?? null,
          sceneName: scene?.name ?? null,
          color: layer.color,
          pointStyle: layer.pointStyle,
          lineStyle: layer.lineStyle,
          opacity: layer.opacity,
          visible: layer.visible,
          featureCount: layer.featureCount,
          styleConfig: layer.styleConfig,
          networkType: layer.networkType,
        });
      }

      const matrix = Array.from(layerGroups.values()).map(group => {
        const types = group.instances.map(i => i.networkType).filter(Boolean);
        group.networkType = types.length > 0 ? types[0] as string : null;
        return group;
      });
      const scenes = allScenes.map(s => ({ id: s.id, name: s.name }));
      const adminGroups = await storage.getAdminLayerGroups();

      return res.json({ matrix, scenes, adminGroups });
    } catch (error) {
      console.error("Error getting layer matrix:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/clone-layer-to-scenes", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { sourceLayerId, targetSceneIds, palette } = req.body;
      if (!sourceLayerId || !targetSceneIds || !Array.isArray(targetSceneIds) || targetSceneIds.length === 0) {
        return res.status(400).json({ message: "sourceLayerId and targetSceneIds[] are required" });
      }

      const sourceLayer = await storage.getEditableLayer(sourceLayerId);
      if (!sourceLayer) {
        return res.status(404).json({ message: "Source layer not found" });
      }

      const sourceFeatures = await storage.getDrawnFeatures(sourceLayerId);
      const sourceSchema = await storage.getLayerSchema(sourceLayerId);

      const created: any[] = [];
      for (const sceneId of targetSceneIds) {
        const newLayer = await storage.createEditableLayer({
          sceneId,
          name: sourceLayer.name,
          geometryType: sourceLayer.geometryType,
          color: palette?.color ?? sourceLayer.color,
          pointStyle: palette?.pointStyle ?? sourceLayer.pointStyle,
          lineStyle: palette?.lineStyle ?? sourceLayer.lineStyle,
          visible: true,
          opacity: palette?.opacity ?? sourceLayer.opacity,
          source: sourceLayer.source,
          sourceFileName: sourceLayer.sourceFileName,
          sourceFiles: sourceLayer.sourceFiles,
          crs: sourceLayer.crs,
          styleConfig: palette?.styleConfig ?? sourceLayer.styleConfig,
          metadata: sourceLayer.metadata as any,
        });

        if (sourceSchema) {
          await storage.createLayerSchema({
            layerId: newLayer.id,
            fields: sourceSchema.fields as any,
          });
        }

        if (sourceFeatures.length > 0) {
          const batchSize = 500;
          for (let i = 0; i < sourceFeatures.length; i += batchSize) {
            const batch = sourceFeatures.slice(i, i + batchSize).map(f => ({
              layerId: newLayer.id,
              geometryType: f.geometryType as any,
              coordinates: f.coordinates,
              properties: f.properties,
            }));
            await storage.createDrawnFeaturesBatch(batch);
          }
        }

        created.push({
          layerId: newLayer.id,
          sceneId,
          name: newLayer.name,
          featureCount: sourceFeatures.length,
        });
      }

      return res.json({ success: true, created });
    } catch (error) {
      console.error("Error cloning layer to scenes:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/admin/remove-layer-from-scene", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { layerId } = req.body;
      if (!layerId) {
        return res.status(400).json({ message: "layerId is required" });
      }

      const layer = await storage.getEditableLayer(layerId);
      if (!layer) {
        return res.status(404).json({ message: "Layer not found" });
      }

      await storage.deleteEditableLayer(layerId);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error removing layer from scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/apply-palette", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { layerIds, palette } = req.body;
      if (!layerIds || !Array.isArray(layerIds) || layerIds.length === 0) {
        return res.status(400).json({ message: "layerIds[] is required" });
      }
      if (!palette || typeof palette !== "object") {
        return res.status(400).json({ message: "palette object is required" });
      }

      const updated: any[] = [];
      for (const id of layerIds) {
        const updates: Partial<any> = {};
        if (palette.color !== undefined) updates.color = palette.color;
        if (palette.pointStyle !== undefined) updates.pointStyle = palette.pointStyle;
        if (palette.lineStyle !== undefined) updates.lineStyle = palette.lineStyle;
        if (palette.opacity !== undefined) updates.opacity = palette.opacity;
        if (palette.styleConfig !== undefined) updates.styleConfig = palette.styleConfig;

        const layer = await storage.updateEditableLayer(id, updates);
        if (layer) {
          updated.push({ layerId: layer.id, sceneId: layer.sceneId });
        }
      }

      return res.json({ success: true, updated });
    } catch (error) {
      console.error("Error applying palette:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Admin layer groups CRUD
  app.get("/api/admin/layer-groups", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const groups = await storage.getAdminLayerGroups();
      return res.json(groups);
    } catch (error) {
      console.error("Error fetching admin layer groups:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/layer-groups", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { name, displayOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name is required" });
      }
      const group = await storage.createAdminLayerGroup({ name: name.trim(), displayOrder: displayOrder ?? 0 });
      return res.status(201).json(group);
    } catch (error) {
      console.error("Error creating admin layer group:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/admin/layer-groups/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const { name, displayOrder } = req.body;
      const updates: Partial<{ name: string; displayOrder: number }> = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (displayOrder !== undefined) updates.displayOrder = Number(displayOrder);
      const group = await storage.updateAdminLayerGroup(id, updates);
      if (!group) return res.status(404).json({ message: "Group not found" });
      return res.json(group);
    } catch (error) {
      console.error("Error updating admin layer group:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/admin/layer-groups/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteAdminLayerGroup(id);
      if (!deleted) return res.status(404).json({ message: "Group not found" });
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting admin layer group:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/assign-layer-group", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layerName, geometryType, adminGroupId } = req.body;
      if (!layerName || !geometryType) {
        return res.status(400).json({ message: "layerName and geometryType are required" });
      }
      await storage.setLayerAdminGroup(layerName, geometryType, adminGroupId ?? null);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error assigning layer group:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Rename layer globally (all instances)
  app.post("/api/admin/rename-layer", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { oldName, geometryType, newName } = req.body;
      if (!oldName || !geometryType || !newName || !newName.trim()) {
        return res.status(400).json({ message: "oldName, geometryType and newName are required" });
      }
      await storage.renameLayerGlobal(oldName, geometryType, newName.trim());
      return res.json({ success: true });
    } catch (error) {
      console.error("Error renaming layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update layer metadata globally (all instances)
  app.post("/api/admin/layer-metadata", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { layerName, geometryType, metadata } = req.body;
      if (!layerName || !geometryType || !metadata || typeof metadata !== "object") {
        return res.status(400).json({ message: "layerName, geometryType and metadata are required" });
      }
      await storage.updateLayerMetadataGlobal(layerName, geometryType, metadata);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error updating layer metadata:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/geocode/search", isAuthenticated as any, async (req: AuthRequest, res: Response) => {
    try {
      const query = (req.query.q as string || "").trim();
      if (!query) {
        return res.status(400).json({ message: "Query parameter 'q' is required" });
      }

      const providerSetting = await storage.getAppSetting("geocode_provider");
      const provider: GeocodeProvider = providerSetting === "dadata" ? "dadata" : "yandex";

      let apiKey: string | undefined;
      if (provider === "dadata") {
        apiKey = (await storage.getAppSetting("geocode_dadata_api_key")) || process.env.DADATA_API_KEY;
      } else {
        apiKey = (await storage.getAppSetting("geocode_yandex_api_key")) || process.env.YANDEX_GEOCODER_API_KEY;
      }

      if (apiKey) {
        try {
          const results = await geocodeBatch(
            [{ index: 0, address: query }],
            apiKey,
            undefined,
            provider
          );
          if (results.length > 0 && results[0].result) {
            const r = results[0].result;
            return res.json({
              found: true,
              lat: r.lat,
              lon: r.lon,
              address: r.formattedAddress,
              provider,
            });
          }
        } catch (geoErr) {
          console.warn(`Configured geocoder (${provider}) failed, trying fallback:`, (geoErr as Error).message);
        }
      }

      const fallbackProvider: GeocodeProvider = provider === "dadata" ? "yandex" : "dadata";
      let fallbackKey: string | undefined;
      if (fallbackProvider === "yandex") {
        fallbackKey = (await storage.getAppSetting("geocode_yandex_api_key")) || process.env.YANDEX_GEOCODER_API_KEY;
      } else {
        fallbackKey = (await storage.getAppSetting("geocode_dadata_api_key")) || process.env.DADATA_API_KEY;
      }

      if (fallbackKey) {
        try {
          const fallbackResults = await geocodeBatch(
            [{ index: 0, address: query }],
            fallbackKey,
            undefined,
            fallbackProvider
          );
          if (fallbackResults.length > 0 && fallbackResults[0].result) {
            const r = fallbackResults[0].result;
            return res.json({
              found: true,
              lat: r.lat,
              lon: r.lon,
              address: r.formattedAddress,
              provider: fallbackProvider,
            });
          }
        } catch (fallbackErr) {
          console.warn(`Fallback geocoder (${fallbackProvider}) also failed:`, (fallbackErr as Error).message);
        }
      }

      if (!apiKey && !fallbackKey) {
        return res.json({ found: false, message: "Геокодер не настроен. Укажите API-ключ Яндекс или DaData в настройках." });
      }

      return res.json({ found: false });
    } catch (error) {
      console.error("Error in geocode search:", error);
      return res.status(500).json({ message: "Geocoding error" });
    }
  });

  app.post("/api/bug-reports", isAuthenticated as any, screenshotUpload.single("screenshot"), async (req: AuthRequest, res: Response) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Сообщение обязательно" });
      }

      const userId = req.user!.id;
      const username = req.user!.username;
      const screenshotPath = req.file ? req.file.filename : null;

      const report = await storage.createBugReport({
        userId,
        username,
        message: message.trim(),
        screenshotPath,
        status: "new",
      });

      res.status(201).json(report);
    } catch (error: any) {
      console.error("Error creating bug report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bug-reports", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const reports = await storage.getBugReports();
      res.json(reports);
    } catch (error: any) {
      console.error("Error fetching bug reports:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/bug-reports/:id/status", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const { status } = req.body;
      if (!status || !(bugReportStatusEnum as readonly string[]).includes(status)) {
        return res.status(400).json({ message: "Недопустимый статус" });
      }
      const updated = await storage.updateBugReportStatus(id, status);
      if (!updated) {
        return res.status(404).json({ message: "Отчёт не найден" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating bug report status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bug-reports/:id/screenshot", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const report = await storage.getBugReport(id);
      if (!report || !report.screenshotPath) {
        return res.status(404).json({ message: "Скриншот не найден" });
      }
      const filePath = path.join(screenshotUploadDir, report.screenshotPath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Файл не найден" });
      }
      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Error serving screenshot:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Sensor Integration Routes ─────────────────────────────────────────────

  app.get("/api/admin/sensor-integration/config", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const config = await storage.getSensorIntegrationConfig();
      res.json(config || null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/sensor-integration/config", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { apiUrl, apiToken, pollingIntervalMinutes, isEnabled, isDebugMode } = req.body;
      const data: Record<string, unknown> = {};
      if (apiUrl !== undefined) data.apiUrl = apiUrl;
      if (apiToken !== undefined) data.apiToken = apiToken;
      if (pollingIntervalMinutes !== undefined) data.pollingIntervalMinutes = Number(pollingIntervalMinutes);
      if (isEnabled !== undefined) data.isEnabled = isEnabled ? 1 : 0;
      if (isDebugMode !== undefined) data.isDebugMode = isDebugMode ? 1 : 0;
      const config = await storage.upsertSensorIntegrationConfig(data as any);
      if (isDebugMode !== undefined) {
        setDebugMode(!!isDebugMode);
      }
      if (isEnabled !== undefined) {
        if (isEnabled) {
          restartSensorPolling();
        } else {
          stopSensorPolling();
        }
      }
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/sensor-integration/test", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { apiUrl, apiToken } = req.body;
      if (!apiUrl || !apiToken) {
        return res.status(400).json({ message: "apiUrl и apiToken обязательны" });
      }
      const result = await testSensorConnection(apiUrl, apiToken);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/sensor-integration/sync", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const result = await syncSensors();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ synced: 0, error: err.message });
    }
  });

  app.get("/api/admin/sensor-integration/bindings", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const bindings = await storage.getSensorObjectBindings();
      res.json(bindings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/sensor-integration/bindings", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const { idCdsKoteln, objectType, layerId, objectName } = req.body;
      if (!idCdsKoteln || !objectType || !layerId) {
        return res.status(400).json({ message: "idCdsKoteln, objectType и layerId обязательны" });
      }
      const binding = await storage.createSensorObjectBinding({
        idCdsKoteln: Number(idCdsKoteln),
        objectType,
        layerId: Number(layerId),
        objectName: objectName || "",
      });
      res.json(binding);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/sensor-integration/bindings/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const { idCdsKoteln, objectType, layerId, objectName } = req.body;
      const data: Record<string, unknown> = {};
      if (idCdsKoteln !== undefined) data.idCdsKoteln = Number(idCdsKoteln);
      if (objectType !== undefined) data.objectType = objectType;
      if (layerId !== undefined) data.layerId = Number(layerId);
      if (objectName !== undefined) data.objectName = objectName;
      const binding = await storage.updateSensorObjectBinding(id, data as any);
      if (!binding) return res.status(404).json({ message: "Привязка не найдена" });
      res.json(binding);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/sensor-integration/bindings/:id", isAuthenticated, isAdmin as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteSensorObjectBinding(id);
      if (!deleted) return res.status(404).json({ message: "Привязка не найдена" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sensor-readings", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const { id_cds_koteln } = req.query;
      if (id_cds_koteln) {
        const reading = await storage.getSensorReadingByKotelnId(Number(id_cds_koteln));
        res.json(reading || null);
      } else {
        const readings = await storage.getSensorReadingsCache();
        res.json(readings);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sensor-bindings", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const bindings = await storage.getSensorObjectBindings();
      res.json(bindings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Cost Unit Rates (справочник удельников) ────────────────────────────────

  app.get("/api/unit-rates", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const { object_type, work_type, laying_type } = req.query as Record<string, string>;
      const rates = await storage.getCostUnitRates({
        objectType: object_type,
        workType: work_type,
        layingType: laying_type,
      });
      res.json(rates);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/unit-rates", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const data = req.body;
      if (!data.objectType || !data.workType || !data.pricePerUnit || !data.unit) {
        return res.status(400).json({ message: "Обязательные поля: objectType, workType, pricePerUnit, unit" });
      }
      const rate = await storage.createCostUnitRate(data);
      res.status(201).json(rate);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/unit-rates/:id", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const updated = await storage.updateCostUnitRate(id, req.body);
      if (!updated) return res.status(404).json({ message: "Удельник не найден" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/unit-rates/:id", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteCostUnitRate(id);
      if (!deleted) return res.status(404).json({ message: "Удельник не найден" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Zulu Field Labels (справочник атрибутов SHP) ────────────────────────────

  app.get("/api/field-labels", isAuthenticated, async (_req: AuthRequest, res: Response) => {
    try {
      const labels = await storage.getZuluFieldLabels();
      res.json(labels);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field-labels", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const { fieldName, label, category } = req.body;
      if (!fieldName || !label) {
        return res.status(400).json({ message: "Поля fieldName и label обязательны" });
      }
      const existing = await storage.getZuluFieldLabelByName(fieldName);
      if (existing) {
        return res.status(409).json({ message: "Запись с таким именем поля уже существует" });
      }
      const created = await storage.createZuluFieldLabel({ fieldName, label, category: category ?? null });
      refreshFieldLabelsCache().catch(() => {});
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/field-labels/:id", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const { label, category } = req.body;
      if (!label) {
        return res.status(400).json({ message: "Поле label обязательно" });
      }
      const updated = await storage.updateZuluFieldLabel(id, { label, category: category ?? null });
      if (!updated) return res.status(404).json({ message: "Запись не найдена" });
      refreshFieldLabelsCache().catch(() => {});
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/field-labels/:id", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteZuluFieldLabel(id);
      if (!deleted) return res.status(404).json({ message: "Запись не найдена" });
      refreshFieldLabelsCache().catch(() => {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Zulu Field Values (расшифровка кодовых значений атрибутов) ───────────────

  app.get("/api/field-values", isAuthenticated, async (_req: AuthRequest, res: Response) => {
    try {
      const values = await storage.getZuluFieldValues();
      res.json(values);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field-values", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const { fieldName, fieldValue, label, networkType, category } = req.body;
      if (!fieldName || fieldValue === undefined || fieldValue === null || !label) {
        return res.status(400).json({ message: "Поля fieldName, fieldValue и label обязательны" });
      }
      const created = await storage.createZuluFieldValue({
        fieldName,
        fieldValue: String(fieldValue),
        label,
        networkType: networkType ?? null,
        category: category ?? null,
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/field-values/:id", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const { label, networkType, category } = req.body;
      if (!label) {
        return res.status(400).json({ message: "Поле label обязательно" });
      }
      const updated = await storage.updateZuluFieldValue(id, {
        label,
        networkType: networkType ?? null,
        category: category ?? null,
      });
      if (!updated) return res.status(404).json({ message: "Запись не найдена" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/field-values/:id", isAuthenticated, isAdmin, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteZuluFieldValue(id);
      if (!deleted) return res.status(404).json({ message: "Запись не найдена" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Reconstruction Programs ─────────────────────────────────────────────────

  app.get("/api/reconstruction-programs", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const sceneId = parseIntParam(req.query.sceneId as string, res);
      if (sceneId === null) return;
      const programs = await storage.getReconstructionPrograms(sceneId);
      res.json(programs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/reconstruction-programs", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const { sceneId, name, periodFrom, periodTo, baseYear, inflationRate } = req.body;
      if (!sceneId || !name || !periodFrom || !periodTo) {
        return res.status(400).json({ message: "Обязательные поля: sceneId, name, periodFrom, periodTo" });
      }
      const program = await storage.createReconstructionProgram({
        sceneId,
        name,
        periodFrom,
        periodTo,
        baseYear: baseYear ?? 2025,
        inflationRate: inflationRate ?? "5.00",
        status: "draft",
        createdBy: req.user!.id,
      });
      res.status(201).json(program);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reconstruction-programs/:id", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const program = await storage.getReconstructionProgram(id);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });
      const objects = await storage.getProgramObjects(id);
      res.json({ ...program, objects });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/reconstruction-programs/:id", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const updated = await storage.updateReconstructionProgram(id, req.body);
      if (!updated) return res.status(404).json({ message: "Программа не найдена" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/reconstruction-programs/:id", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;
      const deleted = await storage.deleteReconstructionProgram(id);
      if (!deleted) return res.status(404).json({ message: "Программа не найдена" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Program Objects ─────────────────────────────────────────────────────────

  app.post("/api/reconstruction-programs/:id/objects", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const programId = parseIntParam(req.params.id, res);
      if (programId === null) return;

      const program = await storage.getReconstructionProgram(programId);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });

      const { objectType, objectName, diameterMm, lengthM, capacityMw, layingType, workType, accidentCount, accidentsPerM, residentCount, geometry, featureId } = req.body;

      // Автоподбор удельника
      const unitRate = await storage.findBestUnitRate(
        objectType,
        workType || 'overhaul',
        layingType,
        diameterMm,
        program.baseYear
      );

      // Расчёт базовой стоимости
      let baseCost: string | null = null;
      let unitRateValue: string | null = null;
      if (unitRate) {
        unitRateValue = unitRate.pricePerUnit;
        const price = parseFloat(unitRate.pricePerUnit);
        if (objectType === 'pipe' && lengthM) {
          baseCost = (price * parseFloat(lengthM)).toFixed(2);
        } else if ((objectType === 'ctp' || objectType === 'source') && capacityMw) {
          baseCost = (price * parseFloat(capacityMw)).toFixed(2);
        }
      }

      const existingObjects = await storage.getProgramObjects(programId);
      const sortOrder = existingObjects.length;

      const obj = await storage.createProgramObject({
        programId,
        featureId: featureId ?? null,
        objectType,
        objectName,
        diameterMm: diameterMm ?? null,
        lengthM: lengthM ? String(lengthM) : null,
        capacityMw: capacityMw ? String(capacityMw) : null,
        layingType: layingType ?? null,
        workType: workType || 'overhaul',
        unitRateId: unitRate?.id ?? null,
        unitRateValue,
        baseCost,
        plannedYear: null,
        indexedCost: null,
        accidentCount: accidentCount ?? null,
        accidentsPerM: accidentsPerM ? String(accidentsPerM) : null,
        residentCount: residentCount ?? null,
        geometry: geometry ?? null,
        sortOrder,
      });

      res.status(201).json({ ...obj, unitRate: unitRate || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/reconstruction-programs/:id/objects/batch", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const programId = parseIntParam(req.params.id, res);
      if (programId === null) return;

      const program = await storage.getReconstructionProgram(programId);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });

      const items: any[] = req.body.objects;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Массив objects обязателен" });
      }

      const existingObjects = await storage.getProgramObjects(programId);
      let sortOrder = existingObjects.length;

      const created: any[] = [];
      for (const item of items) {
        const { objectType = "pipe", objectName, diameterMm, lengthM, capacityMw, layingType, workType, accidentCount, residentCount, consumerCount, featureId } = item;

        const unitRate = await storage.findBestUnitRate(
          objectType,
          workType || "overhaul",
          layingType,
          diameterMm,
          program.baseYear
        );

        let baseCost: string | null = null;
        let unitRateValue: string | null = null;
        if (unitRate) {
          unitRateValue = unitRate.pricePerUnit;
          const price = parseFloat(unitRate.pricePerUnit);
          if (objectType === "pipe" && lengthM) {
            baseCost = (price * parseFloat(String(lengthM))).toFixed(2);
          } else if ((objectType === "ctp" || objectType === "source") && capacityMw) {
            baseCost = (price * parseFloat(String(capacityMw))).toFixed(2);
          }
        }

        const accsPerM = (accidentCount && lengthM && parseFloat(String(lengthM)) > 0)
          ? (accidentCount / parseFloat(String(lengthM))).toFixed(4)
          : null;

        const obj = await storage.createProgramObject({
          programId,
          featureId: featureId ?? null,
          objectType,
          objectName: objectName || `Участок #${featureId ?? sortOrder}`,
          diameterMm: diameterMm ?? null,
          lengthM: lengthM ? String(lengthM) : null,
          capacityMw: capacityMw ? String(capacityMw) : null,
          layingType: layingType ?? "underground",
          workType: workType || "overhaul",
          unitRateId: unitRate?.id ?? null,
          unitRateValue,
          baseCost,
          plannedYear: null,
          indexedCost: null,
          accidentCount: accidentCount ?? null,
          accidentsPerM: accsPerM,
          residentCount: residentCount ?? null,
          consumerCount: consumerCount ?? null,
          geometry: null,
          sortOrder: sortOrder++,
        });
        created.push(obj);
      }

      res.status(201).json({ count: created.length, objects: created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/reconstruction-programs/:id/objects/:oid", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const programId = parseIntParam(req.params.id, res);
      const oid = parseIntParam(req.params.oid, res);
      if (programId === null || oid === null) return;

      const program = await storage.getReconstructionProgram(programId);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });

      const obj = await storage.getProgramObject(oid);
      if (!obj) return res.status(404).json({ message: "Объект не найден" });

      const updates = { ...req.body };

      // Если изменился тип работ или прокладка — пересчитываем удельник
      const needsRecalc = updates.workType || updates.layingType;
      if (needsRecalc) {
        const newWorkType = updates.workType || obj.workType;
        const newLayingType = updates.layingType !== undefined ? updates.layingType : obj.layingType;
        const unitRate = await storage.findBestUnitRate(
          obj.objectType,
          newWorkType,
          newLayingType ?? undefined,
          obj.diameterMm ?? undefined,
          program.baseYear
        );
        if (unitRate) {
          updates.unitRateId = unitRate.id;
          updates.unitRateValue = unitRate.pricePerUnit;
          const price = parseFloat(unitRate.pricePerUnit);
          if (obj.objectType === 'pipe' && obj.lengthM) {
            updates.baseCost = (price * parseFloat(obj.lengthM)).toFixed(2);
          } else if ((obj.objectType === 'ctp' || obj.objectType === 'source') && obj.capacityMw) {
            updates.baseCost = (price * parseFloat(obj.capacityMw)).toFixed(2);
          }
        }
      }

      // Пересчёт индексированной стоимости если задан год
      if (updates.plannedYear !== undefined && updates.plannedYear !== null) {
        const baseCostVal = updates.baseCost ? parseFloat(updates.baseCost) : (obj.baseCost ? parseFloat(obj.baseCost) : 0);
        const inflationRate = parseFloat(program.inflationRate);
        const yearsAhead = updates.plannedYear - program.baseYear;
        if (yearsAhead > 0) {
          updates.indexedCost = (baseCostVal * Math.pow(1 + inflationRate / 100, yearsAhead)).toFixed(2);
        } else {
          updates.indexedCost = baseCostVal.toFixed(2);
        }
      } else if (updates.plannedYear === null) {
        updates.indexedCost = null;
      }

      const updated = await storage.updateProgramObject(oid, updates);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/reconstruction-programs/:id/objects/:oid", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const oid = parseIntParam(req.params.oid, res);
      if (oid === null) return;
      const deleted = await storage.deleteProgramObject(oid);
      if (!deleted) return res.status(404).json({ message: "Объект не найден" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Пересчёт стоимости всей программы
  app.post("/api/reconstruction-programs/:id/calculate", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;

      const program = await storage.getReconstructionProgram(id);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });

      const objects = await storage.getProgramObjects(id);
      const inflationRate = parseFloat(program.inflationRate);
      let totalBase = 0;
      let totalIndexed = 0;

      const updatedObjects = await Promise.all(objects.map(async obj => {
        // Переподбор удельника (на случай если он изменился)
        const unitRate = await storage.findBestUnitRate(
          obj.objectType,
          obj.workType,
          obj.layingType ?? undefined,
          obj.diameterMm ?? undefined,
          program.baseYear
        );

        let baseCost = obj.baseCost ? parseFloat(obj.baseCost) : 0;
        let unitRateValue = obj.unitRateValue;
        let unitRateId = obj.unitRateId;

        if (unitRate) {
          unitRateId = unitRate.id;
          unitRateValue = unitRate.pricePerUnit;
          const price = parseFloat(unitRate.pricePerUnit);
          if (obj.objectType === 'pipe' && obj.lengthM) {
            baseCost = price * parseFloat(obj.lengthM);
          } else if ((obj.objectType === 'ctp' || obj.objectType === 'source') && obj.capacityMw) {
            baseCost = price * parseFloat(obj.capacityMw);
          }
        }

        let indexedCost: string | null = null;
        if (obj.plannedYear != null) {
          const yearsAhead = obj.plannedYear - program.baseYear;
          indexedCost = yearsAhead > 0
            ? (baseCost * Math.pow(1 + inflationRate / 100, yearsAhead)).toFixed(2)
            : baseCost.toFixed(2);
        }

        totalBase += baseCost;
        totalIndexed += indexedCost ? parseFloat(indexedCost) : baseCost;

        return storage.updateProgramObject(obj.id, {
          unitRateId,
          unitRateValue,
          baseCost: baseCost.toFixed(2),
          indexedCost,
        });
      }));

      await storage.updateReconstructionProgram(id, {
        totalBaseCost: totalBase.toFixed(2),
        totalIndexedCost: totalIndexed.toFixed(2),
      });

      const refreshed = await storage.getReconstructionProgram(id);
      res.json({ program: refreshed, objects: updatedObjects });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Детерминированное распределение объектов по годам на основе скоринга критичности
  app.post("/api/reconstruction-programs/:id/schedule", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;

      const program = await storage.getReconstructionProgram(id);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });

      const objects = await storage.getProgramObjects(id);
      const { annualBudget } = req.body;

      const years = Array.from({ length: program.periodTo - program.periodFrom + 1 }, (_, i) => program.periodFrom + i);

      // --- Скоринг критичности ---
      // Факторы (веса из аналитического отчёта):
      //   F1 accidentsPerM  — 35% (удельная аварийность, главный показатель износа)
      //   F2 residentCount  — 25% (жители под отключением, социальный риск)
      //   F3 consumerCount  — 20% (потребители-объекты: больницы, школы и т.д.)
      //   F4 accidentCount  — 15% (абсолютная аварийность)
      //   F5 diameterMm     — 5%  (важность в сети: магистраль vs разводящий)
      const W1 = 0.35, W2 = 0.25, W3 = 0.20, W4 = 0.15, W5 = 0.05;

      // Вычисляем accidentsPerM на лету если в БД NULL — из accidentCount / lengthM
      const getAccPerM = (o: typeof objects[0]) => {
        if (o.accidentsPerM) return parseFloat(o.accidentsPerM);
        if (o.accidentCount && o.lengthM && parseFloat(o.lengthM) > 0) {
          return o.accidentCount / parseFloat(o.lengthM);
        }
        return 0;
      };

      const maxAccPerM   = Math.max(...objects.map(getAccPerM), 0);
      const maxResidents = Math.max(...objects.map(o => o.residentCount ?? 0), 0);
      const maxConsumers = Math.max(...objects.map(o => o.consumerCount ?? 0), 0);
      const maxAccidents = Math.max(...objects.map(o => o.accidentCount ?? 0), 0);
      const maxDiameter  = Math.max(...objects.map(o => o.diameterMm ?? 0), 0);

      const norm = (val: number, max: number) => max > 0 ? val / max : 0;

      const scored = objects.map(o => {
        const f1 = norm(getAccPerM(o), maxAccPerM);
        const f2 = norm(o.residentCount ?? 0, maxResidents);
        const f3 = norm(o.consumerCount ?? 0, maxConsumers);
        const f4 = norm(o.accidentCount ?? 0, maxAccidents);
        const f5 = norm(o.diameterMm ?? 0, maxDiameter);
        const score = W1 * f1 + W2 * f2 + W3 * f3 + W4 * f4 + W5 * f5;
        return { obj: o, score };
      });

      // Сортировка по убыванию скоринга (самые критичные — первые)
      scored.sort((a, b) => b.score - a.score);

      // --- Планирование по годам ---
      const schedule: Array<{ objectId: number; year: number }> = [];

      if (annualBudget && annualBudget > 0) {
        // Бюджетное распределение: заполняем каждый год до лимита
        let yearIdx = 0;
        let budgetUsed = 0;
        for (const { obj } of scored) {
          if (yearIdx >= years.length) yearIdx = years.length - 1;
          const cost = obj.baseCost ? parseFloat(obj.baseCost) : 0;
          if (cost > 0 && budgetUsed + cost > annualBudget) {
            if (yearIdx < years.length - 1) {
              yearIdx++;
              budgetUsed = 0;
            } else {
              // Последний год заполнен — остальные объекты не планируются
              break;
            }
          }
          schedule.push({ objectId: obj.id, year: years[yearIdx] });
          budgetUsed += cost;
        }
      } else {
        // Равномерное распределение: делим объекты поровну по годам
        const perYear = Math.ceil(scored.length / years.length);
        scored.forEach(({ obj }, i) => {
          const yearIdx = Math.min(Math.floor(i / perYear), years.length - 1);
          schedule.push({ objectId: obj.id, year: years[yearIdx] });
        });
      }

      // Сохраняем распределение: плановый год + индексированная стоимость + скоринговый балл + sortOrder
      const scheduledIds = new Set(schedule.map(s => s.objectId));
      const inflationRate = parseFloat(program.inflationRate);

      await Promise.all(scored.map(({ obj, score }, rank) => {
        const criticalityScore = (score * 10).toFixed(2);
        const sortOrderVal = rank; // ранг по убыванию критичности

        if (scheduledIds.has(obj.id)) {
          const item = schedule.find(s => s.objectId === obj.id)!;
          const baseCost = obj.baseCost ? parseFloat(obj.baseCost) : 0;
          const yearsAhead = item.year - program.baseYear;
          const indexedCost = yearsAhead > 0
            ? (baseCost * Math.pow(1 + inflationRate / 100, yearsAhead)).toFixed(2)
            : baseCost.toFixed(2);
          return storage.updateProgramObject(obj.id, {
            plannedYear: item.year,
            indexedCost,
            criticalityScore,
            sortOrder: sortOrderVal,
          });
        } else {
          // Объект не вошёл в бюджет — сбрасываем год планирования, сохраняем балл и ранг
          return storage.updateProgramObject(obj.id, {
            plannedYear: null,
            indexedCost: null,
            criticalityScore,
            sortOrder: sortOrderVal,
          });
        }
      }));

      const updatedObjects = await storage.getProgramObjects(id);
      const usedBudget = annualBudget && annualBudget > 0;

      // Предупреждение о неполных данных скоринга
      const missingResidents = maxResidents === 0;
      const missingConsumers = maxConsumers === 0;
      const dataWarning = (missingResidents || missingConsumers)
        ? ` ⚠ Данные неполные: ${[missingResidents && "жители (25%)", missingConsumers && "потребители (20%)"].filter(Boolean).join(", ")} отсутствуют — запустите симуляцию отключений для полного скоринга.`
        : "";

      const comment = usedBudget
        ? `Распределение по скорингу критичности с годовым лимитом ${Number(annualBudget).toLocaleString("ru-RU")} ₽. Факторы: удельная аварийность (35%), жители (25%), потребители (20%), аварии (15%), диаметр (5%).${dataWarning}`
        : `Равномерное распределение по скорингу критичности. Факторы: удельная аварийность (35%), жители (25%), потребители (20%), аварии (15%), диаметр (5%).${dataWarning}`;

      res.json({ objects: updatedObjects, comment });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Экспорт программы в Excel
  app.post("/api/reconstruction-programs/:id/export", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseIntParam(req.params.id, res);
      if (id === null) return;

      const program = await storage.getReconstructionProgram(id);
      if (!program) return res.status(404).json({ message: "Программа не найдена" });

      const objects = await storage.getProgramObjects(id);
      const unitRates = await storage.getCostUnitRates();

      const workbook = new ExcelJS.Workbook();
      const fmt = (n: string | null | undefined) => n ? parseFloat(n) : 0;
      const fmtM = (n: string | null | undefined) => n ? (parseFloat(n) / 1_000_000).toFixed(2) + ' млн' : '—';

      // Лист 1 — Титул
      const titleSheet = workbook.addWorksheet("Титул");
      titleSheet.mergeCells("A1:D1");
      titleSheet.getCell("A1").value = program.name;
      titleSheet.getCell("A1").font = { bold: true, size: 16 };
      titleSheet.getCell("A1").alignment = { horizontal: "center" };
      titleSheet.addRow([]);
      titleSheet.addRow(["Период реализации:", `${program.periodFrom}–${program.periodTo}`]);
      titleSheet.addRow(["Год базовых цен:", program.baseYear]);
      titleSheet.addRow(["Индексация цен:", `${program.inflationRate}% в год`]);
      titleSheet.addRow(["Статус:", program.status === "approved" ? "Утверждена" : "Черновик"]);
      titleSheet.addRow([]);
      titleSheet.addRow(["Итого (базовые цены):", fmtM(program.totalBaseCost)]);
      titleSheet.addRow(["Итого (с индексацией):", fmtM(program.totalIndexedCost)]);
      titleSheet.addRow([]);
      titleSheet.addRow(["Дата формирования:", new Date().toLocaleDateString("ru-RU")]);
      titleSheet.columns = [{ width: 30 }, { width: 25 }, { width: 20 }, { width: 20 }];

      // Лист 2 — Перечень объектов
      const objSheet = workbook.addWorksheet("Перечень объектов");
      objSheet.columns = [
        { header: "Наименование", key: "name", width: 25 },
        { header: "Тип", key: "type", width: 12 },
        { header: "Д/МВт", key: "spec", width: 10 },
        { header: "L, м", key: "length", width: 10 },
        { header: "Прокладка", key: "laying", width: 14 },
        { header: "Тип работ", key: "workType", width: 16 },
        { header: "Удельник", key: "unitRate", width: 16 },
        { header: "Стоим. баз., руб.", key: "baseCost", width: 18 },
        { header: "Год", key: "year", width: 8 },
        { header: "Стоим. инд., руб.", key: "indexedCost", width: 18 },
      ];
      objSheet.getRow(1).font = { bold: true };

      const typeLabels: Record<string, string> = { pipe: "Трубопровод", ctp: "ЦТП/ИТП", source: "Источник" };
      const workTypeLabels: Record<string, string> = { overhaul: "Кап. ремонт", reconstruction: "Реконструкция" };
      const layingLabels: Record<string, string> = { underground: "Подземная", above: "Надземная" };

      objects.forEach(obj => {
        const spec = obj.objectType === 'pipe'
          ? (obj.diameterMm ? `${obj.diameterMm} мм` : '—')
          : (obj.capacityMw ? `${obj.capacityMw} МВт` : '—');
        const unitRateLabel = obj.unitRateValue
          ? (obj.objectType === 'pipe' ? `${Number(obj.unitRateValue).toLocaleString("ru-RU")} ₽/м` : `${(Number(obj.unitRateValue) / 1_000_000).toFixed(1)} М₽/МВт`)
          : '—';
        objSheet.addRow({
          name: obj.objectName,
          type: typeLabels[obj.objectType] ?? obj.objectType,
          spec,
          length: obj.lengthM ? parseFloat(obj.lengthM) : null,
          laying: obj.layingType ? (layingLabels[obj.layingType] ?? obj.layingType) : '—',
          workType: workTypeLabels[obj.workType] ?? obj.workType,
          unitRate: unitRateLabel,
          baseCost: obj.baseCost ? parseFloat(obj.baseCost) : null,
          year: obj.plannedYear ?? '—',
          indexedCost: obj.indexedCost ? parseFloat(obj.indexedCost) : null,
        });
      });

      // Итого
      const totalRow = objSheet.addRow({
        name: "ИТОГО",
        baseCost: objects.reduce((s, o) => s + fmt(o.baseCost), 0),
        indexedCost: objects.reduce((s, o) => s + fmt(o.indexedCost || o.baseCost), 0),
      });
      totalRow.font = { bold: true };

      // Лист 3 — Финансовый план
      const finSheet = workbook.addWorksheet("Финансовый план");
      const years = Array.from({ length: program.periodTo - program.periodFrom + 1 }, (_, i) => program.periodFrom + i);
      const finCols: any[] = [{ header: "Объект", key: "name", width: 25 }];
      years.forEach(y => finCols.push({ header: String(y), key: `y${y}`, width: 14 }));
      finCols.push({ header: "ИТОГО", key: "total", width: 14 });
      finSheet.columns = finCols;
      finSheet.getRow(1).font = { bold: true };

      objects.forEach(obj => {
        const row: Record<string, any> = { name: obj.objectName };
        years.forEach(y => {
          row[`y${y}`] = obj.plannedYear === y ? (obj.indexedCost ? parseFloat(obj.indexedCost) : null) : null;
        });
        row.total = obj.indexedCost ? parseFloat(obj.indexedCost) : (obj.baseCost ? parseFloat(obj.baseCost) : null);
        finSheet.addRow(row);
      });

      // Строка итогов по годам
      const totalsRow: Record<string, any> = { name: "Итого по годам" };
      let grandTotal = 0;
      years.forEach(y => {
        const sum = objects.filter(o => o.plannedYear === y).reduce((s, o) => s + fmt(o.indexedCost || o.baseCost), 0);
        totalsRow[`y${y}`] = sum || null;
        grandTotal += sum;
      });
      totalsRow.total = grandTotal;
      const totalFinRow = finSheet.addRow(totalsRow);
      totalFinRow.font = { bold: true };

      // Лист 4 — Справочник удельников
      const ratesSheet = workbook.addWorksheet("Справочник удельников");
      ratesSheet.columns = [
        { header: "Тип объекта", key: "type", width: 16 },
        { header: "Прокладка", key: "laying", width: 14 },
        { header: "Диаметр, мм", key: "diameter", width: 14 },
        { header: "Тип работ", key: "workType", width: 16 },
        { header: "Стоимость", key: "price", width: 18 },
        { header: "Единица", key: "unit", width: 14 },
        { header: "Год цен", key: "year", width: 10 },
      ];
      ratesSheet.getRow(1).font = { bold: true };
      unitRates.forEach(r => {
        ratesSheet.addRow({
          type: typeLabels[r.objectType] ?? r.objectType,
          laying: r.layingType ? (layingLabels[r.layingType] ?? r.layingType) : '—',
          diameter: r.diameterMm ?? '—',
          workType: workTypeLabels[r.workType] ?? r.workType,
          price: parseFloat(r.pricePerUnit),
          unit: r.unit === 'rub_per_m' ? 'руб./м' : 'руб./МВт',
          year: r.baseYear,
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const safeName = program.name.replace(/[^а-яёА-ЯЁa-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.xlsx`);
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

function translateNodeType(type: string): string {
  const map: Record<string, string> = {
    source: "Источник",
    ctp: "ЦТП",
    consumer: "Потребитель",
    node: "Узел",
    valve: "Задвижка",
    pump: "Насос",
    other: "Другое",
  };
  return map[type] || type;
}

function translateConfidence(conf: string): string {
  const map: Record<string, string> = {
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
  };
  return map[conf] || conf;
}
