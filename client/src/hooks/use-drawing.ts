import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/contexts/scene-context";
import type { 
  EditableLayer, 
  InsertEditableLayer, 
  DrawnFeature, 
  InsertDrawnFeature,
  LayerSchemaDefinition,
  AttributeField,
  GeometryType,
} from "@shared/schema";
import type { DrawingMode } from "@/components/drawing-toolbar";

interface UndoAction {
  type: "create" | "update" | "delete";
  featureId: number;
  layerId: number;
  previousData?: DrawnFeature;
  newData?: InsertDrawnFeature;
}

export function useDrawing() {
  const { toast } = useToast();
  const { currentSceneId } = useScene();
  
  // State
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("select");
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([]);
  
  // Undo/redo stacks
  const undoStack = useRef<UndoAction[]>([]);
  const redoStack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Queries - load editable layers for current scene
  const { data: editableLayers = [], isLoading: layersLoading } = useQuery<EditableLayer[]>({
    queryKey: ["/api/scenes", currentSceneId, "editable-layers"],
    enabled: !!currentSceneId,
  });

  const activeLayer = editableLayers.find(l => l.id === activeLayerId) || null;

  const { data: features = [], isLoading: featuresLoading } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", activeLayerId, "features"],
    enabled: activeLayerId !== null,
  });

  const { data: layerSchema } = useQuery<LayerSchemaDefinition>({
    queryKey: ["/api/editable-layers", activeLayerId, "schema"],
    enabled: activeLayerId !== null,
  });

  // Mutations
  const createLayerMutation = useMutation({
    mutationFn: async (layer: InsertEditableLayer) => {
      // Attach layer to current scene
      const layerWithScene = { ...layer, sceneId: currentSceneId };
      const res = await apiRequest("POST", "/api/editable-layers", layerWithScene);
      return res.json();
    },
    onSuccess: (newLayer: EditableLayer) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      setActiveLayerId(newLayer.id);
      toast({
        title: "Слой создан",
        description: `Слой "${newLayer.name}" готов к редактированию`,
      });
    },
  });

  const updateLayerMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertEditableLayer>) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
    },
  });

  const deleteLayerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/editable-layers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      if (activeLayerId === activeLayerId) {
        setActiveLayerId(null);
      }
      toast({
        title: "Слой удалён",
      });
    },
  });

  const createFeatureMutation = useMutation({
    mutationFn: async (feature: InsertDrawnFeature) => {
      const res = await apiRequest("POST", `/api/editable-layers/${feature.layerId}/features`, feature);
      return res.json();
    },
    onSuccess: (newFeature: DrawnFeature) => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers/viewport-features"] });
      
      // Add to undo stack
      undoStack.current.push({
        type: "create",
        featureId: newFeature.id,
        layerId: newFeature.layerId,
        newData: {
          layerId: newFeature.layerId,
          geometryType: newFeature.geometryType as GeometryType,
          coordinates: newFeature.coordinates,
          properties: newFeature.properties,
        },
      });
      redoStack.current = [];
      setCanUndo(true);
      setCanRedo(false);
    },
  });

  const updateFeatureMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertDrawnFeature>) => {
      const res = await apiRequest("PATCH", `/api/features/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers/viewport-features"] });
    },
  });

  const deleteFeatureMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/features/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers/viewport-features"] });
    },
  });

  const updateSchemaMutation = useMutation({
    mutationFn: async ({ layerId, fields }: { layerId: number; fields: AttributeField[] }) => {
      const res = await apiRequest("PUT", `/api/editable-layers/${layerId}/schema`, { fields });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "schema"] });
      toast({
        title: "Схема сохранена",
      });
    },
  });

  // Actions
  const selectLayer = useCallback((layer: EditableLayer) => {
    setActiveLayerId(layer.id);
    setSelectedFeatureIds([]);
  }, []);

  const createLayer = useCallback((layer: InsertEditableLayer) => {
    createLayerMutation.mutate(layer);
  }, [createLayerMutation]);

  const createFeature = useCallback((
    geometryType: GeometryType,
    coordinates: unknown,
    properties: Record<string, unknown> = {}
  ) => {
    if (!activeLayerId) return;
    
    createFeatureMutation.mutate({
      layerId: activeLayerId,
      geometryType,
      coordinates,
      properties,
    });
  }, [activeLayerId, createFeatureMutation]);

  const updateFeature = useCallback((featureId: number, updates: Partial<InsertDrawnFeature>) => {
    const feature = features.find(f => f.id === featureId);
    if (!feature) return;

    // Store for undo
    undoStack.current.push({
      type: "update",
      featureId,
      layerId: feature.layerId,
      previousData: { ...feature },
    });
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);

    updateFeatureMutation.mutate({ id: featureId, ...updates });
  }, [features, updateFeatureMutation]);

  const deleteSelectedFeatures = useCallback(() => {
    if (selectedFeatureIds.length === 0) return;

    // Store for undo
    selectedFeatureIds.forEach(id => {
      const feature = features.find(f => f.id === id);
      if (feature) {
        undoStack.current.push({
          type: "delete",
          featureId: id,
          layerId: feature.layerId,
          previousData: { ...feature },
        });
      }
    });
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);

    selectedFeatureIds.forEach(id => {
      deleteFeatureMutation.mutate(id);
    });
    setSelectedFeatureIds([]);
  }, [selectedFeatureIds, features, deleteFeatureMutation]);

  const selectFeature = useCallback((featureId: number, multi = false) => {
    if (multi) {
      setSelectedFeatureIds(prev => 
        prev.includes(featureId) 
          ? prev.filter(id => id !== featureId)
          : [...prev, featureId]
      );
    } else {
      setSelectedFeatureIds([featureId]);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFeatureIds([]);
  }, []);

  const updateSchema = useCallback((fields: AttributeField[]) => {
    if (!activeLayerId) return;
    updateSchemaMutation.mutate({ layerId: activeLayerId, fields });
  }, [activeLayerId, updateSchemaMutation]);

  const undo = useCallback(() => {
    const action = undoStack.current.pop();
    if (!action) return;

    if (action.type === "create") {
      // Undo creation = delete
      deleteFeatureMutation.mutate(action.featureId);
      redoStack.current.push(action);
    } else if (action.type === "delete" && action.previousData) {
      // Undo deletion = recreate
      createFeatureMutation.mutate({
        layerId: action.previousData.layerId,
        geometryType: action.previousData.geometryType as GeometryType,
        coordinates: action.previousData.coordinates,
        properties: action.previousData.properties,
      });
      redoStack.current.push(action);
    } else if (action.type === "update" && action.previousData) {
      // Undo update = restore previous
      updateFeatureMutation.mutate({
        id: action.featureId,
        coordinates: action.previousData.coordinates,
        properties: action.previousData.properties,
      });
      redoStack.current.push(action);
    }

    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [createFeatureMutation, updateFeatureMutation, deleteFeatureMutation]);

  const redo = useCallback(() => {
    const action = redoStack.current.pop();
    if (!action) return;

    if (action.type === "create" && action.newData) {
      createFeatureMutation.mutate(action.newData);
      undoStack.current.push(action);
    } else if (action.type === "delete") {
      deleteFeatureMutation.mutate(action.featureId);
      undoStack.current.push(action);
    } else if (action.type === "update" && action.previousData) {
      // Already have the new state, just need to swap
      undoStack.current.push(action);
    }

    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  }, [createFeatureMutation, deleteFeatureMutation]);

  const save = useCallback(() => {
    // Data is auto-saved, this is just for UX
    toast({
      title: "Изменения сохранены",
    });
  }, [toast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelectedFeatures();
      } else if (e.key === "Escape") {
        setDrawingMode("select");
        clearSelection();
      } else if (e.key === "v" || e.key === "V") {
        setDrawingMode("select");
      } else if (e.key === "p" || e.key === "P") {
        if (activeLayer) setDrawingMode("point");
      } else if (e.key === "l" || e.key === "L") {
        if (activeLayer) setDrawingMode("line");
      } else if (e.key === "g" || e.key === "G") {
        if (activeLayer) setDrawingMode("polygon");
      } else if (e.key === "m" || e.key === "M") {
        if (activeLayer) setDrawingMode("modify");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLayer, deleteSelectedFeatures, clearSelection, undo, redo, save]);

  return {
    // State
    editableLayers,
    activeLayer,
    activeLayerId,
    features,
    layerSchema,
    drawingMode,
    selectedFeatureIds,
    canUndo,
    canRedo,
    
    // Loading states
    isLoading: layersLoading || featuresLoading,
    isSaving: createFeatureMutation.isPending || updateFeatureMutation.isPending,
    
    // Actions
    setDrawingMode,
    selectLayer,
    createLayer,
    createFeature,
    updateFeature,
    deleteSelectedFeatures,
    selectFeature,
    clearSelection,
    updateSchema,
    undo,
    redo,
    save,
    deleteLayer: deleteLayerMutation.mutate,
  };
}
