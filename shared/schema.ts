import { z } from "zod";

// ZuluServer connection configuration
export const zuluConnectionSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().min(1).max(65535).optional(),
  layerName: z.string().min(1, "Layer name is required"),
  useWfs: z.boolean().default(false),
  useZws: z.boolean().default(false),
  baseUrl: z.string().optional(),
});

export type ZuluConnection = z.infer<typeof zuluConnectionSchema>;

// Layer configuration
export const layerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  type: z.enum(["wms", "wfs", "base"]),
  url: z.string().optional(),
});

export type LayerConfig = z.infer<typeof layerConfigSchema>;

// Feature info from WMS GetFeatureInfo or WFS
export const featureInfoSchema = z.object({
  id: z.string(),
  layerName: z.string(),
  properties: z.record(z.string(), z.unknown()),
  geometry: z.object({
    type: z.string(),
    coordinates: z.unknown(),
  }).optional(),
});

export type FeatureInfo = z.infer<typeof featureInfoSchema>;

// Map view state
export const mapViewStateSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number(),
  rotation: z.number().default(0),
});

export type MapViewState = z.infer<typeof mapViewStateSchema>;

// WMS capabilities response
export const wmsCapabilitiesSchema = z.object({
  layers: z.array(z.object({
    name: z.string(),
    title: z.string(),
    abstract: z.string().optional(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  })),
  version: z.string(),
  title: z.string().optional(),
});

export type WmsCapabilities = z.infer<typeof wmsCapabilitiesSchema>;

// Connection status
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// API response types
export interface ProxyWmsRequest {
  baseUrl: string;
  service: "WMS" | "WFS";
  request: string;
  layers?: string;
  bbox?: string;
  width?: number;
  height?: number;
  format?: string;
  srs?: string;
  version?: string;
  query?: string;
  x?: number;
  y?: number;
  info_format?: string;
}

// Keep existing user schema for compatibility
import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
