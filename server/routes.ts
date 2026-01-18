import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { zuluConnectionSchema, insertTicketSchema, insertEditableLayerSchema, insertDrawnFeatureSchema, attributeFieldSchema } from "@shared/schema";
import * as turf from "@turf/turf";
import ExcelJS from "exceljs";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, seedAdminUser, isAuthenticated, type AuthRequest } from "./auth";
import { isApiAuthenticated, generateApiToken, hashApiToken, type ApiAuthenticatedRequest } from "./auth/api-auth";
import { externalCreatePointSchema, apiKeys } from "@shared/schema";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq, and } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { parseShapefileBuffer, simplifyFeatureGeometry, getSimplifyTolerance } from "./shapefile-parser";

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
        sourceLayerId,
        sourceFilters = [],
        targetLayerId,
        targetFilters = [],
        boundaryLayerId,
        boundaryFilters = [],
        boundaryMode = "none",
        boundaryType = "polygon",
        bufferDistanceMeters = 10,
        maxDistanceMeters = 15
      } = req.body;

      if (!sourceLayerId || !targetLayerId) {
        return res.status(400).json({ message: "sourceLayerId and targetLayerId are required" });
      }

      if (boundaryType === "line" && boundaryMode !== "none" && boundaryLayerId) {
        const bufferNum = Number(bufferDistanceMeters);
        if (isNaN(bufferNum) || bufferNum <= 0) {
          return res.status(400).json({ message: "bufferDistanceMeters must be a positive number for line constraints" });
        }
      }

      const sourceLayer = await storage.getEditableLayer(sourceLayerId);
      const targetLayer = await storage.getEditableLayer(targetLayerId);

      if (!sourceLayer) {
        return res.status(404).json({ message: "Source layer not found" });
      }
      if (!targetLayer) {
        return res.status(404).json({ message: "Target layer not found" });
      }

      const sourceFeaturesRaw = await storage.getDrawnFeatures(sourceLayerId);
      const targetFeaturesRaw = await storage.getDrawnFeatures(targetLayerId);

      let sourceFeatures = sourceFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: f.properties || {},
      }));

      let targetFeatures = targetFeaturesRaw.map(f => ({
        id: f.id,
        geometry: { type: f.geometryType, coordinates: f.coordinates },
        properties: f.properties || {},
      }));

      sourceFeatures = applyFilters(sourceFeatures, sourceFilters);
      targetFeatures = applyFilters(targetFeatures, targetFilters);

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

      if (boundaryFeatures.length > 0 && (boundaryMode === "inside" || boundaryMode === "outside")) {
        if (boundaryType === "line") {
          sourceFeatures = sourceFeatures.filter(feature => {
            return isFeatureNearLines(feature, boundaryFeatures, bufferDistanceMeters, boundaryMode as "inside" | "outside");
          });

          targetFeatures = targetFeatures.filter(feature => {
            return isFeatureNearLines(feature, boundaryFeatures, bufferDistanceMeters, boundaryMode as "inside" | "outside");
          });
        } else {
          sourceFeatures = sourceFeatures.filter(feature => {
            return isFeatureInBoundary(feature, boundaryFeatures, boundaryMode as "inside" | "outside");
          });

          targetFeatures = targetFeatures.filter(feature => {
            return isFeatureInBoundary(feature, boundaryFeatures, boundaryMode as "inside" | "outside");
          });
        }
      }

      if (sourceFeatures.length === 0) {
        return res.status(422).json({ message: "No source features match the filters" });
      }
      if (targetFeatures.length === 0) {
        return res.status(422).json({ message: "No target features match the filters" });
      }

      const targetMatchCounts: Map<number, number> = new Map();
      const sourceMatches: { sourceIdx: number; targetIdx: number; distance: number }[] = [];
      let unmatchedCount = 0;

      for (let srcIdx = 0; srcIdx < sourceFeatures.length; srcIdx++) {
        const sourceFeature = sourceFeatures[srcIdx];
        const sourceCentroid = getFeatureCentroid(sourceFeature);
        
        if (!sourceCentroid) {
          unmatchedCount++;
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
          const currentCount = targetMatchCounts.get(nearestTargetIndex) || 0;
          targetMatchCounts.set(nearestTargetIndex, currentCount + 1);
          sourceMatches.push({ sourceIdx: srcIdx, targetIdx: nearestTargetIndex, distance: distanceInMeters });
        } else {
          unmatchedCount++;
        }
      }

      const workbook = new ExcelJS.Workbook();

      const resultsSheet = workbook.addWorksheet("Результаты привязки");
      
      const targetPropKeys = new Set<string>();
      for (const feature of targetFeatures) {
        Object.keys(feature.properties).forEach(k => targetPropKeys.add(k));
      }
      const targetPropKeysArr = Array.from(targetPropKeys).sort();

      const columns = [
        { header: "ID объекта", key: "id", width: 12 },
        ...targetPropKeysArr.map(k => ({ header: k, key: k, width: 15 })),
        { header: "Количество привязок", key: "match_count", width: 18 },
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
        const matchCount = targetMatchCounts.get(i) || 0;

        const row: Record<string, any> = {
          id: (feature as any).id || i + 1,
          match_count: matchCount,
        };
        
        for (const key of targetPropKeysArr) {
          row[key] = feature.properties[key] ?? "";
        }
        
        rows.push(row);
      }

      const filteredRows = rows.filter(r => r.match_count > 0);
      filteredRows.sort((a, b) => b.match_count - a.match_count);

      for (const row of filteredRows) {
        resultsSheet.addRow(row);
      }

      const detailsSheet = workbook.addWorksheet("Детали привязок");
      
      const sourcePropKeys = new Set<string>();
      for (const feature of sourceFeatures) {
        Object.keys(feature.properties).forEach(k => sourcePropKeys.add(k));
      }
      const sourcePropKeysArr = Array.from(sourcePropKeys).sort();

      detailsSheet.columns = [
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

      for (const match of sourceMatches) {
        const sourceFeature = sourceFeatures[match.sourceIdx];
        const targetFeature = targetFeatures[match.targetIdx];
        
        const detailRow: Record<string, any> = {
          source_id: (sourceFeature as any).id || match.sourceIdx + 1,
          target_id: (targetFeature as any).id || match.targetIdx + 1,
          distance: Math.round(match.distance * 100) / 100,
        };
        
        for (const key of sourcePropKeysArr) {
          detailRow[`src_${key}`] = sourceFeature.properties[key] ?? "";
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
      metaSheet.addRow({ param: "Исходный слой", value: sourceLayer.name });
      metaSheet.addRow({ param: "Фильтры исходного слоя", value: sourceFilters.length > 0 ? sourceFilters.map((f: FilterCondition) => `${f.attribute} ${f.operator} ${f.value}`).join("; ") : "Без фильтров" });
      metaSheet.addRow({ param: "Целевой слой", value: targetLayer.name });
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
      metaSheet.addRow({ param: "Всего исходных объектов (после фильтров)", value: sourceFeatures.length });
      metaSheet.addRow({ param: "Всего целевых объектов (после фильтров)", value: targetFeatures.length });
      metaSheet.addRow({ param: "Привязано объектов", value: sourceFeatures.length - unmatchedCount });
      metaSheet.addRow({ param: "Непривязано объектов", value: unmatchedCount });
      metaSheet.addRow({ 
        param: "Целевых объектов с привязками", 
        value: Array.from(targetMatchCounts.values()).filter(c => c > 0).length 
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="geospatial_analysis_${Date.now()}.xlsx"`);
      return res.send(Buffer.from(buffer));
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

  app.get("/api/features/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const feature = await storage.getDrawnFeature(id);
      if (!feature) {
        return res.status(404).json({ message: "Feature not found" });
      }
      return res.json(feature);
    } catch (error) {
      console.error("Error fetching drawn feature:", error);
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
      
      return res.status(400).json({ message: `Unsupported format: ${format}. Supported: geojson` });
    } catch (error) {
      console.error("Error exporting layer:", error);
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
      const { name, description } = req.body;
      
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const scene = await storage.createScene({ name, description, createdBy: user.id });
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
      
      const { name, description } = req.body;
      const scene = await storage.updateScene(sceneId, { name, description });
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
          geometryType: normalizeGeometryType(feature.geometry?.type || parseResult.geometryType),
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

      // Simplify geometries for lower zoom levels
      const simplifiedFeatures = limitedFeatures.map(feature => {
        if (tolerance > 0 && feature.geometryType !== "Point") {
          return {
            ...feature,
            coordinates: simplifyFeatureGeometry(feature.coordinates, feature.geometryType, tolerance),
          };
        }
        return feature;
      });

      return res.json({
        features: simplifiedFeatures,
        total: filteredFeatures.length,
        limited: filteredFeatures.length > featureLimit,
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

      // Simplify geometries for lower zoom levels
      const simplifiedFeatures = limitedFeatures.map(feature => {
        if (tolerance > 0 && feature.geometryType !== "Point") {
          return {
            ...feature,
            coordinates: simplifyFeatureGeometry(feature.coordinates, feature.geometryType, tolerance),
          };
        }
        return feature;
      });

      return res.json({
        features: simplifiedFeatures,
        total: filteredFeatures.length,
        limited: filteredFeatures.length > featureLimit,
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
      const sceneId = parseInt(req.params.sceneId);

      if (apiKey.sceneId && apiKey.sceneId !== sceneId) {
        return res.status(403).json({ error: "Forbidden", message: "API key restricted to different scene" });
      }

      const layers = await storage.getEditableLayersByScene(sceneId);
      const pointLayers = layers.filter(l => l.geometryType === "Point");

      return res.json(pointLayers.map(l => ({
        id: l.id,
        name: l.name,
        geometryType: l.geometryType,
        featureCount: l.featureCount,
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
          properties: feature.properties,
          createdAt: feature.createdAt,
        },
      });
    } catch (error) {
      console.error("External API error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // API health check
  app.get("/api/external/health", (req: Request, res: Response) => {
    return res.json({ status: "ok", version: "1.0.0" });
  });

  return httpServer;
}
