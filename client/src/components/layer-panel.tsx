import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Map, Database, Building2, Users, ChevronRight, Eye, EyeOff, Upload, Trash2, FileArchive, BarChart3, Download, Loader2, FolderOpen } from "lucide-react";
import { useScene } from "@/contexts/scene-context";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { LayerConfig, EditableLayer, GeometryType } from "@shared/schema";
import type { LayerFilters, ActiveFilters } from "@/hooks/use-zulu-connection";
import { Plus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseShapefileWithEncoding } from "@/lib/shapefile-parser";

const truncateName = (name: string, maxLength: number = 30): string => {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
};

const LAYER_COLORS = [
  "#1976D2", "#D32F2F", "#388E3C", "#7B1FA2",
  "#F57C00", "#0097A7", "#C2185B", "#512DA8",
];


type LayerGeometryType = "point" | "line" | "polygon" | "unknown";

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

interface LayerPanelProps {
  layers: LayerConfig[];
  onToggleVisibility: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  layerFilters?: Record<string, LayerFilters>;
  activeFilters?: Record<string, ActiveFilters>;
  onToggleFilter?: (layerId: string, filterType: keyof ActiveFilters, value: string) => void;
  // Editable layers props
  editableLayers?: EditableLayer[];
  activeEditableLayer?: EditableLayer | null;
  onSelectEditableLayer?: (layer: EditableLayer) => void;
  onCreateEditableLayer?: (name: string, geometryType: GeometryType) => void;
  onDeleteEditableLayer?: (layerId: number) => void;
  editMode?: boolean;
  onToggleEditMode?: () => void;
  // Scene dataset editing props
  activeSceneDataset?: SceneDataset | null;
  onSelectSceneDataset?: (sd: SceneDataset | null) => void;
}

