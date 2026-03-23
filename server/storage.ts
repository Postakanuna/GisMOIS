import { 
  type Ticket, type InsertTicket, 
  type EditableLayer, type InsertEditableLayer, 
  type DrawnFeature, type InsertDrawnFeature, 
  type LayerSchemaDefinition, type InsertLayerSchemaDefinition, 
  type AttributeField,
  type Scene, type InsertScene,
  type SceneMember, type InsertSceneMember,
  type SceneFolder, type InsertSceneFolder,
  type Dataset, type InsertDataset,
  type DatasetFeature, type InsertDatasetFeature,
  type SceneDataset, type InsertSceneDataset,
  type Upload, type InsertUpload,
  type SceneRole,
  type ApiKey, type InsertApiKey, type ApiKeyPermission,
  type CustomIcon, type InsertCustomIcon,
  type LayerFolder,
  type BugReport, type InsertBugReport,
  type SensorIntegrationConfig, type InsertSensorIntegrationConfig,
  type SensorObjectBinding, type InsertSensorObjectBinding,
  type SensorReadingCache, type InsertSensorReadingCache,
  type CostUnitRate, type InsertCostUnitRate,
  type ReconstructionProgram, type InsertReconstructionProgram,
  type ProgramObject, type InsertProgramObject,
  type ZuluFieldLabel, type InsertZuluFieldLabel,
  type AdminLayerGroup,
  editableLayers, drawnFeatures, layerSchemas,
  scenes, sceneMembers, sceneFolders, datasets, datasetFeatures, sceneDatasets, uploads, apiKeys, customIcons, layerFolders,
  appSettings, bugReports,
  sensorIntegrationConfig, sensorObjectBindings, sensorReadingsCache,
  costUnitRates, reconstructionPrograms, programObjects, zuluFieldLabels, adminLayerGroups
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { aiProviders, type AiProvider, type InsertAiProvider, type UpdateAiProvider } from "@shared/models/chat";
import { db } from "./db";
import { eq, sql, and, inArray, gte, lte, isNull, desc } from "drizzle-orm";

export interface IStorage {
  getTickets(): Promise<Ticket[]>;
  getTicket(id: number): Promise<Ticket | undefined>;
  createTicket(ticket: InsertTicket): Promise<Ticket>;
  deleteTicket(id: number): Promise<boolean>;
  getEditableLayers(): Promise<EditableLayer[]>;
  getEditableLayersByScene(sceneId: number): Promise<EditableLayer[]>;
  getEditableLayer(id: number): Promise<EditableLayer | undefined>;
  createEditableLayer(layer: InsertEditableLayer): Promise<EditableLayer>;
  updateEditableLayer(id: number, updates: Partial<InsertEditableLayer>): Promise<EditableLayer | undefined>;
  deleteEditableLayer(id: number): Promise<boolean>;
  getDrawnFeatures(layerId: number): Promise<DrawnFeature[]>;
  getDrawnFeaturesByViewport(layerIds: number[], bbox: { minX: number; minY: number; maxX: number; maxY: number }, limit?: number): Promise<Record<number, DrawnFeature[]>>;
  getDrawnFeature(id: number): Promise<DrawnFeature | undefined>;
  createDrawnFeature(feature: InsertDrawnFeature): Promise<DrawnFeature>;
  createDrawnFeaturesBatch(features: InsertDrawnFeature[]): Promise<DrawnFeature[]>;
  updateDrawnFeature(id: number, updates: Partial<InsertDrawnFeature>): Promise<DrawnFeature | undefined>;
  updateDrawnFeaturesBatch(updates: { id: number; properties: Record<string, unknown> }[]): Promise<DrawnFeature[]>;
  deleteDrawnFeature(id: number): Promise<boolean>;
  deleteDrawnFeaturesBatch(ids: number[]): Promise<{ deletedCount: number; layerIds: number[] }>;
  deleteDrawnFeaturesByLayer(layerId: number): Promise<boolean>;
  getLayerSchema(layerId: number): Promise<LayerSchemaDefinition | undefined>;
  createLayerSchema(schema: InsertLayerSchemaDefinition): Promise<LayerSchemaDefinition>;
  updateLayerSchema(layerId: number, fields: AttributeField[]): Promise<LayerSchemaDefinition | undefined>;
  
  // Scene folder methods
  getSceneFolders(parentId?: number | null): Promise<SceneFolder[]>;
  getSceneFolder(id: number): Promise<SceneFolder | undefined>;
  createSceneFolder(folder: { name: string; parentId?: number | null; createdBy: string }): Promise<SceneFolder>;
  updateSceneFolder(id: number, updates: Partial<{ name: string; parentId: number | null }>): Promise<SceneFolder | undefined>;
  deleteSceneFolder(id: number): Promise<boolean>;

  // Scene methods
  getScenes(): Promise<Scene[]>;
  getScenesForUser(userId: string): Promise<(Scene & { role: SceneRole })[]>;
  getScene(id: number): Promise<Scene | undefined>;
  createScene(scene: { name: string; description?: string; folderId?: number | null; createdBy: string }): Promise<Scene>;
  updateScene(id: number, updates: Partial<{ name: string; description: string; folderId: number | null }>): Promise<Scene | undefined>;
  deleteScene(id: number): Promise<boolean>;
  
  // Scene members methods
  getSceneMembers(sceneId: number): Promise<(SceneMember & { username?: string; firstName?: string | null; lastName?: string | null })[]>;
  getSceneMember(sceneId: number, userId: string): Promise<SceneMember | undefined>;
  addSceneMember(sceneId: number, userId: string, role: SceneRole): Promise<SceneMember>;
  updateSceneMemberRole(sceneId: number, userId: string, role: SceneRole): Promise<SceneMember | undefined>;
  removeSceneMember(sceneId: number, userId: string): Promise<boolean>;
  
  // Dataset methods
  getDatasets(): Promise<Dataset[]>;
  getDataset(id: number): Promise<Dataset | undefined>;
  createDataset(dataset: { name: string; originalFilename: string; geometryType: string; crs?: string; fieldSchema?: AttributeField[]; createdBy: string }): Promise<Dataset>;
  updateDataset(id: number, updates: Partial<{ name: string; featureCount: number }>): Promise<Dataset | undefined>;
  deleteDataset(id: number): Promise<boolean>;
  
  // Dataset features methods
  getDatasetFeatures(datasetId: number): Promise<DatasetFeature[]>;
  getDatasetFeature(id: number): Promise<DatasetFeature | undefined>;
  createDatasetFeature(feature: { datasetId: number; geometryType: string; coordinates: unknown; properties?: Record<string, unknown> }): Promise<DatasetFeature>;
  createDatasetFeaturesBatch(features: { datasetId: number; geometryType: string; coordinates: unknown; properties?: Record<string, unknown> }[]): Promise<DatasetFeature[]>;
  updateDatasetFeature(id: number, updates: Partial<{ geometryType: string; coordinates: unknown; properties: Record<string, unknown> }>): Promise<DatasetFeature | undefined>;
  deleteDatasetFeature(id: number): Promise<{ deleted: boolean; datasetId: number | null }>;
  deleteDatasetFeatures(datasetId: number): Promise<boolean>;
  
  // Scene datasets methods
  getSceneDatasets(sceneId: number): Promise<(SceneDataset & { dataset: Dataset })[]>;
  addDatasetToScene(sceneId: number, datasetId: number, options?: Partial<{ layerName: string; color: string; opacity: number }>): Promise<SceneDataset>;
  updateSceneDataset(id: number, updates: Partial<{ layerName: string; isVisible: number; opacity: number; color: string; pointStyle: string; lineStyle: string; zIndex: number }>): Promise<SceneDataset | undefined>;
  removeDatasetFromScene(id: number): Promise<boolean>;
  
  // Upload methods
  getUploads(userId?: string): Promise<Upload[]>;
  getUpload(id: number): Promise<Upload | undefined>;
  createUpload(upload: { filename: string; originalFilename: string; createdBy: string }): Promise<Upload>;
  updateUpload(id: number, updates: Partial<{ status: string; error: string | null; datasetId: number | null; layerId: number | null; progress: number; totalFeatures: number | null; processedFeatures: number }>): Promise<Upload | undefined>;
  deleteUpload(id: number): Promise<boolean>;
  
  // API Key methods
  getApiKeys(userId: string): Promise<ApiKey[]>;
  getApiKey(id: number): Promise<ApiKey | undefined>;
  getApiKeyByToken(tokenHash: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: { userId: string; name: string; tokenHash: string; sceneId?: number; permissions?: ApiKeyPermission[] }): Promise<ApiKey>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  revokeApiKey(id: number): Promise<boolean>;
  
  // Custom icons methods
  getCustomIcons(): Promise<CustomIcon[]>;
  getCustomIcon(id: number): Promise<CustomIcon | undefined>;
  createCustomIcon(icon: { name: string; svgContent: string; category?: string; createdBy?: string }): Promise<CustomIcon>;
  deleteCustomIcon(id: number): Promise<boolean>;
  
  // Layer folders methods
  getLayerFolders(sceneId: number): Promise<LayerFolder[]>;
  getLayerFolder(id: number): Promise<LayerFolder | undefined>;
  createLayerFolder(folder: { sceneId: number; name: string }): Promise<LayerFolder>;
  updateLayerFolder(id: number, updates: Partial<{ name: string; visible: number }>): Promise<LayerFolder | undefined>;
  deleteLayerFolder(id: number): Promise<boolean>;
  setLayerFolder(layerId: number, folderId: number | null, displayOrder?: number): Promise<EditableLayer | undefined>;
  toggleFolderVisibility(folderId: number, visible: boolean): Promise<void>;
  reorderLayers(layerIds: number[], displayOrders?: number[]): Promise<void>;
  reorderFolders(folderIds: number[], displayOrders?: number[]): Promise<void>;
  getMaxLayerDisplayOrder(sceneId: number, folderId: number | null): Promise<number>;
  getMaxFolderDisplayOrder(sceneId: number): Promise<number>;
  
  // App settings methods
  getAppSetting(key: string): Promise<string | undefined>;
  setAppSetting(key: string, value: string): Promise<void>;
  deleteAppSetting(key: string): Promise<void>;

  // Bug reports methods
  getBugReports(): Promise<BugReport[]>;
  getBugReport(id: number): Promise<BugReport | undefined>;
  createBugReport(report: InsertBugReport): Promise<BugReport>;
  updateBugReportStatus(id: number, status: string): Promise<BugReport | undefined>;

  // AI providers methods
  getAiProviders(): Promise<AiProvider[]>;
  getAiProvider(id: number): Promise<AiProvider | undefined>;
  createAiProvider(provider: InsertAiProvider): Promise<AiProvider>;
  updateAiProvider(id: number, updates: UpdateAiProvider): Promise<AiProvider | undefined>;
  deleteAiProvider(id: number): Promise<boolean>;
  getDefaultAiProvider(): Promise<AiProvider | undefined>;

  // Sensor integration methods
  getSensorIntegrationConfig(): Promise<SensorIntegrationConfig | undefined>;
  upsertSensorIntegrationConfig(data: Partial<InsertSensorIntegrationConfig>): Promise<SensorIntegrationConfig>;
  getSensorObjectBindings(): Promise<SensorObjectBinding[]>;
  createSensorObjectBinding(data: InsertSensorObjectBinding): Promise<SensorObjectBinding>;
  updateSensorObjectBinding(id: number, data: Partial<InsertSensorObjectBinding>): Promise<SensorObjectBinding | undefined>;
  deleteSensorObjectBinding(id: number): Promise<boolean>;
  getSensorReadingsCache(): Promise<SensorReadingCache[]>;
  getSensorReadingByKotelnId(idCdsKoteln: number): Promise<SensorReadingCache | undefined>;
  upsertSensorReadingsCache(readings: InsertSensorReadingCache[]): Promise<void>;
  updateSensorLastSyncAt(timestamp: Date): Promise<void>;

  // Cost unit rates (справочник удельников)
  getCostUnitRates(filters?: { objectType?: string; workType?: string; layingType?: string }): Promise<CostUnitRate[]>;
  getCostUnitRate(id: number): Promise<CostUnitRate | undefined>;
  createCostUnitRate(data: InsertCostUnitRate): Promise<CostUnitRate>;
  updateCostUnitRate(id: number, data: Partial<InsertCostUnitRate>): Promise<CostUnitRate | undefined>;
  deleteCostUnitRate(id: number): Promise<boolean>;
  findBestUnitRate(objectType: string, workType: string, layingType?: string, diameterMm?: number, baseYear?: number): Promise<CostUnitRate | undefined>;

  // Reconstruction programs
  getReconstructionPrograms(sceneId: number): Promise<ReconstructionProgram[]>;
  getReconstructionProgram(id: number): Promise<ReconstructionProgram | undefined>;
  createReconstructionProgram(data: InsertReconstructionProgram): Promise<ReconstructionProgram>;
  updateReconstructionProgram(id: number, data: Partial<InsertReconstructionProgram>): Promise<ReconstructionProgram | undefined>;
  deleteReconstructionProgram(id: number): Promise<boolean>;

  // Program objects
  getProgramObjects(programId: number): Promise<ProgramObject[]>;
  getProgramObject(id: number): Promise<ProgramObject | undefined>;
  createProgramObject(data: InsertProgramObject): Promise<ProgramObject>;
  updateProgramObject(id: number, data: Partial<InsertProgramObject>): Promise<ProgramObject | undefined>;
  deleteProgramObject(id: number): Promise<boolean>;
  deleteProgramObjects(programId: number): Promise<void>;

  // Zulu field labels (расшифровка атрибутов SHP-файлов)
  getZuluFieldLabels(): Promise<ZuluFieldLabel[]>;
  getZuluFieldLabel(id: number): Promise<ZuluFieldLabel | undefined>;
  getZuluFieldLabelByName(fieldName: string): Promise<ZuluFieldLabel | undefined>;
  createZuluFieldLabel(data: InsertZuluFieldLabel): Promise<ZuluFieldLabel>;
  updateZuluFieldLabel(id: number, data: Partial<InsertZuluFieldLabel>): Promise<ZuluFieldLabel | undefined>;
  deleteZuluFieldLabel(id: number): Promise<boolean>;
  seedZuluFieldLabels(entries: { fieldName: string; label: string; category?: string }[]): Promise<void>;

  // Admin layer groups methods
  getAdminLayerGroups(): Promise<AdminLayerGroup[]>;
  createAdminLayerGroup(data: { name: string; displayOrder?: number }): Promise<AdminLayerGroup>;
  updateAdminLayerGroup(id: number, updates: Partial<{ name: string; displayOrder: number }>): Promise<AdminLayerGroup | undefined>;
  deleteAdminLayerGroup(id: number): Promise<boolean>;
  setLayerAdminGroup(layerName: string, geometryType: string, adminGroupId: number | null): Promise<void>;
  renameLayerGlobal(oldName: string, geometryType: string, newName: string): Promise<void>;
  updateLayerMetadataGlobal(name: string, geometryType: string, metadata: Record<string, unknown>): Promise<void>;
}

function toEditableLayer(row: typeof editableLayers.$inferSelect): EditableLayer {
  return {
    id: row.id,
    sceneId: row.sceneId ?? undefined,
    folderId: row.folderId ?? undefined,
    adminGroupId: row.adminGroupId ?? undefined,
    name: row.name,
    geometryType: row.geometryType as EditableLayer["geometryType"],
    color: row.color,
    pointStyle: row.pointStyle as EditableLayer["pointStyle"],
    lineStyle: row.lineStyle as EditableLayer["lineStyle"],
    visible: row.visible === 1,
    opacity: row.opacity,
    featureCount: row.featureCount,
    displayOrder: row.displayOrder ?? 0,
    source: row.source as EditableLayer["source"],
    sourceFileName: row.sourceFileName || undefined,
    sourceFiles: row.sourceFiles || [],
    crs: row.crs || "EPSG:4326",
    styleConfig: (row as any).styleConfig || undefined,
    metadata: (row as any).metadata || undefined,
    networkType: (row as any).networkType || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDrawnFeature(row: typeof drawnFeatures.$inferSelect): DrawnFeature {
  return {
    id: row.id,
    layerId: row.layerId,
    geometryType: row.geometryType as DrawnFeature["geometryType"],
    coordinates: row.coordinates,
    properties: row.properties as Record<string, unknown>,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function computeBbox(coordinates: any, geometryType: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!coordinates) return null;
  const allCoords: number[][] = [];
  function extract(coords: any): void {
    if (!coords || !Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      allCoords.push(coords as number[]);
    } else {
      coords.forEach(extract);
    }
  }
  extract(coordinates);
  if (allCoords.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of allCoords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function toLayerSchema(row: typeof layerSchemas.$inferSelect): LayerSchemaDefinition {
  return {
    id: row.id,
    layerId: row.layerId,
    fields: row.fields as AttributeField[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DatabaseStorage implements IStorage {
  private tickets: Map<number, Ticket> = new Map();
  private ticketIdCounter = 1;

  async getTickets(): Promise<Ticket[]> {
    return Array.from(this.tickets.values());
  }

  async getTicket(id: number): Promise<Ticket | undefined> {
    return this.tickets.get(id);
  }

  async createTicket(insertTicket: InsertTicket): Promise<Ticket> {
    const id = this.ticketIdCounter++;
    const ticket: Ticket = {
      ...insertTicket,
      id,
      status: insertTicket.nameIst ? "bound" : "unbound",
      createdAt: new Date().toISOString(),
    };
    this.tickets.set(id, ticket);
    return ticket;
  }

  async deleteTicket(id: number): Promise<boolean> {
    return this.tickets.delete(id);
  }

  async getEditableLayers(): Promise<EditableLayer[]> {
    const rows = await db.select().from(editableLayers);
    return rows.map(toEditableLayer);
  }

  async getEditableLayersByScene(sceneId: number): Promise<EditableLayer[]> {
    const rows = await db.select().from(editableLayers).where(eq(editableLayers.sceneId, sceneId));
    return rows.map(toEditableLayer);
  }

  async getEditableLayer(id: number): Promise<EditableLayer | undefined> {
    const [row] = await db.select().from(editableLayers).where(eq(editableLayers.id, id));
    return row ? toEditableLayer(row) : undefined;
  }

  async createEditableLayer(layer: InsertEditableLayer): Promise<EditableLayer> {
    const sceneId = layer.sceneId ?? null;
    const maxOrder = sceneId !== null ? await this.getMaxLayerDisplayOrder(sceneId, null) : -1;
    const [row] = await db.insert(editableLayers).values({
      sceneId,
      name: layer.name,
      geometryType: layer.geometryType,
      color: layer.color || "#1976D2",
      pointStyle: layer.pointStyle || "circle",
      lineStyle: layer.lineStyle || "solid",
      visible: layer.visible !== false ? 1 : 0,
      opacity: layer.opacity ?? 1,
      featureCount: 0,
      displayOrder: layer.displayOrder ?? (maxOrder + 1),
      source: layer.source || "user",
      sourceFileName: layer.sourceFileName,
      sourceFiles: layer.sourceFiles || [],
      crs: layer.crs || "EPSG:4326",
      metadata: (layer as any).metadata || null,
    }).returning();
    return toEditableLayer(row);
  }

  async updateEditableLayer(id: number, updates: Partial<InsertEditableLayer>): Promise<EditableLayer | undefined> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.geometryType !== undefined) updateData.geometryType = updates.geometryType;
    if (updates.color !== undefined) updateData.color = updates.color;
    if (updates.pointStyle !== undefined) updateData.pointStyle = updates.pointStyle;
    if (updates.lineStyle !== undefined) updateData.lineStyle = updates.lineStyle;
    if (updates.visible !== undefined) updateData.visible = updates.visible ? 1 : 0;
    if (updates.opacity !== undefined) updateData.opacity = updates.opacity;
    if (updates.source !== undefined) updateData.source = updates.source;
    if (updates.sourceFileName !== undefined) updateData.sourceFileName = updates.sourceFileName;
    if (updates.sceneId !== undefined) updateData.sceneId = updates.sceneId;
    if ((updates as any).folderId !== undefined) updateData.folderId = (updates as any).folderId;
    if (updates.crs !== undefined) updateData.crs = updates.crs;
    if ((updates as any).styleConfig !== undefined) updateData.styleConfig = (updates as any).styleConfig;
    if ((updates as any).metadata !== undefined) updateData.metadata = (updates as any).metadata;
    if ((updates as any).networkType !== undefined) updateData.networkType = (updates as any).networkType;

    const [row] = await db.update(editableLayers)
      .set(updateData)
      .where(eq(editableLayers.id, id))
      .returning();
    return row ? toEditableLayer(row) : undefined;
  }

  async deleteEditableLayer(id: number): Promise<boolean> {
    await this.deleteDrawnFeaturesByLayer(id);
    await db.delete(layerSchemas).where(eq(layerSchemas.layerId, id));
    const result = await db.delete(editableLayers).where(eq(editableLayers.id, id)).returning();
    return result.length > 0;
  }

  async getDrawnFeatures(layerId: number): Promise<DrawnFeature[]> {
    const rows = await db.select().from(drawnFeatures).where(eq(drawnFeatures.layerId, layerId));
    return rows.map(toDrawnFeature);
  }

  async getDrawnFeaturesByViewport(
    layerIds: number[],
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    limit: number = 5000
  ): Promise<Record<number, DrawnFeature[]>> {
    if (layerIds.length === 0) return {};
    const result: Record<number, DrawnFeature[]> = {};
    for (const id of layerIds) result[id] = [];

    const rows = await db.select().from(drawnFeatures).where(
      and(
        inArray(drawnFeatures.layerId, layerIds),
        lte(drawnFeatures.bboxMinX, bbox.maxX),
        gte(drawnFeatures.bboxMaxX, bbox.minX),
        lte(drawnFeatures.bboxMinY, bbox.maxY),
        gte(drawnFeatures.bboxMaxY, bbox.minY),
      )
    ).limit(limit);

    for (const row of rows) {
      const f = toDrawnFeature(row);
      if (result[f.layerId]) {
        result[f.layerId].push(f);
      }
    }
    return result;
  }

  async getDrawnFeature(id: number): Promise<DrawnFeature | undefined> {
    const [row] = await db.select().from(drawnFeatures).where(eq(drawnFeatures.id, id));
    return row ? toDrawnFeature(row) : undefined;
  }

  async createDrawnFeature(feature: InsertDrawnFeature): Promise<DrawnFeature> {
    const bbox = computeBbox(feature.coordinates, feature.geometryType);
    const [row] = await db.insert(drawnFeatures).values({
      layerId: feature.layerId,
      geometryType: feature.geometryType,
      coordinates: feature.coordinates,
      properties: feature.properties || {},
      bboxMinX: bbox?.minX ?? null,
      bboxMinY: bbox?.minY ?? null,
      bboxMaxX: bbox?.maxX ?? null,
      bboxMaxY: bbox?.maxY ?? null,
    }).returning();
    
    await db.update(editableLayers)
      .set({ 
        featureCount: sql`${editableLayers.featureCount} + 1`,
        updatedAt: new Date()
      })
      .where(eq(editableLayers.id, feature.layerId));
    
    return toDrawnFeature(row);
  }

  async createDrawnFeaturesBatch(features: InsertDrawnFeature[]): Promise<DrawnFeature[]> {
    if (features.length === 0) return [];
    
    const rows = await db.insert(drawnFeatures).values(
      features.map(f => {
        const bbox = computeBbox(f.coordinates, f.geometryType);
        return {
          layerId: f.layerId,
          geometryType: f.geometryType,
          coordinates: f.coordinates,
          properties: f.properties || {},
          bboxMinX: bbox?.minX ?? null,
          bboxMinY: bbox?.minY ?? null,
          bboxMaxX: bbox?.maxX ?? null,
          bboxMaxY: bbox?.maxY ?? null,
        };
      })
    ).returning();

    const layerCounts = new Map<number, number>();
    features.forEach(f => {
      layerCounts.set(f.layerId, (layerCounts.get(f.layerId) || 0) + 1);
    });

    for (const [layerId, count] of Array.from(layerCounts.entries())) {
      await db.update(editableLayers)
        .set({ 
          featureCount: sql`${editableLayers.featureCount} + ${count}`,
          updatedAt: new Date()
        })
        .where(eq(editableLayers.id, layerId));
    }

    return rows.map(toDrawnFeature);
  }

  async updateDrawnFeature(id: number, updates: Partial<InsertDrawnFeature>): Promise<DrawnFeature | undefined> {
    const updateData: Record<string, unknown> = { 
      updatedAt: new Date(),
      version: sql`${drawnFeatures.version} + 1`
    };
    if (updates.geometryType !== undefined) updateData.geometryType = updates.geometryType;
    if (updates.coordinates !== undefined) {
      updateData.coordinates = updates.coordinates;
      const bbox = computeBbox(updates.coordinates, updates.geometryType || "Point");
      updateData.bboxMinX = bbox?.minX ?? null;
      updateData.bboxMinY = bbox?.minY ?? null;
      updateData.bboxMaxX = bbox?.maxX ?? null;
      updateData.bboxMaxY = bbox?.maxY ?? null;
    }
    if (updates.properties !== undefined) updateData.properties = updates.properties;

    const [row] = await db.update(drawnFeatures)
      .set(updateData)
      .where(eq(drawnFeatures.id, id))
      .returning();
    return row ? toDrawnFeature(row) : undefined;
  }

  async deleteDrawnFeature(id: number): Promise<boolean> {
    const [feature] = await db.select().from(drawnFeatures).where(eq(drawnFeatures.id, id));
    if (!feature) return false;
    
    await db.delete(drawnFeatures).where(eq(drawnFeatures.id, id));
    
    await db.update(editableLayers)
      .set({ 
        featureCount: sql`GREATEST(${editableLayers.featureCount} - 1, 0)`,
        updatedAt: new Date()
      })
      .where(eq(editableLayers.id, feature.layerId));
    
    return true;
  }

  async updateDrawnFeaturesBatch(updates: { id: number; properties: Record<string, unknown> }[]): Promise<DrawnFeature[]> {
    if (updates.length === 0) return [];
    
    const results: DrawnFeature[] = [];
    for (const update of updates) {
      const [row] = await db.update(drawnFeatures)
        .set({ 
          properties: update.properties,
          updatedAt: new Date(),
          version: sql`${drawnFeatures.version} + 1`
        })
        .where(eq(drawnFeatures.id, update.id))
        .returning();
      if (row) {
        results.push(toDrawnFeature(row));
      }
    }
    return results;
  }

  async deleteDrawnFeaturesBatch(ids: number[]): Promise<{ deletedCount: number; layerIds: number[] }> {
    if (ids.length === 0) return { deletedCount: 0, layerIds: [] };
    
    const featuresToDelete = await db.select()
      .from(drawnFeatures)
      .where(inArray(drawnFeatures.id, ids));
    
    if (featuresToDelete.length === 0) return { deletedCount: 0, layerIds: [] };
    
    const layerCounts = new Map<number, number>();
    for (const f of featuresToDelete) {
      layerCounts.set(f.layerId, (layerCounts.get(f.layerId) || 0) + 1);
    }
    
    await db.delete(drawnFeatures).where(inArray(drawnFeatures.id, ids));
    
    for (const [layerId, count] of Array.from(layerCounts.entries())) {
      await db.update(editableLayers)
        .set({ 
          featureCount: sql`GREATEST(${editableLayers.featureCount} - ${count}, 0)`,
          updatedAt: new Date()
        })
        .where(eq(editableLayers.id, layerId));
    }
    
    return { deletedCount: featuresToDelete.length, layerIds: Array.from(layerCounts.keys()) };
  }

  async deleteDrawnFeaturesByLayer(layerId: number): Promise<boolean> {
    const result = await db.delete(drawnFeatures).where(eq(drawnFeatures.layerId, layerId)).returning();
    return result.length > 0;
  }

  async getLayerSchema(layerId: number): Promise<LayerSchemaDefinition | undefined> {
    const [row] = await db.select().from(layerSchemas).where(eq(layerSchemas.layerId, layerId));
    return row ? toLayerSchema(row) : undefined;
  }

  async createLayerSchema(schema: InsertLayerSchemaDefinition): Promise<LayerSchemaDefinition> {
    const [row] = await db.insert(layerSchemas).values({
      layerId: schema.layerId,
      fields: schema.fields,
    }).returning();
    return toLayerSchema(row);
  }

  async updateLayerSchema(layerId: number, fields: AttributeField[]): Promise<LayerSchemaDefinition | undefined> {
    const [row] = await db.update(layerSchemas)
      .set({ fields, updatedAt: new Date() })
      .where(eq(layerSchemas.layerId, layerId))
      .returning();
    return row ? toLayerSchema(row) : undefined;
  }

  // Scene methods
  // Scene folder methods
  async getSceneFolders(parentId?: number | null): Promise<SceneFolder[]> {
    if (parentId === undefined) {
      return await db.select().from(sceneFolders);
    }
    if (parentId === null) {
      return await db.select().from(sceneFolders).where(isNull(sceneFolders.parentId));
    }
    return await db.select().from(sceneFolders).where(eq(sceneFolders.parentId, parentId));
  }

  async getSceneFolder(id: number): Promise<SceneFolder | undefined> {
    const [row] = await db.select().from(sceneFolders).where(eq(sceneFolders.id, id));
    return row;
  }

  async createSceneFolder(folder: { name: string; parentId?: number | null; createdBy: string }): Promise<SceneFolder> {
    const [row] = await db.insert(sceneFolders).values({
      name: folder.name,
      parentId: folder.parentId ?? null,
      createdBy: folder.createdBy,
    }).returning();
    return row;
  }

  async updateSceneFolder(id: number, updates: Partial<{ name: string; parentId: number | null }>): Promise<SceneFolder | undefined> {
    const updateData: Record<string, unknown> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.parentId !== undefined) updateData.parentId = updates.parentId;
    const [row] = await db.update(sceneFolders).set(updateData).where(eq(sceneFolders.id, id)).returning();
    return row;
  }

  async deleteSceneFolder(id: number): Promise<boolean> {
    await db.update(scenes).set({ folderId: null }).where(eq(scenes.folderId, id));
    await db.update(sceneFolders).set({ parentId: null }).where(eq(sceneFolders.parentId, id));
    const result = await db.delete(sceneFolders).where(eq(sceneFolders.id, id)).returning();
    return result.length > 0;
  }

  async getScenes(): Promise<Scene[]> {
    return await db.select().from(scenes);
  }

  async getScenesForUser(userId: string): Promise<(Scene & { role: SceneRole })[]> {
    const memberships = await db.select().from(sceneMembers).where(eq(sceneMembers.userId, userId));
    if (memberships.length === 0) return [];
    
    const sceneIds = memberships.map(m => m.sceneId);
    const sceneRows = await db.select().from(scenes).where(inArray(scenes.id, sceneIds));
    
    return sceneRows.map(scene => {
      const membership = memberships.find(m => m.sceneId === scene.id);
      return { ...scene, role: (membership?.role || "viewer") as SceneRole };
    });
  }

  async getScene(id: number): Promise<Scene | undefined> {
    const [row] = await db.select().from(scenes).where(eq(scenes.id, id));
    return row;
  }

  async createScene(scene: { name: string; description?: string; folderId?: number | null; createdBy: string }): Promise<Scene> {
    const [row] = await db.insert(scenes).values({
      name: scene.name,
      description: scene.description || null,
      folderId: scene.folderId ?? null,
      createdBy: scene.createdBy,
    }).returning();
    
    // Add creator as owner
    await db.insert(sceneMembers).values({
      sceneId: row.id,
      userId: scene.createdBy,
      role: "owner",
    });
    
    return row;
  }

  async updateScene(id: number, updates: Partial<{ name: string; description: string; folderId: number | null }>): Promise<Scene | undefined> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.folderId !== undefined) updateData.folderId = updates.folderId;
    
    const [row] = await db.update(scenes).set(updateData).where(eq(scenes.id, id)).returning();
    return row;
  }

  async deleteScene(id: number): Promise<boolean> {
    // Delete all scene datasets first
    await db.delete(sceneDatasets).where(eq(sceneDatasets.sceneId, id));
    // Delete all scene members
    await db.delete(sceneMembers).where(eq(sceneMembers.sceneId, id));
    // Delete scene
    const result = await db.delete(scenes).where(eq(scenes.id, id)).returning();
    return result.length > 0;
  }

  // Scene members methods
  async getSceneMembers(sceneId: number): Promise<(SceneMember & { username?: string; firstName?: string | null; lastName?: string | null })[]> {
    const members = await db.select({
      id: sceneMembers.id,
      sceneId: sceneMembers.sceneId,
      userId: sceneMembers.userId,
      role: sceneMembers.role,
      addedAt: sceneMembers.addedAt,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(sceneMembers)
      .leftJoin(users, eq(sceneMembers.userId, users.id))
      .where(eq(sceneMembers.sceneId, sceneId));
    return members;
  }

  async getSceneMember(sceneId: number, userId: string): Promise<SceneMember | undefined> {
    const [row] = await db.select().from(sceneMembers)
      .where(and(eq(sceneMembers.sceneId, sceneId), eq(sceneMembers.userId, userId)));
    return row;
  }

  async addSceneMember(sceneId: number, userId: string, role: SceneRole): Promise<SceneMember> {
    const [row] = await db.insert(sceneMembers).values({
      sceneId,
      userId,
      role,
    }).returning();
    return row;
  }

  async updateSceneMemberRole(sceneId: number, userId: string, role: SceneRole): Promise<SceneMember | undefined> {
    const [row] = await db.update(sceneMembers)
      .set({ role })
      .where(and(eq(sceneMembers.sceneId, sceneId), eq(sceneMembers.userId, userId)))
      .returning();
    return row;
  }

  async removeSceneMember(sceneId: number, userId: string): Promise<boolean> {
    const result = await db.delete(sceneMembers)
      .where(and(eq(sceneMembers.sceneId, sceneId), eq(sceneMembers.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // Dataset methods
  async getDatasets(): Promise<Dataset[]> {
    return await db.select().from(datasets);
  }

  async getDataset(id: number): Promise<Dataset | undefined> {
    const [row] = await db.select().from(datasets).where(eq(datasets.id, id));
    return row;
  }

  async createDataset(dataset: { name: string; originalFilename: string; geometryType: string; crs?: string; fieldSchema?: AttributeField[]; createdBy: string }): Promise<Dataset> {
    const [row] = await db.insert(datasets).values({
      name: dataset.name,
      originalFilename: dataset.originalFilename,
      geometryType: dataset.geometryType,
      crs: dataset.crs || "EPSG:4326",
      fieldSchema: dataset.fieldSchema || [],
      createdBy: dataset.createdBy,
    }).returning();
    return row;
  }

  async updateDataset(id: number, updates: Partial<{ name: string; featureCount: number }>): Promise<Dataset | undefined> {
    const updateData: Record<string, unknown> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.featureCount !== undefined) updateData.featureCount = updates.featureCount;
    
    const [row] = await db.update(datasets).set(updateData).where(eq(datasets.id, id)).returning();
    return row;
  }

  async deleteDataset(id: number): Promise<boolean> {
    // Delete features first
    await db.delete(datasetFeatures).where(eq(datasetFeatures.datasetId, id));
    // Remove from all scenes
    await db.delete(sceneDatasets).where(eq(sceneDatasets.datasetId, id));
    // Delete dataset
    const result = await db.delete(datasets).where(eq(datasets.id, id)).returning();
    return result.length > 0;
  }

  // Dataset features methods
  async getDatasetFeatures(datasetId: number): Promise<DatasetFeature[]> {
    return await db.select().from(datasetFeatures).where(eq(datasetFeatures.datasetId, datasetId));
  }

  async createDatasetFeature(feature: { datasetId: number; geometryType: string; coordinates: unknown; properties?: Record<string, unknown> }): Promise<DatasetFeature> {
    const [row] = await db.insert(datasetFeatures).values({
      datasetId: feature.datasetId,
      geometryType: feature.geometryType,
      coordinates: feature.coordinates,
      properties: feature.properties || {},
    }).returning();
    
    await db.update(datasets)
      .set({ featureCount: sql`${datasets.featureCount} + 1` })
      .where(eq(datasets.id, feature.datasetId));
    
    return row;
  }

  async createDatasetFeaturesBatch(features: { datasetId: number; geometryType: string; coordinates: unknown; properties?: Record<string, unknown> }[]): Promise<DatasetFeature[]> {
    if (features.length === 0) return [];
    
    const rows = await db.insert(datasetFeatures).values(
      features.map(f => ({
        datasetId: f.datasetId,
        geometryType: f.geometryType,
        coordinates: f.coordinates,
        properties: f.properties || {},
      }))
    ).returning();
    
    // Update feature counts
    const datasetCounts = new Map<number, number>();
    features.forEach(f => {
      datasetCounts.set(f.datasetId, (datasetCounts.get(f.datasetId) || 0) + 1);
    });
    
    for (const [datasetId, count] of Array.from(datasetCounts.entries())) {
      await db.update(datasets)
        .set({ featureCount: sql`${datasets.featureCount} + ${count}` })
        .where(eq(datasets.id, datasetId));
    }
    
    return rows;
  }

  async getDatasetFeature(id: number): Promise<DatasetFeature | undefined> {
    const [row] = await db.select().from(datasetFeatures).where(eq(datasetFeatures.id, id));
    return row;
  }

  async updateDatasetFeature(id: number, updates: Partial<{ geometryType: string; coordinates: unknown; properties: Record<string, unknown> }>): Promise<DatasetFeature | undefined> {
    const updateData: Record<string, unknown> = {};
    if (updates.geometryType !== undefined) updateData.geometryType = updates.geometryType;
    if (updates.coordinates !== undefined) updateData.coordinates = updates.coordinates;
    if (updates.properties !== undefined) updateData.properties = updates.properties;
    
    const [row] = await db.update(datasetFeatures).set(updateData).where(eq(datasetFeatures.id, id)).returning();
    return row;
  }

  async deleteDatasetFeature(id: number): Promise<{ deleted: boolean; datasetId: number | null }> {
    const [feature] = await db.select().from(datasetFeatures).where(eq(datasetFeatures.id, id));
    if (!feature) return { deleted: false, datasetId: null };
    
    await db.delete(datasetFeatures).where(eq(datasetFeatures.id, id));
    await db.update(datasets)
      .set({ featureCount: sql`GREATEST(${datasets.featureCount} - 1, 0)` })
      .where(eq(datasets.id, feature.datasetId));
    
    return { deleted: true, datasetId: feature.datasetId };
  }

  async deleteDatasetFeatures(datasetId: number): Promise<boolean> {
    const result = await db.delete(datasetFeatures).where(eq(datasetFeatures.datasetId, datasetId)).returning();
    await db.update(datasets).set({ featureCount: 0 }).where(eq(datasets.id, datasetId));
    return result.length > 0;
  }

  // Scene datasets methods
  async getSceneDatasets(sceneId: number): Promise<(SceneDataset & { dataset: Dataset })[]> {
    const links = await db.select().from(sceneDatasets).where(eq(sceneDatasets.sceneId, sceneId));
    if (links.length === 0) return [];
    
    const datasetIds = links.map(l => l.datasetId);
    const datasetRows = await db.select().from(datasets).where(inArray(datasets.id, datasetIds));
    
    return links.map(link => {
      const dataset = datasetRows.find(d => d.id === link.datasetId)!;
      return { ...link, dataset };
    });
  }

  async addDatasetToScene(sceneId: number, datasetId: number, options?: Partial<{ layerName: string; color: string; opacity: number }>): Promise<SceneDataset> {
    const [row] = await db.insert(sceneDatasets).values({
      sceneId,
      datasetId,
      layerName: options?.layerName,
      color: options?.color || "#1976D2",
      opacity: options?.opacity ?? 1,
    }).returning();
    return row;
  }

  async updateSceneDataset(id: number, updates: Partial<{ layerName: string; isVisible: number; opacity: number; color: string; pointStyle: string; lineStyle: string; zIndex: number }>): Promise<SceneDataset | undefined> {
    const [row] = await db.update(sceneDatasets).set(updates).where(eq(sceneDatasets.id, id)).returning();
    return row;
  }

  async removeDatasetFromScene(id: number): Promise<boolean> {
    const result = await db.delete(sceneDatasets).where(eq(sceneDatasets.id, id)).returning();
    return result.length > 0;
  }

  // Upload methods
  async getUploads(userId?: string): Promise<Upload[]> {
    if (userId) {
      return await db.select().from(uploads).where(eq(uploads.createdBy, userId));
    }
    return await db.select().from(uploads);
  }

  async getUpload(id: number): Promise<Upload | undefined> {
    const [row] = await db.select().from(uploads).where(eq(uploads.id, id));
    return row;
  }

  async createUpload(upload: { filename: string; originalFilename: string; createdBy: string; sceneId?: number | null; color?: string | null }): Promise<Upload> {
    const [row] = await db.insert(uploads).values({
      filename: upload.filename,
      originalFilename: upload.originalFilename,
      createdBy: upload.createdBy,
      sceneId: upload.sceneId ?? null,
      color: upload.color ?? null,
    }).returning();
    return row;
  }

  async updateUpload(id: number, updates: Partial<{ status: string; error: string | null; datasetId: number | null; layerId: number | null; progress: number; totalFeatures: number | null; processedFeatures: number }>): Promise<Upload | undefined> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.error !== undefined) updateData.error = updates.error;
    if (updates.datasetId !== undefined) updateData.datasetId = updates.datasetId;
    if (updates.layerId !== undefined) updateData.layerId = updates.layerId;
    if (updates.progress !== undefined) updateData.progress = updates.progress;
    if (updates.totalFeatures !== undefined) updateData.totalFeatures = updates.totalFeatures;
    if (updates.processedFeatures !== undefined) updateData.processedFeatures = updates.processedFeatures;
    
    const [row] = await db.update(uploads).set(updateData).where(eq(uploads.id, id)).returning();
    return row;
  }

  async deleteUpload(id: number): Promise<boolean> {
    const result = await db.delete(uploads).where(eq(uploads.id, id)).returning();
    return result.length > 0;
  }

  // API Key methods
  async getApiKeys(userId: string): Promise<ApiKey[]> {
    return await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  }

  async getApiKey(id: number): Promise<ApiKey | undefined> {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
    return row;
  }

  async getApiKeyByToken(tokenHash: string): Promise<ApiKey | undefined> {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.tokenHash, tokenHash));
    return row;
  }

  async createApiKey(apiKey: { userId: string; name: string; tokenHash: string; sceneId?: number; permissions?: ApiKeyPermission[] }): Promise<ApiKey> {
    const [row] = await db.insert(apiKeys).values({
      userId: apiKey.userId,
      name: apiKey.name,
      tokenHash: apiKey.tokenHash,
      sceneId: apiKey.sceneId ?? null,
      permissions: apiKey.permissions || ["create_point"],
    }).returning();
    return row;
  }

  async updateApiKeyLastUsed(id: number): Promise<void> {
    await db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }

  async revokeApiKey(id: number): Promise<boolean> {
    const [row] = await db.update(apiKeys)
      .set({ isActive: 0 })
      .where(eq(apiKeys.id, id))
      .returning();
    return !!row;
  }

  async getCustomIcons(): Promise<CustomIcon[]> {
    return db.select().from(customIcons).orderBy(customIcons.createdAt);
  }

  async getCustomIcon(id: number): Promise<CustomIcon | undefined> {
    const [row] = await db.select().from(customIcons).where(eq(customIcons.id, id));
    return row;
  }

  async createCustomIcon(icon: { name: string; svgContent: string; category?: string; createdBy?: string }): Promise<CustomIcon> {
    const [row] = await db.insert(customIcons).values({
      name: icon.name,
      svgContent: icon.svgContent,
      category: icon.category || "custom",
      createdBy: icon.createdBy || null,
    }).returning();
    return row;
  }

  async deleteCustomIcon(id: number): Promise<boolean> {
    const [row] = await db.delete(customIcons).where(eq(customIcons.id, id)).returning();
    return !!row;
  }

  // Layer folders methods
  async getLayerFolders(sceneId: number): Promise<LayerFolder[]> {
    return db.select().from(layerFolders).where(eq(layerFolders.sceneId, sceneId)).orderBy(layerFolders.displayOrder);
  }

  async getLayerFolder(id: number): Promise<LayerFolder | undefined> {
    const [row] = await db.select().from(layerFolders).where(eq(layerFolders.id, id));
    return row;
  }

  async createLayerFolder(folder: { sceneId: number; name: string }): Promise<LayerFolder> {
    const maxOrder = await this.getMaxFolderDisplayOrder(folder.sceneId);
    const [row] = await db.insert(layerFolders).values({
      sceneId: folder.sceneId,
      name: folder.name,
      displayOrder: maxOrder + 1,
    }).returning();
    return row;
  }

  async updateLayerFolder(id: number, updates: Partial<{ name: string; visible: number }>): Promise<LayerFolder | undefined> {
    const updateData: Record<string, unknown> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.visible !== undefined) updateData.visible = updates.visible;
    
    const [row] = await db.update(layerFolders)
      .set(updateData)
      .where(eq(layerFolders.id, id))
      .returning();
    return row;
  }

  async deleteLayerFolder(id: number): Promise<boolean> {
    await db.update(editableLayers)
      .set({ folderId: null, updatedAt: new Date() })
      .where(eq(editableLayers.folderId, id));
    const result = await db.delete(layerFolders).where(eq(layerFolders.id, id)).returning();
    return result.length > 0;
  }

  async setLayerFolder(layerId: number, folderId: number | null, displayOrder?: number): Promise<EditableLayer | undefined> {
    const setData: Record<string, unknown> = { folderId, updatedAt: new Date() };
    if (displayOrder !== undefined) {
      setData.displayOrder = displayOrder;
    }
    const [row] = await db.update(editableLayers)
      .set(setData)
      .where(eq(editableLayers.id, layerId))
      .returning();
    return row ? toEditableLayer(row) : undefined;
  }

  async toggleFolderVisibility(folderId: number, visible: boolean): Promise<void> {
    await db.update(layerFolders)
      .set({ visible: visible ? 1 : 0 })
      .where(eq(layerFolders.id, folderId));
    await db.update(editableLayers)
      .set({ visible: visible ? 1 : 0, updatedAt: new Date() })
      .where(eq(editableLayers.folderId, folderId));
  }

  async reorderLayers(layerIds: number[], displayOrders?: number[]): Promise<void> {
    for (let i = 0; i < layerIds.length; i++) {
      const order = displayOrders ? displayOrders[i] : i;
      await db.update(editableLayers)
        .set({ displayOrder: order })
        .where(eq(editableLayers.id, layerIds[i]));
    }
  }

  async reorderFolders(folderIds: number[], displayOrders?: number[]): Promise<void> {
    for (let i = 0; i < folderIds.length; i++) {
      const order = displayOrders ? displayOrders[i] : i;
      await db.update(layerFolders)
        .set({ displayOrder: order })
        .where(eq(layerFolders.id, folderIds[i]));
    }
  }

  async getMaxLayerDisplayOrder(sceneId: number, folderId: number | null): Promise<number> {
    const result = await db.select({ maxOrder: sql<number>`COALESCE(MAX(${editableLayers.displayOrder}), -1)` })
      .from(editableLayers)
      .where(folderId !== null
        ? and(eq(editableLayers.sceneId, sceneId), eq(editableLayers.folderId, folderId))
        : and(eq(editableLayers.sceneId, sceneId), isNull(editableLayers.folderId))
      );
    return (result[0]?.maxOrder ?? -1);
  }

  async getMaxFolderDisplayOrder(sceneId: number): Promise<number> {
    const result = await db.select({ maxOrder: sql<number>`COALESCE(MAX(${layerFolders.displayOrder}), -1)` })
      .from(layerFolders)
      .where(eq(layerFolders.sceneId, sceneId));
    return (result[0]?.maxOrder ?? -1);
  }

  async getAppSetting(key: string): Promise<string | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value;
  }

  async setAppSetting(key: string, value: string): Promise<void> {
    await db.insert(appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  async deleteAppSetting(key: string): Promise<void> {
    await db.delete(appSettings).where(eq(appSettings.key, key));
  }

  async getBugReports(): Promise<BugReport[]> {
    return await db.select().from(bugReports).orderBy(sql`${bugReports.createdAt} DESC`);
  }

  async getBugReport(id: number): Promise<BugReport | undefined> {
    const [row] = await db.select().from(bugReports).where(eq(bugReports.id, id));
    return row;
  }

  async createBugReport(report: InsertBugReport): Promise<BugReport> {
    const [row] = await db.insert(bugReports).values(report).returning();
    return row;
  }

  async updateBugReportStatus(id: number, status: string): Promise<BugReport | undefined> {
    const [row] = await db.update(bugReports).set({ status }).where(eq(bugReports.id, id)).returning();
    return row;
  }

  async getAiProviders(): Promise<AiProvider[]> {
    return await db.select().from(aiProviders).orderBy(aiProviders.createdAt);
  }

  async getAiProvider(id: number): Promise<AiProvider | undefined> {
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, id));
    return row;
  }

  async createAiProvider(provider: InsertAiProvider): Promise<AiProvider> {
    const [row] = await db.insert(aiProviders).values(provider).returning();
    return row;
  }

  async updateAiProvider(id: number, updates: UpdateAiProvider): Promise<AiProvider | undefined> {
    const setData: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    const [row] = await db.update(aiProviders).set(setData).where(eq(aiProviders.id, id)).returning();
    return row;
  }

  async deleteAiProvider(id: number): Promise<boolean> {
    const result = await db.delete(aiProviders).where(eq(aiProviders.id, id)).returning();
    return result.length > 0;
  }

  async getDefaultAiProvider(): Promise<AiProvider | undefined> {
    const [row] = await db.select().from(aiProviders).where(and(eq(aiProviders.isDefault, true), eq(aiProviders.isActive, true)));
    if (row) return row;
    const [first] = await db.select().from(aiProviders).where(eq(aiProviders.isActive, true)).limit(1);
    return first;
  }

  async getSensorIntegrationConfig(): Promise<SensorIntegrationConfig | undefined> {
    const [row] = await db.select().from(sensorIntegrationConfig).limit(1);
    return row;
  }

  async upsertSensorIntegrationConfig(data: Partial<InsertSensorIntegrationConfig>): Promise<SensorIntegrationConfig> {
    const existing = await this.getSensorIntegrationConfig();
    if (existing) {
      const [row] = await db.update(sensorIntegrationConfig)
        .set(data)
        .where(eq(sensorIntegrationConfig.id, existing.id))
        .returning();
      return row;
    } else {
      const [row] = await db.insert(sensorIntegrationConfig)
        .values(data as InsertSensorIntegrationConfig)
        .returning();
      return row;
    }
  }

  async getSensorObjectBindings(): Promise<SensorObjectBinding[]> {
    return await db.select().from(sensorObjectBindings).orderBy(sensorObjectBindings.createdAt);
  }

  async createSensorObjectBinding(data: InsertSensorObjectBinding): Promise<SensorObjectBinding> {
    const [row] = await db.insert(sensorObjectBindings).values(data).returning();
    return row;
  }

  async updateSensorObjectBinding(id: number, data: Partial<InsertSensorObjectBinding>): Promise<SensorObjectBinding | undefined> {
    const [row] = await db.update(sensorObjectBindings).set(data).where(eq(sensorObjectBindings.id, id)).returning();
    return row;
  }

  async deleteSensorObjectBinding(id: number): Promise<boolean> {
    const result = await db.delete(sensorObjectBindings).where(eq(sensorObjectBindings.id, id)).returning();
    return result.length > 0;
  }

  async getSensorReadingsCache(): Promise<SensorReadingCache[]> {
    return await db.select().from(sensorReadingsCache).orderBy(sensorReadingsCache.nameKoteln);
  }

  async getSensorReadingByKotelnId(idCdsKoteln: number): Promise<SensorReadingCache | undefined> {
    const [row] = await db.select().from(sensorReadingsCache).where(eq(sensorReadingsCache.idCdsKoteln, idCdsKoteln));
    return row;
  }

  async upsertSensorReadingsCache(readings: InsertSensorReadingCache[]): Promise<void> {
    if (readings.length === 0) return;
    for (const reading of readings) {
      await db.insert(sensorReadingsCache)
        .values(reading)
        .onConflictDoUpdate({
          target: sensorReadingsCache.idCdsKoteln,
          set: {
            mrName: reading.mrName,
            placeName: reading.placeName,
            nameKoteln: reading.nameKoteln,
            address: reading.address,
            rsoName: reading.rsoName,
            type: reading.type,
            mkdCount: reading.mkdCount,
            mkdPeopleCount: reading.mkdPeopleCount,
            activeClaims: reading.activeClaims,
            sensorsState: reading.sensorsState,
            sensorDate: reading.sensorDate,
            tForward: reading.tForward,
            tReverse: reading.tReverse,
            pForward: reading.pForward,
            pRevers: reading.pRevers,
            responsibles: reading.responsibles,
            fetchedAt: new Date(),
          }
        });
    }
  }

  async updateSensorLastSyncAt(timestamp: Date): Promise<void> {
    const existing = await this.getSensorIntegrationConfig();
    if (existing) {
      await db.update(sensorIntegrationConfig)
        .set({ lastSyncAt: timestamp })
        .where(eq(sensorIntegrationConfig.id, existing.id));
    }
  }

  // ─── Cost Unit Rates ───────────────────────────────────────────────────────

  async getCostUnitRates(filters?: { objectType?: string; workType?: string; layingType?: string }): Promise<CostUnitRate[]> {
    let query = db.select().from(costUnitRates) as any;
    const conditions = [];
    if (filters?.objectType) conditions.push(eq(costUnitRates.objectType, filters.objectType));
    if (filters?.workType) conditions.push(eq(costUnitRates.workType, filters.workType));
    if (filters?.layingType) conditions.push(eq(costUnitRates.layingType, filters.layingType));
    if (conditions.length > 0) query = query.where(and(...conditions));
    return await query.orderBy(costUnitRates.objectType, costUnitRates.diameterMm);
  }

  async getCostUnitRate(id: number): Promise<CostUnitRate | undefined> {
    const [row] = await db.select().from(costUnitRates).where(eq(costUnitRates.id, id));
    return row;
  }

  async createCostUnitRate(data: InsertCostUnitRate): Promise<CostUnitRate> {
    const [row] = await db.insert(costUnitRates).values(data).returning();
    return row;
  }

  async updateCostUnitRate(id: number, data: Partial<InsertCostUnitRate>): Promise<CostUnitRate | undefined> {
    const [row] = await db.update(costUnitRates).set(data).where(eq(costUnitRates.id, id)).returning();
    return row;
  }

  async deleteCostUnitRate(id: number): Promise<boolean> {
    const result = await db.delete(costUnitRates).where(eq(costUnitRates.id, id)).returning();
    return result.length > 0;
  }

  async findBestUnitRate(objectType: string, workType: string, layingType?: string, diameterMm?: number, baseYear?: number): Promise<CostUnitRate | undefined> {
    const allRates = await db.select().from(costUnitRates)
      .where(and(
        eq(costUnitRates.objectType, objectType),
        eq(costUnitRates.workType, workType)
      ))
      .orderBy(costUnitRates.baseYear, costUnitRates.diameterMm);

    const targetYear = baseYear ?? new Date().getFullYear();
    // Filter by year (closest <= target)
    const yearFiltered = allRates.filter(r => r.baseYear <= targetYear);
    const ratesForYear = yearFiltered.length > 0 ? yearFiltered : allRates;

    if (objectType === 'pipe') {
      // Filter by laying type
      const layingFiltered = ratesForYear.filter(r => r.layingType === (layingType || 'underground'));
      const pool = layingFiltered.length > 0 ? layingFiltered : ratesForYear;

      if (diameterMm != null) {
        // Exact match first
        const exact = pool.find(r => r.diameterMm === diameterMm);
        if (exact) return exact;
        // Nearest larger
        const larger = pool.filter(r => r.diameterMm != null && r.diameterMm > diameterMm).sort((a, b) => (a.diameterMm! - b.diameterMm!));
        if (larger.length > 0) return larger[0];
        // Nearest smaller
        const smaller = pool.filter(r => r.diameterMm != null && r.diameterMm < diameterMm).sort((a, b) => (b.diameterMm! - a.diameterMm!));
        if (smaller.length > 0) return smaller[0];
      }
      return pool[0];
    } else {
      // ctp or source — no diameter/laying needed
      return ratesForYear[0];
    }
  }

  // ─── Reconstruction Programs ───────────────────────────────────────────────

  async getReconstructionPrograms(sceneId: number): Promise<ReconstructionProgram[]> {
    return await db.select().from(reconstructionPrograms)
      .where(eq(reconstructionPrograms.sceneId, sceneId))
      .orderBy(desc(reconstructionPrograms.createdAt));
  }

  async getReconstructionProgram(id: number): Promise<ReconstructionProgram | undefined> {
    const [row] = await db.select().from(reconstructionPrograms).where(eq(reconstructionPrograms.id, id));
    return row;
  }

  async createReconstructionProgram(data: InsertReconstructionProgram): Promise<ReconstructionProgram> {
    const [row] = await db.insert(reconstructionPrograms).values(data).returning();
    return row;
  }

  async updateReconstructionProgram(id: number, data: Partial<InsertReconstructionProgram>): Promise<ReconstructionProgram | undefined> {
    const [row] = await db.update(reconstructionPrograms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(reconstructionPrograms.id, id))
      .returning();
    return row;
  }

  async deleteReconstructionProgram(id: number): Promise<boolean> {
    await db.delete(programObjects).where(eq(programObjects.programId, id));
    const result = await db.delete(reconstructionPrograms).where(eq(reconstructionPrograms.id, id)).returning();
    return result.length > 0;
  }

  // ─── Program Objects ───────────────────────────────────────────────────────

  async getProgramObjects(programId: number): Promise<ProgramObject[]> {
    return await db.select().from(programObjects)
      .where(eq(programObjects.programId, programId))
      .orderBy(programObjects.sortOrder, programObjects.id);
  }

  async getProgramObject(id: number): Promise<ProgramObject | undefined> {
    const [row] = await db.select().from(programObjects).where(eq(programObjects.id, id));
    return row;
  }

  async createProgramObject(data: InsertProgramObject): Promise<ProgramObject> {
    const [row] = await db.insert(programObjects).values(data).returning();
    return row;
  }

  async updateProgramObject(id: number, data: Partial<InsertProgramObject>): Promise<ProgramObject | undefined> {
    const [row] = await db.update(programObjects).set(data).where(eq(programObjects.id, id)).returning();
    return row;
  }

  async deleteProgramObject(id: number): Promise<boolean> {
    const result = await db.delete(programObjects).where(eq(programObjects.id, id)).returning();
    return result.length > 0;
  }

  async deleteProgramObjects(programId: number): Promise<void> {
    await db.delete(programObjects).where(eq(programObjects.programId, programId));
  }

  async getZuluFieldLabels(): Promise<ZuluFieldLabel[]> {
    return await db.select().from(zuluFieldLabels).orderBy(zuluFieldLabels.fieldName);
  }

  async getZuluFieldLabel(id: number): Promise<ZuluFieldLabel | undefined> {
    const [row] = await db.select().from(zuluFieldLabels).where(eq(zuluFieldLabels.id, id));
    return row;
  }

  async getZuluFieldLabelByName(fieldName: string): Promise<ZuluFieldLabel | undefined> {
    const [row] = await db.select().from(zuluFieldLabels).where(eq(zuluFieldLabels.fieldName, fieldName));
    return row;
  }

  async createZuluFieldLabel(data: InsertZuluFieldLabel): Promise<ZuluFieldLabel> {
    const [row] = await db.insert(zuluFieldLabels).values(data).returning();
    return row;
  }

  async updateZuluFieldLabel(id: number, data: Partial<InsertZuluFieldLabel>): Promise<ZuluFieldLabel | undefined> {
    const [row] = await db.update(zuluFieldLabels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(zuluFieldLabels.id, id))
      .returning();
    return row;
  }

  async deleteZuluFieldLabel(id: number): Promise<boolean> {
    const result = await db.delete(zuluFieldLabels).where(eq(zuluFieldLabels.id, id)).returning();
    return result.length > 0;
  }

  async seedZuluFieldLabels(entries: { fieldName: string; label: string; category?: string }[]): Promise<void> {
    for (const entry of entries) {
      await db.insert(zuluFieldLabels)
        .values({ fieldName: entry.fieldName, label: entry.label, category: entry.category ?? null })
        .onConflictDoNothing();
    }
  }

  // Admin layer groups
  async getAdminLayerGroups(): Promise<AdminLayerGroup[]> {
    return db.select().from(adminLayerGroups).orderBy(adminLayerGroups.displayOrder);
  }

  async createAdminLayerGroup(data: { name: string; displayOrder?: number }): Promise<AdminLayerGroup> {
    const [row] = await db.insert(adminLayerGroups).values({ name: data.name, displayOrder: data.displayOrder ?? 0 }).returning();
    return row;
  }

  async updateAdminLayerGroup(id: number, updates: Partial<{ name: string; displayOrder: number }>): Promise<AdminLayerGroup | undefined> {
    const [row] = await db.update(adminLayerGroups).set(updates).where(eq(adminLayerGroups.id, id)).returning();
    return row;
  }

  async deleteAdminLayerGroup(id: number): Promise<boolean> {
    await db.update(editableLayers).set({ adminGroupId: null }).where(eq(editableLayers.adminGroupId, id));
    const result = await db.delete(adminLayerGroups).where(eq(adminLayerGroups.id, id)).returning();
    return result.length > 0;
  }

  async setLayerAdminGroup(layerName: string, geometryType: string, adminGroupId: number | null): Promise<void> {
    await db.update(editableLayers)
      .set({ adminGroupId })
      .where(and(eq(editableLayers.name, layerName), eq(editableLayers.geometryType, geometryType)));
  }

  async renameLayerGlobal(oldName: string, geometryType: string, newName: string): Promise<void> {
    await db.update(editableLayers)
      .set({ name: newName })
      .where(and(eq(editableLayers.name, oldName), eq(editableLayers.geometryType, geometryType)));
  }

  async updateLayerMetadataGlobal(name: string, geometryType: string, metadata: Record<string, unknown>): Promise<void> {
    await db.update(editableLayers)
      .set({ metadata: metadata as any })
      .where(and(eq(editableLayers.name, name), eq(editableLayers.geometryType, geometryType)));
  }
}

export const storage = new DatabaseStorage();
