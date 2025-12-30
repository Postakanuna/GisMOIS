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

// Sublayer filter for virtual layers
export const sublayerFilterSchema = z.object({
  field: z.string(),
  value: z.string(),
  label: z.string(),
  visible: z.boolean().default(true),
});

export type SublayerFilter = z.infer<typeof sublayerFilterSchema>;

// Layer configuration
export const layerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  type: z.enum(["wms", "wfs", "base"]),
  url: z.string().optional(),
  sublayers: z.array(sublayerFilterSchema).optional(),
  activeFilters: z.record(z.string(), z.array(z.string())).optional(),
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

// Ticket (marker point) schema
export const ticketSchema = z.object({
  id: z.number(),
  lon: z.number(),
  lat: z.number(),
  status: z.enum(["bound", "unbound"]),
  boundPolygonId: z.string().optional(),
  boundLayerId: z.string().optional(),
  nameIst: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
});

export type Ticket = z.infer<typeof ticketSchema>;

export const insertTicketSchema = ticketSchema.omit({ id: true, createdAt: true, status: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;

// Facility types for infrastructure objects
export const facilityTypeSchema = z.enum(["building", "boilerhouse", "waterintake"]);
export type FacilityType = z.infer<typeof facilityTypeSchema>;

// Facility (infrastructure object) schema
export const facilitySchema = z.object({
  id: z.number(),
  type: facilityTypeSchema,
  name: z.string(),
  lon: z.number(),
  lat: z.number(),
  // Boilerhouse: free heat capacity in Gcal/h
  freeHeatCapacity: z.number().optional(),
  // Waterintake: free water capacity in m³/h
  freeWaterCapacity: z.number().optional(),
  // Building: required heat load in Gcal/h
  requiredHeatLoad: z.number().optional(),
  // Building: required water supply in m³/h
  requiredWaterSupply: z.number().optional(),
  createdAt: z.string(),
});

export type Facility = z.infer<typeof facilitySchema>;

export const insertFacilitySchema = facilitySchema.omit({ id: true, createdAt: true });
export type InsertFacility = z.infer<typeof insertFacilitySchema>;

// Trace types for routing
export const traceTypeSchema = z.enum(["heating", "water"]);
export type TraceType = z.infer<typeof traceTypeSchema>;

// Trace (routing line) schema
export const traceSchema = z.object({
  id: z.number(),
  type: traceTypeSchema,
  buildingId: z.number(),
  targetId: z.number(),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
  length: z.number(),
  createdAt: z.string(),
});

export type Trace = z.infer<typeof traceSchema>;

export const insertTraceSchema = traceSchema.omit({ id: true, createdAt: true });
export type InsertTrace = z.infer<typeof insertTraceSchema>;

// Point style options for shapefile layers
export const pointStyleSchema = z.enum(["circle", "square", "triangle", "cloud"]);
export type PointStyle = z.infer<typeof pointStyleSchema>;

// Line style options for shapefile layers
export const lineStyleSchema = z.enum(["solid", "dashed", "double"]);
export type LineStyle = z.infer<typeof lineStyleSchema>;

// Uploaded shapefile layer schema
export const uploadedLayerSchema = z.object({
  id: z.number(),
  name: z.string(),
  filename: z.string(),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  color: z.string().default("#1976D2"),
  pointStyle: pointStyleSchema.default("circle"),
  lineStyle: lineStyleSchema.default("solid"),
  geojson: z.any(),
  featureCount: z.number(),
  createdAt: z.string(),
});

export type UploadedLayer = z.infer<typeof uploadedLayerSchema>;

export const insertUploadedLayerSchema = uploadedLayerSchema.omit({ id: true, createdAt: true });
export type InsertUploadedLayer = z.infer<typeof insertUploadedLayerSchema>;

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
