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
  type: "create" | "update" | "delete" | "field-update";
  featureId: number;
  layerId: number;
  layerName: string;
  description: string;
  previousData?: DrawnFeature;
  newData?: InsertDrawnFeature;
  fieldName?: string;
  oldFieldValue?: unknown;
  newFieldValue?: unknown;
}

export interface SnapSettings {
  enabled: boolean;
  snapToVertices: boolean;
  snapToEdges: boolean;
  snapRadius: number;
  snapLayerIds: number[]; // empty array = all visible layers
}

interface UseDrawingOptions {
  drawActionsRef?: React.MutableRefObject<{ removeLastPoint: () => boolean; abortDrawing: () => void } | null>;
}

export function useDrawing(options: UseDrawingOptions = {}) {
  const { drawActionsRef } = options;
  const { toast } = useToast();
  const { currentSceneId } = useScene();
  
  // State
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("select");
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([]);
  
  // Snap settings
  const [snapSettings, setSnapSettings] = useState<SnapSettings>({
    enabled: false,
    snapToVertices: true,
    snapToEdges: true,
    snapRadius: 15,
    snapLayerIds: [],
  });
  
  // Undo/redo stacks
  const undoStack = useRef<UndoAction[]>([]);
  const redoStack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Session trash: deleted features waiting for flush on edit-mode exit
  const sessionTrashRef = useRef<Map<number, DrawnFeature>>(new Map());

  // Queries - load editable layers for current scene
  const { data: editableLayers = [], isLoading: layersLoading } = useQuery<EditableLayer[]>({
    queryKey: ["/api/scenes", currentSceneId, "editable-layers"],
    enabled: !!currentSceneId,
  });

  const activeLayer = editableLayers.find(l => l.id === activeLayerId) || null;

  const getLayerName = useCallback((layerId: number): string =>
    editableLayers.find(l => l.id === layerId)?.name ?? `Слой ${layerId}`,
  [editableLayers]);

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

  // Query key for editable layers
  const editableLayersQueryKey = ["/api/scenes", currentSceneId, "editable-layers"];

  const updateLayerMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertEditableLayer>) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, updates);
      return res.json();
    },
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: editableLayersQueryKey });
      // Snapshot the previous value
      const previousLayers = queryClient.getQueryData<EditableLayer[]>(editableLayersQueryKey);
      // Optimistically update to the new value
      queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => 
        old?.map(layer => layer.id === variables.id ? { ...layer, ...variables } : layer) ?? []
      );
      return { previousLayers };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousLayers) {
        queryClient.setQueryData(editableLayersQueryKey, context.previousLayers);
      }
    },
    onSettled: () => {
      // Always refetch to ensure data is in sync
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const deleteLayerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/editable-layers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      window.dispatchEvent(new Event("viewport-features-invalidate"));
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
      window.dispatchEvent(new CustomEvent("feature-created", { detail: { feature: newFeature } }));
      window.dispatchEvent(new Event("viewport-features-invalidate"));
      
      // Add to undo stack
      undoStack.current.push({
        type: "create",
        featureId: newFeature.id,
        layerId: newFeature.layerId,
        layerName: getLayerName(newFeature.layerId),
        description: "Создан объект",
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
      window.dispatchEvent(new Event("viewport-features-invalidate"));
    },
  });

  const deleteFeatureMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/features/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      window.dispatchEvent(new Event("viewport-features-invalidate"));
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/features/batch-delete", { ids });
      return res.json();
    },
    onSuccess: (_, variables) => {
      sessionTrashRef.current.clear();
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      window.dispatchEvent(new Event("viewport-features-invalidate"));
      const count = variables.length;
      toast({
        title: count === 1 ? "Объект удалён" : `Удалено объектов: ${count}`,
      });
    },
  });

  const batchUpdateMutation = useMutation({
    mutationFn: async (updates: { id: number; properties: Record<string, unknown> }[]) => {
      const res = await apiRequest("PATCH", "/api/features/batch", { updates });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", activeLayerId, "features"] });
      window.dispatchEvent(new Event("viewport-features-invalidate"));
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
      layerName: getLayerName(feature.layerId),
      description: "Изменена геометрия",
      previousData: { ...feature },
    });
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);

    updateFeatureMutation.mutate({ id: featureId, ...updates });
  }, [features, updateFeatureMutation, getLayerName]);

  // Adds features to the session trash bin and records undo entries.
  // No API call is made — deletion is deferred until flushSessionDeletes().
  const addToSessionTrash = useCallback((featuresToTrash: DrawnFeature[]) => {
    featuresToTrash.forEach(feature => {
      sessionTrashRef.current.set(feature.id, feature);
      undoStack.current.push({
        type: "delete",
        featureId: feature.id,
        layerId: feature.layerId,
        layerName: getLayerName(feature.layerId),
        description: "Удалён объект",
        previousData: { ...feature },
      });
    });
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [getLayerName]);

  // Unified deletion: moves features to session trash and updates UI immediately.
  // No API call — physical deletion happens on edit-mode exit via flushSessionDeletes().
  const deleteFromSession = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const found = ids.map(id => features.find(f => f.id === id) || sessionTrashRef.current.get(id)).filter((f): f is DrawnFeature => !!f);
    if (found.length > 0) {
      addToSessionTrash(found);
    }
    window.dispatchEvent(new CustomEvent("features-batch-deleted", { detail: { ids } }));
    setSelectedFeatureIds([]);
  }, [features, addToSessionTrash]);

  // Sends all session-trashed features to the server in one batch request.
  const flushSessionDeletes = useCallback(() => {
    const ids = Array.from(sessionTrashRef.current.keys());
    if (ids.length === 0) return;
    batchDeleteMutation.mutate(ids);
  }, [batchDeleteMutation]);

  // Clears session state (undo/redo stacks, trash, selection).
  // Call when entering or exiting edit mode.
  const clearSession = useCallback(() => {
    sessionTrashRef.current.clear();
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setSelectedFeatureIds([]);
  }, []);

  const deleteSelectedFeatures = useCallback(() => {
    if (selectedFeatureIds.length === 0) return;
    deleteFromSession(selectedFeatureIds);
  }, [selectedFeatureIds, deleteFromSession]);

  const batchDeleteFeatures = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    deleteFromSession(ids);
  }, [deleteFromSession]);

  // Records deletion to undo stack and updates UI without API call.
  // For backward-compat with paths that call this externally.
  const recordDeleteForUndo = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const found = ids.map(id => features.find(f => f.id === id)).filter((f): f is DrawnFeature => !!f);
    addToSessionTrash(found);
    setSelectedFeatureIds(prev => prev.filter(id => !ids.includes(id)));
  }, [features, addToSessionTrash]);

  const batchUpdateFeatures = useCallback((updates: { id: number; properties: Record<string, unknown> }[]) => {
    if (updates.length === 0) return Promise.resolve();

    // Filter out any invalid updates
    const validUpdates = updates.filter(u => typeof u.id === 'number' && !isNaN(u.id) && u.id > 0);
    
    if (validUpdates.length === 0) {
      console.warn("No valid updates to process");
      return Promise.resolve();
    }

    // Store per-field undo actions
    validUpdates.forEach(update => {
      const feature = features.find(f => f.id === update.id);
      if (!feature) return;
      const oldProps = (feature.properties ?? {}) as Record<string, unknown>;
      Object.entries(update.properties).forEach(([fieldName, newValue]) => {
        const oldValue = oldProps[fieldName];
        if (oldValue !== newValue) {
          undoStack.current.push({
            type: "field-update",
            featureId: update.id,
            layerId: feature.layerId,
            layerName: getLayerName(feature.layerId),
            description: `Изменено поле «${fieldName}»: «${String(oldValue ?? '')}» → «${String(newValue ?? '')}»`,
            fieldName,
            oldFieldValue: oldValue,
            newFieldValue: newValue,
          });
        }
      });
    });
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(false);

    return batchUpdateMutation.mutateAsync(validUpdates);
  }, [features, batchUpdateMutation, getLayerName]);

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
  
  const selectAllFeatures = useCallback((featureIds: number[]) => {
    setSelectedFeatureIds(featureIds);
  }, []);

  const updateSchema = useCallback((fields: AttributeField[]) => {
    if (!activeLayerId) return;
    updateSchemaMutation.mutate({ layerId: activeLayerId, fields });
  }, [activeLayerId, updateSchemaMutation]);

  // Snap functions
  const toggleSnap = useCallback(() => {
    setSnapSettings(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const updateSnapSettings = useCallback((updates: Partial<SnapSettings>) => {
    setSnapSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const undo = useCallback(() => {
    const action = undoStack.current.pop();
    if (!action) return;

    if (action.type === "create") {
      // Undo creation = delete
      deleteFeatureMutation.mutate(action.featureId);
      redoStack.current.push(action);
    } else if (action.type === "delete" && action.previousData) {
      // Undo deletion = restore from session trash (no API, original ID preserved)
      const feature = sessionTrashRef.current.get(action.featureId);
      if (feature) {
        sessionTrashRef.current.delete(action.featureId);
        window.dispatchEvent(new CustomEvent("feature-restored", { detail: { feature } }));
      }
      redoStack.current.push(action);
    } else if (action.type === "update" && action.previousData) {
      // Undo update = restore previous
      updateFeatureMutation.mutate({
        id: action.featureId,
        coordinates: action.previousData.coordinates,
        properties: action.previousData.properties,
      });
      redoStack.current.push(action);
    } else if (action.type === "field-update" && action.fieldName !== undefined) {
      // Undo field change = restore just that field using current server state
      const currentFeaturesData = queryClient.getQueryData<DrawnFeature[]>(["/api/editable-layers", action.layerId, "features"]) ?? [];
      const currentFeature = currentFeaturesData.find(f => f.id === action.featureId);
      const currentProps = (currentFeature?.properties ?? {}) as Record<string, unknown>;
      updateFeatureMutation.mutate({
        id: action.featureId,
        properties: { ...currentProps, [action.fieldName]: action.oldFieldValue },
      });
      redoStack.current.push(action);
    }

    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [updateFeatureMutation, deleteFeatureMutation]);

  const redo = useCallback(() => {
    const action = redoStack.current.pop();
    if (!action) return;

    if (action.type === "create" && action.newData) {
      createFeatureMutation.mutate(action.newData);
      undoStack.current.push(action);
    } else if (action.type === "delete" && action.previousData) {
      // Redo deletion = put back into session trash and remove from map
      addToSessionTrash([action.previousData]);
      window.dispatchEvent(new CustomEvent("features-batch-deleted", { detail: { ids: [action.featureId] } }));
      undoStack.current.push(action);
    } else if (action.type === "update" && action.previousData) {
      // Already have the new state, just need to swap
      undoStack.current.push(action);
    } else if (action.type === "field-update" && action.fieldName !== undefined) {
      // Redo field change = re-apply new value using current server state
      const currentFeaturesData = queryClient.getQueryData<DrawnFeature[]>(["/api/editable-layers", action.layerId, "features"]) ?? [];
      const currentFeature = currentFeaturesData.find(f => f.id === action.featureId);
      const currentProps = (currentFeature?.properties ?? {}) as Record<string, unknown>;
      updateFeatureMutation.mutate({
        id: action.featureId,
        properties: { ...currentProps, [action.fieldName]: action.newFieldValue },
      });
      undoStack.current.push(action);
    }

    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  }, [createFeatureMutation, addToSessionTrash, updateFeatureMutation]);

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
        // During line/polygon drawing, try to remove last point first
        if ((drawingMode === "line" || drawingMode === "polygon") && drawActionsRef?.current) {
          const removed = drawActionsRef.current.removeLastPoint();
          if (removed) {
            return; // Successfully removed a point during drawing
          }
        }
        // Fall back to normal undo
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "s" || e.key === "S") {
        if (!e.ctrlKey && !e.metaKey) {
          toggleSnap();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLayer, deleteSelectedFeatures, clearSelection, undo, redo, toggleSnap, drawingMode, drawActionsRef]);

  // Computed descriptions for undo/redo tooltips (derived during render, canUndo/canRedo trigger re-render)
  const undoDescription = canUndo && undoStack.current.length > 0
    ? `${undoStack.current[undoStack.current.length - 1].description} (${undoStack.current[undoStack.current.length - 1].layerName})`
    : null;
  const redoDescription = canRedo && redoStack.current.length > 0
    ? `${redoStack.current[redoStack.current.length - 1].description} (${redoStack.current[redoStack.current.length - 1].layerName})`
    : null;

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
    undoDescription,
    redoDescription,
    snapSettings,
    
    // Loading states
    isLoading: layersLoading || featuresLoading,
    isDeleting: batchDeleteMutation.isPending,
    
    // Actions
    setDrawingMode,
    selectLayer,
    createLayer,
    createFeature,
    updateFeature,
    deleteSelectedFeatures,
    batchDeleteFeatures,
    deleteFromSession,
    recordDeleteForUndo,
    batchUpdateFeatures,
    selectFeature,
    clearSelection,
    selectAllFeatures,
    updateSchema,
    undo,
    redo,
    flushSessionDeletes,
    clearSession,
    deleteLayer: deleteLayerMutation.mutate,
    toggleSnap,
    updateSnapSettings,
  };
}
