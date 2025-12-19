import { useState, useCallback } from "react";
import type { ZuluConnection, ConnectionStatus, LayerConfig } from "@shared/schema";

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
}

export function useZuluConnection(): UseZuluConnectionReturn {
  const [connection, setConnection] = useState<ZuluConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [layers, setLayers] = useState<LayerConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      const newLayers: LayerConfig[] = [
        {
          id: "osm-base",
          name: "OpenStreetMap (Base)",
          visible: true,
          opacity: 1,
          type: "base",
        },
        ...data.layers.map((layer: { name: string; title: string }) => ({
          id: layer.name,
          name: layer.title || layer.name,
          visible: true,
          opacity: 1,
          type: config.useWfs ? "wfs" : "wms" as const,
          url: `http://${config.host}:${config.port}/ZuluServer/wms`,
        })),
      ];

      setLayers(newLayers);
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

      const newLayers: LayerConfig[] = [
        {
          id: "osm-base",
          name: "OpenStreetMap (Базовая карта)",
          visible: true,
          opacity: 1,
          type: "base",
        },
        ...data.layers.map((layer: { name: string; title: string }) => ({
          id: layer.name,
          name: layer.title || layer.name,
          visible: true,
          opacity: 1,
          type: "wms" as const,
        })),
      ];

      const zwsConnection: ZuluConnection = {
        host: "is.arki.mosreg.ru",
        layerName: "mosgaz",
        useWfs: false,
        useZws: true,
        baseUrl: "https://is.arki.mosreg.ru/zws",
      };

      setLayers(newLayers);
      setConnection(zwsConnection);
      setStatus("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка подключения к ZWS");
      setStatus("error");
    }
  }, []);

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
      return "https://is.arki.mosreg.ru/zws";
    }
    return `http://${connection.host}:${connection.port}/ZuluServer/wms`;
  }, [connection]);

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
  };
}
