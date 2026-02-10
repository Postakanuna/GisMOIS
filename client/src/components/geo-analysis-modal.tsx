import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Download,
  Plus,
  X,
  Layers,
  Target,
  Square,
  AlertCircle,
  ArrowLeft,
  Eye,
  FileSpreadsheet,
  ChevronRight,
  MapPin,
  Minus as LineIcon,
  Pentagon,
  BarChart3,
  Play,
  RotateCcw,
  Settings,
  Search,
  Filter,
  Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { EditableLayer, DrawnFeature } from "@shared/schema";

interface FilterCondition {
  id: string;
  attribute: string;
  operator: string;
  value: string;
}

interface SelectedLayerEntry {
  layerId: number;
  filters: FilterCondition[];
  filterSqlPreview: string;
}

type BoundaryMode = "inside" | "outside" | "none";
type BoundaryType = "polygon" | "line";
type ModalStep = "config" | "report-constructor" | "results";

interface LayerAnalysisResult {
  layerId: number;
  layerName: string;
  geometryType: string;
  totalCount: number;
  matchedCount: number;
}

interface LayerDetailResult {
  layerName: string;
  geometryType: string;
  availableAttributes: string[];
  features: { id: number; properties: Record<string, unknown> }[];
}

interface AnalysisResults {
  mode: "distance-binding" | "boundary-only";
  summary: {
    totalObjects: number;
    boundaryLayerName: string | null;
    boundaryCount: number;
    targetLayerName: string | null;
    byLayer: LayerAnalysisResult[];
  };
  details: Record<string, LayerDetailResult>;
}

interface GeoAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  editableLayers: EditableLayer[];
  sceneId: number | null;
}

const OPERATORS = [
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "contains", label: "LIKE" },
  { value: "not_contains", label: "NOT LIKE" },
];

const OPERATOR_LABELS: Record<string, string> = {
  "=": "равно",
  "!=": "не равно",
  ">": "больше",
  "<": "меньше",
  ">=": "больше или равно",
  "<=": "меньше или равно",
  "contains": "содержит",
  "not_contains": "не содержит",
};

const GEOM_TYPE_LABELS: Record<string, string> = {
  Point: "Точка",
  LineString: "Линия",
  Polygon: "Полигон",
};

