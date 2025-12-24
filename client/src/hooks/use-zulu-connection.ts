import { useState, useCallback } from "react";
import type { ZuluConnection, ConnectionStatus, LayerConfig, Ticket, InsertTicket } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface LayerFilters {
  name_rso: Set<string>;
  muniz_obr: Set<string>;
}

export interface ActiveFilters {
  name_rso: string[];
  muniz_obr: string[];
}

interface UseZuluConnectionReturn {
  connection: ZuluConnection | null;
  status: ConnectionStatus;
  layers: LayerConfig[];
  error: string | null;
  connect: (config: ZuluConnection) => Promise<void>;
  connectZws: () => Promise<void>;
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
}

// Default OSM base layer that is always available
const DEFAULT_OSM_LAYER: LayerConfig = {
  id: "osm-base",
  name: "OpenStreetMap",
  visible: true,
  opacity: 1,
  type: "base",
};

export function useZuluConnection(): UseZuluConnectionReturn {
  const [connection, setConnection] = useState<ZuluConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [layers, setLayers] = useState<LayerConfig[]>([DEFAULT_OSM_LAYER]);
  const [error, setError] = useState<string | null>(null);
  const [layerFilters, setLayerFiltersState] = useState<Record<string, LayerFilters>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, ActiveFilters>>({});
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketMode, setTicketMode] = useState(false);

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

      setLayers((prev) => {
        // Preserve current OSM layer state
        const currentOsm = prev.find(l => l.id === "osm-base");
        return [
          currentOsm || DEFAULT_OSM_LAYER,
          ...data.layers.map((layer: { name: string; title: string }) => ({
            id: layer.name,
            name: layer.title || layer.name,
            visible: true,
            opacity: 1,
            type: config.useWfs ? "wfs" : "wms" as const,
            url: `http://${config.host}:${config.port}/ZuluServer/wms`,
          })),
        ];
      });
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

      setLayers((prev) => {
        // Preserve current OSM layer state
        const currentOsm = prev.find(l => l.id === "osm-base");
        return [
          currentOsm || DEFAULT_OSM_LAYER,
          ...data.layers.map((layer: { name: string; title: string }) => ({
            id: layer.name,
            name: layer.title || layer.name,
            visible: true,
            opacity: 1,
            type: "wms" as const,
          })),
        ];
      });
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

  const disconnect = useCallback(() => {
    setConnection(null);
    // Keep only the OSM base layer with its current visibility/opacity
    setLayers((prev) => {
      const osmLayer = prev.find(l => l.id === "osm-base");
      return osmLayer ? [osmLayer] : [DEFAULT_OSM_LAYER];
    });
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
      return "https://is.arki.mosreg.ru/zws";
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
    // Only set connected if we're still in connecting state
    setStatus((prev) => prev === "connecting" ? "connected" : prev);
    setError(null);
  }, []);

  return {
    connection,
    status,
    layers,
    error,
    connect,
    connectZws,
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
  };
}
