import { 
  type Ticket, type InsertTicket, 
  type Facility, type InsertFacility, 
  type Trace, type InsertTrace, 
  type EditableLayer, type InsertEditableLayer, 
  type DrawnFeature, type InsertDrawnFeature, 
  type LayerSchemaDefinition, type InsertLayerSchemaDefinition, 
  type AttributeField,
  editableLayers, drawnFeatures, layerSchemas
} from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

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
}

function toEditableLayer(row: typeof editableLayers.$inferSelect): EditableLayer {
  return {
    id: row.id,
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

  async getEditableLayer(id: number): Promise<EditableLayer | undefined> {
    const [row] = await db.select().from(editableLayers).where(eq(editableLayers.id, id));
    return row ? toEditableLayer(row) : undefined;
  }

  async createEditableLayer(layer: InsertEditableLayer): Promise<EditableLayer> {
    const [row] = await db.insert(editableLayers).values({
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
}

export const storage = new DatabaseStorage();
