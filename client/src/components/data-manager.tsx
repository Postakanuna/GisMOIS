import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/contexts/scene-context";
import shp from "shpjs";
import {
  X,
  GripVertical,
  Upload,
  Database,
  Layers,
  Plus,
  Minus,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  FileUp,
  Loader2,
} from "lucide-react";

interface Dataset {
  id: number;
  name: string;
  originalFilename: string;
  geometryType: string;
  crs: string;
  featureCount: number;
  createdBy: string;
  createdAt: string;
}

interface SceneDataset {
  id: number;
  sceneId: number;
  datasetId: number;
  layerName: string | null;
  isVisible: number;
  opacity: number;
  color: string;
  pointStyle: string;
  lineStyle: string;
  zIndex: number;
  dataset: Dataset;
}

interface Upload {
  id: number;
  filename: string;
  originalFilename: string;
  status: string;
  error: string | null;
  datasetId: number | null;
  createdBy: string;
  createdAt: string;
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

  const { data: datasets = [], isLoading: datasetsLoading } = useQuery<Dataset[]>({
    queryKey: ["/api/datasets"],
  });

  const { data: sceneDatasets = [], isLoading: sceneLoading } = useQuery<SceneDataset[]>({
    queryKey: ["/api/scenes", currentSceneId, "datasets"],
    enabled: !!currentSceneId,
  });

  const { data: uploads = [] } = useQuery<Upload[]>({
    queryKey: ["/api/uploads"],
  });

  const addToSceneMutation = useMutation({
    mutationFn: async (datasetId: number) => {
      const res = await apiRequest("POST", `/api/scenes/${currentSceneId}/datasets`, { datasetId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
      toast({ title: "Датасет добавлен в сцену" });
    },
    onError: () => {
      toast({ title: "Ошибка добавления датасета", variant: "destructive" });
    },
  });

  const removeFromSceneMutation = useMutation({
    mutationFn: async (sceneDatasetId: number) => {
      await apiRequest("DELETE", `/api/scenes/${currentSceneId}/datasets/${sceneDatasetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
      toast({ title: "Датасет удален из сцены" });
    },
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({ id, isVisible }: { id: number; isVisible: number }) => {
      const res = await apiRequest("PATCH", `/api/scenes/${currentSceneId}/datasets/${id}`, { isVisible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
    },
  });

  const deleteDatasetMutation = useMutation({
    mutationFn: async (datasetId: number) => {
      await apiRequest("DELETE", `/api/datasets/${datasetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/datasets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
      toast({ title: "Датасет удален" });
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
          });

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || "Upload failed");
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/datasets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
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

  const sceneDsIds = new Set(sceneDatasets.map(sd => sd.datasetId));
  const availableDatasets = datasets.filter(d => !sceneDsIds.has(d.id));

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

      <Tabs defaultValue="scene" className="flex-1 flex flex-col overflow-hidden" data-no-drag>
        <TabsList className="mx-3 mt-2 grid w-auto grid-cols-2">
          <TabsTrigger value="scene" data-testid="tab-scene-datasets">
            <Layers className="h-4 w-4 mr-2" />
            В сцене ({sceneDatasets.length})
          </TabsTrigger>
          <TabsTrigger value="catalog" data-testid="tab-catalog">
            <Database className="h-4 w-4 mr-2" />
            Каталог ({datasets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scene" className="flex-1 overflow-hidden m-0 p-3">
          <ScrollArea className="h-full">
            {sceneLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : sceneDatasets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>В сцене нет датасетов</p>
                <p className="text-xs mt-1">Добавьте датасеты из каталога</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sceneDatasets.map(sd => (
                  <div
                    key={sd.id}
                    className="flex items-center gap-2 p-2 rounded-md border bg-background"
                    data-testid={`scene-dataset-${sd.id}`}
                  >
                    <span className="text-lg w-6 text-center" title={sd.dataset.geometryType}>
                      {getGeometryIcon(sd.dataset.geometryType)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {sd.layerName || sd.dataset.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {sd.dataset.featureCount} объектов
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleVisibilityMutation.mutate({
                            id: sd.id,
                            isVisible: sd.isVisible ? 0 : 1,
                          })}
                          data-testid={`button-toggle-visibility-${sd.id}`}
                        >
                          {sd.isVisible ? (
                            <Eye className="h-4 w-4" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{sd.isVisible ? "Скрыть" : "Показать"}</TooltipContent>
                    </Tooltip>
                    {canEdit && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeFromSceneMutation.mutate(sd.id)}
                            data-testid={`button-remove-from-scene-${sd.id}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Удалить из сцены</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="catalog" className="flex-1 overflow-hidden m-0 p-3 flex flex-col gap-3">
          {canEdit && (
            <div className="flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".zip,.shp"
                multiple
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-shapefile"
              >
                <FileUp className="h-4 w-4 mr-2" />
                Загрузить SHP
              </Button>
            </div>
          )}

          <ScrollArea className="flex-1">
            {datasetsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : datasets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Каталог пуст</p>
                <p className="text-xs mt-1">Загрузите shapefile для начала работы</p>
              </div>
            ) : (
              <div className="space-y-2">
                {datasets.map(dataset => {
                  const inScene = sceneDsIds.has(dataset.id);
                  return (
                    <div
                      key={dataset.id}
                      className={`flex items-center gap-2 p-2 rounded-md border ${
                        inScene ? "bg-primary/5 border-primary/20" : "bg-background"
                      }`}
                      data-testid={`catalog-dataset-${dataset.id}`}
                    >
                      <span className="text-lg w-6 text-center" title={dataset.geometryType}>
                        {getGeometryIcon(dataset.geometryType)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{dataset.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{dataset.featureCount} объектов</span>
                          <span>•</span>
                          <span>{dataset.originalFilename}</span>
                        </div>
                      </div>
                      {inScene ? (
                        <Badge variant="secondary" className="text-xs">В сцене</Badge>
                      ) : (
                        canEdit && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => addToSceneMutation.mutate(dataset.id)}
                                data-testid={`button-add-to-scene-${dataset.id}`}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Добавить в сцену</TooltipContent>
                          </Tooltip>
                        )
                      )}
                      {canEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => deleteDatasetMutation.mutate(dataset.id)}
                              data-testid={`button-delete-dataset-${dataset.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Удалить из каталога</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeMouseDown}
        data-testid="resize-handle"
      />
    </div>
  );
}
