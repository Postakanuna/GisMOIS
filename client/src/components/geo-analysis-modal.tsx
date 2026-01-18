import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
  Loader2, 
  Download, 
  Plus, 
  X, 
  Filter,
  Layers,
  Target,
  Square,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { EditableLayer, DrawnFeature, LayerSchemaDefinition, AttributeField } from "@shared/schema";

interface FilterCondition {
  id: string;
  attribute: string;
  operator: string;
  value: string;
}

interface LayerFilterConfig {
  layerId: string;
  conditions: FilterCondition[];
}

type BoundaryMode = "inside" | "outside" | "none";
type BoundaryType = "polygon" | "line";

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
                className="h-6 w-6"
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

export function GeoAnalysisModal({
  isOpen,
  onClose,
  editableLayers,
  sceneId,
}: GeoAnalysisModalProps) {
  const { toast } = useToast();
  
  const [sourceLayerId, setSourceLayerId] = useState<string>("");
  const [sourceConditions, setSourceConditions] = useState<FilterCondition[]>([]);
  
  const [targetLayerId, setTargetLayerId] = useState<string>("");
  const [targetConditions, setTargetConditions] = useState<FilterCondition[]>([]);
  
  const [boundaryEnabled, setBoundaryEnabled] = useState(false);
  const [boundaryType, setBoundaryType] = useState<BoundaryType>("polygon");
  const [boundaryLayerId, setBoundaryLayerId] = useState<string>("");
  const [boundaryConditions, setBoundaryConditions] = useState<FilterCondition[]>([]);
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("inside");
  const [bufferDistance, setBufferDistance] = useState<string>("10");
  
  const [maxDistance, setMaxDistance] = useState<string>("15");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const pointLayers = useMemo(() => 
    editableLayers.filter(l => l.geometryType === "Point"), 
    [editableLayers]
  );
  
  const lineLayers = useMemo(() => 
    editableLayers.filter(l => l.geometryType === "LineString"), 
    [editableLayers]
  );
  
  const polygonLayers = useMemo(() => 
    editableLayers.filter(l => l.geometryType === "Polygon"), 
    [editableLayers]
  );

  const { data: sourceFeatures = [] } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", parseInt(sourceLayerId), "features"],
    enabled: !!sourceLayerId,
  });

  const { data: targetFeatures = [] } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", parseInt(targetLayerId), "features"],
    enabled: !!targetLayerId,
  });

  const { data: boundaryFeatures = [] } = useQuery<DrawnFeature[]>({
    queryKey: ["/api/editable-layers", parseInt(boundaryLayerId), "features"],
    enabled: !!boundaryLayerId && boundaryEnabled,
  });

  const { data: sourceSchema } = useQuery<LayerSchemaDefinition>({
    queryKey: ["/api/editable-layers", parseInt(sourceLayerId), "schema"],
    enabled: !!sourceLayerId,
  });

  const { data: targetSchema } = useQuery<LayerSchemaDefinition>({
    queryKey: ["/api/editable-layers", parseInt(targetLayerId), "schema"],
    enabled: !!targetLayerId,
  });

  const { data: boundarySchema } = useQuery<LayerSchemaDefinition>({
    queryKey: ["/api/editable-layers", parseInt(boundaryLayerId), "schema"],
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

  const sourceAttrsData = useMemo(() => extractAttributes(sourceFeatures), [sourceFeatures, extractAttributes]);
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

  const filteredSourceCount = useMemo(() => 
    applyFilter(sourceFeatures, sourceConditions).length,
    [sourceFeatures, sourceConditions, applyFilter]
  );

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
      setSourceLayerId("");
      setSourceConditions([]);
      setTargetLayerId("");
      setTargetConditions([]);
      setBoundaryEnabled(false);
      setBoundaryType("polygon");
      setBoundaryLayerId("");
      setBoundaryConditions([]);
      setBoundaryMode("inside");
      setBufferDistance("10");
      setMaxDistance("15");
    }
  }, [isOpen]);

  // Сброс слоя при смене типа ограничения
  useEffect(() => {
    setBoundaryLayerId("");
    setBoundaryConditions([]);
  }, [boundaryType]);

  const runAnalysis = async () => {
    if (!sourceLayerId || !targetLayerId) {
      toast({
        title: "Ошибка",
        description: "Выберите исходный и целевой слои",
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

    if (boundaryEnabled && !boundaryLayerId) {
      toast({
        title: "Ошибка",
        description: "Выберите ограничивающий слой или отключите его",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      const bufferNum = parseFloat(bufferDistance);
      const requestBody = {
        sourceLayerId: parseInt(sourceLayerId),
        sourceFilters: sourceConditions.filter(c => c.attribute && c.value),
        targetLayerId: parseInt(targetLayerId),
        targetFilters: targetConditions.filter(c => c.attribute && c.value),
        boundaryLayerId: boundaryEnabled && boundaryLayerId ? parseInt(boundaryLayerId) : null,
        boundaryFilters: boundaryEnabled ? boundaryConditions.filter(c => c.attribute && c.value) : [],
        boundaryMode: boundaryEnabled ? boundaryMode : "none",
        boundaryType: boundaryEnabled ? boundaryType : "polygon",
        bufferDistanceMeters: boundaryType === "line" ? (isNaN(bufferNum) ? 10 : bufferNum) : null,
        maxDistanceMeters: distanceNum,
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

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `geospatial_analysis_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Анализ завершён",
        description: "Файл XLSX загружен",
      });

      onClose();
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

  const canRunAnalysis = sourceLayerId && targetLayerId && (!boundaryEnabled || boundaryLayerId);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Геопространственный анализ"
      defaultWidth={700}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex flex-col h-full">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <Accordion type="multiple" defaultValue={["source", "target"]} className="space-y-2">
              <AccordionItem value="source" className="border rounded-md px-3">
                <AccordionTrigger className="py-2 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Исходный слой</span>
                    {sourceLayerId && (
                      <Badge variant="secondary" className="text-xs">
                        {filteredSourceCount} объектов
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  <div className="space-y-2">
                    <Label htmlFor="source-layer" className="text-xs">Выберите слой</Label>
                    <Select value={sourceLayerId} onValueChange={setSourceLayerId}>
                      <SelectTrigger id="source-layer" data-testid="select-source-layer">
                        <SelectValue placeholder="Выберите слой" />
                      </SelectTrigger>
                      <SelectContent>
                        {editableLayers.map(layer => (
                          <SelectItem key={layer.id} value={String(layer.id)}>
                            {layer.name} ({layer.geometryType}, {layer.featureCount} объектов)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {sourceLayerId && (
                    <AttributeFilterBuilder
                      layerId={sourceLayerId}
                      conditions={sourceConditions}
                      onConditionsChange={setSourceConditions}
                      availableAttributes={sourceAttrsData.attrs}
                      attributeValues={sourceAttrsData.values}
                      label="Фильтры по атрибутам (условия объединяются через И)"
                    />
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="target" className="border rounded-md px-3">
                <AccordionTrigger className="py-2 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Целевой слой привязки</span>
                    {targetLayerId && (
                      <Badge variant="secondary" className="text-xs">
                        {filteredTargetCount} объектов
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  <div className="space-y-2">
                    <Label htmlFor="target-layer" className="text-xs">Выберите слой</Label>
                    <Select value={targetLayerId} onValueChange={setTargetLayerId}>
                      <SelectTrigger id="target-layer" data-testid="select-target-layer">
                        <SelectValue placeholder="Выберите слой" />
                      </SelectTrigger>
                      <SelectContent>
                        {editableLayers.map(layer => (
                          <SelectItem key={layer.id} value={String(layer.id)}>
                            {layer.name} ({layer.geometryType}, {layer.featureCount} объектов)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {targetLayerId && (
                    <AttributeFilterBuilder
                      layerId={targetLayerId}
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
                    <span className="font-medium text-sm">Ограничивающий слой (опционально)</span>
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
          </div>
        </ScrollArea>

        <div className="border-t p-3 flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-muted-foreground">
            {sourceLayerId && targetLayerId && (
              <span>
                Анализ: {filteredSourceCount} исходных → {filteredTargetCount} целевых
                {boundaryEnabled && boundaryLayerId && (
                  boundaryType === "polygon" 
                    ? ` (${boundaryMode === "inside" ? "внутри" : "вне"} ${filteredBoundaryCount} полигонов)`
                    : ` (${boundaryMode === "inside" ? "вблизи" : "вдали от"} ${filteredBoundaryCount} линий, буфер ${bufferDistance}м)`
                )}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              data-testid="button-cancel-analysis"
            >
              Отмена
            </Button>
            <Button
              onClick={runAnalysis}
              disabled={isAnalyzing || !canRunAnalysis}
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
          </div>
        </div>
      </div>
    </DraggableModal>
  );
}
