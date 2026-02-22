import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { zuluConnectionSchema, insertTicketSchema, insertEditableLayerSchema, insertDrawnFeatureSchema, attributeFieldSchema, styleConfigSchema, drawnFeatures, editableLayers, type AttributeField } from "@shared/schema";
import * as turf from "@turf/turf";
import ExcelJS from "exceljs";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, seedAdminUser, isAuthenticated, type AuthRequest } from "./auth";
import { isApiAuthenticated, generateApiToken, hashApiToken, type ApiAuthenticatedRequest } from "./auth/api-auth";
import { externalCreatePointSchema, apiKeys, geocodeProviderSchema, type GeocodeProvider } from "@shared/schema";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq, and, sql, inArray } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import { geocodeBatch, reverseGeocodeBatch, type ReverseGeocodeBatchItem } from "./geocoder";
import path from "path";
import os from "os";
import { parseShapefileBuffer, simplifyFeatureGeometry, getSimplifyTolerance, samplePointFeatures } from "./shapefile-parser";
import { transformPropertyKeys } from "@shared/field-labels";
import { searchObjectsForRAG, getLayersSummaryForContext } from "./ai-rag";

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
    fileSize: 500 * 1024 * 1024, // 500MB limit
    fieldSize: 500 * 1024 * 1024,
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
    fileSize: 50 * 1024 * 1024, // 50MB limit for Excel files
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

const ZULU_USERNAME = process.env.ZULU_USERNAME || "";
const ZULU_PASSWORD = process.env.ZULU_PASSWORD || "";
const ZWS_BASE_URL = "https://is.arki.mosreg.ru/zws";

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

