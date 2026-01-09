import { 
  type Ticket, type InsertTicket, 
  type Facility, type InsertFacility, 
  type Trace, type InsertTrace, 
  type EditableLayer, type InsertEditableLayer, 
  type DrawnFeature, type InsertDrawnFeature, 
  type LayerSchemaDefinition, type InsertLayerSchemaDefinition, 
  type AttributeField,
  type Scene, type InsertScene,
  type SceneMember, type InsertSceneMember,
  type Dataset, type InsertDataset,
  type DatasetFeature, type InsertDatasetFeature,
  type SceneDataset, type InsertSceneDataset,
  type Upload, type InsertUpload,
  type SceneRole,
  editableLayers, drawnFeatures, layerSchemas,
  scenes, sceneMembers, datasets, datasetFeatures, sceneDatasets, uploads
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, and, inArray } from "drizzle-orm";

export interface IStorage {
  getTickets(): Promise<Ticket[]>;
  getTicket(id: number): Promise<Ticket | undefined>;
  createTicket(ticket: InsertTicket): Promise<Ticket>;
  deleteTicket(id: number): Promise<boolean>;
  getFacilities(): Promise<Facility[]>;
  getFacility(id: number): Promise<Facility | undefined>;
  createFacility(facility: InsertFacility): Promise<Facility>;
  updateFacility(id: number, updates: Partial<InsertFacility>): Promise<Facility | undefined>;
  deleteFacility(id: number): Promise<boolean>;
  getTraces(): Promise<Trace[]>;
  getTrace(id: number): Promise<Trace | undefined>;
  getTracesByBuilding(buildingId: number): Promise<Trace[]>;
  createTrace(trace: InsertTrace): Promise<Trace>;
  deleteTrace(id: number): Promise<boolean>;
  deleteTracesByBuilding(buildingId: number): Promise<boolean>;
  getEditableLayers(): Promise<EditableLayer[]>;
  getEditableLayersByScene(sceneId: number): Promise<EditableLayer[]>;
  getEditableLayer(id: number): Promise<EditableLayer | undefined>;
  createEditableLayer(layer: InsertEditableLayer): Promise<EditableLayer>;
  updateEditableLayer(id: number, updates: Partial<InsertEditableLayer>): Promise<EditableLayer | undefined>;
  deleteEditableLayer(id: number): Promise<boolean>;
  getDrawnFeatures(layerId: number): Promise<DrawnFeature[]>;
  getDrawnFeature(id: number): Promise<DrawnFeature | undefined>;
  createDrawnFeature(feature: InsertDrawnFeature): Promise<DrawnFeature>;
  createDrawnFeaturesBatch(features: InsertDrawnFeature[]): Promise<DrawnFeature[]>;
  updateDrawnFeature(id: number, updates: Partial<InsertDrawnFeature>): Promise<DrawnFeature | undefined>;
  deleteDrawnFeature(id: number): Promise<boolean>;
  deleteDrawnFeaturesByLayer(layerId: number): Promise<boolean>;
  getLayerSchema(layerId: number): Promise<LayerSchemaDefinition | undefined>;
  createLayerSchema(schema: InsertLayerSchemaDefinition): Promise<LayerSchemaDefinition>;
  updateLayerSchema(layerId: number, fields: AttributeField[]): Promise<LayerSchemaDefinition | undefined>;
  
  // Scene methods
  getScenes(): Promise<Scene[]>;
  getScenesForUser(userId: string): Promise<(Scene & { role: SceneRole })[]>;
  getScene(id: number): Promise<Scene | undefined>;
  createScene(scene: { name: string; description?: string; createdBy: string }): Promise<Scene>;
  updateScene(id: number, updates: Partial<{ name: string; description: string }>): Promise<Scene | undefined>;
  deleteScene(id: number): Promise<boolean>;
  
  // Scene members methods
  getSceneMembers(sceneId: number): Promise<(SceneMember & { username?: string })[]>;
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
  updateUpload(id: number, updates: Partial<{ status: string; error: string | null; datasetId: number | null }>): Promise<Upload | undefined>;
  deleteUpload(id: number): Promise<boolean>;
}

