import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { ZuluConnection, ConnectionStatus, LayerConfig, Ticket, InsertTicket, EditableLayer, AttributeField, ZwsConnectionConfig } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface LayerFilters {
  name_rso: Set<string>;
  muniz_obr: Set<string>;
}

export interface ActiveFilters {
  name_rso: string[];
  muniz_obr: string[];
}

export interface ZwsSession {
  id: number;
  displayName: string;
  baseUrl: string;
  username?: string;
  password?: string;
  layers: EditableLayer[];
  status: ConnectionStatus;
}

interface UseZuluConnectionReturn {
  connection: ZuluConnection | null;
  status: ConnectionStatus;
  layers: LayerConfig[];
  error: string | null;
  connect: (config: ZuluConnection) => Promise<void>;
  connectZws: () => Promise<void>;
  connectCustomZws: (config: ZuluConnection) => Promise<void>;
  disconnect: () => void;
  toggleLayerVisibility: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  getWmsUrl: () => string | null;
  layerFilters: Record<string, LayerFilters>;
  activeFilters: Record<string, ActiveFilters>;
  setLayerFilters: (layerId: string, filters: LayerFilters) => void;
  toggleFilter: (layerId: string, filterType: keyof ActiveFilters, value: string) => void;
  tickets: Ticket[];
  ticketMode: boolean;
  setTicketMode: (mode: boolean) => void;
  createTicket: (ticket: InsertTicket) => Promise<Ticket>;
  loadTickets: () => Promise<void>;
  handleLayerLoadError: (error: string) => void;
  handleLayerLoadSuccess: () => void;
  zwsSessions: ZwsSession[];
  savedZwsConnections: ZwsConnectionConfig[];
  loadSavedZwsConnections: () => Promise<void>;
  connectSavedZws: (connId: number) => Promise<void>;
  disconnectZwsSession: (sessionId: number) => void;
  refreshZwsSession: (sessionId: number) => Promise<void>;
  deleteZwsConnection: (connId: number) => Promise<void>;
  zwsEditableLayers: EditableLayer[];
  updateZwsLayerStyle: (layerId: number, updates: Partial<EditableLayer>) => void;
  toggleZwsLayerVisibility: (layerId: number) => void;
}

// Default OSM base layer that is always available
const DEFAULT_OSM_LAYER: LayerConfig = {
  id: "osm-base",
  name: "OpenStreetMap",
  visible: true,
  opacity: 1,
  type: "base",
};

async function fetchZwsLayerSchema(baseUrl: string, layerName: string, username?: string, password?: string): Promise<{ fields: AttributeField[]; geometryType: string }> {
  try {
    const res = await fetch("/api/zulu/zws/layer-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layer: layerName, baseUrl, zwsUsername: username, zwsPassword: password }),
    });
    if (!res.ok) return { fields: [], geometryType: "Point" };
    const data = await res.json();
    const fields: AttributeField[] = (data.fields || []).map((f: any) => ({
      name: f.name || f.Name,
      type: mapZwsFieldType(f.type || f.Type || "string"),
      required: false,
    }));
    const gt = guessGeometryType(data.layerType);
    return { fields, geometryType: gt };
  } catch {
    return { fields: [], geometryType: "Point" };
  }
}

function mapZwsFieldType(t: string): "text" | "number" | "date" | "boolean" {
  const tl = (t || "").toLowerCase();
  if (tl.includes("int") || tl.includes("float") || tl.includes("double") || tl.includes("numeric") || tl.includes("real")) return "number";
  if (tl.includes("date") || tl.includes("time")) return "date";
  if (tl.includes("bool")) return "boolean";
  return "text";
}

function guessGeometryType(layerType?: string | number): "Point" | "LineString" | "Polygon" {
  const t = String(layerType || "").toLowerCase();
  if (t.includes("line") || t.includes("polyline") || t === "1") return "LineString";
  if (t.includes("polygon") || t.includes("area") || t === "2") return "Polygon";
  return "Point";
}

let nextZwsLayerId = -1000;
function getNextZwsLayerId(): number {
  return nextZwsLayerId--;
}

