import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { zuluConnectionSchema } from "@shared/schema";

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

  app.post("/api/zulu/zws/layers", async (req: Request, res: Response) => {
    try {
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
  <Command>
    <LayerExecSql>
      <Layer>LAYTERS:mosgaz</Layer>
      <Query>SELECT * FROM sys.tables LIMIT 1</Query>
      <CRS>EPSG:4326</CRS>
    </LayerExecSql>
  </Command>
</zulu-server>`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${ZWS_BASE_URL}/LayerExecSQL`, {
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
        console.error("ZWS error response:", errorText);
        return res.status(response.status).json({
          message: `ZWS server error: ${response.status} ${response.statusText}`,
        });
      }

      const layers = [
        { name: "mosgaz", title: "МосГаз - Газовые сети" },
        { name: "ZR_TS_MO", title: "ЗР ТС МО" },
      ];

      return res.json({
        layers,
        version: "1.0.0",
        title: "ZuluServer ZWS",
        connected: true,
      });
    } catch (error: any) {
      if (error.name === "AbortError") {
        return res.status(504).json({ message: "Connection timeout" });
      }
      console.error("ZWS connection error:", error);
      return res.status(502).json({
        message: "Cannot connect to ZWS server. Check credentials and network.",
      });
    }
  });

  app.post("/api/zulu/zws/query", async (req: Request, res: Response) => {
    try {
      const { layer, query, crs } = req.body;

      if (!layer) {
        return res.status(400).json({ message: "Layer is required" });
      }

      const sqlQuery = query || "SELECT *";
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${ZWS_BASE_URL}/LayerExecSQL`, {
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
        console.error("ZWS query error:", errorText);
        return res.status(response.status).json({
          message: `ZWS query failed: ${response.statusText}`,
          details: errorText,
        });
      }

      const responseText = await response.text();
      
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          const jsonData = JSON.parse(responseText);
          return res.json(jsonData);
        } catch {
          return res.json({ raw: responseText });
        }
      }

      return res.json({ 
        raw: responseText,
        layer,
        query: sqlQuery,
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
