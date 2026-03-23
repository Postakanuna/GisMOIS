import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type BaseLayerType = "osm" | "yandex-map" | "yandex-satellite" | "none";

export interface BaseLayerConfig {
  id: BaseLayerType;
  name: string;
  visible: boolean;
}

interface BaseLayersContextType {
  baseLayers: BaseLayerConfig[];
  activeBaseLayer: BaseLayerType;
  setActiveBaseLayer: (layerId: BaseLayerType) => void;
  baseLayerOpacity: number;
  setBaseLayerOpacity: (opacity: number) => void;
}

const defaultBaseLayers: BaseLayerConfig[] = [
  { id: "osm", name: "OpenStreetMap", visible: false },
  { id: "yandex-map", name: "Яндекс Карта", visible: true },
  { id: "yandex-satellite", name: "Яндекс Спутник", visible: false },
  { id: "none", name: "Без подложки", visible: false },
];

const BaseLayersContext = createContext<BaseLayersContextType | null>(null);

export function BaseLayersProvider({ children }: { children: ReactNode }) {
  const [activeBaseLayer, setActiveBaseLayerState] = useState<BaseLayerType>("yandex-map");
  const [baseLayerOpacity, setBaseLayerOpacityState] = useState<number>(1);

  const baseLayers = defaultBaseLayers.map(layer => ({
    ...layer,
    visible: layer.id === activeBaseLayer,
  }));

  const setActiveBaseLayer = useCallback((layerId: BaseLayerType) => {
    setActiveBaseLayerState(layerId);
  }, []);

  const setBaseLayerOpacity = useCallback((opacity: number) => {
    setBaseLayerOpacityState(opacity);
  }, []);

  return (
    <BaseLayersContext.Provider
      value={{
        baseLayers,
        activeBaseLayer,
        setActiveBaseLayer,
        baseLayerOpacity,
        setBaseLayerOpacity,
      }}
    >
      {children}
    </BaseLayersContext.Provider>
  );
}

export function useBaseLayers() {
  const context = useContext(BaseLayersContext);
  if (!context) {
    throw new Error("useBaseLayers must be used within a BaseLayersProvider");
  }
  return context;
}
