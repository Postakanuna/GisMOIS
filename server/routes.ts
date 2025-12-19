import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { zuluConnectionSchema, insertTicketSchema } from "@shared/schema";

const ZULU_USERNAME = process.env.ZULU_USERNAME || "";
const ZULU_PASSWORD = process.env.ZULU_PASSWORD || "";
const ZWS_BASE_URL = "https://is.arki.mosreg.ru/zws";

function getBasicAuthHeader(): string {
  const credentials = Buffer.from(`${ZULU_USERNAME}:${ZULU_PASSWORD}`).toString("base64");
  return `Basic ${credentials}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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

  return httpServer;
}
