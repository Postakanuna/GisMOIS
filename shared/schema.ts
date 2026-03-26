import { z } from "zod";

// ZuluServer connection configuration
export const zuluConnectionSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().min(1).max(65535).optional(),
  layerName: z.string().default(""),
  useWfs: z.boolean().default(false),
  useZws: z.boolean().default(false),
  baseUrl: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
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
  type: z.enum(["wms", "wfs", "base", "zws"]),
  url: z.string().optional(),
  zwsUsername: z.string().optional(),
  zwsPassword: z.string().optional(),
  sublayers: z.array(sublayerFilterSchema).optional(),
  activeFilters: z.record(z.string(), z.array(z.string())).optional(),
});

export type LayerConfig = z.infer<typeof layerConfigSchema>;

// Feature info from WMS GetFeatureInfo or WFS
export const featureInfoSchema = z.object({
  id: z.string(),
  layerName: z.string(),
  properties: z.record(z.string(), z.unknown()),
  networkType: z.string().nullable().optional(),
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

// Point style options for shapefile layers
// Basic shapes + ГОСТ heat network symbols
export const pointStyleSchema = z.enum([
  // Basic geometric shapes
  "circle", "square", "triangle", "cloud", "diamond", "star", "cross", "hexagon", "pentagon",
  // ГОСТ heat network symbols
  "heat-source",    // Теплоисточник
  "ctp",            // ЦТП (Центральный тепловой пункт)
  "itp",            // ИТП (Индивидуальный тепловой пункт)
  "valve",          // Задвижка
  "heat-chamber",   // Тепловая камера
  "pump-station",   // Насосная станция
  "compensator",    // Компенсатор
  "support",        // Опора
]);
export type PointStyle = z.infer<typeof pointStyleSchema>;

// Line style options for shapefile layers
// Basic styles + ГОСТ heat network line styles
export const lineStyleSchema = z.enum([
  // Basic line styles
  "solid", "dashed", "double", "dash-dot", "dotted", "long-dash", "dash-dot-dot",
  // Extended basic line styles
  "crossed",               // Перечёркнутая
  "double-solid-dashed",   // Двойная (верх сплошная, низ прерывистая)
  "double-dashed-solid",   // Двойная (низ сплошная, верх прерывистая)
  "double-dashed",         // Двойная прерывистая
  // Custom constructor
  "custom-constructor",    // Конструктор линий
  // ГОСТ heat network line styles
  "relaying",              // Под перекладку
  "bypass",                // Байпас (временная схема)
  "demolition",            // Под демонтаж
  "above-ground",          // Наземная
  "underground-channel",   // Подземная канальная
  "underground-channelless", // Подземная бесканальная
  "state-program",         // Под перекладку в рамках госпрограммы
]);
export type LineStyle = z.infer<typeof lineStyleSchema>;

// Constructor line layer (one stroke in a composite line)
export const lineLayerSchema = z.object({
  offset: z.number().min(-10).max(10).default(0),
  width: z.number().min(0.5).max(10).default(2),
  color: z.string().default("#1976D2"),
  dash: z.enum(["solid", "dashed", "dotted", "dash-dot"]).default("solid"),
});
export type LineLayer = z.infer<typeof lineLayerSchema>;

// Layer source type
export const layerSourceSchema = z.enum(["user", "import"]);
export type LayerSource = z.infer<typeof layerSourceSchema>;

// Style renderer types (inspired by QGIS/ArcGIS)
export const rendererTypeSchema = z.enum(["single", "categorized", "graduated"]);
export type RendererType = z.infer<typeof rendererTypeSchema>;

export const styleClassItemSchema = z.object({
  color: z.string(),
  pointStyle: pointStyleSchema.optional(),
  lineStyle: lineStyleSchema.optional(),
  strokeWidth: z.number().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  iconSize: z.number().min(4).max(128).optional(),
  customIconId: z.number().optional(),
  constructorLayers: z.array(lineLayerSchema).optional(),
});
export type StyleClassItem = z.infer<typeof styleClassItemSchema>;

export const categorizedClassSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string(),
  style: styleClassItemSchema,
});
export type CategorizedClass = z.infer<typeof categorizedClassSchema>;

export const graduatedClassSchema = z.object({
  min: z.number(),
  max: z.number(),
  label: z.string(),
  style: styleClassItemSchema,
});
export type GraduatedClass = z.infer<typeof graduatedClassSchema>;

