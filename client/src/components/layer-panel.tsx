import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Map, Database, Building2, Users, ChevronRight, Eye, EyeOff, Upload, Trash2, Palette, FileArchive, BarChart3, Download, Loader2 } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LayerConfig, UploadedLayer, PointStyle, LineStyle } from "@shared/schema";
import type { LayerFilters, ActiveFilters } from "@/hooks/use-zulu-connection";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseShapefileWithEncoding } from "@/lib/shapefile-parser";
import { Circle, Square, Triangle, Cloud, Minus, MoreHorizontal } from "lucide-react";

const LAYER_COLORS = [
  "#1976D2", "#D32F2F", "#388E3C", "#7B1FA2",
  "#F57C00", "#0097A7", "#C2185B", "#512DA8",
];

const POINT_STYLES: { value: PointStyle; label: string; icon: typeof Circle }[] = [
  { value: "circle", label: "Круг", icon: Circle },
  { value: "square", label: "Квадрат", icon: Square },
  { value: "triangle", label: "Треугольник", icon: Triangle },
  { value: "cloud", label: "Облачко", icon: Cloud },
];

const LINE_STYLES: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Сплошная" },
  { value: "dashed", label: "Пунктирная" },
  { value: "double", label: "Двойная" },
];

type LayerGeometryType = "point" | "line" | "polygon" | "unknown";

interface LayerPanelProps {
  layers: LayerConfig[];
  onToggleVisibility: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  layerFilters?: Record<string, LayerFilters>;
  activeFilters?: Record<string, ActiveFilters>;
  onToggleFilter?: (layerId: string, filterType: keyof ActiveFilters, value: string) => void;
}

