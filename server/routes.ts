import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { zuluConnectionSchema, insertTicketSchema, insertFacilitySchema, insertTraceSchema, insertEditableLayerSchema, insertDrawnFeatureSchema, attributeFieldSchema } from "@shared/schema";
import * as turf from "@turf/turf";
import ExcelJS from "exceljs";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, seedAdminUser, isAuthenticated, type AuthRequest } from "./auth";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq, and } from "drizzle-orm";

const ZULU_USERNAME = process.env.ZULU_USERNAME || "";
const ZULU_PASSWORD = process.env.ZULU_PASSWORD || "";
const ZWS_BASE_URL = "https://is.arki.mosreg.ru/zws";

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

  // Facility routes
  app.get("/api/facilities", async (_req: Request, res: Response) => {
    try {
      const facilities = await storage.getFacilities();
      return res.json(facilities);
    } catch (error) {
      console.error("Get facilities error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/facilities", async (req: Request, res: Response) => {
    try {
      const parseResult = insertFacilitySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid facility data",
          errors: parseResult.error.errors,
        });
      }
      const facility = await storage.createFacility(parseResult.data);
      return res.status(201).json(facility);
    } catch (error) {
      console.error("Create facility error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/facilities/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid facility ID" });
      }
      const facility = await storage.updateFacility(id, req.body);
      if (!facility) {
        return res.status(404).json({ message: "Facility not found" });
      }
      return res.json(facility);
    } catch (error) {
      console.error("Update facility error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/facilities/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid facility ID" });
      }
      // Delete associated traces first
      await storage.deleteTracesByBuilding(id);
      const deleted = await storage.deleteFacility(id);
      if (!deleted) {
        return res.status(404).json({ message: "Facility not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Delete facility error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Trace routes
  app.get("/api/traces", async (_req: Request, res: Response) => {
    try {
      const traces = await storage.getTraces();
      return res.json(traces);
    } catch (error) {
      console.error("Get traces error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/traces", async (req: Request, res: Response) => {
    try {
      const parseResult = insertTraceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid trace data",
          errors: parseResult.error.errors,
        });
      }
      const trace = await storage.createTrace(parseResult.data);
      return res.status(201).json(trace);
    } catch (error) {
      console.error("Create trace error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/traces/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid trace ID" });
      }
      const deleted = await storage.deleteTrace(id);
      if (!deleted) {
        return res.status(404).json({ message: "Trace not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Delete trace error:", error);
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

      const { name, geometryType, geojson, sourceFileName, crs, sceneId, color } = req.body;
      
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
        source: "import",
        sourceFileName: sourceFileName || name,
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

  return httpServer;
}