export const styleConfigSchema = z.object({
  renderer: rendererTypeSchema.default("single"),
  field: z.string().optional(),
  categorizedClasses: z.array(categorizedClassSchema).optional(),
  graduatedClasses: z.array(graduatedClassSchema).optional(),
  defaultStyle: styleClassItemSchema.optional(),
});
export type StyleConfig = z.infer<typeof styleConfigSchema>;

// Geometry types for drawn features
export const geometryTypeSchema = z.enum(["Point", "LineString", "Polygon"]);
export type GeometryType = z.infer<typeof geometryTypeSchema>;

// Attribute field types
export const attributeFieldTypeSchema = z.enum(["text", "number", "date", "boolean", "select"]);
export type AttributeFieldType = z.infer<typeof attributeFieldTypeSchema>;

// Attribute field definition
export const attributeFieldSchema = z.object({
  name: z.string(),
  type: attributeFieldTypeSchema,
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(), // For select type
});
export type AttributeField = z.infer<typeof attributeFieldSchema>;

// Layer schema definition (for custom attribute structures)
export const layerSchemaDefinitionSchema = z.object({
  id: z.number(),
  layerId: z.number(),
  fields: z.array(attributeFieldSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LayerSchemaDefinition = z.infer<typeof layerSchemaDefinitionSchema>;

export const insertLayerSchemaDefinitionSchema = layerSchemaDefinitionSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLayerSchemaDefinition = z.infer<typeof insertLayerSchemaDefinitionSchema>;

// Drawn feature schema (user-created geometry)
export const drawnFeatureSchema = z.object({
  id: z.number(),
  layerId: z.number(),
  geometryType: geometryTypeSchema,
  coordinates: z.any(), // GeoJSON coordinates
  properties: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().default(1),
});
export type DrawnFeature = z.infer<typeof drawnFeatureSchema>;

export const insertDrawnFeatureSchema = drawnFeatureSchema.omit({ id: true, createdAt: true, updatedAt: true, version: true });
export type InsertDrawnFeature = z.infer<typeof insertDrawnFeatureSchema>;

// Feature history for versioning
export const featureHistorySchema = z.object({
  id: z.number(),
  featureId: z.number(),
  layerId: z.number(),
  geometryType: geometryTypeSchema,
  coordinates: z.any(),
  properties: z.record(z.string(), z.unknown()),
  version: z.number(),
  action: z.enum(["create", "update", "delete"]),
  createdAt: z.string(),
});
export type FeatureHistory = z.infer<typeof featureHistorySchema>;

export const insertFeatureHistorySchema = featureHistorySchema.omit({ id: true, createdAt: true });
export type InsertFeatureHistory = z.infer<typeof insertFeatureHistorySchema>;

export const networkTypeSchema = z.enum(["source", "ctp", "consumer", "segment", "valve", "node", "pump", "accident"]);
export type NetworkType = z.infer<typeof networkTypeSchema>;

// Editable layer (user-created layer for drawing or imported from shapefile)
export const editableLayerSchema = z.object({
  id: z.number(),
  sceneId: z.number().nullable().optional(),
  folderId: z.number().nullable().optional(),
  adminGroupId: z.number().nullable().optional(),
  name: z.string(),
  geometryType: geometryTypeSchema,
  color: z.string().default("#1976D2"),
  pointStyle: pointStyleSchema.default("circle"),
  lineStyle: lineStyleSchema.default("solid"),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  featureCount: z.number().default(0),
  displayOrder: z.number().default(0),
  source: layerSourceSchema.default("user"),
  sourceFileName: z.string().optional(),
  sourceFiles: z.array(z.string()).optional(),
  crs: z.string().default("EPSG:4326"),
  styleConfig: styleConfigSchema.optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  networkType: networkTypeSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EditableLayer = z.infer<typeof editableLayerSchema>;

export const insertEditableLayerSchema = editableLayerSchema.omit({ id: true, createdAt: true, updatedAt: true, featureCount: true });
export type InsertEditableLayer = z.infer<typeof insertEditableLayerSchema>;

// Auth schema (users and sessions)
export * from "./models/auth";

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, jsonb, timestamp, real, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Admin-level layer groups (global folders for the admin layer manager)
export const adminLayerGroups = pgTable("admin_layer_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminLayerGroup = typeof adminLayerGroups.$inferSelect;
export type InsertAdminLayerGroup = typeof adminLayerGroups.$inferInsert;
export const insertAdminLayerGroupSchema = createInsertSchema(adminLayerGroups).omit({ id: true, createdAt: true });

// Layer folders for grouping layers
export const layerFolders = pgTable("layer_folders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sceneId: integer("scene_id").notNull(),
  name: text("name").notNull(),
  visible: integer("visible").notNull().default(1),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LayerFolder = typeof layerFolders.$inferSelect;
export type InsertLayerFolder = typeof layerFolders.$inferInsert;

export const layerFolderSchema = z.object({
  id: z.number(),
  sceneId: z.number(),
  name: z.string(),
  visible: z.boolean(),
  displayOrder: z.number().default(0),
  createdAt: z.string(),
});

export const insertLayerFolderSchema = z.object({
  sceneId: z.number(),
  name: z.string().min(1),
});

// PostgreSQL tables for GIS data
export const editableLayers = pgTable("editable_layers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sceneId: integer("scene_id"), // null for global layers, scene ID for scene-specific layers
  folderId: integer("folder_id"), // null = not in any folder
  adminGroupId: integer("admin_group_id"), // null = not in any admin group
  name: text("name").notNull(),
  geometryType: text("geometry_type").notNull(), // Point, LineString, Polygon
  color: text("color").notNull().default("#1976D2"),
  pointStyle: text("point_style").notNull().default("circle"),
  lineStyle: text("line_style").notNull().default("solid"),
  visible: integer("visible").notNull().default(1),
  opacity: real("opacity").notNull().default(1),
  featureCount: integer("feature_count").notNull().default(0),
  displayOrder: integer("display_order").notNull().default(0),
  source: text("source").notNull().default("user"), // "user" or "import"
  sourceFileName: text("source_file_name"), // original filename for imported layers
  sourceFiles: jsonb("source_files").default([]), // list of files in shapefile set (shp, dbf, prj, cpg, shx)
  crs: text("crs").notNull().default("EPSG:4326"), // coordinate reference system
  styleConfig: jsonb("style_config"),
  metadata: jsonb("metadata"),
  networkType: text("network_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const drawnFeatures = pgTable("drawn_features", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  layerId: integer("layer_id").notNull(),
  geometryType: text("geometry_type").notNull(),
  coordinates: jsonb("coordinates").notNull(),
  properties: jsonb("properties").notNull().default({}),
  version: integer("version").notNull().default(1),
  bboxMinX: real("bbox_min_x"),
  bboxMinY: real("bbox_min_y"),
  bboxMaxX: real("bbox_max_x"),
  bboxMaxY: real("bbox_max_y"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("drawn_features_layer_id_idx").on(table.layerId),
  index("drawn_features_bbox_idx").on(table.layerId, table.bboxMinX, table.bboxMinY, table.bboxMaxX, table.bboxMaxY),
]);

export const featureHistory = pgTable("feature_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  featureId: integer("feature_id").notNull(),
  layerId: integer("layer_id").notNull(),
  geometryType: text("geometry_type").notNull(),
  coordinates: jsonb("coordinates").notNull(),
  properties: jsonb("properties").notNull(),
  version: integer("version").notNull(),
  action: text("action").notNull(), // create, update, delete
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const layerSchemas = pgTable("layer_schemas", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  layerId: integer("layer_id").notNull().unique(),
  fields: jsonb("fields").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Scene role types
export const sceneRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type SceneRole = z.infer<typeof sceneRoleSchema>;

// Scene folders for grouping scenes
export const sceneFolders = pgTable("scene_folders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SceneFolder = typeof sceneFolders.$inferSelect;
export type InsertSceneFolder = typeof sceneFolders.$inferInsert;

export const insertSceneFolderSchema = z.object({
  name: z.string().min(1),
  parentId: z.number().nullable().optional(),
  createdBy: z.string(),
});

// Scenes table - project containers
export const scenes = pgTable("scenes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description"),
  folderId: integer("folder_id"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;

export const insertSceneSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  folderId: z.number().nullable().optional(),
  createdBy: z.string(),
});

// Scene members - user access to scenes with roles
export const sceneMembers = pgTable("scene_members", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sceneId: integer("scene_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: text("role").notNull().default("viewer"), // owner, editor, viewer
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export type SceneMember = typeof sceneMembers.$inferSelect;
export type InsertSceneMember = typeof sceneMembers.$inferInsert;

export const insertSceneMemberSchema = z.object({
  sceneId: z.number(),
  userId: z.string(),
  role: sceneRoleSchema.default("viewer"),
});

// Datasets - processed shapefile data catalog
export const datasets = pgTable("datasets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  originalFilename: text("original_filename").notNull(),
  geometryType: text("geometry_type").notNull(), // Point, LineString, Polygon
  crs: text("crs").default("EPSG:4326"),
  fieldSchema: jsonb("field_schema").notNull().default([]), // Array of AttributeField
  featureCount: integer("feature_count").notNull().default(0),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Dataset = typeof datasets.$inferSelect;
export type InsertDataset = typeof datasets.$inferInsert;

export const insertDatasetSchema = z.object({
  name: z.string().min(1),
  originalFilename: z.string(),
  geometryType: z.string(),
  crs: z.string().default("EPSG:4326"),
  fieldSchema: z.array(attributeFieldSchema).default([]),
  createdBy: z.string(),
});

// Dataset features - geometry and attributes for each dataset
export const datasetFeatures = pgTable("dataset_features", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  datasetId: integer("dataset_id").notNull(),
  geometryType: text("geometry_type").notNull(),
  coordinates: jsonb("coordinates").notNull(),
  properties: jsonb("properties").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DatasetFeature = typeof datasetFeatures.$inferSelect;
export type InsertDatasetFeature = typeof datasetFeatures.$inferInsert;

export const insertDatasetFeatureSchema = z.object({
  datasetId: z.number(),
  geometryType: z.string(),
  coordinates: z.any(),
  properties: z.record(z.string(), z.unknown()).default({}),
});

// Scene datasets - links datasets to scenes with display settings
export const sceneDatasets = pgTable("scene_datasets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sceneId: integer("scene_id").notNull(),
  datasetId: integer("dataset_id").notNull(),
  layerName: text("layer_name"), // custom name in this scene
  isVisible: integer("is_visible").notNull().default(1),
  opacity: real("opacity").notNull().default(1),
  color: text("color").notNull().default("#1976D2"),
  pointStyle: text("point_style").notNull().default("circle"),
  lineStyle: text("line_style").notNull().default("solid"),
  zIndex: integer("z_index").notNull().default(0),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export type SceneDataset = typeof sceneDatasets.$inferSelect;
export type InsertSceneDataset = typeof sceneDatasets.$inferInsert;

export const insertSceneDatasetSchema = z.object({
  sceneId: z.number(),
  datasetId: z.number(),
  layerName: z.string().optional(),
  isVisible: z.number().default(1),
  opacity: z.number().default(1),
  color: z.string().default("#1976D2"),
  pointStyle: pointStyleSchema.default("circle"),
  lineStyle: lineStyleSchema.default("solid"),
  zIndex: z.number().default(0),
});

// Uploads - tracking shapefile upload status
export const uploadStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const uploads = pgTable("uploads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  status: text("status").notNull().default("pending"), // pending, uploading, processing, completed, failed
  error: text("error"),
  datasetId: integer("dataset_id"),
  layerId: integer("layer_id"),
  progress: integer("progress").notNull().default(0),
  totalFeatures: integer("total_features"),
  processedFeatures: integer("processed_features").notNull().default(0),
  sceneId: integer("scene_id"),
  color: text("color"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Upload = typeof uploads.$inferSelect;
export type InsertUpload = typeof uploads.$inferInsert;

export const insertUploadSchema = z.object({
  filename: z.string(),
  originalFilename: z.string(),
  createdBy: z.string(),
});

// Custom icons - user-uploaded SVG icons for styling
export const customIcons = pgTable("custom_icons", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  svgContent: text("svg_content").notNull(),
  category: text("category").default("custom"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomIcon = typeof customIcons.$inferSelect;
export type InsertCustomIcon = typeof customIcons.$inferInsert;

export const insertCustomIconSchema = z.object({
  name: z.string().min(1),
  svgContent: z.string().min(1),
  category: z.string().default("custom"),
  createdBy: z.string().optional(),
});

// API Keys for external integrations (Telegram bot, etc.)
export const apiKeys = pgTable("api_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  sceneId: integer("scene_id"),
  permissions: text("permissions").array().notNull().default(sql`ARRAY['create_point']`),
  isActive: integer("is_active").notNull().default(1),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

export const apiKeyPermissionSchema = z.enum(["create_point", "read_layers", "read_scenes", "spatial_query"]);
export type ApiKeyPermission = z.infer<typeof apiKeyPermissionSchema>;

export const insertApiKeySchema = z.object({
  userId: z.string(),
  name: z.string().min(1, "Название обязательно"),
  tokenHash: z.string(),
  sceneId: z.number().optional(),
  permissions: z.array(apiKeyPermissionSchema).default(["create_point"]),
});

// Application settings - key-value store for app configuration
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

export const geocodeProviderSchema = z.enum(["yandex", "dadata"]);
export type GeocodeProvider = z.infer<typeof geocodeProviderSchema>;

// Audit log for user action tracking
export const auditLog = pgTable("audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id"),
  username: varchar("username"),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: varchar("entity_id", { length: 100 }),
  sceneId: integer("scene_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("audit_log_user_id_idx").on(table.userId),
  index("audit_log_created_at_idx").on(table.createdAt),
  index("audit_log_action_idx").on(table.action),
]);

export type AuditLogEntry = typeof auditLog.$inferSelect;

// Bug reports
export const bugReportStatusEnum = ["new", "rejected", "in_progress", "fixed", "paused"] as const;
export type BugReportStatus = typeof bugReportStatusEnum[number];

export const bugReports = pgTable("bug_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  username: varchar("username"),
  message: text("message").notNull(),
  screenshotPath: text("screenshot_path"),
  status: varchar("status", { length: 50 }).notNull().default("new"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("bug_reports_user_id_idx").on(table.userId),
  index("bug_reports_status_idx").on(table.status),
  index("bug_reports_created_at_idx").on(table.createdAt),
]);

export const insertBugReportSchema = createInsertSchema(bugReports).omit({ id: true, createdAt: true });
export type BugReport = typeof bugReports.$inferSelect;
export type InsertBugReport = z.infer<typeof insertBugReportSchema>;

// Sensor integration tables
export const sensorIntegrationConfig = pgTable("sensor_integration_config", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  apiUrl: text("api_url").notNull().default("https://mvitu.arki.mosreg.ru/api/edds/bot/koteln_last_sensors_state/index.php"),
  apiToken: text("api_token").notNull().default(""),
  pollingIntervalMinutes: integer("polling_interval_minutes").notNull().default(15),
  isEnabled: integer("is_enabled").notNull().default(0),
  isDebugMode: integer("is_debug_mode").notNull().default(0),
  lastSyncAt: timestamp("last_sync_at"),
});

export type SensorIntegrationConfig = typeof sensorIntegrationConfig.$inferSelect;
export type InsertSensorIntegrationConfig = typeof sensorIntegrationConfig.$inferInsert;

export const sensorObjectBindings = pgTable("sensor_object_bindings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  idCdsKoteln: integer("id_cds_koteln").notNull().unique(),
  objectType: text("object_type").notNull(), // 'source' | 'ctp' | 'consumer'
  layerId: integer("layer_id").notNull(),
  objectName: text("object_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SensorObjectBinding = typeof sensorObjectBindings.$inferSelect;
export type InsertSensorObjectBinding = typeof sensorObjectBindings.$inferInsert;

export const sensorReadingsCache = pgTable("sensor_readings_cache", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  idCdsKoteln: integer("id_cds_koteln").notNull().unique(),
  mrName: text("mr_name"),
  placeName: text("place_name"),
  nameKoteln: text("name_koteln"),
  address: text("address"),
  rsoName: text("rso_name"),
  type: text("type"),
  mkdCount: integer("mkd_count"),
  mkdPeopleCount: integer("mkd_people_count"),
  activeClaims: jsonb("active_claims").default([]),
  sensorsState: text("sensors_state"),
  sensorDate: timestamp("sensor_date"),
  tForward: real("t_forward"),
  tReverse: real("t_reverse"),
  pForward: real("p_forward"),
  pRevers: real("p_revers"),
  responsibles: jsonb("responsibles").default([]),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

export type SensorReadingCache = typeof sensorReadingsCache.$inferSelect;
export type InsertSensorReadingCache = typeof sensorReadingsCache.$inferInsert;

// External API schemas
export const externalCreatePointSchema = z.object({
  sceneId: z.number(),
  layerId: z.number(),
  coordinates: z.tuple([z.number(), z.number()]), // [longitude, latitude]
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type ExternalCreatePoint = z.infer<typeof externalCreatePointSchema>;

// ─── Reconstruction & Cost Estimation ────────────────────────────────────────

// Справочник удельных стоимостей (заполняется администратором)
export const costUnitRates = pgTable("cost_unit_rates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  objectType: text("object_type").notNull(), // 'pipe' | 'ctp' | 'source'
  layingType: text("laying_type"),           // 'underground' | 'above' | null (для ctp/source)
  diameterMm: integer("diameter_mm"),        // только для pipe; null для ctp/source
  workType: text("work_type").notNull(),     // 'overhaul' | 'reconstruction'
  pricePerUnit: numeric("price_per_unit", { precision: 14, scale: 2 }).notNull(),
  unit: text("unit").notNull(),              // 'rub_per_m' | 'rub_per_mw'
  baseYear: integer("base_year").notNull().default(2025),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CostUnitRate = typeof costUnitRates.$inferSelect;
export type InsertCostUnitRate = typeof costUnitRates.$inferInsert;
export const insertCostUnitRateSchema = createInsertSchema(costUnitRates).omit({ id: true, createdAt: true });

// Программы реконструкции и капремонта
export const reconstructionPrograms = pgTable("reconstruction_programs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sceneId: integer("scene_id").notNull(),
  name: text("name").notNull(),
  periodFrom: integer("period_from").notNull(),
  periodTo: integer("period_to").notNull(),
  baseYear: integer("base_year").notNull().default(2025),
  inflationRate: numeric("inflation_rate", { precision: 5, scale: 2 }).notNull().default("5.00"),
  totalBaseCost: numeric("total_base_cost", { precision: 14, scale: 2 }),
  totalIndexedCost: numeric("total_indexed_cost", { precision: 14, scale: 2 }),
  status: text("status").notNull().default("draft"), // 'draft' | 'approved'
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReconstructionProgram = typeof reconstructionPrograms.$inferSelect;
export type InsertReconstructionProgram = typeof reconstructionPrograms.$inferInsert;
export const insertReconstructionProgramSchema = createInsertSchema(reconstructionPrograms).omit({ id: true, createdAt: true, updatedAt: true });

// Объекты внутри программы реконструкции
export const programObjects = pgTable("program_objects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  programId: integer("program_id").notNull(),
  featureId: integer("feature_id"),           // FK → drawn_features (опционально)
  objectType: text("object_type").notNull(),  // 'pipe' | 'ctp' | 'source'
  objectName: text("object_name").notNull(),
  diameterMm: integer("diameter_mm"),
  lengthM: numeric("length_m", { precision: 10, scale: 2 }),
  capacityMw: numeric("capacity_mw", { precision: 10, scale: 3 }),
  layingType: text("laying_type"),            // 'underground' | 'above'
  workType: text("work_type").notNull().default("overhaul"),
  unitRateId: integer("unit_rate_id"),
  unitRateValue: numeric("unit_rate_value", { precision: 14, scale: 2 }),
  baseCost: numeric("base_cost", { precision: 14, scale: 2 }),
  plannedYear: integer("planned_year"),
  indexedCost: numeric("indexed_cost", { precision: 14, scale: 2 }),
  accidentCount: integer("accident_count"),
  accidentsPerM: numeric("accidents_per_m", { precision: 10, scale: 6 }),
  residentCount: integer("resident_count"),
  consumerCount: integer("consumer_count"),
  criticalityScore: numeric("criticality_score", { precision: 5, scale: 2 }),
  geometry: jsonb("geometry"),               // GeoJSON для подсветки на карте
  sortOrder: integer("sort_order").notNull().default(0),
});

export type ProgramObject = typeof programObjects.$inferSelect;
export type InsertProgramObject = typeof programObjects.$inferInsert;
export const insertProgramObjectSchema = createInsertSchema(programObjects).omit({ id: true });

// Справочник полей Zulu (расшифровка технических имён атрибутов SHP-файлов)
export const zuluFieldLabels = pgTable("zulu_field_labels", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fieldName: text("field_name").notNull().unique(),
  label: text("label").notNull(),
  category: text("category"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ZuluFieldLabel = typeof zuluFieldLabels.$inferSelect;
export type InsertZuluFieldLabel = typeof zuluFieldLabels.$inferInsert;
export const insertZuluFieldLabelSchema = createInsertSchema(zuluFieldLabels).omit({ id: true, createdAt: true, updatedAt: true });

// Справочник значений полей Zulu (расшифровка кодов, например ZType=1 → "Теплосеть рабочая")
export const zuluFieldValues = pgTable("zulu_field_values", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fieldName: text("field_name").notNull(),
  fieldValue: text("field_value").notNull(),
  label: text("label").notNull(),
  networkType: text("network_type"),
  category: text("category"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ZuluFieldValue = typeof zuluFieldValues.$inferSelect;
export type InsertZuluFieldValue = typeof zuluFieldValues.$inferInsert;
export const insertZuluFieldValueSchema = createInsertSchema(zuluFieldValues).omit({ id: true, createdAt: true, updatedAt: true });
