import { type User, type InsertUser, type Ticket, type InsertTicket, type Facility, type InsertFacility, type Trace, type InsertTrace, type UploadedLayer, type InsertUploadedLayer } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
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
  getUploadedLayers(): Promise<UploadedLayer[]>;
  getUploadedLayer(id: number): Promise<UploadedLayer | undefined>;
  createUploadedLayer(layer: InsertUploadedLayer): Promise<UploadedLayer>;
  createUploadedLayersBatch(layers: InsertUploadedLayer[]): Promise<UploadedLayer[]>;
  updateUploadedLayer(id: number, updates: Partial<InsertUploadedLayer>): Promise<UploadedLayer | undefined>;
  deleteUploadedLayer(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private tickets: Map<number, Ticket>;
  private ticketIdCounter: number;
  private facilities: Map<number, Facility>;
  private facilityIdCounter: number;
  private traces: Map<number, Trace>;
  private traceIdCounter: number;
  private uploadedLayers: Map<number, UploadedLayer>;
  private uploadedLayerIdCounter: number;

  constructor() {
    this.users = new Map();
    this.tickets = new Map();
    this.ticketIdCounter = 1;
    this.facilities = new Map();
    this.facilityIdCounter = 1;
    this.traces = new Map();
    this.traceIdCounter = 1;
    this.uploadedLayers = new Map();
    this.uploadedLayerIdCounter = 1;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

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
    
    const updatedFacility: Facility = {
      ...facility,
      ...updates,
    };
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
    return Array.from(this.traces.values()).filter(
      (trace) => trace.buildingId === buildingId
    );
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
    const tracesToDelete = Array.from(this.traces.values()).filter(
      (trace) => trace.buildingId === buildingId
    );
    tracesToDelete.forEach((trace) => this.traces.delete(trace.id));
    return tracesToDelete.length > 0;
  }

  async getUploadedLayers(): Promise<UploadedLayer[]> {
    return Array.from(this.uploadedLayers.values());
  }

  async getUploadedLayer(id: number): Promise<UploadedLayer | undefined> {
    return this.uploadedLayers.get(id);
  }

  async createUploadedLayer(insertLayer: InsertUploadedLayer): Promise<UploadedLayer> {
    const id = this.uploadedLayerIdCounter++;
    const layer: UploadedLayer = {
      ...insertLayer,
      id,
      createdAt: new Date().toISOString(),
    };
    this.uploadedLayers.set(id, layer);
    return layer;
  }

  async createUploadedLayersBatch(insertLayers: InsertUploadedLayer[]): Promise<UploadedLayer[]> {
    const createdLayers: UploadedLayer[] = [];
    for (const insertLayer of insertLayers) {
      const id = this.uploadedLayerIdCounter++;
      const layer: UploadedLayer = {
        ...insertLayer,
        id,
        createdAt: new Date().toISOString(),
      };
      this.uploadedLayers.set(id, layer);
      createdLayers.push(layer);
    }
    return createdLayers;
  }

  async updateUploadedLayer(id: number, updates: Partial<InsertUploadedLayer>): Promise<UploadedLayer | undefined> {
    const layer = this.uploadedLayers.get(id);
    if (!layer) return undefined;
    
    const updatedLayer: UploadedLayer = {
      ...layer,
      ...updates,
    };
    this.uploadedLayers.set(id, updatedLayer);
    return updatedLayer;
  }

  async deleteUploadedLayer(id: number): Promise<boolean> {
    return this.uploadedLayers.delete(id);
  }
}

export const storage = new MemStorage();
