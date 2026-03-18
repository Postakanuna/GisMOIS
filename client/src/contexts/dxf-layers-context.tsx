import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { DxfFeature, DxfLayerInfo } from '@/lib/dxf-parser-util';
import { filterFeaturesByLayers } from '@/lib/dxf-parser-util';

export interface DxfSurveyLayer {
  id: string;
  name: string;
  crs: string;
  color: string;
  opacity: number;
  visible: boolean;
  selectedLayers: string[];
  allLayers: DxfLayerInfo[];
  allFeatures: DxfFeature[];
  features: DxfFeature[];
  featureCount: number;
  createdAt: string;
}

interface DxfLayersContextValue {
  surveyLayers: DxfSurveyLayer[];
  addSurveyLayer: (layer: Omit<DxfSurveyLayer, 'id' | 'createdAt' | 'features' | 'featureCount'>) => void;
  removeSurveyLayer: (id: string) => void;
  toggleSurveyLayerVisibility: (id: string) => void;
  setSurveyLayerOpacity: (id: string, opacity: number) => void;
  updateSurveyLayerSelectedLayers: (id: string, selectedLayers: string[]) => void;
}

const DxfLayersContext = createContext<DxfLayersContextValue | null>(null);

export function DxfLayersProvider({ children }: { children: ReactNode }) {
  const [surveyLayers, setSurveyLayers] = useState<DxfSurveyLayer[]>([]);

  const addSurveyLayer = useCallback((layer: Omit<DxfSurveyLayer, 'id' | 'createdAt' | 'features' | 'featureCount'>) => {
    const id = `dxf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const features = filterFeaturesByLayers(layer.allFeatures, layer.selectedLayers);
    setSurveyLayers(prev => [
      ...prev,
      {
        ...layer,
        id,
        features,
        featureCount: features.length,
        createdAt: new Date().toLocaleDateString('ru-RU'),
      },
    ]);
  }, []);

  const removeSurveyLayer = useCallback((id: string) => {
    setSurveyLayers(prev => prev.filter(l => l.id !== id));
  }, []);

  const toggleSurveyLayerVisibility = useCallback((id: string) => {
    setSurveyLayers(prev =>
      prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l)
    );
  }, []);

  const setSurveyLayerOpacity = useCallback((id: string, opacity: number) => {
    setSurveyLayers(prev =>
      prev.map(l => l.id === id ? { ...l, opacity } : l)
    );
  }, []);

  const updateSurveyLayerSelectedLayers = useCallback((id: string, selectedLayers: string[]) => {
    setSurveyLayers(prev =>
      prev.map(l => {
        if (l.id !== id) return l;
        const features = filterFeaturesByLayers(l.allFeatures, selectedLayers);
        return { ...l, selectedLayers, features, featureCount: features.length };
      })
    );
  }, []);

  return (
    <DxfLayersContext.Provider
      value={{
        surveyLayers,
        addSurveyLayer,
        removeSurveyLayer,
        toggleSurveyLayerVisibility,
        setSurveyLayerOpacity,
        updateSurveyLayerSelectedLayers,
      }}
    >
      {children}
    </DxfLayersContext.Provider>
  );
}

export function useDxfLayers() {
  const ctx = useContext(DxfLayersContext);
  if (!ctx) throw new Error('useDxfLayers must be used within DxfLayersProvider');
  return ctx;
}