function toEditableLayer(row: typeof editableLayers.$inferSelect): EditableLayer {
  return {
    id: row.id,
    sceneId: row.sceneId ?? undefined,
    name: row.name,
    geometryType: row.geometryType as EditableLayer["geometryType"],
    color: row.color,
    pointStyle: row.pointStyle as EditableLayer["pointStyle"],
    lineStyle: row.lineStyle as EditableLayer["lineStyle"],
    visible: row.visible === 1,
    opacity: row.opacity,
    featureCount: row.featureCount,
    source: row.source as EditableLayer["source"],
    sourceFileName: row.sourceFileName || undefined,
    crs: row.crs || "EPSG:4326",
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
  private facilities: Map<number, Facility> = new Map();
  private facilityIdCounter = 1;
  private traces: Map<number, Trace> = new Map();
  private traceIdCounter = 1;

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

  async getFacilities(): Promise<Facility[]> {
    return Array.from(this.facilities.values());
  }

  async getFacility(id: number): Promise<Facility | undefined> {
    return this.facilities.get(id);
  }

  async createFacility(insertFacility: InsertFacility): Promise<Facility> {
    const id = this.facilityIdCounter++;
    const facility: Facility = {
      ...insertFacility,
      id,
      createdAt: new Date().toISOString(),
    };
    this.facilities.set(id, facility);
    return facility;
  }

  async updateFacility(id: number, updates: Partial<InsertFacility>): Promise<Facility | undefined> {
    const facility = this.facilities.get(id);
    if (!facility) return undefined;
    const updatedFacility: Facility = { ...facility, ...updates };
    this.facilities.set(id, updatedFacility);
    return updatedFacility;
  }

  async deleteFacility(id: number): Promise<boolean> {
    return this.facilities.delete(id);
  }

  async getTraces(): Promise<Trace[]> {
    return Array.from(this.traces.values());
  }

  async getTrace(id: number): Promise<Trace | undefined> {
    return this.traces.get(id);
  }

  async getTracesByBuilding(buildingId: number): Promise<Trace[]> {
    return Array.from(this.traces.values()).filter(t => t.buildingId === buildingId);
  }

  async createTrace(insertTrace: InsertTrace): Promise<Trace> {
    const id = this.traceIdCounter++;
    const trace: Trace = {
      ...insertTrace,
      id,
      createdAt: new Date().toISOString(),
    };
    this.traces.set(id, trace);
    return trace;
  }

  async deleteTrace(id: number): Promise<boolean> {
    return this.traces.delete(id);
  }

  async deleteTracesByBuilding(buildingId: number): Promise<boolean> {
    const toDelete = Array.from(this.traces.values()).filter(t => t.buildingId === buildingId);
    toDelete.forEach(t => this.traces.delete(t.id));
    return toDelete.length > 0;
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
    const [row] = await db.insert(editableLayers).values({
      sceneId: layer.sceneId ?? null,
      name: layer.name,
      geometryType: layer.geometryType,
      color: layer.color || "#1976D2",
      pointStyle: layer.pointStyle || "circle",
      lineStyle: layer.lineStyle || "solid",
      visible: layer.visible !== false ? 1 : 0,
      opacity: layer.opacity ?? 1,
      featureCount: 0,
      source: layer.source || "user",
      sourceFileName: layer.sourceFileName,
      crs: layer.crs || "EPSG:4326",
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
    if (updates.crs !== undefined) updateData.crs = updates.crs;

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

  async getDrawnFeature(id: number): Promise<DrawnFeature | undefined> {
    const [row] = await db.select().from(drawnFeatures).where(eq(drawnFeatures.id, id));
    return row ? toDrawnFeature(row) : undefined;
  }

  async createDrawnFeature(feature: InsertDrawnFeature): Promise<DrawnFeature> {
    const [row] = await db.insert(drawnFeatures).values({
      layerId: feature.layerId,
      geometryType: feature.geometryType,
      coordinates: feature.coordinates,
      properties: feature.properties || {},
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
      features.map(f => ({
        layerId: f.layerId,
        geometryType: f.geometryType,
        coordinates: f.coordinates,
        properties: f.properties || {},
      }))
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
    if (updates.coordinates !== undefined) updateData.coordinates = updates.coordinates;
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

  async createScene(scene: { name: string; description?: string; createdBy: string }): Promise<Scene> {
    const [row] = await db.insert(scenes).values({
      name: scene.name,
      description: scene.description || null,
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

  async updateScene(id: number, updates: Partial<{ name: string; description: string }>): Promise<Scene | undefined> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    
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
  async getSceneMembers(sceneId: number): Promise<(SceneMember & { username?: string })[]> {
    const members = await db.select().from(sceneMembers).where(eq(sceneMembers.sceneId, sceneId));
    return members.map(m => ({ ...m, username: undefined })); // Username populated by route
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

  async createUpload(upload: { filename: string; originalFilename: string; createdBy: string }): Promise<Upload> {
    const [row] = await db.insert(uploads).values({
      filename: upload.filename,
      originalFilename: upload.originalFilename,
      createdBy: upload.createdBy,
    }).returning();
    return row;
  }

  async updateUpload(id: number, updates: Partial<{ status: string; error: string | null; datasetId: number | null }>): Promise<Upload | undefined> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.error !== undefined) updateData.error = updates.error;
    if (updates.datasetId !== undefined) updateData.datasetId = updates.datasetId;
    
    const [row] = await db.update(uploads).set(updateData).where(eq(uploads.id, id)).returning();
    return row;
  }

  async deleteUpload(id: number): Promise<boolean> {
    const result = await db.delete(uploads).where(eq(uploads.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