const GEOM_TYPE_ICONS: Record<string, typeof MapPin> = {
  Point: MapPin,
  LineString: LineIcon,
  Polygon: Pentagon,
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function buildSqlPreview(conditions: FilterCondition[]): string {
  const valid = conditions.filter(c => c.attribute && c.value !== "");
  if (valid.length === 0) return "";
  return valid.map(c => {
    const val = isNaN(Number(c.value)) ? `'${c.value}'` : c.value;
    if (c.operator === "contains") return `${c.attribute} LIKE '%${c.value}%'`;
    if (c.operator === "not_contains") return `${c.attribute} NOT LIKE '%${c.value}%'`;
    return `${c.attribute} ${c.operator} ${val}`;
  }).join(" AND ");
}

function LayerPickerDialog({
  isOpen,
  onClose,
  editableLayers,
  excludeLayerIds,
  title,
  filterGeometryTypes,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  editableLayers: EditableLayer[];
  excludeLayerIds: Set<number>;
  title: string;
  filterGeometryTypes?: string[];
  onSelect: (layer: EditableLayer) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedId(null);
    }
  }, [isOpen]);

  const filteredLayers = useMemo(() => {
    let layers = editableLayers;
    if (filterGeometryTypes && filterGeometryTypes.length > 0) {
      layers = layers.filter(l => filterGeometryTypes.includes(l.geometryType));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      layers = layers.filter(l => l.name.toLowerCase().includes(q));
    }
    return layers;
  }, [editableLayers, filterGeometryTypes, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" data-testid="layer-picker-overlay">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <Card className="relative z-10 w-[420px] max-h-[500px] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-3 border-b shrink-0">
          <span className="font-medium text-sm">{title}</span>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-picker">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-3 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию..."
              className="pl-8 h-8 text-sm"
              data-testid="input-layer-search"
            />
          </div>
        </div>
        <ScrollArea className="flex-1 max-h-[320px]">
          <div className="p-2 space-y-0.5">
            {filteredLayers.length === 0 && (
              <p className="text-xs text-muted-foreground italic p-3 text-center">Нет подходящих слоёв</p>
            )}
            {filteredLayers.map(layer => {
              const isExcluded = excludeLayerIds.has(layer.id);
              const isSelected = selectedId === layer.id;
              const GeomIcon = GEOM_TYPE_ICONS[layer.geometryType] || MapPin;
              return (
                <button
                  key={layer.id}
                  disabled={isExcluded}
                  className={`w-full flex items-center gap-2 p-2 rounded-md text-left transition-colors ${
                    isExcluded
                      ? "opacity-40 cursor-not-allowed"
                      : isSelected
                        ? "bg-primary/10 border border-primary/30"
                        : "hover-elevate cursor-pointer"
                  }`}
                  onClick={() => !isExcluded && setSelectedId(layer.id)}
                  data-testid={`picker-layer-${layer.id}`}
                >
                  <GeomIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate">{layer.name}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {GEOM_TYPE_LABELS[layer.geometryType] || layer.geometryType}
                  </Badge>
                  <span className="text-xs text-muted-foreground shrink-0">{layer.featureCount}</span>
                  {isExcluded && (
                    <Badge variant="outline" className="text-[10px] shrink-0">добавлен</Badge>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="border-t p-3 flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-picker-cancel">
            Отмена
          </Button>
          <Button
            size="sm"
            disabled={selectedId === null}
            onClick={() => {
              const layer = editableLayers.find(l => l.id === selectedId);
              if (layer) onSelect(layer);
            }}
            data-testid="button-picker-select"
          >
            Выбрать
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function LayerFilterDialog({
  isOpen,
  onClose,
  layer,
  initialConditions,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  layer: EditableLayer | null;
  initialConditions: FilterCondition[];
  onApply: (conditions: FilterCondition[]) => void;
}) {
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [attrData, setAttrData] = useState<{ attrs: string[]; values: Record<string, string[]> }>({ attrs: [], values: {} });
  const [isLoadingAttrs, setIsLoadingAttrs] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isCountingMatches, setIsCountingMatches] = useState(false);

  useEffect(() => {
    if (isOpen && layer) {
      setConditions(initialConditions.length > 0 ? initialConditions.map(c => ({ ...c })) : []);
      loadAttributes(layer.id);
    }
  }, [isOpen, layer?.id]);

  const loadAttributes = async (layerId: number) => {
    setIsLoadingAttrs(true);
    try {
      const response = await fetch(`/api/editable-layers/${layerId}/attribute-values`);
      if (response.ok) {
        const data = await response.json();
        setAttrData(data);
        setTotalCount(data.totalFeatures || 0);
        setMatchCount(null);
      }
    } catch {
      setAttrData({ attrs: [], values: {} });
    } finally {
      setIsLoadingAttrs(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !layer) return;
    const validConditions = conditions.filter(c => c.attribute && c.value !== "");
    if (validConditions.length === 0) {
      setMatchCount(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsCountingMatches(true);
      try {
        const response = await fetch(`/api/editable-layers/${layer.id}/count-filtered`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters: validConditions.map(c => ({ attribute: c.attribute, operator: c.operator, value: c.value })) }),
        });
        if (response.ok) {
          const data = await response.json();
          setMatchCount(data.count);
        }
      } catch { /* ignore */ } finally {
        setIsCountingMatches(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [conditions, isOpen, layer?.id]);

  const addCondition = () => {
    setConditions(prev => [...prev, { id: generateId(), attribute: "", operator: "=", value: "" }]);
  };

  const updateCondition = (id: string, field: keyof FilterCondition, value: string) => {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const removeCondition = (id: string) => {
    setConditions(prev => prev.filter(c => c.id !== id));
  };

  const sqlPreview = buildSqlPreview(conditions);

  if (!isOpen || !layer) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" data-testid="filter-dialog-overlay">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <Card className="relative z-10 w-[520px] max-h-[550px] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Filter className="h-4 w-4 text-primary shrink-0" />
            <span className="font-medium text-sm truncate">Фильтр: {layer.name}</span>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-filter">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-4">
          {isLoadingAttrs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Загрузка атрибутов...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <Label className="text-xs font-mono text-muted-foreground">WHERE</Label>

              {conditions.length === 0 && (
                <p className="text-xs text-muted-foreground italic py-2">
                  Нет условий — будут использованы все объекты слоя ({totalCount} шт.)
                </p>
              )}

              <div className="space-y-2">
                {conditions.map((condition, index) => (
                  <div key={condition.id} className="space-y-1">
                    {index > 0 && (
                      <div className="flex items-center gap-2 pl-2">
                        <Badge variant="secondary" className="text-[10px] font-mono">AND</Badge>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={condition.attribute}
                        onValueChange={(v) => updateCondition(condition.id, "attribute", v)}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1" data-testid={`filter-attr-${index}`}>
                          <SelectValue placeholder="Атрибут" />
                        </SelectTrigger>
                        <SelectContent>
                          {attrData.attrs.map(attr => (
                            <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={condition.operator}
                        onValueChange={(v) => updateCondition(condition.id, "operator", v)}
                      >
                        <SelectTrigger className="h-8 text-xs w-[90px]" data-testid={`filter-op-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPERATORS.map(op => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {condition.attribute &&
                        attrData.values[condition.attribute] &&
                        attrData.values[condition.attribute].length > 0 &&
                        attrData.values[condition.attribute].length <= 50 ? (
                        <Select
                          value={condition.value}
                          onValueChange={(v) => updateCondition(condition.id, "value", v)}
                        >
                          <SelectTrigger className="h-8 text-xs flex-1" data-testid={`filter-val-${index}`}>
                            <SelectValue placeholder="Значение" />
                          </SelectTrigger>
                          <SelectContent>
                            {attrData.values[condition.attribute].map(val => (
                              <SelectItem key={val} value={val}>{val}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={condition.value}
                          onChange={(e) => updateCondition(condition.id, "value", e.target.value)}
                          placeholder="Значение"
                          className="h-8 text-xs flex-1"
                          data-testid={`filter-val-input-${index}`}
                        />
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeCondition(condition.id)}
                        data-testid={`filter-remove-${index}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={addCondition}
                className="text-xs"
                data-testid="button-add-filter-condition"
              >
                <Plus className="h-3 w-3 mr-1" />
                Добавить условие
              </Button>

              {sqlPreview && (
                <div className="mt-3 p-2.5 bg-muted/50 rounded-md border">
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">SQL Preview</Label>
                  <p className="text-xs font-mono mt-1 break-all">WHERE {sqlPreview}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    {isCountingMatches ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : matchCount !== null ? (
                      <span className="text-xs text-muted-foreground">
                        Результат: <span className="font-medium text-foreground">{matchCount}</span> из {totalCount} объектов
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="border-t p-3 flex items-center justify-between gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConditions([])}
            className="text-xs"
            data-testid="button-clear-filter"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Без фильтра
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} data-testid="button-filter-cancel">
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={() => onApply(conditions)}
              data-testid="button-filter-apply"
            >
              Применить
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function LayerCard({
  entry,
  layer,
  onEditFilter,
  onRemove,
}: {
  entry: SelectedLayerEntry;
  layer: EditableLayer | undefined;
  onEditFilter: () => void;
  onRemove: () => void;
}) {
  if (!layer) return null;
  const GeomIcon = GEOM_TYPE_ICONS[layer.geometryType] || MapPin;
  const hasFilter = entry.filters.length > 0 && entry.filters.some(c => c.attribute && c.value);
  const sqlPreview = entry.filterSqlPreview;

  return (
    <div className="border rounded-md p-2.5 space-y-1.5 bg-card" data-testid={`layer-card-${entry.layerId}`}>
      <div className="flex items-center gap-2">
        <GeomIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium flex-1 truncate">{layer.name}</span>
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {layer.featureCount}
        </Badge>
        <Button size="icon" variant="ghost" onClick={onRemove} data-testid={`button-remove-layer-${entry.layerId}`}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        {hasFilter ? (
          <p className="text-[11px] font-mono text-muted-foreground flex-1 truncate" title={sqlPreview}>
            {sqlPreview}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground italic flex-1">Все объекты</p>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onEditFilter}
          className="h-6 text-[11px] shrink-0"
          data-testid={`button-edit-filter-${entry.layerId}`}
        >
          <Pencil className="h-3 w-3 mr-1" />
          Фильтр
        </Button>
      </div>
    </div>
  );
}

export function GeoAnalysisModal({
  isOpen,
  onClose,
  editableLayers,
  sceneId,
}: GeoAnalysisModalProps) {
  const { toast } = useToast();

  const [step, setStep] = useState<ModalStep>("config");

  const [sourceLayers, setSourceLayers] = useState<SelectedLayerEntry[]>([]);
  const [targetLayer, setTargetLayer] = useState<SelectedLayerEntry | null>(null);
  const [boundaryLayer, setBoundaryLayer] = useState<SelectedLayerEntry | null>(null);

  const [boundaryType, setBoundaryType] = useState<BoundaryType>("polygon");
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("inside");
  const [bufferDistance, setBufferDistance] = useState<string>("10");
  const [maxDistance, setMaxDistance] = useState<string>("15");

  const [includeSummary, setIncludeSummary] = useState(true);
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, Set<string>>>({});
  const [sourceLayerAttributes, setSourceLayerAttributes] = useState<Record<string, string[]>>({});

  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedResultLayers, setExpandedResultLayers] = useState<Set<string>>(new Set());

  const [pickerOpen, setPickerOpen] = useState<"source" | "target" | "boundary" | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filterDialogLayer, setFilterDialogLayer] = useState<EditableLayer | null>(null);
  const [filterDialogConditions, setFilterDialogConditions] = useState<FilterCondition[]>([]);
  const [filterDialogTarget, setFilterDialogTarget] = useState<"source" | "target" | "boundary">("source");
  const [filterDialogSourceIndex, setFilterDialogSourceIndex] = useState<number>(-1);

  const hasTargetLayer = targetLayer !== null;
  const hasBoundaryLayer = boundaryLayer !== null;

  const lineLayers = useMemo(() =>
    editableLayers.filter(l => l.geometryType === "LineString"),
    [editableLayers]
  );

  const polygonLayers = useMemo(() =>
    editableLayers.filter(l => l.geometryType === "Polygon"),
    [editableLayers]
  );

  const sourceExcludeIds = useMemo(() => new Set(sourceLayers.map(s => s.layerId)), [sourceLayers]);
  const targetExcludeIds = useMemo(() => {
    const ids = new Set<number>();
    if (targetLayer) ids.add(targetLayer.layerId);
    return ids;
  }, [targetLayer]);
  const boundaryExcludeIds = useMemo(() => {
    const ids = new Set<number>();
    if (boundaryLayer) ids.add(boundaryLayer.layerId);
    return ids;
  }, [boundaryLayer]);

  useEffect(() => {
    if (!isOpen) {
      setStep("config");
      setSourceLayers([]);
      setTargetLayer(null);
      setBoundaryLayer(null);
      setBoundaryType("polygon");
      setBoundaryMode("inside");
      setBufferDistance("10");
      setMaxDistance("15");
      setIncludeSummary(true);
      setSelectedAttributes({});
      setSourceLayerAttributes({});
      setAnalysisResults(null);
      setExpandedResultLayers(new Set());
      setPickerOpen(null);
      setFilterDialogOpen(false);
    }
  }, [isOpen]);

  const loadSourceLayerAttributes = useCallback(async () => {
    const attrsMap: Record<string, string[]> = {};
    const promises = sourceLayers.map(async (entry) => {
      try {
        const response = await fetch(`/api/editable-layers/${entry.layerId}/attributes`);
        if (response.ok) {
          const attrs: string[] = await response.json();
          attrsMap[String(entry.layerId)] = attrs;
        }
      } catch {
        attrsMap[String(entry.layerId)] = [];
      }
    });
    await Promise.all(promises);
    setSourceLayerAttributes(attrsMap);
  }, [sourceLayers]);

  useEffect(() => {
    if (step === "report-constructor") {
      loadSourceLayerAttributes();
    }
  }, [step, loadSourceLayerAttributes]);

  const handlePickerSelect = (layer: EditableLayer) => {
    if (pickerOpen === "source") {
      setPickerOpen(null);
      const entry: SelectedLayerEntry = { layerId: layer.id, filters: [], filterSqlPreview: "" };
      setSourceLayers(prev => [...prev, entry]);
      setFilterDialogLayer(layer);
      setFilterDialogConditions([]);
      setFilterDialogTarget("source");
      setFilterDialogSourceIndex(sourceLayers.length);
      setFilterDialogOpen(true);
    } else if (pickerOpen === "target") {
      setPickerOpen(null);
      const entry: SelectedLayerEntry = { layerId: layer.id, filters: [], filterSqlPreview: "" };
      setTargetLayer(entry);
      setFilterDialogLayer(layer);
      setFilterDialogConditions([]);
      setFilterDialogTarget("target");
      setFilterDialogSourceIndex(-1);
      setFilterDialogOpen(true);
    } else if (pickerOpen === "boundary") {
      setPickerOpen(null);
      const entry: SelectedLayerEntry = { layerId: layer.id, filters: [], filterSqlPreview: "" };
      setBoundaryLayer(entry);
      setFilterDialogLayer(layer);
      setFilterDialogConditions([]);
      setFilterDialogTarget("boundary");
      setFilterDialogSourceIndex(-1);
      setFilterDialogOpen(true);
    }
  };

  const openFilterForSource = (index: number) => {
    const entry = sourceLayers[index];
    const layer = editableLayers.find(l => l.id === entry.layerId);
    if (layer) {
      setFilterDialogLayer(layer);
      setFilterDialogConditions(entry.filters);
      setFilterDialogTarget("source");
      setFilterDialogSourceIndex(index);
      setFilterDialogOpen(true);
    }
  };

  const openFilterForTarget = () => {
    if (targetLayer) {
      const layer = editableLayers.find(l => l.id === targetLayer.layerId);
      if (layer) {
        setFilterDialogLayer(layer);
        setFilterDialogConditions(targetLayer.filters);
        setFilterDialogTarget("target");
        setFilterDialogSourceIndex(-1);
        setFilterDialogOpen(true);
      }
    }
  };

  const openFilterForBoundary = () => {
    if (boundaryLayer) {
      const layer = editableLayers.find(l => l.id === boundaryLayer.layerId);
      if (layer) {
        setFilterDialogLayer(layer);
        setFilterDialogConditions(boundaryLayer.filters);
        setFilterDialogTarget("boundary");
        setFilterDialogSourceIndex(-1);
        setFilterDialogOpen(true);
      }
    }
  };

  const handleFilterApply = (conditions: FilterCondition[]) => {
    const preview = buildSqlPreview(conditions);
    if (filterDialogTarget === "source" && filterDialogSourceIndex >= 0) {
      setSourceLayers(prev => prev.map((e, i) =>
        i === filterDialogSourceIndex ? { ...e, filters: conditions, filterSqlPreview: preview } : e
      ));
    } else if (filterDialogTarget === "target" && targetLayer) {
      setTargetLayer({ ...targetLayer, filters: conditions, filterSqlPreview: preview });
    } else if (filterDialogTarget === "boundary" && boundaryLayer) {
      setBoundaryLayer({ ...boundaryLayer, filters: conditions, filterSqlPreview: preview });
    }
    setFilterDialogOpen(false);
  };

  const removeSourceLayer = (index: number) => {
    setSourceLayers(prev => prev.filter((_, i) => i !== index));
  };

  const toggleAttributeSelection = (layerId: string, attr: string) => {
    setSelectedAttributes(prev => {
      const next = { ...prev };
      if (!next[layerId]) {
        next[layerId] = new Set();
      }
      const s = new Set(next[layerId]);
      if (s.has(attr)) {
        s.delete(attr);
      } else {
        s.add(attr);
      }
      next[layerId] = s;
      return next;
    });
  };

  const selectAllAttrsForLayer = (layerId: string, attrs: string[]) => {
    setSelectedAttributes(prev => ({
      ...prev,
      [layerId]: new Set(attrs),
    }));
  };

  const deselectAllAttrsForLayer = (layerId: string) => {
    setSelectedAttributes(prev => ({
      ...prev,
      [layerId]: new Set<string>(),
    }));
  };

  const toggleResultLayerExpand = (layerId: string) => {
    setExpandedResultLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const canProceed = sourceLayers.length > 0 && (hasTargetLayer || hasBoundaryLayer);

  const resetAll = () => {
    setSourceLayers([]);
    setTargetLayer(null);
    setBoundaryLayer(null);
    setBoundaryType("polygon");
    setBoundaryMode("inside");
    setBufferDistance("10");
    setMaxDistance("15");
  };

  const runAnalysis = async (format: "json" | "xlsx") => {
    if (sourceLayers.length === 0) {
      toast({ title: "Ошибка", description: "Добавьте хотя бы один исходный слой", variant: "destructive" });
      return;
    }

    if (!hasTargetLayer && !hasBoundaryLayer) {
      toast({ title: "Ошибка", description: "Добавьте целевой или ограничивающий слой", variant: "destructive" });
      return;
    }

    if (hasTargetLayer) {
      const distanceNum = parseFloat(maxDistance);
      if (isNaN(distanceNum) || distanceNum <= 0) {
        toast({ title: "Ошибка", description: "Укажите корректный порог расстояния", variant: "destructive" });
        return;
      }
    }

    setIsAnalyzing(true);
    try {
      const bufferNum = parseFloat(bufferDistance);
      const distanceNum = parseFloat(maxDistance);

      const sourceFiltersForRequest: Record<string, { attribute: string; operator: string; value: string }[]> = {};
      for (const entry of sourceLayers) {
        const filtered = entry.filters.filter(c => c.attribute && c.value);
        if (filtered.length > 0) {
          sourceFiltersForRequest[String(entry.layerId)] = filtered.map(c => ({
            attribute: c.attribute,
            operator: c.operator,
            value: c.value,
          }));
        }
      }

      const targetFiltersList = targetLayer
        ? targetLayer.filters.filter(c => c.attribute && c.value).map(c => ({ attribute: c.attribute, operator: c.operator, value: c.value }))
        : [];

      const boundaryFiltersList = boundaryLayer
        ? boundaryLayer.filters.filter(c => c.attribute && c.value).map(c => ({ attribute: c.attribute, operator: c.operator, value: c.value }))
        : [];

      const includeAttrs: Record<string, string[]> = {};
      for (const [layerId, attrs] of Object.entries(selectedAttributes)) {
        if (attrs.size > 0) {
          includeAttrs[layerId] = Array.from(attrs);
        }
      }

      const requestBody: Record<string, unknown> = {
        sourceLayerIds: sourceLayers.map(e => e.layerId),
        sourceFilters: sourceFiltersForRequest,
        targetLayerId: targetLayer ? targetLayer.layerId : null,
        targetFilters: targetFiltersList,
        boundaryLayerId: boundaryLayer ? boundaryLayer.layerId : null,
        boundaryFilters: boundaryFiltersList,
        boundaryMode: boundaryLayer ? boundaryMode : "none",
        boundaryType: boundaryType,
        bufferDistanceMeters: boundaryType === "line" ? (isNaN(bufferNum) ? 10 : bufferNum) : null,
        maxDistanceMeters: hasTargetLayer ? distanceNum : 15,
        reportConfig: {
          includeAttributes: includeAttrs,
          includeSummary,
          format,
        },
      };

      const response = await fetch("/api/analytics/geospatial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Ошибка анализа");
      }

      if (format === "xlsx") {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `geospatial_analysis_${Date.now()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast({ title: "Экспорт завершён", description: "Файл XLSX загружен" });
      } else {
        const data: AnalysisResults = await response.json();
        setAnalysisResults(data);
        setStep("results");
        toast({ title: "Анализ завершён", description: `Найдено ${data.summary.totalObjects} объектов` });
      }
    } catch (error) {
      console.error("Geospatial analysis error:", error);
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось выполнить анализ",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getFilterSummary = (entry: SelectedLayerEntry): string => {
    if (entry.filterSqlPreview) return entry.filterSqlPreview;
    return "Все объекты";
  };

  const renderToolbar = () => {
    if (step === "config") {
      return (
        <div className="flex items-center gap-1.5 p-2 border-b bg-muted/30 shrink-0 flex-wrap">
          <Button
            size="sm"
            onClick={() => setStep("report-constructor")}
            disabled={!canProceed}
            data-testid="button-proceed-to-constructor"
          >
            <ChevronRight className="h-3.5 w-3.5 mr-1" />
            Далее
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            size="sm"
            variant="ghost"
            onClick={resetAll}
            data-testid="button-reset-all"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Сбросить
          </Button>
          <div className="flex-1" />
          {hasTargetLayer && (
            <div className="flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs text-muted-foreground">Порог:</Label>
              <Input
                type="number"
                value={maxDistance}
                onChange={e => setMaxDistance(e.target.value)}
                className="h-7 w-16 text-xs"
                min="1"
                max="10000"
                data-testid="input-max-distance"
              />
              <span className="text-xs text-muted-foreground">м</span>
            </div>
          )}
        </div>
      );
    }

    if (step === "report-constructor") {
      return (
        <div className="flex items-center gap-1.5 p-2 border-b bg-muted/30 shrink-0 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => setStep("config")} data-testid="button-back-to-config">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Назад
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            size="sm"
            onClick={() => runAnalysis("json")}
            disabled={isAnalyzing}
            data-testid="button-run-analysis"
          >
            {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Запустить
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAnalysis("xlsx")}
            disabled={isAnalyzing}
            data-testid="button-export-xlsx"
          >
            {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />}
            XLSX
          </Button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <Switch
              checked={includeSummary}
              onCheckedChange={setIncludeSummary}
              data-testid="switch-include-summary"
            />
            <Label className="text-xs">Сводка</Label>
          </div>
        </div>
      );
    }

    if (step === "results") {
      return (
        <div className="flex items-center gap-1.5 p-2 border-b bg-muted/30 shrink-0 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => setStep("report-constructor")} data-testid="button-back-to-constructor">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Назад
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAnalysis("xlsx")}
            disabled={isAnalyzing}
            data-testid="button-export-results-xlsx"
          >
            {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
            Скачать XLSX
          </Button>
          <div className="flex-1" />
          {analysisResults && (
            <Badge variant="outline" className="text-[10px]">
              {analysisResults.mode === "distance-binding" ? "Привязка" : "Пространственный"}
            </Badge>
          )}
        </div>
      );
    }

    return null;
  };

  const renderConfig = () => (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col border-r min-w-0">
        <div className="flex items-center gap-2 p-2.5 border-b bg-muted/20 shrink-0">
          <Layers className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-medium">Исходные слои</span>
          {sourceLayers.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{sourceLayers.length}</Badge>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1.5">
            {sourceLayers.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-4">
                Добавьте слои для анализа
              </p>
            )}
            {sourceLayers.map((entry, index) => {
              const layer = editableLayers.find(l => l.id === entry.layerId);
              return (
                <LayerCard
                  key={`${entry.layerId}-${index}`}
                  entry={entry}
                  layer={layer}
                  onEditFilter={() => openFilterForSource(index)}
                  onRemove={() => removeSourceLayer(index)}
                />
              );
            })}
          </div>
        </ScrollArea>
        <div className="p-2 border-t shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPickerOpen("source")}
            className="w-full text-xs"
            data-testid="button-add-source-layer"
          >
            <Plus className="h-3 w-3 mr-1" />
            Добавить слой
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col border-r min-w-0">
        <div className="flex items-center gap-2 p-2.5 border-b bg-muted/20 shrink-0">
          <Target className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-medium">Целевой слой</span>
          <Badge variant="outline" className="text-[10px]">привязка</Badge>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            {!targetLayer ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Слой для привязки исходных объектов по расстоянию
                </p>
                <p className="text-[11px] text-muted-foreground italic">
                  Если не выбран — только пространственный анализ
                </p>
              </div>
            ) : (
              <LayerCard
                entry={targetLayer}
                layer={editableLayers.find(l => l.id === targetLayer.layerId)}
                onEditFilter={openFilterForTarget}
                onRemove={() => setTargetLayer(null)}
              />
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t shrink-0">
          {!targetLayer ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPickerOpen("target")}
              className="w-full text-xs"
              data-testid="button-add-target-layer"
            >
              <Plus className="h-3 w-3 mr-1" />
              Выбрать слой
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPickerOpen("target")}
              className="w-full text-xs"
              data-testid="button-change-target-layer"
            >
              Заменить слой
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 p-2.5 border-b bg-muted/20 shrink-0">
          <Square className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-medium">Ограничение</span>
          {!hasTargetLayer && (
            <Badge variant="default" className="text-[10px]">обязательно</Badge>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={boundaryType === "polygon" ? "default" : "outline"}
                onClick={() => { setBoundaryType("polygon"); if (boundaryLayer) { const l = editableLayers.find(la => la.id === boundaryLayer.layerId); if (l && l.geometryType !== "Polygon") setBoundaryLayer(null); } }}
                className="flex-1 text-[11px]"
                data-testid="button-boundary-polygon"
              >
                Полигон
              </Button>
              <Button
                size="sm"
                variant={boundaryType === "line" ? "default" : "outline"}
                onClick={() => { setBoundaryType("line"); if (boundaryLayer) { const l = editableLayers.find(la => la.id === boundaryLayer.layerId); if (l && l.geometryType !== "LineString") setBoundaryLayer(null); } }}
                className="flex-1 text-[11px]"
                data-testid="button-boundary-line"
              >
                Линия
              </Button>
            </div>

            <div className="flex gap-1">
              <Button
                size="sm"
                variant={boundaryMode === "inside" ? "default" : "outline"}
                onClick={() => setBoundaryMode("inside")}
                className="flex-1 text-[11px]"
                data-testid="button-boundary-inside"
              >
                {boundaryType === "polygon" ? "Внутри" : "Вблизи"}
              </Button>
              <Button
                size="sm"
                variant={boundaryMode === "outside" ? "default" : "outline"}
                onClick={() => setBoundaryMode("outside")}
                className="flex-1 text-[11px]"
                data-testid="button-boundary-outside"
              >
                {boundaryType === "polygon" ? "Снаружи" : "Вдали"}
              </Button>
            </div>

            {boundaryType === "line" && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Буфер (м)</Label>
                <Input
                  type="number"
                  value={bufferDistance}
                  onChange={e => setBufferDistance(e.target.value)}
                  min="1"
                  max="1000"
                  className="h-7 text-xs"
                  data-testid="input-buffer-distance"
                />
              </div>
            )}

            {boundaryLayer ? (
              <LayerCard
                entry={boundaryLayer}
                layer={editableLayers.find(l => l.id === boundaryLayer.layerId)}
                onEditFilter={openFilterForBoundary}
                onRemove={() => setBoundaryLayer(null)}
              />
            ) : (
              <p className="text-xs text-muted-foreground italic text-center py-2">
                {boundaryType === "polygon"
                  ? (polygonLayers.length === 0 ? "Нет полигональных слоёв" : "Выберите ограничивающий слой")
                  : (lineLayers.length === 0 ? "Нет линейных слоёв" : "Выберите ограничивающий слой")
                }
              </p>
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t shrink-0">
          {!boundaryLayer ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPickerOpen("boundary")}
              className="w-full text-xs"
              disabled={boundaryType === "polygon" ? polygonLayers.length === 0 : lineLayers.length === 0}
              data-testid="button-add-boundary-layer"
            >
              <Plus className="h-3 w-3 mr-1" />
              Выбрать слой
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPickerOpen("boundary")}
              className="w-full text-xs"
              data-testid="button-change-boundary-layer"
            >
              Заменить слой
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const renderReportConstructor = () => {
    return (
      <div className="flex h-full min-h-0">
        {sourceLayers.map((entry, colIndex) => {
          const layer = editableLayers.find(l => l.id === entry.layerId);
          if (!layer) return null;
          const layerIdStr = String(entry.layerId);
          const attrs = sourceLayerAttributes[layerIdStr] || [];
          const selected = selectedAttributes[layerIdStr] || new Set<string>();
          const GeomIcon = GEOM_TYPE_ICONS[layer.geometryType] || MapPin;

          return (
            <div
              key={`${entry.layerId}-${colIndex}`}
              className={`flex-1 flex flex-col min-w-0 ${colIndex < sourceLayers.length - 1 ? "border-r" : ""}`}
            >
              <div className="p-2.5 border-b bg-muted/20 shrink-0 space-y-1">
                <div className="flex items-center gap-1.5">
                  <GeomIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">{layer.name}</span>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono truncate" title={getFilterSummary(entry)}>
                  {entry.filterSqlPreview || "Все объекты"}
                </p>
              </div>
              <div className="p-2 flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => selectAllAttrsForLayer(layerIdStr, attrs)} className="h-6 text-[11px] flex-1">
                  Все
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deselectAllAttrsForLayer(layerIdStr)} className="h-6 text-[11px] flex-1">
                  Сброс
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-2 pb-2 space-y-0.5">
                  {attrs.length === 0 ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    attrs.map(attr => (
                      <label key={attr} className="flex items-center gap-1.5 text-[11px] cursor-pointer p-1 rounded hover-elevate">
                        <Checkbox
                          checked={selected.has(attr)}
                          onCheckedChange={() => toggleAttributeSelection(layerIdStr, attr)}
                        />
                        <span className="truncate">{attr}</span>
                      </label>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    );
  };

  const renderResults = () => {
    if (!analysisResults) return null;

    const { summary, details } = analysisResults;

    return (
      <div className="p-4 space-y-4">
        {includeSummary && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <Label className="text-sm font-medium">Сводка</Label>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Слой</TableHead>
                    <TableHead className="text-xs">Тип</TableHead>
                    <TableHead className="text-xs text-right">Всего</TableHead>
                    <TableHead className="text-xs text-right">
                      {analysisResults.mode === "distance-binding" ? "Привязано" : "Попало"}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byLayer.map(lr => {
                    const srcEntry = sourceLayers.find(s => s.layerId === lr.layerId);
                    const filterLabel = srcEntry?.filterSqlPreview || "";
                    return (
                      <TableRow key={lr.layerId} data-testid={`row-summary-${lr.layerId}`}>
                        <TableCell className="text-xs">
                          <div>
                            <span className="font-medium">{lr.layerName}</span>
                            {filterLabel && (
                              <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{filterLabel}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="secondary" className="text-[10px]">
                            {GEOM_TYPE_LABELS[lr.geometryType] || lr.geometryType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right">{lr.totalCount}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{lr.matchedCount}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="font-bold">
                    <TableCell className="text-xs" colSpan={3}>ИТОГО</TableCell>
                    <TableCell className="text-xs text-right">{summary.totalObjects}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {summary.boundaryLayerName && (
              <p className="text-xs text-muted-foreground">
                Ограничение: {summary.boundaryLayerName} ({summary.boundaryCount} объектов, {boundaryMode === "inside" ? "внутри" : "снаружи"})
              </p>
            )}
            {summary.targetLayerName && (
              <p className="text-xs text-muted-foreground">
                Целевой слой: {summary.targetLayerName}
              </p>
            )}
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <Label className="text-sm font-medium">Детали по слоям</Label>

          {Object.entries(details).map(([layerId, detail]) => {
            const isExpanded = expandedResultLayers.has(layerId);
            const propKeys = detail.features.length > 0
              ? Object.keys(detail.features[0].properties).sort()
              : detail.availableAttributes;
            const srcEntry = sourceLayers.find(s => String(s.layerId) === layerId);
            const filterLabel = srcEntry?.filterSqlPreview || "";

            return (
              <div key={layerId} className="border rounded-md">
                <button
                  className="w-full flex items-center gap-2 p-2 text-left hover-elevate rounded-md"
                  onClick={() => toggleResultLayerExpand(layerId)}
                  data-testid={`button-expand-layer-${layerId}`}
                >
                  <ChevronRight className={`h-4 w-4 transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                  {(() => { const Icon = GEOM_TYPE_ICONS[detail.geometryType] || MapPin; return <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />; })()}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{detail.layerName}</span>
                    {filterLabel && (
                      <span className="text-[10px] text-muted-foreground font-mono truncate block">{filterLabel}</span>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {detail.features.length} объектов
                  </Badge>
                </button>

                {isExpanded && detail.features.length > 0 && (
                  <div className="border-t overflow-x-auto max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs sticky top-0 bg-background">ID</TableHead>
                          {propKeys.map(key => (
                            <TableHead key={key} className="text-xs sticky top-0 bg-background">{key}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.features.map(f => (
                          <TableRow key={f.id} data-testid={`row-detail-${layerId}-${f.id}`}>
                            <TableCell className="text-xs">{f.id}</TableCell>
                            {propKeys.map(key => (
                              <TableCell key={key} className="text-xs max-w-[200px] truncate">
                                {f.properties[key] !== undefined && f.properties[key] !== null
                                  ? String(f.properties[key])
                                  : ""}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {isExpanded && detail.features.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground italic border-t">
                    Нет объектов в выбранной области
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const pickerGeomFilter = useMemo(() => {
    if (pickerOpen === "boundary") {
      return boundaryType === "polygon" ? ["Polygon"] : ["LineString"];
    }
    return undefined;
  }, [pickerOpen, boundaryType]);

  const pickerExcludeIds = useMemo(() => {
    if (pickerOpen === "source") return sourceExcludeIds;
    if (pickerOpen === "target") return targetExcludeIds;
    if (pickerOpen === "boundary") return boundaryExcludeIds;
    return new Set<number>();
  }, [pickerOpen, sourceExcludeIds, targetExcludeIds, boundaryExcludeIds]);

  const pickerTitle = useMemo(() => {
    if (pickerOpen === "source") return "Выбор исходного слоя";
    if (pickerOpen === "target") return "Выбор целевого слоя";
    if (pickerOpen === "boundary") return boundaryType === "polygon" ? "Выбор полигонального слоя" : "Выбор линейного слоя";
    return "Выбор слоя";
  }, [pickerOpen, boundaryType]);

  const statusText = useMemo(() => {
    const parts: string[] = [];
    if (sourceLayers.length > 0) {
      parts.push(`${sourceLayers.length} исх.`);
    }
    if (targetLayer) {
      const tl = editableLayers.find(l => l.id === targetLayer.layerId);
      if (tl) parts.push(`→ ${tl.name}`);
    }
    if (boundaryLayer) {
      const bl = editableLayers.find(l => l.id === boundaryLayer.layerId);
      if (bl) parts.push(`(${boundaryMode === "inside" ? "внутри" : "снаружи"} ${bl.name})`);
    }
    return parts.join(" ");
  }, [sourceLayers, targetLayer, boundaryLayer, boundaryMode, editableLayers]);

  return (
    <>
      <DraggableModal
        isOpen={isOpen}
        onClose={onClose}
        title="Геопространственный анализ"
        defaultWidth={950}
        defaultHeight={600}
        minWidth={700}
        minHeight={400}
      >
        <div className="flex flex-col h-full">
          {renderToolbar()}

          <div className="flex-1 min-h-0 overflow-hidden">
            {step === "config" && renderConfig()}
            {step === "report-constructor" && renderReportConstructor()}
            {step === "results" && (
              <ScrollArea className="h-full">
                {renderResults()}
              </ScrollArea>
            )}
          </div>

          <div className="border-t px-3 py-1.5 shrink-0 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1 truncate">{statusText}</span>
            <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-7" data-testid="button-close-analysis">
              Закрыть
            </Button>
          </div>
        </div>
      </DraggableModal>

      <LayerPickerDialog
        isOpen={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        editableLayers={editableLayers}
        excludeLayerIds={pickerExcludeIds}
        title={pickerTitle}
        filterGeometryTypes={pickerGeomFilter}
        onSelect={handlePickerSelect}
      />

      <LayerFilterDialog
        isOpen={filterDialogOpen}
        onClose={() => setFilterDialogOpen(false)}
        layer={filterDialogLayer}
        initialConditions={filterDialogConditions}
        onApply={handleFilterApply}
      />
    </>
  );
}