export function useZuluConnection(sceneId?: number | null): UseZuluConnectionReturn {
  const [connection, setConnection] = useState<ZuluConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [layers, setLayers] = useState<LayerConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [layerFilters, setLayerFiltersState] = useState<Record<string, LayerFilters>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, ActiveFilters>>({});
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketMode, setTicketMode] = useState(false);
  const [zwsSessions, setZwsSessions] = useState<ZwsSession[]>([]);
  const [savedZwsConnections, setSavedZwsConnections] = useState<ZwsConnectionConfig[]>([]);
  const initLoadedRef = useRef(false);
  const prevSceneIdRef = useRef<number | null | undefined>(sceneId);

  const connect = useCallback(async (config: ZuluConnection) => {
    setStatus("connecting");
    setError(null);

    try {
      const response = await fetch("/api/zulu/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to connect to ZuluServer");
      }

      const data = await response.json();

      setLayers(
        data.layers.map((layer: { name: string; title: string }) => ({
          id: layer.name,
          name: layer.title || layer.name,
          visible: true,
          opacity: 1,
          type: config.useWfs ? "wfs" : "wms" as const,
          url: `http://${config.host}:${config.port}/ZuluServer/wms`,
        }))
      );
      setConnection(config);
      setStatus("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStatus("error");
    }
  }, []);

  const connectZws = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    try {
      const response = await fetch("/api/zulu/zws/layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Не удалось подключиться к ZWS серверу");
      }

      const data = await response.json();

      const zwsConnection: ZuluConnection = {
        host: "is.arki.mosreg.ru",
        layerName: "mosgaz",
        useWfs: false,
        useZws: true,
        baseUrl: "https://is.arki.mosreg.ru/zws",
      };

      setLayers(
        data.layers.map((layer: { name: string; title: string }) => ({
          id: layer.name,
          name: layer.title || layer.name,
          visible: true,
          opacity: 1,
          type: "zws" as const,
          url: zwsConnection.baseUrl,
        }))
      );
      setConnection(zwsConnection);
      // Stay in "connecting" until layers actually load
      setStatus("connecting");
      
      // Load tickets after successful connection
      try {
        const ticketsResponse = await fetch("/api/tickets");
        if (ticketsResponse.ok) {
          const ticketsData = await ticketsResponse.json();
          setTickets(ticketsData);
        }
      } catch (ticketErr) {
        console.warn("Failed to load tickets:", ticketErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка подключения к ZWS");
      setStatus("error");
    }
  }, []);

  const buildZwsEditableLayer = useCallback((connId: number, layerName: string, baseUrl: string, username?: string, password?: string, schema?: { fields: AttributeField[]; geometryType: string }): EditableLayer => {
    const now = new Date().toISOString();
    return {
      id: getNextZwsLayerId(),
      name: layerName,
      geometryType: (schema?.geometryType || "Point") as any,
      color: "#4CAF50",
      pointStyle: "circle",
      lineStyle: "solid",
      visible: true,
      opacity: 1,
      featureCount: 0,
      displayOrder: 0,
      source: "zws",
      crs: "EPSG:4326",
      zwsLayerName: layerName,
      zwsBaseUrl: baseUrl,
      zwsUsername: username,
      zwsPassword: password,
      zwsConnectionId: connId,
      attributeFields: schema?.fields || [],
      createdAt: now,
      updatedAt: now,
    };
  }, []);

  const connectCustomZws = useCallback(async (config: ZuluConnection) => {
    setStatus("connecting");
    setError(null);

    try {
      const response = await fetch("/api/zulu/zws/custom/layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          layerNames: config.layerName,
          username: config.username || undefined,
          password: config.password || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Не удалось подключиться к ZWS серверу");
      }

      const data = await response.json();
      const layerList: { name: string; title: string }[] = data.layers || [];

      setLayers(
        layerList.map((layer) => ({
          id: layer.name,
          name: layer.title || layer.name,
          visible: true,
          opacity: 1,
          type: "zws" as const,
          url: config.baseUrl,
          zwsUsername: config.username || undefined,
          zwsPassword: config.password || undefined,
        }))
      );
      setConnection(config);
      setStatus("connecting");

      try {
        const hostname = config.baseUrl ? new URL(config.baseUrl).hostname : "ZWS";
        const saveRes = await apiRequest("POST", "/api/zws-connections", {
          displayName: `ZWS: ${hostname}`,
          baseUrl: config.baseUrl || "",
          username: config.username || null,
          passwordEncrypted: config.password || null,
          selectedLayers: layerList.map(l => ({ layerName: l.name })),
          sceneId: sceneId ?? null,
        });
        const savedConn = await saveRes.json();

        const sessionLayers: EditableLayer[] = layerList.map(l =>
          buildZwsEditableLayer(savedConn.id, l.title || l.name, config.baseUrl || "", config.username, config.password)
        );

        const session: ZwsSession = {
          id: savedConn.id,
          displayName: savedConn.displayName,
          baseUrl: config.baseUrl || "",
          username: config.username,
          password: config.password,
          layers: sessionLayers,
          status: "connected",
        };
        setZwsSessions(prev => [...prev, session]);
        setSavedZwsConnections(prev => [...prev, savedConn]);
      } catch (saveErr) {
        console.warn("Failed to save ZWS connection:", saveErr);
      }
      
      try {
        const ticketsResponse = await fetch("/api/tickets");
        if (ticketsResponse.ok) {
          const ticketsData = await ticketsResponse.json();
          setTickets(ticketsData);
        }
      } catch (ticketErr) {
        console.warn("Failed to load tickets:", ticketErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка подключения к ZWS");
      setStatus("error");
    }
  }, [buildZwsEditableLayer]);

  const disconnect = useCallback(() => {
    setConnection(null);
    setLayers([]);
    setStatus("disconnected");
    setError(null);
  }, []);

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
      )
    );
  }, []);

  const setLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, opacity } : layer
      )
    );
  }, []);

  const getWmsUrl = useCallback(() => {
    if (!connection) return null;
    if (connection.useZws) {
      return connection.baseUrl || "https://is.arki.mosreg.ru/zws";
    }
    return `http://${connection.host}:${connection.port}/ZuluServer/wms`;
  }, [connection]);

  const setLayerFilters = useCallback((layerId: string, filters: LayerFilters) => {
    setLayerFiltersState((prev) => ({
      ...prev,
      [layerId]: filters,
    }));
    // Initialize active filters with all values selected
    setActiveFilters((prev) => ({
      ...prev,
      [layerId]: {
        name_rso: Array.from(filters.name_rso),
        muniz_obr: Array.from(filters.muniz_obr),
      },
    }));
  }, []);

  const toggleFilter = useCallback((layerId: string, filterType: keyof ActiveFilters, value: string) => {
    setActiveFilters((prev) => {
      const current = prev[layerId] || { name_rso: [], muniz_obr: [] };
      const currentValues = current[filterType];
      const newValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      
      return {
        ...prev,
        [layerId]: {
          ...current,
          [filterType]: newValues,
        },
      };
    });
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      const response = await fetch("/api/tickets");
      if (response.ok) {
        const data = await response.json();
        setTickets(data);
      }
    } catch (err) {
      console.error("Failed to load tickets:", err);
    }
  }, []);

  const createTicket = useCallback(async (ticketData: InsertTicket): Promise<Ticket> => {
    const response = await apiRequest("POST", "/api/tickets", ticketData);
    const newTicket = await response.json();
    setTickets((prev) => [...prev, newTicket]);
    queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    return newTicket;
  }, []);

  const handleLayerLoadError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setStatus("error");
  }, []);

  const handleLayerLoadSuccess = useCallback(() => {
    setStatus((prev) => prev === "connecting" ? "connected" : prev);
    setError(null);
  }, []);

  const loadSavedZwsConnections = useCallback(async () => {
    try {
      const url = sceneId != null ? `/api/zws-connections?sceneId=${sceneId}` : "/api/zws-connections";
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setSavedZwsConnections(data);
    } catch {
    }
  }, [sceneId]);

  const connectSavedZws = useCallback(async (connId: number) => {
    const saved = savedZwsConnections.find(c => c.id === connId);
    if (!saved) return;

    const existingSession = zwsSessions.find(s => s.id === connId);
    if (existingSession) return;

    const sessionLayers: EditableLayer[] = (saved.selectedLayers || []).map(sl =>
      buildZwsEditableLayer(connId, sl.alias || sl.layerName, saved.baseUrl, saved.username || undefined, saved.passwordEncrypted || undefined)
    );

    const session: ZwsSession = {
      id: connId,
      displayName: saved.displayName,
      baseUrl: saved.baseUrl,
      username: saved.username || undefined,
      password: saved.passwordEncrypted || undefined,
      layers: sessionLayers,
      status: "connected",
    };

    setZwsSessions(prev => [...prev, session]);

    setLayers(prev => {
      const newLayers = sessionLayers.map(sl => ({
        id: `${connId}:${sl.zwsLayerName}`,
        name: sl.name,
        visible: true,
        opacity: 1,
        type: "zws" as const,
        url: saved.baseUrl,
        zwsUsername: saved.username || undefined,
        zwsPassword: saved.passwordEncrypted || undefined,
      }));
      return [...prev, ...newLayers];
    });

    if (!connection) {
      setConnection({
        host: new URL(saved.baseUrl).hostname,
        layerName: "",
        useWfs: false,
        useZws: true,
        baseUrl: saved.baseUrl,
        username: saved.username || undefined,
        password: saved.passwordEncrypted || undefined,
      });
      setStatus("connected");
    } else {
      setStatus("connected");
    }
  }, [savedZwsConnections, zwsSessions, connection, buildZwsEditableLayer]);

  const disconnectZwsSession = useCallback((sessionId: number) => {
    const session = zwsSessions.find(s => s.id === sessionId);
    setZwsSessions(prev => prev.filter(s => s.id !== sessionId));
    if (session) {
      const zwsLayerNames = new Set(session.layers.map(l => l.zwsLayerName).filter(Boolean));
      setLayers(prev => prev.filter(l => {
        if (l.type !== "zws") return true;
        // Match both ID formats: "layerName" (fresh connect) and "connId:layerName" (saved connect)
        return !zwsLayerNames.has(l.id) && !zwsLayerNames.has(l.id.replace(/^\d+:/, ""));
      }));
    }
    if (zwsSessions.length <= 1) {
      setConnection(null);
      setStatus("disconnected");
    }
  }, [zwsSessions]);

  const refreshZwsSession = useCallback(async (sessionId: number) => {
    const session = zwsSessions.find(s => s.id === sessionId);
    if (!session) return;
    window.dispatchEvent(new CustomEvent("zws-refresh", { detail: { sessionId } }));
  }, [zwsSessions]);

  const deleteZwsConnectionCb = useCallback(async (connId: number) => {
    try {
      await apiRequest("DELETE", `/api/zws-connections/${connId}`);
      setSavedZwsConnections(prev => prev.filter(c => c.id !== connId));
      disconnectZwsSession(connId);
    } catch {
    }
  }, [disconnectZwsSession]);

  const updateZwsLayerStyle = useCallback((layerId: number, updates: Partial<EditableLayer>) => {
    setZwsSessions(prev => prev.map(session => ({
      ...session,
      layers: session.layers.map(l => l.id === layerId ? { ...l, ...updates } : l),
    })));
    window.dispatchEvent(new Event("viewport-features-invalidate"));
  }, []);

  const toggleZwsLayerVisibility = useCallback((layerId: number) => {
    setZwsSessions(prev => prev.map(session => ({
      ...session,
      layers: session.layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l),
    })));
  }, []);

  const zwsEditableLayers = useMemo(() => zwsSessions.flatMap(s => s.layers), [zwsSessions]);

  // Reset ZWS state when the active scene changes
  useEffect(() => {
    const prevSceneId = prevSceneIdRef.current;
    prevSceneIdRef.current = sceneId;
    if (prevSceneId === sceneId) return;
    // Scene changed: clear all active ZWS sessions and reload for the new scene
    setZwsSessions([]);
    setSavedZwsConnections([]);
    setConnection(null);
    setStatus("disconnected");
    setError(null);
    setLayers([]);
    initLoadedRef.current = false;
  }, [sceneId]);

  useEffect(() => {
    if (!initLoadedRef.current) {
      initLoadedRef.current = true;
      loadSavedZwsConnections();
    }
  }, [loadSavedZwsConnections]);

  return {
    connection,
    status,
    layers,
    error,
    connect,
    connectZws,
    connectCustomZws,
    disconnect,
    toggleLayerVisibility,
    setLayerOpacity,
    getWmsUrl,
    layerFilters,
    activeFilters,
    setLayerFilters,
    toggleFilter,
    tickets,
    ticketMode,
    setTicketMode,
    createTicket,
    loadTickets,
    handleLayerLoadError,
    handleLayerLoadSuccess,
    zwsSessions,
    savedZwsConnections,
    loadSavedZwsConnections,
    connectSavedZws,
    disconnectZwsSession,
    refreshZwsSession,
    deleteZwsConnection: deleteZwsConnectionCb,
    zwsEditableLayers,
    updateZwsLayerStyle,
    toggleZwsLayerVisibility,
  };
}
