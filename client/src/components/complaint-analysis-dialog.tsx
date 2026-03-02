import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";

import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  GripHorizontal,
  Home,
  Loader2,
  Search,
  X,
  MapPin,
  GitBranch,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Unlink,
  Save,
  Layers,
} from "lucide-react";

type AnalysisMode = "topology" | "no_topology";

interface EditableLayer {
  id: number;
  name: string;
  geometryType: string;
  visible?: boolean;
}

interface FailureZone {
  zoneName: string;
  zoneType: string;
  zoneCoordinates: any;
  incomingSegment: { featureId: number; from: string; to: string; length: number } | null;
  complaintConsumers: string[];
  complaintCount: number;
  uniqueComplaintConsumerCount?: number;
  downstreamConsumerCount: number;
  probability?: number;
  confidence: string;
  affectedSegments: Array<{
    featureId: number;
    from: string;
    to: string;
    length: number;
    coordinates: any;
  }>;
  affectedConsumers: Array<{
    featureId: number;
    name: string;
    address: string;
    coordinates: any;
  }>;
}

interface ComplaintAnalysisResult {
  totalComplaints: number;
  totalMatched: number;
  totalUnmatched: number;
  layerNames?: Record<number, string>;
  dateGroups: Array<{
    date: string;
    clusterId: number;
    sourceName: string;
    complaintCount: number;
    uniqueConsumerCount: number;
    clusterCenter?: [number, number];
    layerBreakdown?: Record<string, number>;
    consumers: Array<{
      name: string;
      address: string;
      complaintCount: number;
      distance: number;
      matchType: "address+proximity" | "proximity_only";
    }>;
    failureZones: FailureZone[];
  }>;
  unclustered?: Array<{
    complaintId: number;
    address: string;
    date: string;
    consumerName: string;
    reason: string;
  }>;
  unmatchedComplaints: Array<{
    complaintId: number;
    address: string;
    date: string;
    reason: string;
  }>;
}

interface NoTopologyCluster {
  id: number;
  date: string;
  complaintCount: number;
  layerBreakdown?: Record<string, number>;
  complaints: Array<{
    featureId: number;
    layerId?: number;
    layerName?: string;
    address: string;
    lon: number;
    lat: number;
    properties: Record<string, unknown>;
  }>;
  centroid: [number, number];
  polygon: number[][] | null;
  radiusM: number;
}

interface NoTopologyResult {
  mode: "no_topology";
  totalComplaints: number;
  totalClustered: number;
  totalUnclustered: number;
  layerNames?: Record<number, string>;
  clusters: NoTopologyCluster[];
  unclustered: Array<{
    featureId: number;
    address: string;
    date: string;
    reason: string;
  }>;
}

interface LayerFieldMapping {
  layerId: number;
  dateField: string;
  addressField: string;
}

interface ComplaintAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editableLayers: EditableLayer[];
  sceneId: number;
  onAnalysisResult: (result: ComplaintAnalysisResult | null) => void;
  onHighlightZone: (zone: FailureZone | null) => void;
  onHighlightPolygons: (data: { polygons: Array<{ coordinates: number[][] }>; points: Array<{ coordinates: [number, number]; type: string }> } | null) => void;
  initialNoTopoResult?: NoTopologyResult | null;
}