export function LayerPanel({
  layers,
  onToggleVisibility,
  onOpacityChange,
  layerFilters,
  activeFilters,
  onToggleFilter,
}: LayerPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [accidentLayerId, setAccidentLayerId] = useState<string>("");
  const [pipelineLayerId, setPipelineLayerId] = useState<string>("");
  const [maxDistance, setMaxDistance] = useState<string>("15");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { data: uploadedLayers = [] } = useQuery<UploadedLayer[]>({
    queryKey: ["/api/uploaded-layers"],
    refetchOnWindowFocus: false,
  });

  const createLayersBatchMutation = useMutation({
    mutationFn: async (data: Omit<UploadedLayer, "id" | "createdAt">[]) => {
      const res = await apiRequest("POST", "/api/uploaded-layers/batch", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
      toast({
        title: "Слои загружены",
        description: `Добавлено ${variables.length} слоёв из архива`,
      });
    },
    onError: () => {
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить слои",
        variant: "destructive",
      });
    },
  });

  const updateLayerMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<UploadedLayer>) => {
      const res = await apiRequest("PATCH", `/api/uploaded-layers/${id}`, data);
      return res.json();
    },
    onMutate: async (variables) => {
      // Отменяем текущие запросы чтобы не перезаписали наше оптимистичное обновление
      await queryClient.cancelQueries({ queryKey: ["/api/uploaded-layers"] });
      
      // Сохраняем предыдущее состояние для возможного отката
      const previousLayers = queryClient.getQueryData<UploadedLayer[]>(["/api/uploaded-layers"]);
      
      // Оптимистично обновляем кэш — UI обновится мгновенно
      queryClient.setQueryData<UploadedLayer[]>(["/api/uploaded-layers"], (old) => 
        old?.map(layer => layer.id === variables.id ? { ...layer, ...variables } : layer) ?? []
      );
      
      return { previousLayers };
    },
    onError: (_err, _variables, context) => {
      // При ошибке откатываем к предыдущему состоянию
      if (context?.previousLayers) {
        queryClient.setQueryData(["/api/uploaded-layers"], context.previousLayers);
      }
      toast({
        title: "Ошибка обновления",
        description: "Не удалось обновить слой",
        variant: "destructive",
      });
    },
    // Не вызываем invalidateQueries — данные уже актуальны
  });

  const deleteLayerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/uploaded-layers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
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

      const layersToCreate = parsedLayers.map((layer, index) => ({
        name: layer.name,
        filename: file.name,
        geojson: layer.geojson,
        color: LAYER_COLORS[index % LAYER_COLORS.length],
        visible: true,
        opacity: 1,
        featureCount: layer.geojson.features.length,
      }));

      await createLayersBatchMutation.mutateAsync(layersToCreate);
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

  const toggleUploadedVisibility = (layer: UploadedLayer) => {
    updateLayerMutation.mutate({ id: layer.id, visible: !layer.visible });
  };

  const setColor = (layer: UploadedLayer, color: string) => {
    updateLayerMutation.mutate({ id: layer.id, color });
  };

  const setPointStyle = (layer: UploadedLayer, pointStyle: PointStyle) => {
    updateLayerMutation.mutate({ id: layer.id, pointStyle });
  };

  const setLineStyle = (layer: UploadedLayer, lineStyle: LineStyle) => {
    updateLayerMutation.mutate({ id: layer.id, lineStyle });
  };

  const getLayerGeometryType = (layer: UploadedLayer): LayerGeometryType => {
    const geom = layer.geojson?.features?.[0]?.geometry?.type;
    if (geom === "Point" || geom === "MultiPoint") return "point";
    if (geom === "LineString" || geom === "MultiLineString") return "line";
    if (geom === "Polygon" || geom === "MultiPolygon") return "polygon";
    return "unknown";
  };

  const pointLayers = uploadedLayers.filter(l => {
    const geom = l.geojson?.features?.[0]?.geometry?.type;
    return geom === "Point" || geom === "MultiPoint";
  });

  const lineLayers = uploadedLayers.filter(l => {
    const geom = l.geojson?.features?.[0]?.geometry?.type;
    return geom === "LineString" || geom === "MultiLineString";
  });

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
        className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1"
        data-testid={`layer-item-${layer.id}`}
      >
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span 
          className="text-xs font-medium truncate flex-1 min-w-0"
          title={layer.name}
        >
          {layer.name}
        </span>
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

  const renderUploadedLayerItem = (layer: UploadedLayer) => {
    return (
      <div
        key={layer.id}
        className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 min-w-0"
        data-testid={`uploaded-layer-item-${layer.id}`}
      >
        <div 
          className="h-2.5 w-2.5 rounded-full shrink-0" 
          style={{ backgroundColor: layer.color }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs font-medium min-w-0 cursor-default truncate flex-1">
              {layer.name.length > 30 ? `${layer.name.slice(0, 30)}...` : layer.name}
            </span>
          </TooltipTrigger>
          {layer.name.length > 30 && (
            <TooltipContent side="top" className="max-w-[300px]">
              <p className="text-xs break-words">{layer.name}</p>
            </TooltipContent>
          )}
        </Tooltip>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {layer.featureCount}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => toggleUploadedVisibility(layer)}
          data-testid={`button-toggle-visibility-${layer.id}`}
        >
          {layer.visible ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              data-testid={`button-style-picker-${layer.id}`}
            >
              <Palette className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="end">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Цвет</p>
                <div className="grid grid-cols-4 gap-1">
                  {LAYER_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`h-6 w-6 rounded-md border-2 hover:scale-110 transition-transform ${layer.color === color ? "border-foreground" : "border-transparent"}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setColor(layer, color)}
                      data-testid={`button-select-color-${layer.id}-${color}`}
                    />
                  ))}
                </div>
              </div>
              {getLayerGeometryType(layer) === "point" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Форма точки</p>
                  <div className="flex gap-1">
                    {POINT_STYLES.map((style) => {
                      const IconComponent = style.icon;
                      const isActive = (layer.pointStyle || "circle") === style.value;
                      return (
                        <Tooltip key={style.value}>
                          <TooltipTrigger asChild>
                            <button
                              className={`h-7 w-7 rounded-md border flex items-center justify-center hover:scale-110 transition-transform ${isActive ? "bg-accent border-foreground" : "border-border"}`}
                              onClick={() => setPointStyle(layer, style.value)}
                              data-testid={`button-point-style-${layer.id}-${style.value}`}
                            >
                              <IconComponent className="h-4 w-4" style={{ color: layer.color }} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="text-xs">{style.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              )}
              {getLayerGeometryType(layer) === "line" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Стиль линии</p>
                  <div className="flex gap-1">
                    {LINE_STYLES.map((style) => {
                      const isActive = (layer.lineStyle || "solid") === style.value;
                      return (
                        <Tooltip key={style.value}>
                          <TooltipTrigger asChild>
                            <button
                              className={`h-7 px-2 rounded-md border flex items-center justify-center gap-1 hover:scale-105 transition-transform ${isActive ? "bg-accent border-foreground" : "border-border"}`}
                              onClick={() => setLineStyle(layer, style.value)}
                              data-testid={`button-line-style-${layer.id}-${style.value}`}
                            >
                              <svg width="24" height="4" viewBox="0 0 24 4">
                                {style.value === "solid" && (
                                  <line x1="0" y1="2" x2="24" y2="2" stroke={layer.color} strokeWidth="2" />
                                )}
                                {style.value === "dashed" && (
                                  <line x1="0" y1="2" x2="24" y2="2" stroke={layer.color} strokeWidth="2" strokeDasharray="4 2" />
                                )}
                                {style.value === "double" && (
                                  <>
                                    <line x1="0" y1="1" x2="24" y2="1" stroke={layer.color} strokeWidth="1" />
                                    <line x1="0" y1="3" x2="24" y2="3" stroke={layer.color} strokeWidth="1" />
                                  </>
                                )}
                              </svg>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="text-xs">{style.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => deleteLayerMutation.mutate(layer.id)}
          disabled={deleteLayerMutation.isPending}
          data-testid={`button-delete-layer-${layer.id}`}
        >
          <Trash2 className="h-3 w-3 text-destructive" />
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || createLayersBatchMutation.isPending}
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
        {uploadedLayers.length >= 2 && pointLayers.length > 0 && lineLayers.length > 0 && (
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
    <div className="space-y-4">
      {headerContent}

      <Accordion type="multiple" defaultValue={["base", "wms", "wfs", "uploaded"]} className="space-y-1">
        {uploadedLayers.length > 0 && (
          <AccordionItem value="uploaded" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-uploaded-layers">
              <div className="flex items-center gap-2">
                <FileArchive className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Shapefile слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({uploadedLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {uploadedLayers.map(renderUploadedLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {baseLayers.length > 0 && (
          <AccordionItem value="base" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-base-layers">
              <div className="flex items-center gap-2">
                <Map className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Базовые слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({baseLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {baseLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wmsLayers.length > 0 && (
          <AccordionItem value="wms" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-wms-layers">
              <div className="flex items-center gap-2">
                <Layers className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">WMS слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({wmsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {wmsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wfsLayers.length > 0 && (
          <AccordionItem value="wfs" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-wfs-layers">
              <div className="flex items-center gap-2">
                <Database className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">WFS слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({wfsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {wfsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {layers.length === 0 && uploadedLayers.length === 0 && (
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
