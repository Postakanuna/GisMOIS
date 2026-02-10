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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { EditableLayer, DrawnFeature } from "@shared/schema";

interface FilterCondition {
  id: string;
  attribute: string;
  operator: string;
  value: string;
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
  { value: "=", label: "равно" },
  { value: "!=", label: "не равно" },
  { value: ">", label: "больше" },
  { value: "<", label: "меньше" },
  { value: ">=", label: "больше или равно" },
  { value: "<=", label: "меньше или равно" },
  { value: "contains", label: "содержит" },
  { value: "not_contains", label: "не содержит" },
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function AttributeFilterBuilder({
  layerId,
  conditions,
  onConditionsChange,
  availableAttributes,
  attributeValues,
  label,
}: {
  layerId: string;
  conditions: FilterCondition[];
  onConditionsChange: (conditions: FilterCondition[]) => void;
  availableAttributes: string[];
  attributeValues: Record<string, Set<unknown>>;
  label: string;
}) {
  const addCondition = () => {
    const newCondition: FilterCondition = {
      id: generateId(),
      attribute: "",
      operator: "=",
      value: "",
    };
    onConditionsChange([...conditions, newCondition]);
  };

  const updateCondition = (id: string, field: keyof FilterCondition, value: string) => {
    onConditionsChange(
      conditions.map(c => c.id === id ? { ...c, [field]: value } : c)
    );
  };

  const removeCondition = (id: string) => {
    onConditionsChange(conditions.filter(c => c.id !== id));
  };

  const getValuesForAttribute = (attr: string): string[] => {
    const values = attributeValues[attr];
    if (!values) return [];
    return Array.from(values)
      .filter(v => v !== null && v !== undefined)
      .map(v => String(v))
      .sort();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Button
          size="sm"
          variant="outline"
          onClick={addCondition}
          disabled={!layerId}
          className="h-6 text-xs"
          data-testid="button-add-filter-condition"
        >
          <Plus className="h-3 w-3 mr-1" />
          Добавить условие
        </Button>
      </div>
      
      {conditions.length > 0 && (
        <div className="space-y-2 p-2 bg-muted/30 rounded-md">
          {conditions.map((condition, index) => (
            <div key={condition.id} className="flex items-center gap-1">
              {index > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1">И</Badge>
              )}
              <Select
                value={condition.attribute}
                onValueChange={(v) => updateCondition(condition.id, "attribute", v)}
              >
                <SelectTrigger className="h-7 text-xs flex-1" data-testid={`select-filter-attribute-${index}`}>
                  <SelectValue placeholder="Атрибут" />
                </SelectTrigger>
                <SelectContent>
                  {availableAttributes.map(attr => (
                    <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select
                value={condition.operator}
                onValueChange={(v) => updateCondition(condition.id, "operator", v)}
              >
                <SelectTrigger className="h-7 text-xs w-24" data-testid={`select-filter-operator-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map(op => (
                    <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {condition.attribute && getValuesForAttribute(condition.attribute).length > 0 && getValuesForAttribute(condition.attribute).length <= 50 ? (
                <Select
                  value={condition.value}
                  onValueChange={(v) => updateCondition(condition.id, "value", v)}
                >
                  <SelectTrigger className="h-7 text-xs flex-1" data-testid={`select-filter-value-${index}`}>
                    <SelectValue placeholder="Значение" />
                  </SelectTrigger>
                  <SelectContent>
                    {getValuesForAttribute(condition.attribute).map(val => (
                      <SelectItem key={val} value={val}>{val}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={condition.value}
                  onChange={(e) => updateCondition(condition.id, "value", e.target.value)}
                  placeholder="Значение"
                  className="h-7 text-xs flex-1"
                  data-testid={`input-filter-value-${index}`}
                />
              )}
              
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeCondition(condition.id)}
                data-testid={`button-remove-condition-${index}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      
      {conditions.length === 0 && layerId && (
        <p className="text-xs text-muted-foreground italic">
          Без фильтров — все объекты слоя
        </p>
      )}
    </div>
  );
}

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

export function GeoAnalysisModal({
  isOpen,
  onClose,
  editableLayers,
  sceneId,
}: GeoAnalysisModalProps) {
  const { toast } = useToast();
  
  const [step, setStep] = useState<ModalStep>("config");

  const [selectedSourceLayerIds, setSelectedSourceLayerIds] = useState<Set<number>>(new Set());
  const [perSourceFilters, setPerSourceFilters] = useState<Record<string, FilterCondition[]>>({});

  const [targetLayerId, setTargetLayerId] = useState<string>("");
  const [targetConditions, setTargetConditions] = useState<FilterCondition[]>([]);

  const [boundaryEnabled, setBoundaryEnabled] = useState(false);
  const [boundaryType, setBoundaryType] = useState<BoundaryType>("polygon");
  const [boundaryLayerId, setBoundaryLayerId] = useState<string>("");
  const [boundaryConditions, setBoundaryConditions] = useState<FilterCondition[]>([]);
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("inside");
  const [bufferDistance, setBufferDistance] = useState<string>("10");
  const [maxDistance, setMaxDistance] = useState<string>("15");

  const [includeSummary, setIncludeSummary] = useState(true);
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, Set<string>>>({});

  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedResultLayers, setExpandedResultLayers] = useState<Set<string>>(new Set());
  const [sourceLayerAttributes, setSourceLayerAttributes] = useState<Record<string, string[]>>({});

  const lineLayers = useMemo(() => 
    editableLayers.filter(l => l.geometryType === "LineString"), 
    [editableLayers]
  );
  
  const polygonLayers = useMemo(() => 
    editableLayers.filter(l => l.geometryType === "Polygon"), 
    [editableLayers]
  );

  const actualTargetLayerId = targetLayerId === "__none__" ? "" : targetLayerId;
  const hasTargetLayer = actualTargetLayerId !== "";
  const isBoundaryOnlyMode = !hasTargetLayer;

  const { data: targetFeatures = [] } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", parseInt(actualTargetLayerId), "features"],
    enabled: hasTargetLayer,
  });

  const { data: boundaryFeatures = [] } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", parseInt(boundaryLayerId), "features"],
    enabled: !!boundaryLayerId && boundaryEnabled,
  });

  const extractAttributes = useCallback((features: DrawnFeature[]): { attrs: string[], values: Record<string, Set<unknown>> } => {
    const attrSet = new Set<string>();
    const values: Record<string, Set<unknown>> = {};
    
    for (const feature of features) {
      if (feature.properties) {
        for (const [key, value] of Object.entries(feature.properties)) {
          attrSet.add(key);
          if (!values[key]) values[key] = new Set();
          values[key].add(value);
        }
      }
    }
    
    return { attrs: Array.from(attrSet).sort(), values };
  }, []);

  const targetAttrsData = useMemo(() => extractAttributes(targetFeatures), [targetFeatures, extractAttributes]);
  const boundaryAttrsData = useMemo(() => extractAttributes(boundaryFeatures), [boundaryFeatures, extractAttributes]);

  const applyFilter = useCallback((features: DrawnFeature[], conditions: FilterCondition[]): DrawnFeature[] => {
    if (conditions.length === 0) return features;
    
    return features.filter(feature => {
      return conditions.every(condition => {
        if (!condition.attribute || condition.value === "") return true;
        
        const propValue = feature.properties?.[condition.attribute];
        const filterValue = condition.value;
        
        if (propValue === undefined || propValue === null) {
          return condition.operator === "!=" || condition.operator === "not_contains";
        }
        
        const propStr = String(propValue);
        const propNum = parseFloat(propStr);
        const filterNum = parseFloat(filterValue);
        
        switch (condition.operator) {
          case "=":
            return propStr === filterValue;
          case "!=":
            return propStr !== filterValue;
          case ">":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum > filterNum;
          case "<":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum < filterNum;
          case ">=":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum >= filterNum;
          case "<=":
            return !isNaN(propNum) && !isNaN(filterNum) && propNum <= filterNum;
          case "contains":
            return propStr.toLowerCase().includes(filterValue.toLowerCase());
          case "not_contains":
            return !propStr.toLowerCase().includes(filterValue.toLowerCase());
          default:
            return true;
        }
      });
    });
  }, []);

  const filteredTargetCount = useMemo(() => 
    applyFilter(targetFeatures, targetConditions).length,
    [targetFeatures, targetConditions, applyFilter]
  );

  const filteredBoundaryCount = useMemo(() => 
    boundaryEnabled ? applyFilter(boundaryFeatures, boundaryConditions).length : 0,
    [boundaryFeatures, boundaryConditions, boundaryEnabled, applyFilter]
  );

  useEffect(() => {
    if (!isOpen) {
      setStep("config");
      setSelectedSourceLayerIds(new Set());
      setPerSourceFilters({});
      setTargetLayerId("");
      setTargetConditions([]);
      setBoundaryEnabled(false);
      setBoundaryType("polygon");
      setBoundaryLayerId("");
      setBoundaryConditions([]);
      setBoundaryMode("inside");
      setBufferDistance("10");
      setMaxDistance("15");
      setIncludeSummary(true);
      setSelectedAttributes({});
      setAnalysisResults(null);
      setExpandedResultLayers(new Set());
      setSourceLayerAttributes({});
    }
  }, [isOpen]);

  useEffect(() => {
    setBoundaryLayerId("");
    setBoundaryConditions([]);
  }, [boundaryType]);

  const loadSourceLayerAttributes = useCallback(async () => {
    const attrsMap: Record<string, string[]> = {};
    const promises = Array.from(selectedSourceLayerIds).map(async (layerId) => {
      try {
        const response = await fetch(`/api/editable-layers/${layerId}/attributes`);
        if (response.ok) {
          const attrs: string[] = await response.json();
          attrsMap[String(layerId)] = attrs;
        }
      } catch {
        attrsMap[String(layerId)] = [];
      }
    });
    await Promise.all(promises);
    setSourceLayerAttributes(attrsMap);
  }, [selectedSourceLayerIds]);

  useEffect(() => {
    if (step === "report-constructor") {
      loadSourceLayerAttributes();
    }
  }, [step, loadSourceLayerAttributes]);

  const toggleSourceLayer = (layerId: number) => {
    setSelectedSourceLayerIds(prev => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const selectAllSourceLayers = () => {
    const all = new Set(editableLayers.map(l => l.id));
    setSelectedSourceLayerIds(all);
  };

  const deselectAllSourceLayers = () => {
    setSelectedSourceLayerIds(new Set());
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

  const runAnalysis = async (format: "json" | "xlsx") => {
    if (selectedSourceLayerIds.size === 0) {
      toast({ title: "Ошибка", description: "Выберите хотя бы один исходный слой", variant: "destructive" });
      return;
    }

    if (isBoundaryOnlyMode && (!boundaryEnabled || !boundaryLayerId)) {
      toast({ title: "Ошибка", description: "Без целевого слоя необходимо включить ограничивающий слой (полигон/линия)", variant: "destructive" });
      return;
    }

    if (hasTargetLayer) {
      const distanceNum = parseFloat(maxDistance);
      if (isNaN(distanceNum) || distanceNum <= 0) {
        toast({ title: "Ошибка", description: "Укажите корректный порог расстояния", variant: "destructive" });
        return;
      }
    }

    if (boundaryEnabled && !boundaryLayerId) {
      toast({ title: "Ошибка", description: "Выберите ограничивающий слой или отключите его", variant: "destructive" });
      return;
    }

    setIsAnalyzing(true);
    try {
      const bufferNum = parseFloat(bufferDistance);
      const distanceNum = parseFloat(maxDistance);

      const sourceFiltersForRequest: Record<string, { attribute: string; operator: string; value: string }[]> = {};
      for (const [layerId, conditions] of Object.entries(perSourceFilters)) {
        const filtered = conditions.filter(c => c.attribute && c.value);
        if (filtered.length > 0) {
          sourceFiltersForRequest[layerId] = filtered.map(c => ({
            attribute: c.attribute,
            operator: c.operator,
            value: c.value,
          }));
        }
      }

      const includeAttrs: Record<string, string[]> = {};
      for (const [layerId, attrs] of Object.entries(selectedAttributes)) {
        if (attrs.size > 0) {
          includeAttrs[layerId] = Array.from(attrs);
        }
      }

      const requestBody: Record<string, unknown> = {
        sourceLayerIds: Array.from(selectedSourceLayerIds),
        sourceFilters: sourceFiltersForRequest,
        targetLayerId: hasTargetLayer ? parseInt(actualTargetLayerId) : null,
        targetFilters: hasTargetLayer ? targetConditions.filter(c => c.attribute && c.value) : [],
        boundaryLayerId: boundaryEnabled && boundaryLayerId ? parseInt(boundaryLayerId) : null,
        boundaryFilters: boundaryEnabled ? boundaryConditions.filter(c => c.attribute && c.value) : [],
        boundaryMode: boundaryEnabled ? boundaryMode : "none",
        boundaryType: boundaryEnabled ? boundaryType : "polygon",
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

  const canProceed = selectedSourceLayerIds.size > 0 && (hasTargetLayer || (boundaryEnabled && !!boundaryLayerId));

  const renderConfig = () => (
    <div className="p-4 space-y-4">
      <Accordion type="multiple" defaultValue={["source", "target"]} className="space-y-2">
        <AccordionItem value="source" className="border rounded-md px-3">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Исходные слои</span>
              {selectedSourceLayerIds.size > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedSourceLayerIds.size} слоёв
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Выберите слои для анализа</Label>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={selectAllSourceLayers} className="h-6 text-xs" data-testid="button-select-all-sources">
                  Все
                </Button>
                <Button size="sm" variant="ghost" onClick={deselectAllSourceLayers} className="h-6 text-xs" data-testid="button-deselect-all-sources">
                  Сбросить
                </Button>
              </div>
            </div>

            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {editableLayers.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Нет доступных слоёв</p>
              )}
              {editableLayers.map(layer => {
                const GeomIcon = GEOM_TYPE_ICONS[layer.geometryType] || MapPin;
                return (
                  <label
                    key={layer.id}
                    className="flex items-center gap-2 p-1.5 rounded-md hover-elevate cursor-pointer"
                    data-testid={`checkbox-source-layer-${layer.id}`}
                  >
                    <Checkbox
                      checked={selectedSourceLayerIds.has(layer.id)}
                      onCheckedChange={() => toggleSourceLayer(layer.id)}
                    />
                    <GeomIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 truncate">{layer.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {GEOM_TYPE_LABELS[layer.geometryType] || layer.geometryType}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">{layer.featureCount}</span>
                  </label>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="target" className="border rounded-md px-3">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Целевой слой привязки</span>
              <Badge variant="outline" className="text-[10px]">опционально</Badge>
              {targetLayerId && (
                <Badge variant="secondary" className="text-xs">
                  {filteredTargetCount} объектов
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-3">
            <p className="text-xs text-muted-foreground">
              Если целевой слой не выбран, анализ покажет только объекты внутри/снаружи ограничивающего слоя.
            </p>
            <div className="space-y-2">
              <Label htmlFor="target-layer" className="text-xs">Выберите слой</Label>
              <Select value={targetLayerId} onValueChange={setTargetLayerId}>
                <SelectTrigger id="target-layer" data-testid="select-target-layer">
                  <SelectValue placeholder="Не выбран (только пространственный анализ)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Не выбран</SelectItem>
                  {editableLayers.map(layer => (
                    <SelectItem key={layer.id} value={String(layer.id)}>
                      {layer.name} ({layer.geometryType}, {layer.featureCount} объектов)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {hasTargetLayer && (
              <AttributeFilterBuilder
                layerId={actualTargetLayerId}
                conditions={targetConditions}
                onConditionsChange={setTargetConditions}
                availableAttributes={targetAttrsData.attrs}
                attributeValues={targetAttrsData.values}
                label="Фильтры по атрибутам (условия объединяются через И)"
              />
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="boundary" className="border rounded-md px-3">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <Square className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Ограничивающий слой</span>
              {isBoundaryOnlyMode && (
                <Badge variant="default" className="text-[10px]">обязательно</Badge>
              )}
              {!isBoundaryOnlyMode && (
                <Badge variant="outline" className="text-[10px]">опционально</Badge>
              )}
              {boundaryEnabled && boundaryLayerId && (
                <Badge variant="secondary" className="text-xs">
                  {filteredBoundaryCount} {boundaryType === "polygon" ? "полигонов" : "линий"}
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={boundaryEnabled}
                onCheckedChange={setBoundaryEnabled}
                data-testid="switch-boundary-enabled"
              />
              <Label className="text-xs">Использовать пространственные ограничения</Label>
            </div>
            
            {isBoundaryOnlyMode && !boundaryEnabled && (
              <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                Без целевого слоя необходимо включить ограничивающий слой
              </div>
            )}

            {boundaryEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Тип ограничивающего слоя</Label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={boundaryType === "polygon" ? "default" : "outline"}
                      onClick={() => setBoundaryType("polygon")}
                      className="flex-1 text-xs"
                      data-testid="button-boundary-type-polygon"
                    >
                      Полигоны
                    </Button>
                    <Button
                      size="sm"
                      variant={boundaryType === "line" ? "default" : "outline"}
                      onClick={() => setBoundaryType("line")}
                      className="flex-1 text-xs"
                      data-testid="button-boundary-type-line"
                    >
                      Линии
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="boundary-layer" className="text-xs">
                    {boundaryType === "polygon" ? "Слой полигонов" : "Слой линий"}
                  </Label>
                  <Select value={boundaryLayerId} onValueChange={setBoundaryLayerId}>
                    <SelectTrigger id="boundary-layer" data-testid="select-boundary-layer">
                      <SelectValue placeholder="Выберите слой" />
                    </SelectTrigger>
                    <SelectContent>
                      {(boundaryType === "polygon" ? polygonLayers : lineLayers).map(layer => (
                        <SelectItem key={layer.id} value={String(layer.id)}>
                          {layer.name} ({layer.featureCount} объектов)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {boundaryType === "polygon" && polygonLayers.length === 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertCircle className="h-3 w-3" />
                      Нет полигональных слоёв
                    </div>
                  )}
                  {boundaryType === "line" && lineLayers.length === 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertCircle className="h-3 w-3" />
                      Нет линейных слоёв
                    </div>
                  )}
                </div>
                
                {boundaryType === "line" && (
                  <div className="space-y-2">
                    <Label htmlFor="buffer-distance" className="text-xs">Буферная зона (метры)</Label>
                    <Input
                      id="buffer-distance"
                      type="number"
                      value={bufferDistance}
                      onChange={e => setBufferDistance(e.target.value)}
                      min="1"
                      max="1000"
                      className="max-w-[150px]"
                      data-testid="input-buffer-distance"
                    />
                    <p className="text-xs text-muted-foreground">
                      Радиус вокруг линий для определения попадания объектов
                    </p>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label className="text-xs">Режим ограничения</Label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={boundaryMode === "inside" ? "default" : "outline"}
                      onClick={() => setBoundaryMode("inside")}
                      className="flex-1 text-xs"
                      data-testid="button-boundary-inside"
                    >
                      {boundaryType === "polygon" ? "Внутри полигонов" : "Вблизи линий"}
                    </Button>
                    <Button
                      size="sm"
                      variant={boundaryMode === "outside" ? "default" : "outline"}
                      onClick={() => setBoundaryMode("outside")}
                      className="flex-1 text-xs"
                      data-testid="button-boundary-outside"
                    >
                      {boundaryType === "polygon" ? "Вне полигонов" : "Вдали от линий"}
                    </Button>
                  </div>
                </div>
                
                {boundaryLayerId && (
                  <AttributeFilterBuilder
                    layerId={boundaryLayerId}
                    conditions={boundaryConditions}
                    onConditionsChange={setBoundaryConditions}
                    availableAttributes={boundaryAttrsData.attrs}
                    attributeValues={boundaryAttrsData.values}
                    label={boundaryType === "polygon" ? "Фильтры по атрибутам полигонов" : "Фильтры по атрибутам линий"}
                  />
                )}
              </>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {hasTargetLayer && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="max-distance" className="text-sm font-medium">Порог расстояния (метры)</Label>
            <Input
              id="max-distance"
              type="number"
              value={maxDistance}
              onChange={e => setMaxDistance(e.target.value)}
              min="1"
              max="10000"
              className="max-w-[200px]"
              data-testid="input-max-distance"
            />
            <p className="text-xs text-muted-foreground">
              Объекты дальше порога не будут привязаны к целевому слою
            </p>
          </div>
        </>
      )}
    </div>
  );

  const renderReportConstructor = () => {
    const selectedLayers = editableLayers.filter(l => selectedSourceLayerIds.has(l.id));

    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Button size="sm" variant="ghost" onClick={() => setStep("config")} data-testid="button-back-to-config">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          <span className="font-medium text-sm">Конструктор отчёта</span>
        </div>

        <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
          <Switch
            checked={includeSummary}
            onCheckedChange={setIncludeSummary}
            data-testid="switch-include-summary"
          />
          <Label className="text-sm">Включить сводную таблицу</Label>
        </div>

        <Separator />

        <div className="space-y-3">
          <Label className="text-sm font-medium">Атрибуты для каждого слоя</Label>
          <p className="text-xs text-muted-foreground">
            Выберите, какие атрибуты включить в отчёт. Если ничего не выбрано — будут включены все.
          </p>

          <Accordion type="multiple" className="space-y-2">
            {selectedLayers.map(layer => {
              const layerIdStr = String(layer.id);
              const attrs = sourceLayerAttributes[layerIdStr] || [];
              const selected = selectedAttributes[layerIdStr] || new Set<string>();

              return (
                <AccordionItem key={layer.id} value={layerIdStr} className="border rounded-md px-3">
                  <AccordionTrigger className="py-2 hover:no-underline">
                    <div className="flex items-center gap-2">
                      {(() => { const Icon = GEOM_TYPE_ICONS[layer.geometryType] || MapPin; return <Icon className="h-3.5 w-3.5 text-muted-foreground" />; })()}
                      <span className="text-sm">{layer.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {selected.size > 0 ? `${selected.size} атр.` : "все"}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pb-3">
                    {attrs.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        Загрузка атрибутов...
                      </p>
                    ) : (
                      <>
                        <div className="flex gap-1 mb-1">
                          <Button size="sm" variant="ghost" onClick={() => selectAllAttrsForLayer(layerIdStr, attrs)} className="h-6 text-xs">
                            Все
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => deselectAllAttrsForLayer(layerIdStr)} className="h-6 text-xs">
                            Сбросить
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {attrs.map(attr => (
                            <label key={attr} className="flex items-center gap-1.5 text-xs cursor-pointer p-1 rounded hover-elevate">
                              <Checkbox
                                checked={selected.has(attr)}
                                onCheckedChange={() => toggleAttributeSelection(layerIdStr, attr)}
                              />
                              <span className="truncate">{attr}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </div>
    );
  };

  const renderResults = () => {
    if (!analysisResults) return null;

    const { summary, details } = analysisResults;

    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Button size="sm" variant="ghost" onClick={() => setStep("report-constructor")} data-testid="button-back-to-constructor">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          <span className="font-medium text-sm">Результаты анализа</span>
          {analysisResults.mode === "distance-binding" && (
            <Badge variant="outline" className="text-[10px]">Привязка по расстоянию</Badge>
          )}
          {analysisResults.mode === "boundary-only" && (
            <Badge variant="outline" className="text-[10px]">Пространственный анализ</Badge>
          )}
        </div>

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
                  {summary.byLayer.map(lr => (
                    <TableRow key={lr.layerId} data-testid={`row-summary-${lr.layerId}`}>
                      <TableCell className="text-xs font-medium">{lr.layerName}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary" className="text-[10px]">
                          {GEOM_TYPE_LABELS[lr.geometryType] || lr.geometryType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right">{lr.totalCount}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{lr.matchedCount}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell className="text-xs" colSpan={3}>ИТОГО</TableCell>
                    <TableCell className="text-xs text-right">{summary.totalObjects}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {summary.boundaryLayerName && (
              <p className="text-xs text-muted-foreground">
                Ограничивающий слой: {summary.boundaryLayerName} ({summary.boundaryCount} объектов)
              </p>
            )}
            {summary.targetLayerName && (
              <p className="text-xs text-muted-foreground">
                Целевой слой привязки: {summary.targetLayerName}
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

            return (
              <div key={layerId} className="border rounded-md">
                <button
                  className="w-full flex items-center gap-2 p-2 text-left hover-elevate rounded-md"
                  onClick={() => toggleResultLayerExpand(layerId)}
                  data-testid={`button-expand-layer-${layerId}`}
                >
                  <ChevronRight className={`h-4 w-4 transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                  {(() => { const Icon = GEOM_TYPE_ICONS[detail.geometryType] || MapPin; return <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />; })()}
                  <span className="text-sm font-medium flex-1 truncate">{detail.layerName}</span>
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

  const renderFooter = () => {
    if (step === "config") {
      return (
        <div className="border-t p-3 flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-muted-foreground">
            {selectedSourceLayerIds.size > 0 && (
              <span>
                {selectedSourceLayerIds.size} исходных слоёв
                {hasTargetLayer && ` → ${filteredTargetCount} целевых`}
                {boundaryEnabled && boundaryLayerId && (
                  boundaryType === "polygon" 
                    ? ` (${boundaryMode === "inside" ? "внутри" : "вне"} ${filteredBoundaryCount} полигонов)`
                    : ` (${boundaryMode === "inside" ? "вблизи" : "вдали от"} ${filteredBoundaryCount} линий, буфер ${bufferDistance}м)`
                )}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-analysis">
              Отмена
            </Button>
            <Button
              onClick={() => setStep("report-constructor")}
              disabled={!canProceed}
              data-testid="button-proceed-to-constructor"
            >
              <ChevronRight className="h-4 w-4 mr-1" />
              Далее
            </Button>
          </div>
        </div>
      );
    }

    if (step === "report-constructor") {
      return (
        <div className="border-t p-3 flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-muted-foreground">
            {selectedSourceLayerIds.size} слоёв для анализа
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-analysis">
              Отмена
            </Button>
            <Button
              variant="outline"
              onClick={() => runAnalysis("xlsx")}
              disabled={isAnalyzing}
              data-testid="button-export-xlsx"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              )}
              Скачать XLSX
            </Button>
            <Button
              onClick={() => runAnalysis("json")}
              disabled={isAnalyzing}
              data-testid="button-run-and-preview"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Анализ...
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-1.5" />
                  Просмотр результатов
                </>
              )}
            </Button>
          </div>
        </div>
      );
    }

    if (step === "results") {
      return (
        <div className="border-t p-3 flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-muted-foreground">
            Найдено: {analysisResults?.summary.totalObjects ?? 0} объектов
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-close-results">
              Закрыть
            </Button>
            <Button
              variant="outline"
              onClick={() => runAnalysis("xlsx")}
              disabled={isAnalyzing}
              data-testid="button-export-results-xlsx"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              Скачать XLSX
            </Button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Геопространственный анализ"
      defaultWidth={750}
      defaultHeight={650}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex flex-col h-full">
        <ScrollArea className="flex-1">
          {step === "config" && renderConfig()}
          {step === "report-constructor" && renderReportConstructor()}
          {step === "results" && renderResults()}
        </ScrollArea>

        {renderFooter()}
      </div>
    </DraggableModal>
  );
}