export function LayerPanel({
  layers,
  onToggleVisibility,
  onOpacityChange,
  layerFilters,
  activeFilters,
  onToggleFilter,
  editableLayers = [],
  activeEditableLayer,
  onSelectEditableLayer,
  onCreateEditableLayer,
  onDeleteEditableLayer,
  editMode = false,
  onToggleEditMode,
  activeSceneDataset,
  onSelectSceneDataset,
}: LayerPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentSceneId } = useScene();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [accidentLayerId, setAccidentLayerId] = useState<string>("");
  const [pipelineLayerId, setPipelineLayerId] = useState<string>("");
  const [maxDistance, setMaxDistance] = useState<string>("15");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [newLayerDialogOpen, setNewLayerDialogOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerGeomType, setNewLayerGeomType] = useState<GeometryType>("Point");

  const { data: sceneDatasets = [] } = useQuery<SceneDataset[]>({
    queryKey: ["/api/scenes", currentSceneId, "datasets"],
    enabled: !!currentSceneId,
  });

  const toggleSceneDatasetVisibility = useMutation({
    mutationFn: async ({ id, isVisible }: { id: number; isVisible: number }) => {
      const res = await apiRequest("PATCH", `/api/scenes/${currentSceneId}/datasets/${id}`, { isVisible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
    },
  });

  const updateSceneDatasetStyle = useMutation({
    mutationFn: async ({ id, ...updates }: { id: number; color?: string; opacity?: number }) => {
      const res = await apiRequest("PATCH", `/api/scenes/${currentSceneId}/datasets/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "datasets"] });
    },
  });


  // Use scene-scoped query key for all editable layers operations
  const editableLayersQueryKey = ["/api/scenes", currentSceneId, "editable-layers"];

  const importLayerMutation = useMutation({
    mutationFn: async (data: { 
      name: string; 
      geometryType: string; 
      geojson: any; 
      sourceFileName: string;
      color: string;
      pointStyle: string;
      lineStyle: string;
    }) => {
      const res = await apiRequest("POST", "/api/editable-layers/import", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
    onError: () => {
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить слой",
        variant: "destructive",
      });
    },
  });

  const updateLayerMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<EditableLayer>) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, data);
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
      toast({
        title: "Ошибка обновления",
        description: "Не удалось обновить слой",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Always refetch after error or success to ensure data is in sync
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const deleteImportedLayerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/editable-layers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
      toast({
        title: "Слой удалён",
        description: "Shapefile удалён с карты",
      });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsedLayers = await parseShapefileWithEncoding(arrayBuffer, file.name);

      if (parsedLayers.length === 0) {
        throw new Error("Не найдено слоёв в архиве");
      }

      // Import each layer using the new endpoint
      let importedCount = 0;
      for (const layer of parsedLayers) {
        const geomType = layer.geojson.features?.[0]?.geometry?.type;
        let geometryType: GeometryType = "Point";
        if (geomType === "LineString" || geomType === "MultiLineString") {
          geometryType = "LineString";
        } else if (geomType === "Polygon" || geomType === "MultiPolygon") {
          geometryType = "Polygon";
        }
        
        await importLayerMutation.mutateAsync({
          name: layer.name,
          geometryType,
          geojson: layer.geojson,
          sourceFileName: file.name,
          color: LAYER_COLORS[importedCount % LAYER_COLORS.length],
          pointStyle: "circle",
          lineStyle: "solid",
        });
        importedCount++;
      }
      
      toast({
        title: "Слои загружены",
        description: `Добавлено ${importedCount} слоёв из архива`,
      });
    } catch (error) {
      console.error("Error parsing shapefile:", error);
      toast({
        title: "Ошибка обработки",
        description: error instanceof Error ? error.message : "Не удалось прочитать shapefile",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // For analytics, filter by geometry type from all editable layers
  const pointLayers = editableLayers.filter(l => l.geometryType === "Point");
  const lineLayers = editableLayers.filter(l => l.geometryType === "LineString");

  const runAnalysis = async () => {
    if (!accidentLayerId || !pipelineLayerId) {
      toast({
        title: "Ошибка",
        description: "Выберите оба слоя для анализа",
        variant: "destructive",
      });
      return;
    }

    const distanceNum = parseFloat(maxDistance);
    if (isNaN(distanceNum) || distanceNum <= 0) {
      toast({
        title: "Ошибка",
        description: "Укажите корректный порог расстояния",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/analytics/accident-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accidentLayerId: parseInt(accidentLayerId),
          pipelineLayerId: parseInt(pipelineLayerId),
          maxDistanceMeters: distanceNum,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Ошибка анализа");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `accident_analysis_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Анализ завершён",
        description: "Файл XLSX загружен",
      });

      setAnalyticsOpen(false);
    } catch (error: any) {
      toast({
        title: "Ошибка анализа",
        description: error.message || "Не удалось выполнить анализ",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const baseLayers = layers.filter((l) => l.type === "base");
  const wmsLayers = layers.filter((l) => l.type === "wms");
  const wfsLayers = layers.filter((l) => l.type === "wfs");

  const renderSublayerFilters = (layer: LayerConfig) => {
    const filters = layerFilters?.[layer.id];
    const active = activeFilters?.[layer.id];
    
    if (!filters || !active || !onToggleFilter) return null;
    
    const rsoValues = Array.from(filters.name_rso).filter(v => v).sort();
    const munizValues = Array.from(filters.muniz_obr).filter(v => v).sort();
    
    if (rsoValues.length === 0 && munizValues.length === 0) return null;

    return (
      <div className="mt-3 space-y-2 pl-2 border-l-2 border-sidebar-border">
        {rsoValues.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full group">
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              <Users className="h-3 w-3" />
              <span>По РСО ({rsoValues.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1 pl-5">
              {rsoValues.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox
                    id={`${layer.id}-rso-${value}`}
                    checked={active.name_rso.includes(value)}
                    onCheckedChange={() => onToggleFilter(layer.id, "name_rso", value)}
                    data-testid={`checkbox-rso-${layer.id}-${value}`}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label
                        htmlFor={`${layer.id}-rso-${value}`}
                        className="text-xs cursor-pointer truncate max-w-[180px]"
                      >
                        {value || "(не указано)"}
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">{value || "(не указано)"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
        
        {munizValues.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full group">
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              <Building2 className="h-3 w-3" />
              <span>По муниципалитету ({munizValues.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1 pl-5">
              {munizValues.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox
                    id={`${layer.id}-muniz-${value}`}
                    checked={active.muniz_obr.includes(value)}
                    onCheckedChange={() => onToggleFilter(layer.id, "muniz_obr", value)}
                    data-testid={`checkbox-muniz-${layer.id}-${value}`}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label
                        htmlFor={`${layer.id}-muniz-${value}`}
                        className="text-xs cursor-pointer truncate max-w-[180px]"
                      >
                        {value || "(не указано)"}
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">{value || "(не указано)"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  };

  const renderLayerItem = (layer: LayerConfig) => {
    const Icon = layer.type === "base" ? Map : layer.type === "wfs" ? Database : Layers;

    return (
      <div
        key={layer.id}
        className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 min-w-0 overflow-hidden"
        data-testid={`layer-item-${layer.id}`}
      >
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <span 
            className="block text-xs font-medium"
            title={layer.name}
          >
            {truncateName(layer.name)}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => onToggleVisibility(layer.id)}
          data-testid={`button-toggle-layer-${layer.id}`}
        >
          {layer.visible ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
      </div>
    );
  };

  const headerContent = (
    <div className="flex items-center justify-between gap-2 pb-2 border-b border-sidebar-border">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium">Слои карты</h2>
      </div>
      <div className="flex items-center gap-1">
        <Input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-shapefile-upload"
        />
        <Dialog open={newLayerDialogOpen} onOpenChange={setNewLayerDialogOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  data-testid="button-create-editable-layer"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Создать редактируемый слой</p>
            </TooltipContent>
          </Tooltip>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Новый редактируемый слой</DialogTitle>
              <DialogDescription>
                Создайте слой для рисования объектов на карте
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-layer-name">Название слоя</Label>
                <Input
                  id="new-layer-name"
                  value={newLayerName}
                  onChange={(e) => setNewLayerName(e.target.value)}
                  placeholder="Например: Мои объекты"
                  data-testid="input-new-layer-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-layer-geom">Тип геометрии</Label>
                <Select value={newLayerGeomType} onValueChange={(v) => setNewLayerGeomType(v as GeometryType)}>
                  <SelectTrigger id="new-layer-geom" data-testid="select-new-layer-geom">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Point">Точки</SelectItem>
                    <SelectItem value="LineString">Линии</SelectItem>
                    <SelectItem value="Polygon">Полигоны</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  if (newLayerName.trim() && onCreateEditableLayer) {
                    onCreateEditableLayer(newLayerName.trim(), newLayerGeomType);
                    setNewLayerName("");
                    setNewLayerDialogOpen(false);
                  }
                }}
                disabled={!newLayerName.trim()}
                data-testid="button-confirm-create-layer"
              >
                <Plus className="h-4 w-4 mr-2" />
                Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || importLayerMutation.isPending}
              data-testid="button-upload-shapefile"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Загрузить Shapefile (ZIP)</p>
          </TooltipContent>
        </Tooltip>
        {editableLayers.length >= 2 && pointLayers.length > 0 && lineLayers.length > 0 && (
          <Dialog open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="button-open-analytics"
                  >
                    <BarChart3 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Анализ аварий</p>
              </TooltipContent>
            </Tooltip>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Привязка аварий к трубопроводам</DialogTitle>
                <DialogDescription>
                  Сопоставление точек аварий с ближайшими участками трубопроводов и экспорт в XLSX
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="accident-layer">Слой аварий (точки)</Label>
                  <Select value={accidentLayerId} onValueChange={setAccidentLayerId}>
                    <SelectTrigger id="accident-layer" data-testid="select-accident-layer">
                      <SelectValue placeholder="Выберите слой" />
                    </SelectTrigger>
                    <SelectContent>
                      {pointLayers.map(layer => (
                        <SelectItem key={layer.id} value={String(layer.id)}>
                          {layer.name} ({layer.featureCount} объектов)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pipeline-layer">Слой трубопроводов (линии)</Label>
                  <Select value={pipelineLayerId} onValueChange={setPipelineLayerId}>
                    <SelectTrigger id="pipeline-layer" data-testid="select-pipeline-layer">
                      <SelectValue placeholder="Выберите слой" />
                    </SelectTrigger>
                    <SelectContent>
                      {lineLayers.map(layer => (
                        <SelectItem key={layer.id} value={String(layer.id)}>
                          {layer.name} ({layer.featureCount} объектов)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-distance">Порог расстояния (метры)</Label>
                  <Input
                    id="max-distance"
                    type="number"
                    value={maxDistance}
                    onChange={e => setMaxDistance(e.target.value)}
                    min="1"
                    max="1000"
                    data-testid="input-max-distance"
                  />
                  <p className="text-xs text-muted-foreground">
                    Аварии дальше порога не будут привязаны к трубопроводам
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={runAnalysis}
                  disabled={isAnalyzing || !accidentLayerId || !pipelineLayerId}
                  data-testid="button-run-analysis"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Анализ...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Выполнить и скачать XLSX
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 min-w-0">
      {headerContent}

      <Accordion type="multiple" defaultValue={["base", "wms", "wfs", "uploaded", "editable"]} className="space-y-1 min-w-0">
        {/* Editable layers section - includes both created and imported layers */}
        <AccordionItem value="editable" className="border-none min-w-0">
          <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-editable-layers">
            <div className="flex items-center gap-2 min-w-0">
              <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">Редактируемые слои</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                ({editableLayers.length})
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-1 pt-1 min-w-0">
            <div className="space-y-1 min-w-0">
              {editableLayers.map((layer) => (
                <div
                  key={layer.id}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 cursor-pointer transition-colors overflow-hidden ${
                    activeEditableLayer?.id === layer.id
                      ? "border-primary bg-primary/10"
                      : "border-sidebar-border hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    if (activeEditableLayer?.id !== layer.id) {
                      onSelectEditableLayer?.(layer);
                    }
                  }}
                  data-testid={`editable-layer-item-${layer.id}`}
                >
                  {/* Left controls - color indicator */}
                  <div className="flex items-center gap-1 shrink-0">
                    <div
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: layer.color }}
                    />
                  </div>
                  
                  {/* Layer name - flex-1 min-w-0 to allow shrinking */}
                  <div className="flex-1 min-w-0 flex items-center gap-1">
                    <span className="text-xs font-medium" title={layer.name}>
                      {truncateName(layer.name)}
                    </span>
                    {layer.source === "import" && (
                      <FileArchive className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                    )}
                    {!layer.visible && (
                      <EyeOff className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                    )}
                  </div>
                  
                  {/* Right - feature count */}
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {layer.featureCount || 0}
                  </span>
                </div>
              ))}
              {editableLayers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Нажмите "+" для создания слоя
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {baseLayers.length > 0 && (
          <AccordionItem value="base" className="border-none min-w-0">
            <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-base-layers">
              <div className="flex items-center gap-2 min-w-0">
                <Map className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">Базовые слои</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({baseLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1 min-w-0">
              {baseLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wmsLayers.length > 0 && (
          <AccordionItem value="wms" className="border-none min-w-0">
            <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-wms-layers">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">WMS слои</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({wmsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1 min-w-0">
              {wmsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wfsLayers.length > 0 && (
          <AccordionItem value="wfs" className="border-none min-w-0">
            <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-wfs-layers">
              <div className="flex items-center gap-2 min-w-0">
                <Database className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">WFS слои</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({wfsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1 min-w-0">
              {wfsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {layers.length === 0 && editableLayers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Layers className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            Загрузите Shapefile или
            <br />
            подключитесь к серверу
          </p>
        </div>
      )}
    </div>
  );
}
