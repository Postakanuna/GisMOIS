import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AttributeTable } from "@/components/attribute-table";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Loader2 } from "lucide-react";
import type { DrawnFeature, LayerSchemaDefinition, AttributeField } from "@shared/schema";

interface LayerAttributeTableWrapperProps {
  layerId: number;
  layerName: string;
  onClose: () => void;
}

export function LayerAttributeTableWrapper({
  layerId,
  layerName,
  onClose,
}: LayerAttributeTableWrapperProps) {
  const queryClient = useQueryClient();
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([]);
  const closeRef = useRef<{ tryClose: () => boolean } | null>(null);

  const { data: features = [], isLoading: featuresLoading } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", layerId, "features"],
    enabled: !!layerId,
  });

  const { data: layerSchema } = useQuery<LayerSchemaDefinition>({
    queryKey: ["/api/editable-layers", layerId, "schema"],
    enabled: !!layerId,
  });

  const updateFeatureMutation = useMutation({
    mutationFn: async ({ featureId, properties }: { featureId: number; properties: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/drawn-features/${featureId}`, { properties });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", layerId, "features"] });
    },
  });

  const batchUpdateMutation = useMutation({
    mutationFn: async (updates: { id: number; properties: Record<string, unknown> }[]) => {
      const res = await apiRequest("PATCH", "/api/drawn-features/batch", { updates });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", layerId, "features"] });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("DELETE", "/api/drawn-features/batch", { ids });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", layerId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes"] });
      setSelectedFeatureIds([]);
    },
  });

  const updateSchemaMutation = useMutation({
    mutationFn: async (fields: AttributeField[]) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${layerId}/schema`, { fields });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", layerId, "schema"] });
    },
  });

  const handleFeatureSelect = useCallback((featureId: number, multi?: boolean) => {
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

  const handleFeatureUpdate = useCallback((featureId: number, properties: Record<string, unknown>) => {
    updateFeatureMutation.mutate({ featureId, properties });
  }, [updateFeatureMutation]);

  const handleBatchUpdate = useCallback(async (updates: { id: number; properties: Record<string, unknown> }[]) => {
    await batchUpdateMutation.mutateAsync(updates);
  }, [batchUpdateMutation]);

  const handleBatchDelete = useCallback((ids: number[]) => {
    batchDeleteMutation.mutate(ids);
  }, [batchDeleteMutation]);

  const handleSchemaUpdate = useCallback((fields: AttributeField[]) => {
    updateSchemaMutation.mutate(fields);
  }, [updateSchemaMutation]);

  const handleSelectAll = useCallback((featureIds: number[]) => {
    setSelectedFeatureIds(featureIds);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedFeatureIds([]);
  }, []);

  const handleRequestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (featuresLoading) {
    return (
      <DraggableModal
        title={`Таблица атрибутов: ${layerName}`}
        isOpen={true}
        onClose={onClose}
        defaultWidth={900}
        defaultHeight={400}
        minWidth={500}
        minHeight={250}
      >
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DraggableModal>
    );
  }

  return (
    <DraggableModal
      title={`Таблица атрибутов: ${layerName}`}
      isOpen={true}
      onClose={onClose}
      defaultWidth={900}
      defaultHeight={400}
      minWidth={500}
      minHeight={250}
    >
      <AttributeTable
        features={features}
        selectedFeatureIds={selectedFeatureIds}
        layerSchema={layerSchema || null}
        onFeatureSelect={handleFeatureSelect}
        onFeatureUpdate={handleFeatureUpdate}
        onBatchUpdate={handleBatchUpdate}
        onBatchDelete={handleBatchDelete}
        onSchemaUpdate={handleSchemaUpdate}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onRequestClose={handleRequestClose}
        closeRef={closeRef}
        layerName={layerName}
      />
    </DraggableModal>
  );
}