export function ComplaintAnalysisDialog({
  open,
  onOpenChange,
  editableLayers,
  sceneId,
  onAnalysisResult,
  onHighlightZone,
  onHighlightPolygons,
  initialNoTopoResult,
}: ComplaintAnalysisDialogProps) {
  const isMobile = useIsMobile();
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("topology");
  const [selectedLayerIds, setSelectedLayerIds] = useState<number[]>([]);
  const [layerFieldMappings, setLayerFieldMappings] = useState<Record<number, { dateField: string; addressField: string }>>({});
  const [matchRadius, setMatchRadius] = useState<number>(100);
  const [clusterRadius, setClusterRadius] = useState<number>(500);
  const [result, setResult] = useState<ComplaintAnalysisResult | null>(null);
  const [noTopoResult, setNoTopoResult] = useState<NoTopologyResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [highlightedZoneKey, setHighlightedZoneKey] = useState<string | null>(null);
  const [layerAttributesCache, setLayerAttributesCache] = useState<Record<number, string[]>>({});

  const [position, setPosition] = useState({ x: 20, y: 80 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    };
    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (initialNoTopoResult && open) {
      setNoTopoResult(initialNoTopoResult);
      setAnalysisMode("no_topology");
      setResult(null);
    }
  }, [initialNoTopoResult, open]);

  useEffect(() => {
    for (const layerId of selectedLayerIds) {
      if (layerAttributesCache[layerId] !== undefined) continue;
      setLayerAttributesCache(prev => ({ ...prev, [layerId]: [] }));
      fetch(`/api/editable-layers/${layerId}/attributes`)
        .then(r => r.ok ? r.json() : [])
        .then((attrs: string[]) => {
          setLayerAttributesCache(prev => ({ ...prev, [layerId]: attrs }));
        })
        .catch(() => {});
    }
  }, [selectedLayerIds, layerAttributesCache]);

  const toggleLayerSelection = (layerId: number) => {
    setSelectedLayerIds(prev => {
      if (prev.includes(layerId)) {
        const next = prev.filter(id => id !== layerId);
        setLayerFieldMappings(m => {
          const copy = { ...m };
          delete copy[layerId];
          return copy;
        });
        return next;
      }
      if (prev.length >= 5) return prev;
      setLayerFieldMappings(m => ({
        ...m,
        [layerId]: { dateField: "", addressField: "" },
      }));
      return [...prev, layerId];
    });
  };

  const updateFieldMapping = (layerId: number, field: "dateField" | "addressField", value: string) => {
    setLayerFieldMappings(prev => ({
      ...prev,
      [layerId]: { ...prev[layerId], [field]: value },
    }));
  };

  const buildComplaintLayers = (): LayerFieldMapping[] => {
    return selectedLayerIds.map(id => ({
      layerId: id,
      dateField: layerFieldMappings[id]?.dateField || "",
      addressField: layerFieldMappings[id]?.addressField || "",
    }));
  };

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        complaintLayers: buildComplaintLayers(),
        mode: analysisMode,
        matchRadius,
      };
      if (analysisMode === "topology") {
        body.sceneId = sceneId;
        body.clusterRadius = clusterRadius;
      }
      const res = await apiRequest("POST", "/api/complaint-analysis", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.mode === "no_topology") {
        setNoTopoResult(data as NoTopologyResult);
        setResult(null);
        onAnalysisResult(null);
      } else {
        setResult(data as ComplaintAnalysisResult);
        setNoTopoResult(null);
        onAnalysisResult(data as ComplaintAnalysisResult);
      }
    },
  });

  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const getSelectedLayerNames = (): string[] => {
    return selectedLayerIds.map(id => {
      const layer = editableLayers.find(l => l.id === id);
      return layer?.name || `Слой ${id}`;
    });
  };

  const saveAsLayerMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      const dateStr = `${now.getDate().toString().padStart(2, "0")}.${(now.getMonth() + 1).toString().padStart(2, "0")}.${now.getFullYear()}`;
      const modeSuffix = analysisMode === "topology" ? "топология" : "кластеры";
      const defaultName = `Анализ жалоб (${modeSuffix}) ${dateStr}`;

      const layerNames = getSelectedLayerNames();

      const body: Record<string, unknown> = {
        mode: analysisMode,
        sceneId: sceneId || null,
        layerName: defaultName,
        analysisParams: {
          complaintLayerName: layerNames.join("; "),
          sourceLayerNames: layerNames,
          matchRadius,
        },
      };

      if (analysisMode === "topology" && result) {
        body.topologyResult = result;
      } else if (analysisMode === "no_topology" && noTopoResult) {
        body.noTopologyResult = noTopoResult;
      }

      const res = await apiRequest("POST", "/api/complaint-analysis/save-as-layer", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Слой сохранён",
        description: `Создан слой "${data.layerName}" с ${data.featureCount} объектами`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", sceneId, "editable-layers"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка сохранения",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const hasAnyResult = result || noTopoResult;

  const handleClose = () => {
    setResult(null);
    setNoTopoResult(null);
    setHighlightedZoneKey(null);
    analysisMutation.reset();
    onAnalysisResult(null);
    onHighlightZone(null);
    onHighlightPolygons(null);
    onOpenChange(false);
  };

  const handleExport = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const res = await fetch("/api/complaint-analysis/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          complaintLayers: buildComplaintLayers(),
          sceneId,
          matchRadius,
          clusterRadius,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Ошибка экспорта");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      let filename = "complaint_analysis.xlsx";
      if (disposition) {
        const match = disposition.match(/filename\*=UTF-8''(.+)/);
        if (match) filename = decodeURIComponent(match[1]);
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  const handleHighlightZone = (zone: FailureZone, key: string) => {
    onHighlightPolygons(null);
    if (highlightedZoneKey === key) {
      setHighlightedZoneKey(null);
      onHighlightZone(null);
    } else {
      setHighlightedZoneKey(key);
      onHighlightZone(zone);
    }
  };

  const handleHighlightCluster = (cluster: NoTopologyCluster, key: string) => {
    onHighlightZone(null);
    if (highlightedZoneKey === key) {
      setHighlightedZoneKey(null);
      onHighlightPolygons(null);
    } else {
      setHighlightedZoneKey(key);
      const polygons = cluster.polygon ? [{ coordinates: cluster.polygon }] : [];
      const points = cluster.complaints.map(c => ({
        coordinates: [c.lon, c.lat] as [number, number],
        type: "complaint",
      }));
      onHighlightPolygons({ polygons, points });
    }
  };

  const toggleGroup = (index: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleReset = () => {
    setResult(null);
    setNoTopoResult(null);
    setHighlightedZoneKey(null);
    analysisMutation.reset();
    onAnalysisResult(null);
    onHighlightZone(null);
    onHighlightPolygons(null);
  };

  const pointLayers = editableLayers.filter(l => l.geometryType === "Point");

  const confidenceIcon = (conf: string) => {
    switch (conf) {
      case "high": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "medium": return <HelpCircle className="h-4 w-4 text-yellow-500" />;
      default: return <XCircle className="h-4 w-4 text-red-400" />;
    }
  };

  const confidenceLabel = (conf: string) => {
    switch (conf) {
      case "high": return "Высокая";
      case "medium": return "Средняя";
      default: return "Низкая";
    }
  };

  const nodeTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      source: "Источник", ctp: "ЦТП", consumer: "Потребитель",
      node: "Узел", valve: "Задвижка", pump: "Насос",
    };
    return map[type] || type;
  };

  if (!open) return null;

  return (
    <div
      className={isMobile
        ? "fixed inset-0 z-[9999] bg-background flex flex-col"
        : "fixed z-50 bg-background border rounded-md shadow-lg"}
      style={isMobile ? undefined : { left: position.x, top: position.y, width: 420, maxHeight: "calc(100vh - 100px)" }}
      data-testid="complaint-analysis-dialog"
    >
      <div
        className={isMobile
          ? "flex items-center justify-between px-3 py-3 border-b bg-muted/40 shrink-0"
          : "flex items-center justify-between px-3 py-2 border-b cursor-move select-none"}
        onMouseDown={isMobile ? undefined : handleMouseDown}
      >
        <div className="flex items-center gap-2">
          {!isMobile && <GripHorizontal className="h-4 w-4 text-muted-foreground" />}
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span className="font-medium text-sm">Анализ жалоб</span>
        </div>
        <div className="flex items-center gap-1">
          {result && (
            <Button
              size="icon"
              variant="ghost"
              onClick={handleExport}
              disabled={exporting}
              data-testid="button-export-complaints"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={handleClose} data-testid="button-close-complaints">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className={isMobile ? "flex-1 overflow-y-auto" : "overflow-y-auto"} style={isMobile ? undefined : { maxHeight: "calc(100vh - 200px)" }}>
        <div className="p-3 space-y-3">
          {!hasAnyResult && (
            <>
              <div className="flex gap-1" data-testid="mode-selector-complaints">
                <Button
                  size="sm"
                  variant={analysisMode === "topology" ? "default" : "outline"}
                  className="flex-1 text-xs toggle-elevate"
                  onClick={() => { setAnalysisMode("topology"); setMatchRadius(100); setClusterRadius(500); }}
                  data-testid="button-mode-topology"
                >
                  <GitBranch className="h-3 w-3 mr-1" />
                  С топологией
                </Button>
                <Button
                  size="sm"
                  variant={analysisMode === "no_topology" ? "default" : "outline"}
                  className="flex-1 text-xs toggle-elevate"
                  onClick={() => { setAnalysisMode("no_topology"); setMatchRadius(350); }}
                  data-testid="button-mode-no-topology"
                >
                  <Unlink className="h-3 w-3 mr-1" />
                  Без топологии
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {analysisMode === "topology"
                  ? "Привязка жалоб к потребителям, кластеризация по дате и близости, поиск точки схождения проблемных потребителей на графе сети"
                  : "Пространственная кластеризация жалоб: одна дата + заданный радиус. Предпросмотр полигонов кластеров на карте"}
              </p>

              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  Слои жалоб (точечные, до 5)
                </Label>
                <div className="border rounded-md max-h-[140px] overflow-y-auto">
                  {pointLayers.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground">Нет точечных слоёв</div>
                  )}
                  {pointLayers.map(l => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 cursor-pointer text-xs"
                      data-testid={`checkbox-layer-${l.id}`}
                    >
                      <Checkbox
                        checked={selectedLayerIds.includes(l.id)}
                        onCheckedChange={() => toggleLayerSelection(l.id)}
                        disabled={!selectedLayerIds.includes(l.id) && selectedLayerIds.length >= 5}
                      />
                      <span className="truncate">{l.name}</span>
                    </label>
                  ))}
                </div>
                {selectedLayerIds.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Выбрано: {selectedLayerIds.length} из {pointLayers.length}
                  </div>
                )}
              </div>

              {selectedLayerIds.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">Маппинг полей для каждого слоя</Label>
                  {selectedLayerIds.map(layerId => {
                    const layer = editableLayers.find(l => l.id === layerId);
                    const attrs = layerAttributesCache[layerId] || [];
                    const mapping = layerFieldMappings[layerId] || { dateField: "", addressField: "" };
                    return (
                      <div key={layerId} className="border rounded-md p-2 space-y-1.5 bg-muted/30">
                        <div className="text-xs font-medium truncate">{layer?.name || `Слой ${layerId}`}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5">Поле даты</div>
                            {attrs.length > 0 ? (
                              <Select
                                value={mapping.dateField}
                                onValueChange={v => updateFieldMapping(layerId, "dateField", v)}
                              >
                                <SelectTrigger className="h-7 text-xs" data-testid={`select-date-field-${layerId}`}>
                                  <SelectValue placeholder="Поле" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none_">Не указывать</SelectItem>
                                  {attrs.map(attr => (
                                    <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                className="h-7 text-xs"
                                placeholder="Имя поля"
                                value={mapping.dateField}
                                onChange={e => updateFieldMapping(layerId, "dateField", e.target.value)}
                                data-testid={`input-date-field-${layerId}`}
                              />
                            )}
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5">Поле адреса</div>
                            {attrs.length > 0 ? (
                              <Select
                                value={mapping.addressField}
                                onValueChange={v => updateFieldMapping(layerId, "addressField", v)}
                              >
                                <SelectTrigger className="h-7 text-xs" data-testid={`select-address-field-${layerId}`}>
                                  <SelectValue placeholder="Поле" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none_">Не указывать</SelectItem>
                                  {attrs.map(attr => (
                                    <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                className="h-7 text-xs"
                                placeholder="Имя поля"
                                value={mapping.addressField}
                                onChange={e => updateFieldMapping(layerId, "addressField", e.target.value)}
                                data-testid={`input-address-field-${layerId}`}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {analysisMode === "topology" ? (
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Радиус привязки жалобы к потребителю (м)</Label>
                    <p className="text-[10px] text-muted-foreground mb-1">Максимальное расстояние от точки жалобы до точки потребителя</p>
                    <Input
                      type="number"
                      value={matchRadius}
                      onChange={e => setMatchRadius(Number(e.target.value) || 100)}
                      min={10}
                      max={5000}
                      data-testid="input-match-radius"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Радиус кластеризации потребителей (м)</Label>
                    <p className="text-[10px] text-muted-foreground mb-1">Максимальное расстояние между потребителями для объединения в кластер</p>
                    <Input
                      type="number"
                      value={clusterRadius}
                      onChange={e => setClusterRadius(Number(e.target.value) || 500)}
                      min={50}
                      max={10000}
                      data-testid="input-cluster-radius"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs">Радиус кластеризации (м)</Label>
                  <Input
                    type="number"
                    value={matchRadius}
                    onChange={e => setMatchRadius(Number(e.target.value) || 350)}
                    min={10}
                    max={5000}
                    data-testid="input-match-radius"
                  />
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={() => analysisMutation.mutate()}
                disabled={selectedLayerIds.length === 0 || analysisMutation.isPending}
                data-testid="button-run-analysis"
              >
                {analysisMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Анализ...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Запустить анализ
                  </>
                )}
              </Button>

              {analysisMutation.isError && (
                <div className="text-sm text-destructive">
                  {(analysisMutation.error as Error).message}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center flex-wrap gap-2">
                <Badge variant="outline">Жалоб: {result.totalComplaints}</Badge>
                <Badge variant="secondary">Привязано: {result.totalMatched}</Badge>
                {result.totalUnmatched > 0 && (
                  <Badge variant="destructive">Не привязано: {result.totalUnmatched}</Badge>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Найдено {result.dateGroups.length} кластер{result.dateGroups.length === 1 ? "" : result.dateGroups.length < 5 ? "а" : "ов"} (дата + близость потребителей)
                {result.unclustered && result.unclustered.length > 0 && (
                  <span className="text-orange-600 dark:text-orange-400"> | {result.unclustered.length} единичных</span>
                )}
              </div>

              {result.dateGroups.map((group, index) => (
                <Card key={index} className="overflow-visible">
                  <Collapsible open={expandedGroups.has(index)} onOpenChange={() => toggleGroup(index)}>
                    <CollapsibleTrigger className="w-full" data-testid={`trigger-group-${index}`}>
                      <div className="flex items-center justify-between p-2 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {expandedGroups.has(index) ? (
                            <ChevronDown className="h-4 w-4 shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">{group.date}</span>
                          <Badge variant="outline" className="shrink-0">
                            {group.uniqueConsumerCount} МКД
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {group.failureZones.length > 0 && (
                            <Badge variant="destructive" className="shrink-0">{group.failureZones.length} зон</Badge>
                          )}
                          <Badge variant="secondary">{group.complaintCount} жалоб</Badge>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-2 pb-2 space-y-2">
                        {group.sourceName && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> Источник: {group.sourceName}
                          </div>
                        )}

                        {group.layerBreakdown && Object.keys(group.layerBreakdown).length > 1 && (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(group.layerBreakdown).map(([name, count]) => (
                              <Badge key={name} variant="outline" className="text-[10px] py-0 px-1.5">
                                {name}: {count}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {group.failureZones.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-orange-500" />
                              Вероятные точки проблемы ({group.failureZones.length})
                            </div>
                            {group.failureZones.map((zone, zi) => {
                              const zoneKey = `${index}-${zi}`;
                              return (
                                <div key={zi} className="border rounded-md p-2 space-y-1 bg-destructive/5">
                                  <div className="flex items-center gap-1 text-xs font-medium">
                                    {confidenceIcon(zone.confidence)}
                                    <span className="truncate">{zone.zoneName}</span>
                                    <Badge variant="outline" className="shrink-0 ml-auto">{nodeTypeLabel(zone.zoneType)}</Badge>
                                  </div>
                                  {zone.probability !== undefined && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-medium">Вероятность:</span>
                                      <span className={`text-sm font-bold ${
                                        zone.probability >= 70 ? "text-red-500" :
                                        zone.probability >= 30 ? "text-yellow-600 dark:text-yellow-400" :
                                        "text-green-600 dark:text-green-400"
                                      }`}>{zone.probability}%</span>
                                    </div>
                                  )}
                                  <div className="text-xs space-y-0.5">
                                    {zone.incomingSegment && (
                                      <div>
                                        <span className="text-muted-foreground">Участок: </span>
                                        {zone.incomingSegment.from} &rarr; {zone.incomingSegment.to}
                                        {zone.incomingSegment.length > 0 && ` (${zone.incomingSegment.length}м)`}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {zone.probability === undefined && (
                                        <span className="flex items-center gap-1">
                                          {confidenceLabel(zone.confidence)}
                                        </span>
                                      )}
                                      <span className="text-muted-foreground">
                                        Жалоб: {zone.complaintCount}
                                      </span>
                                      <span className="text-muted-foreground">
                                        МКД с жалобами: {zone.uniqueComplaintConsumerCount || zone.complaintConsumers?.length || "—"}
                                      </span>
                                      <span className="text-muted-foreground">
                                        Всего потребителей ниже: {zone.downstreamConsumerCount}
                                      </span>
                                      {zone.affectedSegments && zone.affectedSegments.length > 0 && (
                                        <span className="text-muted-foreground">
                                          Участков: {zone.affectedSegments.length} ({Math.round(zone.affectedSegments.reduce((s, seg) => s + seg.length, 0))}м)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={highlightedZoneKey === zoneKey ? "default" : "outline"}
                                    className="w-full mt-1 gap-1"
                                    onClick={() => handleHighlightZone(zone, zoneKey)}
                                    data-testid={`button-highlight-zone-${zoneKey}`}
                                  >
                                    <GitBranch className="h-3 w-3" />
                                    {highlightedZoneKey === zoneKey ? "Убрать подсветку" : "Показать на карте"}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="text-xs font-medium flex items-center gap-1">
                          <Home className="h-3 w-3" />
                          Потребители с жалобами ({group.consumers.length})
                        </div>
                        {group.consumers.map((c, ci) => (
                          <div key={ci} className="text-xs pl-4 border-l-2 border-muted py-0.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-medium">{c.name}</span>
                              {c.matchType === "proximity_only" && (
                                <Badge variant="outline" className="text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-600 shrink-0">
                                  только близость
                                </Badge>
                              )}
                            </div>
                            {c.address && <div className="text-muted-foreground">{c.address}</div>}
                            <div className="text-muted-foreground">
                              Жалоб: {c.complaintCount}, расстояние: {c.distance}м
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              ))}

              {result.unclustered && result.unclustered.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="w-full" data-testid="trigger-unclustered-topology">
                    <div className="flex items-center gap-2 p-2 text-sm">
                      <ChevronRight className="h-4 w-4 shrink-0" />
                      <span className="text-muted-foreground">Единичные жалобы — не кластеризованы ({result.unclustered.length})</span>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-1">
                      {result.unclustered.map((u, i) => (
                        <div key={i} className="text-xs pl-4 border-l-2 border-muted py-0.5">
                          <div className="text-muted-foreground">{u.date} — {u.consumerName || "Без имени"}</div>
                          <div className="text-muted-foreground/80">{u.address || "Без адреса"}</div>
                          <div className="text-muted-foreground/60">{u.reason}</div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {result.unmatchedComplaints.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="w-full" data-testid="trigger-unmatched">
                    <div className="flex items-center gap-2 p-2 text-sm">
                      <ChevronRight className="h-4 w-4 shrink-0" />
                      <span className="text-muted-foreground">Не привязаны к потребителям ({result.unmatchedComplaints.length})</span>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-1">
                      {result.unmatchedComplaints.map((u, i) => (
                        <div key={i} className="text-xs pl-4 border-l-2 border-muted py-0.5">
                          <div className="text-muted-foreground">{u.date} — {u.address || "Без адреса"}</div>
                          <div className="text-muted-foreground/60">{u.reason}</div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <Button
                size="sm"
                className="w-full gap-1"
                onClick={() => saveAsLayerMutation.mutate()}
                disabled={saveAsLayerMutation.isPending}
                data-testid="button-save-as-layer"
              >
                {saveAsLayerMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Сохранить как слой
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleReset}
                data-testid="button-reset-analysis"
              >
                Новый анализ
              </Button>
            </div>
          )}

          {noTopoResult && (
            <div className="space-y-3">
              <Badge variant="outline" className="shrink-0">
                <Unlink className="h-3 w-3 mr-1" />
                Без топологии
              </Badge>

              <div className="flex items-center flex-wrap gap-2">
                <Badge variant="outline">Жалоб: {noTopoResult.totalComplaints}</Badge>
                <Badge variant="secondary">В кластерах: {noTopoResult.totalClustered}</Badge>
                {noTopoResult.totalUnclustered > 0 && (
                  <Badge variant="destructive">Без кластера: {noTopoResult.totalUnclustered}</Badge>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Найдено {noTopoResult.clusters.length} кластер{noTopoResult.clusters.length === 1 ? "" : noTopoResult.clusters.length < 5 ? "а" : "ов"} (дата + радиус {noTopoResult.clusters[0]?.radiusM || matchRadius}м)
              </div>

              {noTopoResult.clusters.map((cluster, index) => {
                const clusterKey = `cluster-${cluster.id}`;
                return (
                  <Card key={cluster.id} className="overflow-visible">
                    <Collapsible open={expandedGroups.has(index)} onOpenChange={() => toggleGroup(index)}>
                      <CollapsibleTrigger className="w-full" data-testid={`trigger-cluster-${index}`}>
                        <div className="flex items-center justify-between p-2 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {expandedGroups.has(index) ? (
                              <ChevronDown className="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0" />
                            )}
                            <span className="text-sm font-medium truncate">{cluster.date}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="secondary">{cluster.complaintCount} жалоб</Badge>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-2 pb-2 space-y-2">
                          {cluster.layerBreakdown && Object.keys(cluster.layerBreakdown).length > 1 && (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(cluster.layerBreakdown).map(([name, count]) => (
                                <Badge key={name} variant="outline" className="text-[10px] py-0 px-1.5">
                                  {name}: {count}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="text-xs font-medium flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            Жалобы в кластере ({cluster.complaintCount})
                          </div>
                          {cluster.complaints.map((c, ci) => (
                            <div key={ci} className="text-xs pl-4 border-l-2 border-muted py-0.5">
                              <div className="text-muted-foreground">{c.address || "Без адреса"}</div>
                              {c.layerName && selectedLayerIds.length > 1 && (
                                <div className="text-muted-foreground/60 text-[10px]">{c.layerName}</div>
                              )}
                            </div>
                          ))}

                          {cluster.polygon && (
                            <Button
                              size="sm"
                              variant={highlightedZoneKey === clusterKey ? "default" : "outline"}
                              className="w-full mt-1 gap-1"
                              onClick={() => handleHighlightCluster(cluster, clusterKey)}
                              data-testid={`button-highlight-cluster-${cluster.id}`}
                            >
                              <MapPin className="h-3 w-3" />
                              {highlightedZoneKey === clusterKey ? "Убрать подсветку" : "Показать на карте"}
                            </Button>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}

              {noTopoResult.unclustered.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="w-full" data-testid="trigger-unclustered">
                    <div className="flex items-center gap-2 p-2 text-sm">
                      <ChevronRight className="h-4 w-4 shrink-0" />
                      <span className="text-muted-foreground">Не вошли в кластеры ({noTopoResult.unclustered.length})</span>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-1">
                      {noTopoResult.unclustered.map((u, i) => (
                        <div key={i} className="text-xs pl-4 border-l-2 border-muted py-0.5">
                          <div className="text-muted-foreground">{u.date} - {u.address || "Без адреса"}</div>
                          <div className="text-muted-foreground/60">{u.reason}</div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <Button
                size="sm"
                className="w-full gap-1"
                onClick={() => saveAsLayerMutation.mutate()}
                disabled={saveAsLayerMutation.isPending}
                data-testid="button-save-as-layer-notopo"
              >
                {saveAsLayerMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Сохранить как слой
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleReset}
                data-testid="button-reset-analysis"
              >
                Новый анализ
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { ComplaintAnalysisResult, NoTopologyResult };
