import { useState, Fragment, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Map, Database, Building2, Users, ChevronRight, Eye, EyeOff, Trash2, FileArchive, Download, Loader2, FolderOpen, FolderClosed, Palette, Table2, MapPin, Bot, Globe, Ruler, Settings2 } from "lucide-react";
import { useDxfLayers, type DxfSurveyLayer } from "@/contexts/dxf-layers-context";
import { useHiddenCategories } from "@/contexts/hidden-categories-context";
import { DxfImportDialog } from "@/components/dxf-import-dialog";
import { useScene } from "@/contexts/scene-context";
import { useBaseLayers, type BaseLayerType } from "@/contexts/base-layers-context";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import type { LayerConfig, EditableLayer, GeometryType, ConnectionStatus } from "@shared/schema";
import type { LayerFilters, ActiveFilters } from "@/hooks/use-zulu-connection";
import { Plus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LayerLegendIcon } from "@/components/layer-legend-icon";

const truncateName = (name: string, maxLength: number = 30): string => {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
};

const NETWORK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  source: { label: "Источник", color: "#e53935" },
  ctp: { label: "ЦТП", color: "#8e24aa" },
  consumer: { label: "Потребитель", color: "#43a047" },
  segment: { label: "Участок", color: "#1e88e5" },
  valve: { label: "Задвижка", color: "#f4511e" },
  node: { label: "Узел", color: "#6d4c41" },
  pump: { label: "Насос", color: "#00acc1" },
  accident: { label: "Авария", color: "#e65100" },
};

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

