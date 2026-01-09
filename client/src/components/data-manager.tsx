import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/contexts/scene-context";
import shp from "shpjs";
import {
  X,
  GripVertical,
  Database,
  Layers,
  Eye,
  EyeOff,
  Trash2,
  FileUp,
  Loader2,
} from "lucide-react";

interface EditableLayer {
  id: number;
  sceneId: number | null;
  name: string;
  geometryType: string;
  color: string;
  pointStyle: string;
  lineStyle: string;
  visible: boolean;
  opacity: number;
  featureCount: number;
  source: string;
  sourceFileName: string | null;
  crs: string;
  createdAt: string;
  updatedAt: string;
}

interface DataManagerProps {
  onClose: () => void;
}

const MIN_WIDTH = 500;
const MIN_HEIGHT = 300;

export function DataManager({ onClose }: DataManagerProps) {
  const { toast } = useToast();
  const { currentSceneId, canEdit } = useScene();
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: sceneLayers = [], isLoading: sceneLoading } = useQuery<EditableLayer[]>({
    queryKey: ["/api/scenes", currentSceneId, "editable-layers"],
    enabled: !!currentSceneId,
  });

  const deleteLayerMutation = useMutation({
    mutationFn: async (layerId: number) => {
      await apiRequest("DELETE", `/api/editable-layers/${layerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      toast({ title: "Слой удалён" });
    },
    onError: () => {
      toast({ title: "Ошибка удаления слоя", variant: "destructive" });
    },
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({ id, visible }: { id: number; visible: boolean }) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, { visible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
    },
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    dragOffset.current = {
      x: e.clientX,
      y: e.clientY,
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: Math.max(0, e.clientX - dragOffset.current.x),
          y: Math.max(0, e.clientY - dragOffset.current.y),
        });
      } else if (isResizing) {
        const deltaX = e.clientX - dragOffset.current.x;
        const deltaY = e.clientY - dragOffset.current.y;
        setSize(prev => ({
          width: Math.max(MIN_WIDTH, prev.width + deltaX),
          height: Math.max(MIN_HEIGHT, prev.height + deltaY),
        }));
        dragOffset.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing]);

  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const arrayBuffer = await file.arrayBuffer();
        
        const geojson = await shp(arrayBuffer);
        
        const collections = Array.isArray(geojson) ? geojson : [geojson];
        
        for (const collection of collections) {
          if (!collection.features || collection.features.length === 0) {
            continue;
          }
          
          const firstFeature = collection.features[0];
          const geometryType = firstFeature.geometry?.type || "Unknown";
          
          const baseName = file.name.replace(/\.(zip|shp)$/i, "");
          const layerName = collections.length > 1 
            ? `${baseName}_${geometryType}` 
            : baseName;
          
          const res = await apiRequest("POST", "/api/datasets/import", {
            name: layerName,
            geometryType,
            geojson: collection,
            sourceFileName: file.name,
            crs: "EPSG:4326",
            sceneId: currentSceneId, // Attach to current scene
          });

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || "Upload failed");
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      toast({ title: "Файл загружен успешно" });
    } catch (error) {
      console.error("Shapefile import error:", error);
      toast({
        title: "Ошибка загрузки",
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getGeometryIcon = (type: string) => {
    switch (type) {
      case "Point":
        return "●";
      case "LineString":
        return "—";
      case "Polygon":
        return "▢";
      default:
        return "◎";
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed bg-card border rounded-lg shadow-lg flex flex-col z-50"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
      data-testid="data-manager-window"
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 cursor-move rounded-t-lg"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <Database className="h-4 w-4" />
          <span className="font-medium text-sm">Менеджер данных</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          data-no-drag
          data-testid="button-close-data-manager"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-3" data-no-drag>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Слои сцены ({sceneLayers.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !canEdit}
              data-testid="button-upload-shapefile"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4 mr-2" />
              )}
              Импорт SHP
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".zip,.shp"
              multiple
              onChange={handleFileChange}
              data-testid="input-shapefile"
            />
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          {sceneLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : sceneLayers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>В сцене нет слоёв</p>
              <p className="text-xs mt-1">Импортируйте shapefile или создайте слой</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sceneLayers.map(layer => (
                <div
                  key={layer.id}
                  className="flex items-center gap-2 p-2 rounded-md border bg-background"
                  data-testid={`scene-layer-${layer.id}`}
                >
                  <div 
                    className="w-3 h-3 rounded-sm shrink-0" 
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className="text-lg w-6 text-center shrink-0" title={layer.geometryType}>
                    {getGeometryIcon(layer.geometryType)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {layer.name}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{layer.featureCount} объектов</span>
                      {layer.source === "import" && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          импорт
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => toggleVisibilityMutation.mutate({
                          id: layer.id,
                          visible: !layer.visible,
                        })}
                        data-testid={`button-toggle-visibility-${layer.id}`}
                      >
                        {layer.visible ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{layer.visible ? "Скрыть" : "Показать"}</TooltipContent>
                  </Tooltip>
                  {canEdit && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteLayerMutation.mutate(layer.id)}
                          data-testid={`button-delete-layer-${layer.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Удалить слой</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeMouseDown}
        data-testid="resize-handle"
      />
    </div>
  );
}