async function backfillBboxColumns() {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM drawn_features WHERE bbox_min_x IS NULL`);
    const count = Number((result as any).rows?.[0]?.cnt || 0);
    if (count === 0) {
      console.log("[Bbox Backfill] All features already have bbox values");
      return;
    }
    console.log(`[Bbox Backfill] Backfilling ${count} features...`);
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
      console.log(`[Bbox Backfill] ${processed}/${count} features processed`);
    }
    console.log("[Bbox Backfill] Complete");
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

  backfillBboxColumns();

  app.post("/api/zulu/zws/layers", async (_req: Request, res: Response) => {
    try {
      const layers = [
        { name: "ZR_VS_MO", title: "Водоснабжение" },
        { name: "ZR_VO_MO", title: "Водоотведение" },
        { name: "ZR_TS_MO", title: "Теплоснабжение" },
      ];

      return res.json({
        layers,
        version: "1.0.0",
        title: "ИС АРКИ Мособлгаз",
        connected: true,
      });
    } catch (error: any) {
      console.error("ZWS layers error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/zulu/zws/custom/layers", async (req: Request, res: Response) => {
    try {
      const { baseUrl, layerNames } = req.body;

      if (!baseUrl) {
        return res.status(400).json({ message: "URL сервера обязателен" });
      }

      if (!layerNames) {
        return res.status(400).json({ message: "Укажите хотя бы один слой" });
      }

      const layerList = layerNames.split(",").map((name: string) => name.trim()).filter(Boolean);

      if (layerList.length === 0) {
        return res.status(400).json({ message: "Укажите хотя бы один слой" });
      }

      const layers = layerList.map((name: string) => ({
        name,
        title: name,
      }));

      return res.json({
        layers,
        version: "1.0.0",
        title: "Пользовательский ZWS сервер",
        baseUrl,
        connected: true,
      });
    } catch (error: any) {
      console.error("Custom ZWS layers error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  const LAYER_QUERIES: Record<string, string> = {
    "ZR_VS_MO": "SELECT name_ist, P_ust, P_podk, P_svob, name_rso, muniz_obr, Geometry.AsText()",
    "ZR_VO_MO": "SELECT name_ist, P_ust, P_podk, P_svob, name_rso, muniz_obr, Geometry.AsText()",
    "ZR_TS_MO": "SELECT name_ist, P_ust, P_podk, P_svob, name_rso, muniz_obr, modename, Адрес, Geometry.AsText()",
  };

  app.post("/api/zulu/zws/query", async (req: Request, res: Response) => {
    try {
      const { layer, query, crs } = req.body;

      if (!layer) {
        return res.status(400).json({ message: "Layer is required" });
      }

      const sqlQuery = query || LAYER_QUERIES[layer] || "SELECT *, Geometry.AsText()";
      const projection = crs || "EPSG:4326";

      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
  <Command>
    <LayerExecSql>
      <Layer>LAYTERS:${layer}</Layer>
      <Query>${sqlQuery}</Query>
      <CRS>${projection}</CRS>
    </LayerExecSql>
  </Command>
</zulu-server>`;

      console.log("ZWS query request:", { layer, sqlQuery, projection });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(`${ZWS_BASE_URL}/LayerExecSQL`, {
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
          "Authorization": getBasicAuthHeader(),
        },
        body: xmlBody,
        signal: controller.signal,
        // @ts-ignore - undici dispatcher option for connection timeout
        dispatcher: new (await import("undici")).Agent({
          connectTimeout: 60000,
          headersTimeout: 60000,
          bodyTimeout: 60000,
        }),
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      console.log("ZWS query response status:", response.status);
      console.log("ZWS query response preview:", responseText.substring(0, 500));

      if (!response.ok) {
        console.error("ZWS query error:", responseText);
        return res.status(response.status).json({
          message: `ZWS query failed: ${response.statusText}`,
          details: responseText,
        });
      }

      return res.json({ 
        raw: responseText,
        layer,
        query: sqlQuery,
        success: true,
      });
    } catch (error: any) {
      if (error.name === "AbortError") {
        return res.status(504).json({ message: "Query timeout" });
      }
      console.error("ZWS query error:", error);
      return res.status(502).json({ message: "Failed to execute ZWS query" });
    }
  });

  app.get("/api/zulu/zws/status", async (_req: Request, res: Response) => {
    try {
      const hasCredentials = ZULU_USERNAME && ZULU_PASSWORD;
      
      if (!hasCredentials) {
        return res.json({
          configured: false,
          message: "ZWS credentials not configured",
        });
      }

      return res.json({
        configured: true,
        baseUrl: ZWS_BASE_URL,
        username: ZULU_USERNAME,
      });
    } catch (error) {
      console.error("ZWS status error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/zulu/zws/tile/:z/:x/:y", async (req: Request, res: Response) => {
    try {
      const { z, x, y } = req.params;
      const { layer } = req.query;

      if (!layer) {
        return res.status(400).json({ message: "Layer parameter is required" });
      }

      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
  <Command>
    <GetLayerTile>
      <X>${x}</X>
      <Y>${y}</Y>
      <Z>${z}</Z>
      <Layer>${layer}</Layer>
    </GetLayerTile>
  </Command>
</zulu-server>`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${ZWS_BASE_URL}/GetLayerTile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
          "Authorization": getBasicAuthHeader(),
        },
        body: xmlBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("ZWS tile error:", response.status, errorText.substring(0, 200));
        return res.status(response.status).json({
          message: `ZWS tile error: ${response.statusText}`,
        });
      }

      const contentType = response.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "max-age=3600");

      const buffer = await response.arrayBuffer();
      return res.send(Buffer.from(buffer));
    } catch (error: any) {
      if (error.name === "AbortError") {
        return res.status(504).json({ message: "ZWS tile request timeout" });
      }
      console.error("ZWS tile error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.post("/api/zulu/capabilities", async (req: Request, res: Response) => {
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

  app.get("/api/zulu/wms", async (req: Request, res: Response) => {
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

  app.post("/api/zulu/feature-info", async (req: Request, res: Response) => {
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

  app.get("/api/tickets", async (_req: Request, res: Response) => {
    try {
      const tickets = await storage.getTickets();
      return res.json(tickets);
    } catch (error) {
      console.error("Get tickets error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/tickets", async (req: Request, res: Response) => {
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

  app.delete("/api/tickets/:id", async (req: Request, res: Response) => {
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
  app.post("/api/routing", async (req: Request, res: Response) => {
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

  app.post("/api/trace-route", async (req: Request, res: Response) => {
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

  app.post("/api/auto-trace", async (req: Request, res: Response) => {
    try {
      const parseResult = autoTraceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request data", errors: parseResult.error.errors });
      }

      const { consumerCoords, sceneId, consumer } = parseResult.data;

      console.log(`[AutoTrace] Starting auto-trace for consumer "${consumer.name}" at [${consumerCoords}] in scene ${sceneId}`);

      const { findNearestConnectionPoint, analyzeRouteGeometry, placeHeatChambers, analyzeCapacity } = await import("./network-graph");

      const { connectionPoint, graph } = await findNearestConnectionPoint(consumerCoords, sceneId);

      if (!connectionPoint) {
        return res.json({
          success: false,
          message: "Не найдена тепловая сеть в данной сцене. Убедитесь, что загружены слои с участками тепловой сети.",
        });
      }

      console.log(`[AutoTrace] Found connection point: "${connectionPoint.name}" (${connectionPoint.type}) at distance ${Math.round(connectionPoint.distance)}m`);

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
            console.log(`[AutoTrace] OSRM route: ${Math.round(routeDistance)}m, ${routeCoords.length} points`);
          }
        }
      } catch (osrmErr: any) {
        console.warn(`[AutoTrace] OSRM unavailable (${osrmErr.name === "AbortError" ? "timeout" : osrmErr.message}), using straight line`);
      }

      const route = analyzeRouteGeometry(routeCoords, routeDistance);

      const heatChambers = placeHeatChambers(route);

      console.log(`[AutoTrace] Route: ${Math.round(route.totalLength)}m, ${route.segments.length} segments, ${route.turningAngles.length} turns, ${heatChambers.length} heat chambers, OSRM=${usedOsrm}`);

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
          const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
          const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

          if (openaiKey && openaiBaseUrl) {
            const OpenAI = (await import("openai")).default;
            const openai = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

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

            console.log("[AutoTrace] Requesting AI calculation...");

            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: "Ты опытный инженер-теплотехник. Отвечай только валидным JSON." },
                { role: "user", content: prompt },
              ],
              temperature: 0.2,
              max_tokens: 1000,
            });

            const aiText = completion.choices?.[0]?.message?.content || "";
            console.log("[AutoTrace] AI response received");

            try {
              const cleaned = aiText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
              aiParams = JSON.parse(cleaned);
            } catch (parseErr) {
              console.error("[AutoTrace] Failed to parse AI response:", aiText.substring(0, 200));
            }
          } else {
            console.log("[AutoTrace] AI not configured, using heuristic calculation");
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

  app.post("/api/auto-trace/save-layer", async (req: Request, res: Response) => {
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

  app.post("/api/auto-trace/save-reconstruction", async (req: Request, res: Response) => {
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

  app.get("/api/zulu/wfs", async (req: Request, res: Response) => {
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
  app.post("/api/editable-layers/import", async (req: Request, res: Response) => {
    try {
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
  app.post("/api/parse-excel", excelUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
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

  app.post("/api/editable-layers/import-excel", async (req: Request, res: Response) => {
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

        console.log(`Starting geocoding of ${addressEntries.length} addresses via ${excelGeoProvider}...`);

        let geocodeResults;
        try {
          geocodeResults = await geocodeBatch(addressEntries, excelGeoApiKey!, undefined, excelGeoProvider);
        } catch (error: any) {
          await storage.deleteEditableLayer(layer.id);
          return res.status(400).json({
            message: error.message || "Ошибка геокодирования",
          });
        }

        console.log(`Geocoding complete. Processing results...`);

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

  app.post("/api/parse-excel-for-join", excelUpload.single("file"), async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      if (!req.file) {
        return res.status(400).json({ message: "Файл не загружен" });
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

  app.post("/api/editable-layers/:layerId/join-preview", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const layerId = parseInt(req.params.layerId);
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

  app.post("/api/editable-layers/:layerId/join-excel", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const layerId = parseInt(req.params.layerId);
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
  app.post("/api/editable-layers/:id/features/batch", async (req: Request, res: Response) => {
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

  app.post("/api/analytics/accident-pipeline", async (req: Request, res: Response) => {
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

  app.post("/api/analytics/geospatial", async (req: Request, res: Response) => {
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

  app.get("/api/editable-layers", async (_req: Request, res: Response) => {
    try {
      const layers = await storage.getEditableLayers();
      return res.json(layers);
    } catch (error) {
      console.error("Error fetching editable layers:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get editable layers for a scene
  app.get("/api/scenes/:sceneId/editable-layers", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      
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

  // Layer folders endpoints
  app.get("/api/scenes/:sceneId/folders", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const sceneId = parseInt(req.params.sceneId);
      const folders = await storage.getLayerFolders(sceneId);
      return res.json(folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scenes/:sceneId/folders", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const sceneId = parseInt(req.params.sceneId);
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

  app.patch("/api/folders/:folderId", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = parseInt(req.params.folderId);
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

  app.delete("/api/folders/:folderId", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = parseInt(req.params.folderId);
      const deleted = await storage.deleteLayerFolder(folderId);
      if (!deleted) return res.status(404).json({ message: "Folder not found" });
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/folders/:folderId/toggle-visibility", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = parseInt(req.params.folderId);
      const { visible } = req.body;
      await storage.toggleFolderVisibility(folderId, !!visible);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error toggling folder visibility:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/editable-layers/:id/folder", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const layerId = parseInt(req.params.id);
      const { folderId, displayOrder } = req.body;
      const layer = await storage.setLayerFolder(layerId, folderId ?? null, displayOrder);
      if (!layer) return res.status(404).json({ message: "Layer not found" });
      return res.json(layer);
    } catch (error) {
      console.error("Error setting layer folder:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/editable-layers/reorder", async (req: Request, res: Response) => {
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

  app.post("/api/layer-folders/reorder", async (req: Request, res: Response) => {
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

  app.get("/api/editable-layers/viewport-batch", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { layerIds, minX, minY, maxX, maxY, zoom, limit } = req.query;
      if (!layerIds || !minX || !minY || !maxX || !maxY) {
        return res.status(400).json({ message: "Missing required parameters: layerIds, minX, minY, maxX, maxY" });
      }

      const ids = (layerIds as string).split(",").map(Number).filter(n => !isNaN(n));
      if (ids.length === 0) {
        return res.json({ layers: {} });
      }

      const featureLimit = limit ? parseInt(limit as string) : 10000;
      const zoomLevel = zoom ? parseInt(zoom as string) : 10;
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

      return res.json({ layers: result, zoom: zoomLevel });
    } catch (error) {
      console.error("Batch viewport features error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:id/field-stats", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.get("/api/editable-layers/:id/unique-values", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.get("/api/editable-layers/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.post("/api/editable-layers", async (req: Request, res: Response) => {
    try {
      const parsed = insertEditableLayerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid layer data", errors: parsed.error.errors });
      }
      const layer = await storage.createEditableLayer(parsed.data);
      return res.status(201).json(layer);
    } catch (error) {
      console.error("Error creating editable layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/editable-layers/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (req.body.styleConfig !== undefined) {
        const parsed = styleConfigSchema.safeParse(req.body.styleConfig);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid styleConfig", errors: parsed.error.errors });
        }
        req.body.styleConfig = parsed.data;
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

  app.delete("/api/editable-layers/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteEditableLayer(id);
      if (!deleted) {
        return res.status(404).json({ message: "Layer not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting editable layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // DRAWN FEATURES API (Features within editable layers)
  // ============================================

  app.get("/api/editable-layers/:layerId/features", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
      const features = await storage.getDrawnFeatures(layerId);
      return res.json(features);
    } catch (error) {
      console.error("Error fetching drawn features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/editable-layers/:layerId/attributes", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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

  app.get("/api/editable-layers/:layerId/attribute-values", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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

  app.post("/api/editable-layers/:layerId/count-filtered", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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

  app.get("/api/features/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.post("/api/editable-layers/:layerId/features", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
      const parsed = insertDrawnFeatureSchema.safeParse({ ...req.body, layerId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid feature data", errors: parsed.error.errors });
      }
      const feature = await storage.createDrawnFeature(parsed.data);
      return res.status(201).json(feature);
    } catch (error) {
      console.error("Error creating drawn feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Batch routes must be defined BEFORE routes with :id parameter to avoid matching "batch" as id
  app.post("/api/features/batch-delete", async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid request: ids must be a non-empty array" });
      }
      const result = await storage.deleteDrawnFeaturesBatch(ids);
      return res.json(result);
    } catch (error) {
      console.error("Error batch deleting features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/features/batch", async (req: Request, res: Response) => {
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
      return res.json(result);
    } catch (error) {
      console.error("Error batch updating features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/features/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const feature = await storage.updateDrawnFeature(id, req.body);
      if (!feature) {
        return res.status(404).json({ message: "Feature not found" });
      }
      return res.json(feature);
    } catch (error) {
      console.error("Error updating drawn feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/features/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteDrawnFeature(id);
      if (!deleted) {
        return res.status(404).json({ message: "Feature not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting drawn feature:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete feature by layerId and featureId (alternative endpoint for map-viewer)
  app.delete("/api/editable-layers/:layerId/features/:featureId", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
      const featureId = parseInt(req.params.featureId);
      
      if (isNaN(layerId) || isNaN(featureId)) {
        return res.status(400).json({ message: "Invalid layer or feature ID" });
      }
      
      const deleted = await storage.deleteDrawnFeature(featureId);
      if (!deleted) {
        return res.status(404).json({ message: "Feature not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting feature from layer:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // LAYER SCHEMA API (Attribute definitions for layers)
  // ============================================

  app.get("/api/editable-layers/:layerId/schema", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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

  app.put("/api/editable-layers/:layerId/schema", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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
  });

  // ============================================
  // EXPORT API (Export layers to various formats)
  // ============================================

  app.get("/api/editable-layers/:layerId/export/:format", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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

  app.get("/api/settings/geocode-provider", async (req: Request, res: Response) => {
    try {
      const value = await storage.getAppSetting("geocode_provider");
      return res.json({ provider: value || "yandex" });
    } catch (error) {
      console.error("Error getting geocode provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/settings/geocode-provider", isAuthenticated, async (req: AuthRequest, res: Response) => {
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
    "ai_yandex_api_key",
    "ai_yandex_folder_id",
    "ai_provider",
  ] as const;

  function maskSecret(value: string): string {
    if (value.length <= 4) return "****";
    return "****" + value.slice(-4);
  }

  app.get("/api/settings/keys", isAuthenticated, async (req: AuthRequest, res: Response) => {
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

  app.put("/api/settings/keys", isAuthenticated, async (req: AuthRequest, res: Response) => {
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

  app.delete("/api/settings/keys/:key", isAuthenticated, async (req: AuthRequest, res: Response) => {
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

  app.get("/api/settings/ai-provider", async (req: Request, res: Response) => {
    try {
      const value = await storage.getAppSetting("ai_provider");
      return res.json({ provider: value || "openai" });
    } catch (error) {
      console.error("Error getting AI provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/settings/ai-provider", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const provider = req.body?.provider;
      if (!["openai", "yandex"].includes(provider)) {
        return res.status(400).json({ message: "Некорректный провайдер. Допустимые: openai, yandex" });
      }
      await storage.setAppSetting("ai_provider", provider);
      return res.json({ provider });
    } catch (error) {
      console.error("Error setting AI provider:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================
  // REVERSE GEOCODING API (Address landmarks)
  // ============================================

  app.post("/api/editable-layers/:layerId/geocode", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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
        clearInterval(keepaliveInterval);
        abortController.abort();
        console.log(`[Geocoder] Client disconnected for layer ${layerId}`);
      });

      const keepaliveInterval = setInterval(() => {
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
        clearInterval(keepaliveInterval);
        sendSSE({ type: "complete", processed: 0, total: 0, success: 0, skipped: features.length });
        res.end();
        return;
      }

      let totalRequests = 0;
      for (const item of batchItems) {
        totalRequests += item.coords.length;
      }

      sendSSE({ type: "start", total: totalRequests, features: batchItems.length, totalFeatures: features.length });

      let successCount = 0;
      let errorCount = 0;

      try {
        const results = await reverseGeocodeBatch(
          batchItems,
          apiKey,
          (processed, total) => {
            sendSSE({ type: "progress", processed, total });
          },
          abortController.signal,
          provider
        );

        for (const result of results) {
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
      } catch (error: any) {
        clearInterval(keepaliveInterval);
        sendSSE({ type: "error", message: error.message || "Ошибка геокодирования" });
        res.end();
        return;
      }

      if (successCount > 0) {
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
          }
        } catch (schemaErr) {
          console.error("Error updating layer schema with geocode fields:", schemaErr);
        }
      }

      clearInterval(keepaliveInterval);
      sendSSE({
        type: "complete",
        processed: totalRequests,
        total: totalRequests,
        success: successCount,
        errors: errorCount,
        skipped: features.length - batchItems.length,
      });
      res.end();
    } catch (error) {
      clearInterval(keepaliveInterval);
      console.error("Error in reverse geocoding:", error);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Internal server error" });
      }
      res.end();
    }
  });

  app.get("/api/editable-layers/:layerId/geocode-info", async (req: Request, res: Response) => {
    try {
      const layerId = parseInt(req.params.layerId);
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

  app.get("/api/scene-folders", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const folders = await storage.getSceneFolders();
      return res.json(folders);
    } catch (error) {
      console.error("Error getting scene folders:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scene-folders", async (req: Request, res: Response) => {
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

  app.patch("/api/scene-folders/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const folderId = parseInt(req.params.id);
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

  app.delete("/api/scene-folders/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const folderId = parseInt(req.params.id);
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
  app.get("/api/scenes", async (req: Request, res: Response) => {
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
  app.get("/api/scenes/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.id);
      
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
  app.post("/api/scenes", async (req: Request, res: Response) => {
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
      return res.status(201).json({ ...scene, role: "owner" });
    } catch (error) {
      console.error("Error creating scene:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update scene
  app.patch("/api/scenes/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.id);
      
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
  app.delete("/api/scenes/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.id);
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (membership?.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ message: "Only owners can delete scenes" });
      }
      
      await storage.deleteScene(sceneId);
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
  app.get("/api/scenes/:sceneId/members", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      
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
  app.post("/api/scenes/:sceneId/members", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      
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
      return res.status(201).json(member);
    } catch (error) {
      console.error("Error adding scene member:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update member role
  app.patch("/api/scenes/:sceneId/members/:memberId", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
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
  app.delete("/api/scenes/:sceneId/members/:memberId", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      const memberId = req.params.memberId;
      
      const membership = await storage.getSceneMember(sceneId, user.id);
      if (membership?.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ message: "Only owners can remove members" });
      }
      
      await storage.removeSceneMember(sceneId, memberId);
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
  app.get("/api/datasets", async (req: Request, res: Response) => {
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
  app.post("/api/datasets/import", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { name, geometryType, geojson, sourceFileName, sourceFiles, crs, sceneId, color } = req.body;
      
      console.log("Server received sourceFiles:", sourceFiles);
      
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
      
      // Batch create drawn features
      if (features.length > 0) {
        const insertFeatures = features.map((feature: any) => ({
          layerId: layer.id,
          geometryType: feature.geometry?.type || geometryType,
          coordinates: feature.geometry?.coordinates || [],
          properties: feature.properties || {},
        }));
        
        await storage.createDrawnFeaturesBatch(insertFeatures);
      }
      
      // Fetch updated layer with correct feature count
      const updatedLayer = await storage.getEditableLayer(layer.id);
      
      return res.status(201).json(updatedLayer);
    } catch (error) {
      console.error("Import layer error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Server-side shapefile upload and parsing (for large files)
  app.post("/api/datasets/upload", upload.single("file"), async (req: Request, res: Response) => {
    let filePath: string | null = null;
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      filePath = file.path;
      const { sceneId, color, name: customName } = req.body;
      const originalName = file.originalname;
      const baseName = customName || originalName.replace(/\.zip$/i, "");

      console.log(`Processing shapefile upload: ${originalName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      const fileBuffer = fs.readFileSync(filePath);
      const parseResult = await parseShapefileBuffer(fileBuffer);
      
      console.log(`Parsed ${parseResult.features.length} features, type: ${parseResult.geometryType}`);

      // Extract field schema from first feature
      let fieldSchema: Array<{ name: string; type: string; required: boolean }> = [];
      if (parseResult.features.length > 0 && parseResult.features[0].properties) {
        fieldSchema = Object.keys(parseResult.features[0].properties).map(key => ({
          name: key,
          type: typeof parseResult.features[0].properties[key] === 'number' ? 'number' : 'text',
          required: false
        }));
      }

      // Create editable layer
      const normalizedType = normalizeGeometryType(parseResult.geometryType);
      const layer = await storage.createEditableLayer({
        sceneId: sceneId ? parseInt(sceneId) : null,
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

      // Create layer schema
      if (fieldSchema.length > 0) {
        await storage.createLayerSchema({
          layerId: layer.id,
          fields: fieldSchema as any,
        });
      }

      // Batch create features in chunks to avoid memory issues
      const BATCH_SIZE = 1000;
      for (let i = 0; i < parseResult.features.length; i += BATCH_SIZE) {
        const batch = parseResult.features.slice(i, i + BATCH_SIZE);
        const insertFeatures = batch.map((feature) => ({
          layerId: layer.id,
          geometryType: feature.geometry?.type || parseResult.geometryType,
          coordinates: feature.geometry?.coordinates || [],
          properties: feature.properties || {},
        }));
        await storage.createDrawnFeaturesBatch(insertFeatures);
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(parseResult.features.length / BATCH_SIZE)}`);
      }

      const updatedLayer = await storage.getEditableLayer(layer.id);
      
      // Clean up temp file
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      return res.status(201).json(updatedLayer);
    } catch (error: any) {
      console.error("Upload shapefile error:", error);
      // Clean up temp file on error
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
      
      // Return more descriptive error message
      const errorMessage = error?.message || "Failed to process shapefile";
      return res.status(500).json({ message: errorMessage });
    }
  });

  // Get features by viewport (bbox) with geometry simplification
  app.get("/api/editable-layers/:id/features/viewport", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const layerId = parseInt(req.params.id);
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

      // Debug: Log layer info for polygon layers
      const layer = await storage.getEditableLayer(layerId);
      const isPolygonLayer = allFeatures.some(f => f.geometryType === "Polygon" || f.geometryType === "MultiPolygon");
      if (isPolygonLayer || layerId === 153) {
        console.log(`[Viewport Filter] Layer ${layer?.name || layerId} (id=${layerId}): ${allFeatures.length} total features, bbox: [${bbox.minX.toFixed(4)}, ${bbox.minY.toFixed(4)}, ${bbox.maxX.toFixed(4)}, ${bbox.maxY.toFixed(4)}], zoom: ${zoomLevel}`);
        
        // Log a sample of feature bounds to debug filtering
        const sampleFeatures = allFeatures.slice(0, 3);
        for (const f of sampleFeatures) {
          const bounds = getFeatureBounds(f.coordinates, f.geometryType);
          if (bounds) {
            console.log(`  Feature ${f.id}: bounds [${bounds.minX.toFixed(4)}, ${bounds.minY.toFixed(4)}, ${bounds.maxX.toFixed(4)}, ${bounds.maxY.toFixed(4)}]`);
          }
        }
      }

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
        
        // Debug: Log excluded polygon features (only first few)
        if (!intersects && (feature.geometryType === "Polygon" || feature.geometryType === "MultiPolygon")) {
          console.log(`[Viewport Filter] Excluding polygon ${feature.id}: bounds [${bounds.minX.toFixed(4)}, ${bounds.minY.toFixed(4)}, ${bounds.maxX.toFixed(4)}, ${bounds.maxY.toFixed(4)}]`);
        }
        
        return intersects;
      });
      
      if (isPolygonLayer) {
        console.log(`[Viewport Filter] Layer ${layer?.name || layerId}: ${filteredFeatures.length} features after filter`);
      }

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
  app.get("/api/datasets/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseInt(req.params.id);
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
  app.delete("/api/datasets/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseInt(req.params.id);
      await storage.deleteDataset(datasetId);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting dataset:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get dataset features
  app.get("/api/datasets/:id/features", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseInt(req.params.id);
      const features = await storage.getDatasetFeatures(datasetId);
      return res.json(features);
    } catch (error) {
      console.error("Error getting dataset features:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get dataset features by viewport (bbox) with geometry simplification
  app.get("/api/datasets/:id/features/viewport", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const datasetId = parseInt(req.params.id);
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
  app.post("/api/datasets/:id/features", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const datasetId = parseInt(req.params.id);
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
  app.patch("/api/datasets/:datasetId/features/:featureId", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const featureId = parseInt(req.params.featureId);
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
  app.delete("/api/datasets/:datasetId/features/:featureId", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const featureId = parseInt(req.params.featureId);
      
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
  app.get("/api/scenes/:sceneId/datasets", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      
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
  app.post("/api/scenes/:sceneId/datasets", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      
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
  app.patch("/api/scenes/:sceneId/datasets/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      const id = parseInt(req.params.id);
      
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
  app.delete("/api/scenes/:sceneId/datasets/:id", async (req: Request, res: Response) => {
    try {
      const user = await getUserFromSession(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const sceneId = parseInt(req.params.sceneId);
      const id = parseInt(req.params.id);
      
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
  app.get("/api/uploads", async (req: Request, res: Response) => {
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
  app.get("/api/api-keys", isAuthenticated, async (req: AuthRequest, res: Response) => {
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
  app.post("/api/api-keys", isAuthenticated, async (req: AuthRequest, res: Response) => {
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
  app.delete("/api/api-keys/:id", isAuthenticated, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const id = parseInt(req.params.id);
      
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

  app.get("/api/custom-icons", async (_req: Request, res: Response) => {
    try {
      const icons = await storage.getCustomIcons();
      return res.json(icons);
    } catch (error) {
      console.error("Error fetching custom icons:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/custom-icons/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.get("/api/custom-icons/:id/svg", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.post("/api/custom-icons", async (req: Request, res: Response) => {
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

  app.delete("/api/custom-icons/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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
      const sceneId = parseInt(req.params.sceneId);

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
      const layerId = parseInt(req.params.layerId);
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

  app.post("/api/network-graph/validate-topology", async (req: Request, res: Response) => {
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

  app.post("/api/network-graph/fix-topology", async (req: Request, res: Response) => {
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

  app.post("/api/network-graph/recalculate-bindings", async (req: Request, res: Response) => {
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

  app.post("/api/network-graph/apply-recalculated-bindings", async (req: Request, res: Response) => {
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

  app.post("/api/network-graph/simulate-spatial", async (req: Request, res: Response) => {
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

  app.post("/api/network-graph/simulate/export", async (req: Request, res: Response) => {
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

  app.post("/api/complaint-analysis", async (req: Request, res: Response) => {
    try {
      const { complaintLayerId, sceneId, dateFieldName, addressFieldName, matchRadius, mode } = req.body;

      if (!complaintLayerId || !dateFieldName) {
        return res.status(400).json({ error: "complaintLayerId and dateFieldName are required" });
      }

      if (mode === "no_topology") {
        const { analyzeComplaintsNoTopology } = await import("./complaint-analysis");
        const result = await analyzeComplaintsNoTopology(
          Number(complaintLayerId),
          String(dateFieldName),
          String(addressFieldName || ""),
          Number(matchRadius) || 350
        );
        return res.json(result);
      }

      if (!sceneId) {
        return res.status(400).json({ error: "sceneId is required for topology mode" });
      }

      const { analyzeComplaints } = await import("./complaint-analysis");
      const result = await analyzeComplaints(
        Number(complaintLayerId),
        Number(sceneId),
        String(dateFieldName),
        String(addressFieldName || ""),
        Number(matchRadius) || 100
      );

      return res.json(result);
    } catch (error: any) {
      console.error("Complaint analysis error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/complaint-analysis/export", async (req: Request, res: Response) => {
    try {
      const { complaintLayerId, sceneId, dateFieldName, addressFieldName, matchRadius } = req.body;

      if (!complaintLayerId || !sceneId || !dateFieldName) {
        return res.status(400).json({ error: "complaintLayerId, sceneId, and dateFieldName are required" });
      }

      const { analyzeComplaints } = await import("./complaint-analysis");
      const result = await analyzeComplaints(
        Number(complaintLayerId),
        Number(sceneId),
        String(dateFieldName),
        String(addressFieldName || ""),
        Number(matchRadius) || 100
      );

      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet("Сводка");
      summarySheet.columns = [
        { header: "Дата", key: "date", width: 15 },
        { header: "Источник (Nist)", key: "nist", width: 15 },
        { header: "Источник", key: "sourceName", width: 30 },
        { header: "Кол-во жалоб", key: "complaintCount", width: 15 },
        { header: "Кол-во потребителей", key: "consumerCount", width: 20 },
        { header: "Вероятный узел аварии", key: "failureNode", width: 35 },
        { header: "Тип узла", key: "nodeType", width: 15 },
        { header: "Участок (от-до)", key: "segment", width: 40 },
        { header: "Уверенность", key: "confidence", width: 15 },
        { header: "Зона покрытия (%)", key: "coverage", width: 18 },
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
              nist: group.nist,
              sourceName: group.sourceName,
              complaintCount: group.complaintCount,
              consumerCount: group.consumers.length,
              failureNode: zone.zoneName || "—",
              nodeType: translateNodeType(zone.zoneType),
              segment: zone.incomingSegment ? `${zone.incomingSegment.from} → ${zone.incomingSegment.to}` : "—",
              confidence: translateConfidence(zone.confidence),
              coverage: group.complaintCount > 0 ? Math.round((zone.complaintCount / group.complaintCount) * 100) : "—",
              downstream: zone.downstreamConsumerCount,
            });
          }
        } else {
          summarySheet.addRow({
            date: group.date,
            nist: group.nist,
            sourceName: group.sourceName,
            complaintCount: group.complaintCount,
            consumerCount: group.consumers.length,
            failureNode: "—",
            nodeType: "—",
            segment: "—",
            confidence: "—",
            coverage: "—",
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
      statsSheet.addRow({ param: "Потребителей без Nist (не группируются)", value: result.emptyNistCount });
      statsSheet.addRow({ param: "Групп дата+источник", value: result.dateGroups.length });

      const usedSheetNames = new Set<string>();
      for (const group of result.dateGroups) {
        if (group.consumers.length === 0) continue;
        let sheetName = `${group.date}_Nist${group.nist}`.substring(0, 31);
        let counter = 1;
        while (usedSheetNames.has(sheetName)) {
          const suffix = `_${counter}`;
          sheetName = `${group.date}_Nist${group.nist}`.substring(0, 31 - suffix.length) + suffix;
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

  app.post("/api/complaint-analysis/save-as-layer", async (req: Request, res: Response) => {
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

          const props: Record<string, unknown> = {
            cluster_id: cluster.id,
            date: cluster.date || "Все даты",
            complaint_count: cluster.complaintCount,
            radius_m: Math.round(cluster.radiusM),
            centroid_lon: cluster.centroid[0],
            centroid_lat: cluster.centroid[1],
            addresses: uniqueAddresses.join("; "),
            address_count: uniqueAddresses.length,
          };

          cluster.complaints.forEach((c: any, idx: number) => {
            const num = idx + 1;
            props[`complaint_${num}_address`] = c.address || "";
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
              nist: group.nist || "",
              source_name: group.sourceName || "",
              confidence: confidenceMap[zone.confidence] || zone.confidence || "",
              complaint_count: zone.complaintCount || 0,
              downstream_consumer_count: zone.downstreamConsumerCount || 0,
              complaint_consumers: zone.complaintConsumers?.join("; ") || "",
              segment: zone.incomingSegment ? `${zone.incomingSegment.from} → ${zone.incomingSegment.to}` : "",
              segment_length_m: zone.incomingSegment?.length || 0,
              affected_segments_count: zone.affectedSegments?.length || 0,
              affected_consumers_count: zone.affectedConsumers?.length || 0,
            };

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
        layerMetadata.emptyNistCount = topologyResult.emptyNistCount || 0;
        layerMetadata.dateGroupCount = topologyResult.dateGroups?.length || 0;
        layerMetadata.failureZoneCount = features.length;
      } else if (mode === "no_topology" && noTopologyResult) {
        layerMetadata.totalComplaints = noTopologyResult.totalComplaints || 0;
        layerMetadata.totalClustered = noTopologyResult.totalClustered || 0;
        layerMetadata.totalUnclustered = noTopologyResult.totalUnclustered || 0;
        layerMetadata.clusterCount = features.length;
      }

      if (analysisParams) {
        if (analysisParams.complaintLayerName) layerMetadata.complaintLayerName = analysisParams.complaintLayerName;
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

  app.get("/api/ai/providers", async (_req: Request, res: Response) => {
    const providers = [];
    const dbYandexKey = await storage.getAppSetting("ai_yandex_api_key");
    const dbYandexFolder = await storage.getAppSetting("ai_yandex_folder_id");
    const hasYandex = !!((dbYandexKey || process.env.YANDEX_STUDIO_API_KEY) && (dbYandexFolder || process.env.YANDEX_FOLDER_ID));
    const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);

    if (hasOpenAI) {
      providers.push({ id: "openai", name: "OpenAI (GPT)", available: true });
    }
    if (hasYandex) {
      providers.push({ id: "yandex", name: "Yandex GPT", available: true });
    }
    if (providers.length === 0) {
      providers.push({ id: "openai", name: "OpenAI (GPT)", available: false });
      providers.push({ id: "yandex", name: "Yandex GPT", available: false });
    }

    return res.json({ providers, default: providers.find(p => p.available)?.id || "openai" });
  });

  // ===== AI Chat (Multi-provider: OpenAI + Yandex) with RAG =====
  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    try {
      const { messages, provider } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages is required and must be a non-empty array" });
      }

      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";

      let ragContext = "";
      let layersSummary = "";
      try {
        const [ragResult, layersResult] = await Promise.all([
          searchObjectsForRAG(lastUserMessage),
          getLayersSummaryForContext(),
        ]);
        ragContext = ragResult;
        layersSummary = layersResult;
        if (ragContext) {
          console.log("[RAG] Found relevant data for query:", lastUserMessage.substring(0, 80));
        }
      } catch (e) {
        console.error("[RAG] Error during search:", e);
      }

      const systemMessage = {
        role: "system",
        content: `Ты — ИИ-ассистент ГИС теплосетей муниципального образования. Помогай пользователю с вопросами об инженерных сетях, теплоснабжении, объектах инфраструктуры. Отвечай на русском языке, кратко и по делу. Ты разбираешься в тепловых сетях, потребителях, источниках теплоснабжения, ЦТП, задвижках, узлах учёта. Можешь помочь с анализом данных, поиском проблемных участков и планированием обслуживания.

ВАЖНО: Если ниже приведены данные из базы — используй их для ответа. Ссылайся на конкретные значения параметров. Если данных нет — отвечай на основе общих знаний, но предупреди, что это общая информация, а не данные из системы.${layersSummary}${ragContext}`,
      };

      const apiMessages = [systemMessage, ...messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      }))];

      const selectedProvider = provider || "openai";

      if (selectedProvider === "openai") {
        const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

        if (!openaiKey || !openaiBaseUrl) {
          return res.status(500).json({ error: "OpenAI не настроен" });
        }

        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

        console.log("OpenAI request:", JSON.stringify({ provider: "openai", messageCount: apiMessages.length }));

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: apiMessages as any,
          temperature: 0.3,
          max_tokens: 2000,
        });

        const aiText = completion.choices?.[0]?.message?.content || "Нет ответа от модели";
        console.log("OpenAI response received successfully");
        return res.json({ content: aiText, provider: "openai" });

      } else if (selectedProvider === "yandex") {
        const apiKey = (await storage.getAppSetting("ai_yandex_api_key")) || process.env.YANDEX_STUDIO_API_KEY;
        const folderId = (await storage.getAppSetting("ai_yandex_folder_id")) || process.env.YANDEX_FOLDER_ID;

        if (!apiKey || !folderId) {
          return res.status(500).json({ error: "Yandex Studio AI не настроен: отсутствует API-ключ или Folder ID" });
        }

        const requestBody = {
          model: `gpt://${folderId}/yandexgpt-lite/latest`,
          messages: apiMessages.map(m => ({ role: m.role, content: m.content })),
          temperature: 0.3,
          max_tokens: 2000,
        };

        console.log("Yandex AI request:", JSON.stringify({ model: requestBody.model, messageCount: requestBody.messages.length }));

        const response = await fetch("https://llm.api.cloud.yandex.net/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "x-folder-id": folderId,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Yandex Studio AI error:", response.status, errorText);

          if (response.status === 401) {
            return res.status(502).json({
              error: "Ошибка авторизации Yandex AI. API-ключ и Folder ID не совпадают.",
              details: errorText.substring(0, 300),
            });
          }
          return res.status(502).json({ error: `Ошибка Yandex AI: ${response.status} - ${errorText.substring(0, 200)}` });
        }

        const data = await response.json() as any;
        console.log("Yandex AI response received successfully");
        const aiText = data?.choices?.[0]?.message?.content || "Нет ответа от модели";

        return res.json({ content: aiText, provider: "yandex" });

      } else {
        return res.status(400).json({ error: `Неизвестный провайдер: ${selectedProvider}` });
      }
    } catch (error: any) {
      console.error("AI chat error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // ============================================
  // ADMIN LAYER MANAGER API
  // ============================================

  app.get("/api/admin/layer-matrix", async (req: Request, res: Response) => {
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
        });
      }

      const matrix = Array.from(layerGroups.values());
      const scenes = allScenes.map(s => ({ id: s.id, name: s.name }));

      return res.json({ matrix, scenes });
    } catch (error) {
      console.error("Error getting layer matrix:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/clone-layer-to-scenes", async (req: Request, res: Response) => {
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

  app.delete("/api/admin/remove-layer-from-scene", async (req: Request, res: Response) => {
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

  app.post("/api/admin/apply-palette", async (req: Request, res: Response) => {
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