interface FolderData {
  id: number;
  sceneId: number;
  name: string;
  visible: boolean;
  displayOrder: number;
  createdAt: string;
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
  // Popover toolbar action props
  onOpenAttributeTable?: (layerId: number, layerName: string) => void;
  onOpenStyleConfig?: (layerId: number) => void;
  onOpenGeocodeDialog?: (layerId: number) => void;
  onToggleAiChat?: () => void;
  aiChatActive?: boolean;
  aiChatContent?: ReactNode;
  aiHeaderActions?: ReactNode;
  onOpenDataManager?: () => void;
  connectionStatus?: ConnectionStatus;
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
  onOpenAttributeTable,
  onOpenStyleConfig,
  onOpenGeocodeDialog,
  onToggleAiChat,
  aiChatActive = false,
  aiChatContent,
  aiHeaderActions,
  onOpenDataManager,
  connectionStatus,
}: LayerPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentSceneId } = useScene();
  const [newLayerDialogOpen, setNewLayerDialogOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerGeomType, setNewLayerGeomType] = useState<GeometryType>("Point");
  const [legendLayerId, setLegendLayerId] = useState<number | null>(null);
  const [popoverLayerId, setPopoverLayerId] = useState<number | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<number>>(new Set());

  const { baseLayers: baseLayerOptions, activeBaseLayer, setActiveBaseLayer } = useBaseLayers();
  const { surveyLayers, toggleSurveyLayerVisibility, setSurveyLayerOpacity, removeSurveyLayer } = useDxfLayers();
  const { toggleCategory, isHidden } = useHiddenCategories();
  const [editDxfLayer, setEditDxfLayer] = useState<DxfSurveyLayer | null>(null);

  const { data: folders = [] } = useQuery<FolderData[]>({
    queryKey: ["/api/scenes", currentSceneId, "folders"],
    enabled: !!currentSceneId,
  });

  const toggleFolderVisibilityMutation = useMutation({
    mutationFn: async ({ folderId, visible }: { folderId: number; visible: boolean }) => {
      const res = await apiRequest("POST", `/api/folders/${folderId}/toggle-visibility`, { visible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "folders"] });
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

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
      window.dispatchEvent(new Event("viewport-features-invalidate"));
      toast({
        title: "Слой удалён",
        description: "Shapefile удалён с карты",
      });
    },
  });

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
        className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 min-w-0 overflow-hidden cursor-pointer transition-colors hover:bg-accent/50"
        onClick={() => onToggleVisibility(layer.id)}
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
        {layer.visible ? (
          <Eye className="h-3 w-3 shrink-0 text-primary" data-testid={`button-toggle-layer-${layer.id}`} />
        ) : (
          <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" data-testid={`button-toggle-layer-${layer.id}`} />
        )}
      </div>
    );
  };

  const headerContent = (
    <div className="flex items-center justify-between gap-2 pb-2 border-b border-sidebar-border">
      <div className="flex items-center gap-2">
        {onToggleAiChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={aiChatActive ? "secondary" : "ghost"}
                onClick={onToggleAiChat}
                data-testid="button-toggle-ai-chat"
              >
                <Bot className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{aiChatActive ? "Вернуться к слоям" : "ИИ-ассистент"}</TooltipContent>
          </Tooltip>
        )}
        <h2 className="text-lg font-medium">{aiChatActive ? "ИИ-ассистент" : "Слои карты"}</h2>
      </div>
      <div className="flex items-center gap-1">
        {aiChatActive ? aiHeaderActions : (
          <>
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
            {onOpenDataManager && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={onOpenDataManager}
                    data-testid="button-open-data-manager"
                  >
                    <Database className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Менеджер данных</p>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  );

  const layerContent = (
    <Fragment>
      <Accordion type="multiple" defaultValue={["base", "external", "uploaded", "editable", "survey"]} className="space-y-1 min-w-0">
        {/* Survey layers (DXF underlays) */}
        {surveyLayers.length > 0 && (
          <AccordionItem value="survey" className="border-none min-w-0">
            <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-survey-layers">
              <div className="flex items-center gap-2 min-w-0">
                <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">Подложки съёмки</span>
                <span className="text-[10px] text-muted-foreground shrink-0">({surveyLayers.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1 min-w-0">
              {surveyLayers.map(sl => (
                <div key={sl.id} className="rounded-md border border-sidebar-border p-2 space-y-1.5" data-testid={`survey-layer-panel-${sl.id}`}>
                  <div className="flex items-center gap-1">
                    <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: sl.color }} />
                    <span className="text-xs font-medium flex-1 truncate min-w-0" title={sl.name}>{sl.name}</span>
                    <button
                      onClick={() => toggleSurveyLayerVisibility(sl.id)}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent/50 shrink-0"
                      data-testid={`button-panel-toggle-survey-${sl.id}`}
                    >
                      {sl.visible
                        ? <Eye className="h-3 w-3 text-muted-foreground" />
                        : <EyeOff className="h-3 w-3 text-muted-foreground" />
                      }
                    </button>
                    <button
                      onClick={() => setEditDxfLayer(sl)}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent/50 shrink-0"
                      data-testid={`button-panel-edit-survey-${sl.id}`}
                      title="Настройки подложки"
                    >
                      <Settings2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => removeSurveyLayer(sl.id)}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive shrink-0"
                      data-testid={`button-panel-remove-survey-${sl.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-0.5">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={sl.opacity}
                      onChange={(e) => setSurveyLayerOpacity(sl.id, parseFloat(e.target.value))}
                      className="flex-1 h-1 accent-primary cursor-pointer"
                      data-testid={`slider-panel-survey-opacity-${sl.id}`}
                    />
                    <span className="text-[10px] text-muted-foreground w-7 text-right shrink-0">{Math.round(sl.opacity * 100)}%</span>
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

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
              {(() => {
                const renderEditableLayerItem = (layer: EditableLayer) => {
                  const sc = layer.styleConfig as any;
                  const hasLegend = sc && sc.renderer !== "single";
                  return (
                    <div key={layer.id} className={`rounded-md border transition-colors overflow-hidden ${
                      activeEditableLayer?.id === layer.id
                        ? "border-primary bg-primary/10"
                        : "border-sidebar-border hover:bg-accent/50"
                    }`}>
                      <div
                        className="flex items-center gap-1 px-2 py-1 cursor-pointer"
                        onClick={() => {
                          if (hasLegend) {
                            setLegendLayerId(legendLayerId === layer.id ? null : layer.id);
                          }
                          onSelectEditableLayer?.(layer);
                        }}
                        data-testid={`editable-layer-item-${layer.id}`}
                      >
                        <div className="flex items-center gap-1 shrink-0">
                          <LayerLegendIcon
                            geometryType={layer.geometryType}
                            color={layer.color}
                            pointStyle={layer.pointStyle}
                            lineStyle={layer.lineStyle}
                            styleConfig={layer.styleConfig}
                            customIconId={(layer as any).customIconId}
                          />
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                          <span className="text-xs font-medium" title={layer.name}>
                            {truncateName(layer.name)}
                          </span>
                          {(layer as any).networkType && NETWORK_TYPE_LABELS[(layer as any).networkType] && (
                            <span
                              className="text-[9px] px-1 py-0 rounded shrink-0 font-medium text-white leading-tight"
                              style={{ backgroundColor: NETWORK_TYPE_LABELS[(layer as any).networkType].color }}
                              title={`Тип сети: ${NETWORK_TYPE_LABELS[(layer as any).networkType].label}`}
                              data-testid={`badge-network-type-${layer.id}`}
                            >
                              {NETWORK_TYPE_LABELS[(layer as any).networkType].label}
                            </span>
                          )}
                          {layer.source === "import" && (
                            <FileArchive className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                          )}
                          {!layer.visible && (
                            <EyeOff className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                          )}
                          {hasLegend && (
                            <ChevronRight className={`h-2.5 w-2.5 text-muted-foreground shrink-0 transition-transform ${legendLayerId === layer.id ? "rotate-90" : ""}`} />
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {layer.featureCount || 0}
                        </span>
                        <Popover open={popoverLayerId === layer.id} onOpenChange={(open) => setPopoverLayerId(open ? layer.id : null)}>
                          <PopoverTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              data-testid={`button-layer-tools-${layer.id}`}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent side="right" align="start" className="w-auto p-1.5" data-testid={`popover-layer-toolbar-${layer.id}`}>
                          <div className="flex items-center gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPopoverLayerId(null);
                                    onOpenStyleConfig?.(layer.id);
                                  }}
                                  data-testid={`button-style-config-${layer.id}`}
                                >
                                  <Palette className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Стиль</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPopoverLayerId(null);
                                    onOpenAttributeTable?.(layer.id, layer.name);
                                  }}
                                  data-testid={`button-attribute-table-${layer.id}`}
                                >
                                  <Table2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Таблица атрибутов</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPopoverLayerId(null);
                                    updateLayerMutation.mutate({ id: layer.id, visible: !layer.visible });
                                  }}
                                  data-testid={`button-toggle-visibility-${layer.id}`}
                                >
                                  {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>{layer.visible ? "Скрыть" : "Показать"}</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPopoverLayerId(null);
                                    onOpenGeocodeDialog?.(layer.id);
                                  }}
                                  data-testid={`button-geocode-${layer.id}`}
                                >
                                  <MapPin className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Геокодирование</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPopoverLayerId(null);
                                    window.open(`/api/editable-layers/${layer.id}/export/shapefile`, "_blank");
                                  }}
                                  data-testid={`button-export-${layer.id}`}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Экспорт</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPopoverLayerId(null);
                                    deleteImportedLayerMutation.mutate(layer.id);
                                  }}
                                  data-testid={`button-delete-layer-${layer.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Удалить</p></TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="border-t mt-1 pt-1">
                            <Select
                              value={(layer as any).networkType || "__none__"}
                              onValueChange={(val) => {
                                const newType = val === "__none__" ? null : val;
                                updateLayerMutation.mutate({ id: layer.id, networkType: newType });
                              }}
                            >
                              <SelectTrigger className="h-6 text-[10px]" data-testid={`select-network-type-${layer.id}`}>
                                <SelectValue placeholder="Тип сети..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Не задано</SelectItem>
                                <SelectItem value="source">Источник</SelectItem>
                                <SelectItem value="ctp">ЦТП</SelectItem>
                                <SelectItem value="consumer">Потребитель</SelectItem>
                                <SelectItem value="segment">Участок</SelectItem>
                                <SelectItem value="valve">Задвижка</SelectItem>
                                <SelectItem value="node">Узел</SelectItem>
                                <SelectItem value="pump">Насос</SelectItem>
                                <SelectItem value="accident">Авария</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </PopoverContent>
                      </Popover>
                      </div>
                      {legendLayerId === layer.id && hasLegend && (
                        <div className="px-3 py-2 border-t bg-muted/20 space-y-1" data-testid={`legend-layer-${layer.id}`}>
                          <p className="text-[10px] text-muted-foreground font-medium mb-1">
                            {sc.renderer === "categorized" ? "Категории" : "Градация"}: {sc.field}
                          </p>
                          {sc.renderer === "categorized" && sc.categorizedClasses && (
                            <div className="space-y-0.5">
                              {sc.categorizedClasses.map((cls: any, i: number) => {
                                const valKey = String(cls.value);
                                const hidden = isHidden(layer.id, valKey);
                                return (
                                  <div
                                    key={i}
                                    className={`flex items-center gap-1.5 group/catrow ${hidden ? "opacity-40" : ""}`}
                                  >
                                    <span className="flex-shrink-0">
                                      <LayerLegendIcon
                                        geometryType={layer.geometryType}
                                        color={cls.style?.color || layer.color}
                                        pointStyle={cls.style?.pointStyle || layer.pointStyle}
                                        lineStyle={layer.lineStyle}
                                        customIconId={cls.style?.customIconId}
                                      />
                                    </span>
                                    <span className={`text-[11px] truncate flex-1 ${hidden ? "line-through text-muted-foreground" : ""}`}>
                                      {cls.label || String(cls.value)}
                                    </span>
                                    <button
                                      className="opacity-0 group-hover/catrow:opacity-100 transition-opacity flex-shrink-0 text-muted-foreground hover:text-foreground"
                                      onClick={() => toggleCategory(layer.id, valKey)}
                                      title={hidden ? "Показать категорию" : "Скрыть категорию"}
                                      data-testid={`button-cat-vis-${layer.id}-${i}`}
                                    >
                                      {hidden
                                        ? <EyeOff className="h-3 w-3" />
                                        : <Eye className="h-3 w-3" />}
                                    </button>
                                  </div>
                                );
                              })}
                              {sc.defaultStyle && (
                                <div className="flex items-center gap-1.5 group/catrow">
                                  <span className="flex-shrink-0">
                                    <LayerLegendIcon
                                      geometryType={layer.geometryType}
                                      color={sc.defaultStyle.color}
                                      pointStyle={layer.pointStyle}
                                      lineStyle={layer.lineStyle}
                                    />
                                  </span>
                                  <span className="text-[11px] truncate text-muted-foreground flex-1">Прочее</span>
                                </div>
                              )}
                            </div>
                          )}
                          {sc.renderer === "graduated" && sc.graduatedClasses && (
                            <div className="space-y-0.5">
                              {sc.graduatedClasses.map((cls: any, i: number) => (
                                <div key={i} className="flex items-center gap-1.5">
                                  <span className="flex-shrink-0">
                                    <LayerLegendIcon
                                      geometryType={layer.geometryType}
                                      color={cls.style?.color || layer.color}
                                      pointStyle={layer.pointStyle}
                                      lineStyle={layer.lineStyle}
                                    />
                                  </span>
                                  <span className="text-[11px] truncate">{cls.label}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                const folderMap: Record<number, FolderData> = {};
                for (const f of folders) {
                  folderMap[f.id] = f;
                }

                const groupedByFolder: Record<number, EditableLayer[]> = {};

                for (const layer of editableLayers) {
                  const fid = (layer as any).folderId as number | null | undefined;
                  if (fid && folderMap[fid]) {
                    if (!groupedByFolder[fid]) {
                      groupedByFolder[fid] = [];
                    }
                    groupedByFolder[fid].push(layer);
                  }
                }

                type TopItem =
                  | { type: "folder"; folder: FolderData; displayOrder: number }
                  | { type: "layer"; layer: EditableLayer; displayOrder: number };

                const topItems: TopItem[] = [
                  ...folders.map(f => ({ type: "folder" as const, folder: f, displayOrder: f.displayOrder ?? 0 })),
                  ...editableLayers
                    .filter(l => !(l as any).folderId)
                    .map(l => ({ type: "layer" as const, layer: l, displayOrder: (l as any).displayOrder ?? 0 })),
                ].sort((a, b) => a.displayOrder - b.displayOrder);

                return (
                  <>
                    {topItems.map((item) => {
                      if (item.type === "folder") {
                        const folder = item.folder;
                        const folderLayers = (groupedByFolder[folder.id] || [])
                          .sort((a, b) => ((a as any).displayOrder ?? 0) - ((b as any).displayOrder ?? 0));
                        if (folderLayers.length === 0) return null;
                        const isCollapsed = collapsedFolders.has(folder.id);
                        return (
                          <Collapsible
                            key={`folder-${folder.id}`}
                            open={!isCollapsed}
                            onOpenChange={(open) => {
                              setCollapsedFolders((prev) => {
                                const next = new Set(prev);
                                if (open) {
                                  next.delete(folder.id);
                                } else {
                                  next.add(folder.id);
                                }
                                return next;
                              });
                            }}
                          >
                            <div className="rounded-md border border-sidebar-border" data-testid={`folder-item-${folder.id}`}>
                              <div className="flex items-center gap-1 px-2 py-1">
                                <CollapsibleTrigger asChild>
                                  <button className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer" data-testid={`button-toggle-folder-${folder.id}`}>
                                    {isCollapsed ? (
                                      <FolderClosed className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    ) : (
                                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    )}
                                    <span className="text-xs font-medium truncate">{folder.name}</span>
                                    <span className="text-[10px] text-muted-foreground shrink-0">({folderLayers.length})</span>
                                  </button>
                                </CollapsibleTrigger>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleFolderVisibilityMutation.mutate({ folderId: folder.id, visible: !folder.visible });
                                      }}
                                      data-testid={`button-toggle-folder-visibility-${folder.id}`}
                                    >
                                      {folder.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent><p>{folder.visible ? "Скрыть папку" : "Показать папку"}</p></TooltipContent>
                                </Tooltip>
                              </div>
                              <CollapsibleContent className="space-y-1 px-1 pb-1">
                                {folderLayers.map(renderEditableLayerItem)}
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        );
                      } else {
                        return renderEditableLayerItem(item.layer);
                      }
                    })}
                  </>
                );
              })()}
              {editableLayers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Нажмите "+" для создания слоя
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="external" className="border-none min-w-0">
          <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-external-connection">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">Внешнее подключение</span>
              {connectionStatus && (
                <div className="flex items-center gap-1 shrink-0">
                  <div className={`h-2 w-2 rounded-full ${
                    connectionStatus === "connected" ? "bg-green-500" :
                    connectionStatus === "connecting" ? "bg-yellow-500 animate-pulse" :
                    connectionStatus === "error" ? "bg-destructive" :
                    "bg-muted-foreground"
                  }`} />
                  <span className="text-[10px] text-muted-foreground">
                    {connectionStatus === "connected" ? "Подключено" :
                     connectionStatus === "connecting" ? "Подключение..." :
                     connectionStatus === "error" ? "Ошибка" :
                     "Не подключено"}
                  </span>
                </div>
              )}
              {(wmsLayers.length + wfsLayers.length) > 0 && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({wmsLayers.length + wfsLayers.length})
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-1 pt-1 min-w-0">
            {wmsLayers.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 px-1">
                  <Layers className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                  <span className="text-[10px] text-muted-foreground font-medium">WMS ({wmsLayers.length})</span>
                </div>
                {wmsLayers.map(renderLayerItem)}
              </div>
            )}
            {wfsLayers.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 px-1">
                  <Database className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                  <span className="text-[10px] text-muted-foreground font-medium">WFS ({wfsLayers.length})</span>
                </div>
                {wfsLayers.map(renderLayerItem)}
              </div>
            )}
            {wmsLayers.length === 0 && wfsLayers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                {connectionStatus === "error" ? "Ошибка подключения к серверу" :
                 connectionStatus === "connecting" ? "Загрузка слоёв..." :
                 connectionStatus === "connected" ? "Нет внешних слоёв" :
                 "Сервер не подключён"}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="base" className="border-none min-w-0">
          <AccordionTrigger className="py-1 hover:no-underline min-w-0" data-testid="accordion-base-layers">
            <div className="flex items-center gap-2 min-w-0">
              <Map className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">Базовые слои</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-1 pt-1 min-w-0">
            {baseLayerOptions.map((bl) => (
              <div
                key={bl.id}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 min-w-0 overflow-hidden cursor-pointer transition-colors ${
                  activeBaseLayer === bl.id
                    ? "border-primary bg-primary/10"
                    : "border-sidebar-border hover:bg-accent/50"
                }`}
                onClick={() => setActiveBaseLayer(bl.id)}
                data-testid={`base-layer-item-${bl.id}`}
              >
                <Map className="h-3 w-3 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <span className="block text-xs font-medium">{bl.name}</span>
                </div>
                {activeBaseLayer === bl.id ? (
                  <Eye className="h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {editDxfLayer && (
        <DxfImportDialog
          open={true}
          onOpenChange={(v) => { if (!v) setEditDxfLayer(null); }}
          editLayer={editDxfLayer}
        />
      )}

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
    </Fragment>
  );

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="shrink-0">
        {headerContent}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 min-w-0 scrollbar-thin">
        {aiChatActive ? aiChatContent : layerContent}
      </div>
    </div>
  );
}
