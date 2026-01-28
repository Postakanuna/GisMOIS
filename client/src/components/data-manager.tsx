import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/contexts/scene-context";
import { parseShapefileWithEncoding } from "@/lib/shapefile-parser";
import { useIsMobile } from "@/hooks/use-mobile";
import { ExcelImportModal } from "@/components/excel-import-modal";
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
  Palette,
  Circle,
  Square,
  Triangle,
  Cloud,
  Minus,
  MoreHorizontal,
  Pencil,
  Check,
  FileText,
  ChevronDown,
  ChevronRight,
  Flame,
  Building2,
  Home,
  Gauge,
  Box,
  Zap,
  Waves,
  Anchor,
  FileSpreadsheet,
  Map,
} from "lucide-react";
import { useBaseLayers, type BaseLayerType } from "@/contexts/base-layers-context";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { 
  getHeatNetworkPreviewIcon, 
  isHeatNetworkStyle,
  type HeatNetworkPointStyle 
} from "@/lib/heat-network-icons";
import {
  getHeatNetworkLineStyles,
  getLinePreviewDataUrl,
  isHeatNetworkLineStyle,
  type HeatNetworkLineStyle
} from "@/lib/heat-network-lines";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  sourceFiles: string[] | null;
  crs: string;
  createdAt: string;
  updatedAt: string;
}

const LAYER_COLORS = [
  "#1976D2", "#D32F2F", "#388E3C", "#7B1FA2",
  "#F57C00", "#0097A7", "#C2185B", "#512DA8",
];

// Basic geometric shapes
const BASIC_POINT_STYLES = [
  { value: "circle", label: "Круг", icon: Circle },
  { value: "square", label: "Квадрат", icon: Square },
  { value: "triangle", label: "Треугольник", icon: Triangle },
  { value: "cloud", label: "Облачко", icon: Cloud },
];

// ГОСТ heat network symbols - using lucide icons as fallback for palette display
const HEAT_NETWORK_STYLES: { value: HeatNetworkPointStyle; label: string; icon: typeof Flame }[] = [
  { value: "heat-source", label: "Теплоисточник", icon: Flame },
  { value: "ctp", label: "ЦТП", icon: Building2 },
  { value: "itp", label: "ИТП", icon: Home },
  { value: "valve", label: "Задвижка", icon: Gauge },
  { value: "heat-chamber", label: "Тепловая камера", icon: Box },
  { value: "pump-station", label: "Насосная станция", icon: Zap },
  { value: "compensator", label: "Компенсатор", icon: Waves },
  { value: "support", label: "Опора", icon: Anchor },
];

const BASIC_LINE_STYLES = [
  { value: "solid", label: "Сплошная" },
  { value: "dashed", label: "Пунктирная" },
  { value: "double", label: "Двойная" },
];

const HEAT_NETWORK_LINE_STYLES = getHeatNetworkLineStyles();

interface DataManagerProps {
  onClose: () => void;
}

const MIN_WIDTH = 500;
const MIN_HEIGHT = 300;

export function DataManager({ onClose }: DataManagerProps) {
  const { toast } = useToast();
  const { currentSceneId, canEdit } = useScene();
  const isMobile = useIsMobile();
  const { baseLayers, activeBaseLayer, setActiveBaseLayer } = useBaseLayers();
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [editingLayerId, setEditingLayerId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedLayerId, setExpandedLayerId] = useState<number | null>(null);
  const [excelParseResult, setExcelParseResult] = useState<{
    fileName: string;
    columns: { index: number; name: string; detectedType: string }[];
    previewRows: Record<string, unknown>[];
    allRows: Record<string, unknown>[];
    totalRows: number;
  } | null>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);

  const { data: sceneLayers = [], isLoading: sceneLoading } = useQuery<EditableLayer[]>({
    queryKey: ["/api/scenes", currentSceneId, "editable-layers"],
    enabled: !!currentSceneId,
  });

  // Single query key for all editable layers operations
  const editableLayersQueryKey = ["/api/scenes", currentSceneId, "editable-layers"];

  const deleteLayerMutation = useMutation({
    mutationFn: async (layerId: number) => {
      await apiRequest("DELETE", `/api/editable-layers/${layerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
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
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: editableLayersQueryKey });
      const previousLayers = queryClient.getQueryData<EditableLayer[]>(editableLayersQueryKey);
      queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => 
        old?.map(layer => layer.id === variables.id ? { ...layer, visible: variables.visible } : layer) ?? []
      );
      return { previousLayers };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousLayers) {
        queryClient.setQueryData(editableLayersQueryKey, context.previousLayers);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const updateLayerStyleMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; color?: string; pointStyle?: string; lineStyle?: string; name?: string }) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, data);
      return res.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: editableLayersQueryKey });
      const previousLayers = queryClient.getQueryData<EditableLayer[]>(editableLayersQueryKey);
      queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => 
        old?.map(layer => layer.id === variables.id ? { ...layer, ...variables } : layer) ?? []
      );
      return { previousLayers };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousLayers) {
        queryClient.setQueryData(editableLayersQueryKey, context.previousLayers);
      }
      toast({ title: "Ошибка обновления", variant: "destructive" });
    },
    onSuccess: () => {
      setEditingLayerId(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const handleStartEditing = (layer: EditableLayer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveName = (layerId: number) => {
    if (editingName.trim()) {
      updateLayerStyleMutation.mutate({ id: layerId, name: editingName.trim() });
    } else {
      setEditingLayerId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, layerId: number) => {
    if (e.key === "Enter") {
      handleSaveName(layerId);
    } else if (e.key === "Escape") {
      setEditingLayerId(null);
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position, isMobile]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.stopPropagation();
    setIsResizing(true);
    dragOffset.current = {
      x: e.clientX,
      y: e.clientY,
    };
  }, [isMobile]);

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
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const SERVER_UPLOAD_THRESHOLD = 10 * 1024 * 1024;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress("");

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileSize = file.size;
        const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
        
        if (fileSize > SERVER_UPLOAD_THRESHOLD) {
          setUploadProgress(`Загрузка ${file.name} (${fileSizeMB} МБ) на сервер...`);
          
          const formData = new FormData();
          formData.append("file", file);
          if (currentSceneId) {
            formData.append("sceneId", currentSceneId.toString());
          }
          
          const res = await fetch("/api/datasets/upload", {
            method: "POST",
            body: formData,
            credentials: "include",
          });
          
          if (!res.ok) {
            let errorMessage = "Ошибка загрузки на сервер";
            try {
              const error = await res.json();
              errorMessage = error.message || errorMessage;
            } catch {
              // Response is not JSON, use status text
              errorMessage = `Ошибка сервера: ${res.status} ${res.statusText}`;
            }
            throw new Error(errorMessage);
          }
          
          // Safely parse success response
          try {
            await res.json();
          } catch {
            console.warn("Could not parse upload response as JSON");
          }
          
          setUploadProgress(`Обработка завершена`);
        } else {
          setUploadProgress(`Обработка ${file.name}...`);
          const arrayBuffer = await file.arrayBuffer();
          
          const parsedLayers = await parseShapefileWithEncoding(arrayBuffer, file.name);
          
          if (parsedLayers.length === 0) {
            throw new Error("Не найдено слоёв в архиве");
          }
          
          for (const layer of parsedLayers) {
            if (!layer.geojson.features || layer.geojson.features.length === 0) {
              continue;
            }
            
            const firstFeature = layer.geojson.features[0];
            const geometryType = firstFeature.geometry?.type || "Unknown";
            
            console.log("Import layer sourceFiles:", layer.sourceFiles);
            
            const res = await apiRequest("POST", "/api/datasets/import", {
              name: layer.name,
              geometryType,
              geojson: layer.geojson,
              sourceFileName: file.name,
              sourceFiles: layer.sourceFiles || [],
              crs: layer.sourceCrs || "EPSG:4326",
              sceneId: currentSceneId,
            });

            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Upload failed");
            }
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
      setUploadProgress("");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsParsingExcel(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Ошибка парсинга файла");
      }

      const result = await response.json();
      setExcelParseResult(result);
    } catch (error) {
      console.error("Excel parse error:", error);
      toast({
        title: "Ошибка чтения Excel",
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setIsParsingExcel(false);
      if (excelInputRef.current) {
        excelInputRef.current.value = "";
      }
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

  const containerClasses = isMobile
    ? "fixed inset-0 bg-card flex flex-col z-50"
    : "fixed bg-card border rounded-lg shadow-lg flex flex-col z-50";

  const containerStyle = isMobile
    ? {}
    : {
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      };

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      style={containerStyle}
      data-testid="data-manager-window"
    >
      <div
        className={`flex items-center justify-between px-3 py-2 border-b bg-muted/50 ${isMobile ? '' : 'cursor-move rounded-t-lg'}`}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          {!isMobile && <GripVertical className="h-4 w-4 text-muted-foreground" />}
          <Database className="h-4 w-4" />
          <span className="font-medium text-sm">Менеджер данных</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
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
            <span className="text-sm font-medium">Слои</span>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => excelInputRef.current?.click()}
              disabled={isParsingExcel || !canEdit}
              data-testid="button-upload-excel"
            >
              {isParsingExcel ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 mr-2" />
              )}
              Импорт XLS
            </Button>
            <input
              ref={excelInputRef}
              type="file"
              className="hidden"
              accept=".xls,.xlsx"
              onChange={handleExcelFileChange}
              data-testid="input-excel"
            />
          </div>
        </div>
        
        {uploadProgress && (
          <div className="mb-3 p-2 bg-muted rounded text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {uploadProgress}
          </div>
        )}
        
        <ScrollArea className="flex-1">
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Map className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Базовые слои</span>
            </div>
            <div className="rounded-md border bg-background p-3">
              <RadioGroup
                value={activeBaseLayer}
                onValueChange={(value) => {
                  setActiveBaseLayer(value as BaseLayerType);
                }}
                className="space-y-2"
                data-testid="base-layer-radio-group"
              >
                {baseLayers.map((layer) => (
                  <div key={layer.id} className="flex items-center space-x-2">
                    <RadioGroupItem
                      value={layer.id}
                      id={`base-layer-${layer.id}`}
                      data-testid={`radio-base-layer-${layer.id}`}
                    />
                    <Label
                      htmlFor={`base-layer-${layer.id}`}
                      className="text-sm cursor-pointer"
                    >
                      {layer.name}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Слои сцены ({sceneLayers.length})</span>
          </div>

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
                  className="rounded-md border bg-background"
                  data-testid={`scene-layer-${layer.id}`}
                >
                  <div className="flex items-center gap-2 p-2">
                    {layer.source === "import" && layer.sourceFiles && layer.sourceFiles.length > 0 && (
                      <button
                        onClick={() => setExpandedLayerId(expandedLayerId === layer.id ? null : layer.id)}
                        className="shrink-0 p-0.5 hover:bg-muted rounded"
                        data-testid={`button-expand-${layer.id}`}
                      >
                        {expandedLayerId === layer.id ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </button>
                    )}
                    <div 
                      className="w-3 h-3 rounded-sm shrink-0" 
                      style={{ backgroundColor: layer.color }}
                    />
                    <span className="text-lg w-6 text-center shrink-0" title={layer.geometryType}>
                      {getGeometryIcon(layer.geometryType)}
                    </span>
                    <div className="flex-1 min-w-0">
                      {editingLayerId === layer.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, layer.id)}
                            className="h-6 text-sm"
                            autoFocus
                            data-no-drag
                            data-testid={`input-layer-name-${layer.id}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => handleSaveName(layer.id)}
                            data-testid={`button-save-name-${layer.id}`}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <div className="font-medium text-sm truncate">
                            {layer.name}
                          </div>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100"
                              onClick={() => handleStartEditing(layer)}
                              data-testid={`button-edit-name-${layer.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{layer.featureCount} объектов</span>
                        {layer.source === "import" && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            импорт
                          </Badge>
                        )}
                      </div>
                    </div>
                  
                    <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        data-testid={`button-layer-style-${layer.id}`}
                      >
                        <Palette className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3" align="end">
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-medium mb-2">Цвет</p>
                          <div className="flex flex-wrap gap-1">
                            {LAYER_COLORS.map((color) => (
                              <button
                                key={color}
                                className={`h-6 w-6 rounded-sm border ${layer.color === color ? "ring-2 ring-primary ring-offset-1" : ""}`}
                                style={{ backgroundColor: color }}
                                onClick={() => updateLayerStyleMutation.mutate({ id: layer.id, color })}
                                data-testid={`color-option-${layer.id}-${color}`}
                              />
                            ))}
                          </div>
                        </div>
                        
                        {layer.geometryType === "Point" && (
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-medium mb-2">Базовые формы</p>
                              <div className="flex flex-wrap gap-1">
                                {BASIC_POINT_STYLES.map(({ value, label, icon: Icon }) => (
                                  <Tooltip key={value}>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`h-7 w-7 flex items-center justify-center rounded border ${layer.pointStyle === value ? "bg-primary/20 border-primary" : "border-border"}`}
                                        onClick={() => updateLayerStyleMutation.mutate({ id: layer.id, pointStyle: value })}
                                        data-testid={`point-style-${layer.id}-${value}`}
                                      >
                                        <Icon className="h-4 w-4" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                      <p className="text-xs">{label}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            </div>
                            
                            <div>
                              <p className="text-xs font-medium mb-2">Тепловые сети (ГОСТ)</p>
                              <div className="flex flex-wrap gap-1">
                                {HEAT_NETWORK_STYLES.map(({ value, label, icon: Icon }) => (
                                  <Tooltip key={value}>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`h-7 w-7 flex items-center justify-center rounded border ${layer.pointStyle === value ? "bg-primary/20 border-primary" : "border-border"}`}
                                        onClick={() => updateLayerStyleMutation.mutate({ id: layer.id, pointStyle: value })}
                                        data-testid={`point-style-${layer.id}-${value}`}
                                      >
                                        {isHeatNetworkStyle(value) ? (
                                          <img 
                                            src={getHeatNetworkPreviewIcon(value, layer.color)} 
                                            alt={label}
                                            className="h-5 w-5"
                                          />
                                        ) : (
                                          <Icon className="h-4 w-4" />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                      <p className="text-xs">{label}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {layer.geometryType === "LineString" && (
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-medium mb-2">Базовые стили</p>
                              <div className="flex gap-1">
                                {BASIC_LINE_STYLES.map(({ value, label }) => (
                                  <Tooltip key={value}>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`h-7 px-2 flex items-center justify-center rounded border text-xs ${layer.lineStyle === value ? "bg-primary/20 border-primary" : "border-border"}`}
                                        onClick={() => updateLayerStyleMutation.mutate({ id: layer.id, lineStyle: value })}
                                        data-testid={`line-style-${layer.id}-${value}`}
                                      >
                                        {value === "solid" && <Minus className="h-4 w-4" />}
                                        {value === "dashed" && <MoreHorizontal className="h-4 w-4" />}
                                        {value === "double" && <span className="font-bold">=</span>}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                      <p className="text-xs">{label}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            </div>
                            
                            <div>
                              <p className="text-xs font-medium mb-2">Тепловые сети (ГОСТ)</p>
                              <div className="flex flex-wrap gap-1">
                                {HEAT_NETWORK_LINE_STYLES.map(({ value, label }) => (
                                  <Tooltip key={value}>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`h-8 px-1 flex items-center justify-center rounded border ${layer.lineStyle === value ? "bg-primary/20 border-primary" : "border-border"}`}
                                        onClick={() => updateLayerStyleMutation.mutate({ id: layer.id, lineStyle: value })}
                                        data-testid={`line-style-${layer.id}-${value}`}
                                      >
                                        <img 
                                          src={getLinePreviewDataUrl(value, layer.color)} 
                                          alt={label}
                                          className="h-4 w-12"
                                        />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                      <p className="text-xs">{label}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  
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
                  
                  {/* Source files panel - shown when expanded */}
                  {expandedLayerId === layer.id && layer.sourceFiles && layer.sourceFiles.length > 0 && (
                    <div className="px-3 py-2 border-t bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Файлы shapefile:</p>
                      <div className="flex flex-wrap gap-1">
                        {layer.sourceFiles.map((file, idx) => (
                          <Badge key={idx} variant="secondary" className="text-[10px] py-0">
                            <FileText className="h-3 w-3 mr-1" />
                            {file}
                          </Badge>
                        ))}
                      </div>
                      {layer.crs && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          CRS: {layer.crs}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {!isMobile && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={handleResizeMouseDown}
          data-testid="resize-handle"
        />
      )}

      {excelParseResult && (
        <ExcelImportModal
          parseResult={excelParseResult}
          onClose={() => setExcelParseResult(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
          }}
        />
      )}
    </div>
  );
}
