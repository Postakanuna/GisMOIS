import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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
  downstreamConsumerCount: number;
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
  emptyNistCount: number;
  dateGroups: Array<{
    date: string;
    nist: string;
    sourceName: string;
    complaintCount: number;
    consumers: Array<{
      name: string;
      address: string;
      complaintCount: number;
      distance: number;
      matchType: "address+proximity" | "proximity_only";
    }>;
    failureZones: FailureZone[];
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
  complaints: Array<{
    featureId: number;
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
  clusters: NoTopologyCluster[];
  unclustered: Array<{
    featureId: number;
    address: string;
    date: string;
    reason: string;
  }>;
}

interface ComplaintAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editableLayers: EditableLayer[];
  sceneId: number;
  onAnalysisResult: (result: ComplaintAnalysisResult | null) => void;
  onHighlightZone: (zone: FailureZone | null) => void;
  onHighlightPolygons: (data: { polygons: Array<{ coordinates: number[][] }>; points: Array<{ coordinates: [number, number]; type: string }> } | null) => void;
}

export function ComplaintAnalysisDialog({
  open,
  onOpenChange,
  editableLayers,
  sceneId,
  onAnalysisResult,
  onHighlightZone,
  onHighlightPolygons,
}: ComplaintAnalysisDialogProps) {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("topology");
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [dateFieldName, setDateFieldName] = useState<string>("");
  const [addressFieldName, setAddressFieldName] = useState<string>("");
  const [matchRadius, setMatchRadius] = useState<number>(100);
  const [result, setResult] = useState<ComplaintAnalysisResult | null>(null);
  const [noTopoResult, setNoTopoResult] = useState<NoTopologyResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [highlightedZoneKey, setHighlightedZoneKey] = useState<string | null>(null);

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

  const layerAttributes = useQuery<string[]>({
    queryKey: ["/api/editable-layers", selectedLayerId, "attributes"],
    enabled: !!selectedLayerId,
  });

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        complaintLayerId: Number(selectedLayerId),
        dateFieldName,
        addressFieldName,
        mode: analysisMode,
      };
      if (analysisMode === "topology") {
        body.sceneId = sceneId;
        body.matchRadius = matchRadius;
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

  const saveAsLayerMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      const dateStr = `${now.getDate().toString().padStart(2, "0")}.${(now.getMonth() + 1).toString().padStart(2, "0")}.${now.getFullYear()}`;
      const modeSuffix = analysisMode === "topology" ? "топология" : "кластеры";
      const defaultName = `Анализ жалоб (${modeSuffix}) ${dateStr}`;

      const body: Record<string, unknown> = {
        mode: analysisMode,
        sceneId: sceneId || null,
        layerName: defaultName,
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
          complaintLayerId: Number(selectedLayerId),
          sceneId,
          dateFieldName,
          addressFieldName,
          matchRadius,
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
      className="fixed z-50 bg-background border rounded-md shadow-lg"
      style={{
        left: position.x,
        top: position.y,
        width: 420,
        maxHeight: "calc(100vh - 100px)",
      }}
      data-testid="complaint-analysis-dialog"
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
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

      <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
        <div className="p-3 space-y-3">
          {!hasAnyResult && (
            <>
              <div className="flex gap-1" data-testid="mode-selector-complaints">
                <Button
                  size="sm"
                  variant={analysisMode === "topology" ? "default" : "outline"}
                  className="flex-1 text-xs toggle-elevate"
                  onClick={() => setAnalysisMode("topology")}
                  data-testid="button-mode-topology"
                >
                  <GitBranch className="h-3 w-3 mr-1" />
                  С топологией
                </Button>
                <Button
                  size="sm"
                  variant={analysisMode === "no_topology" ? "default" : "outline"}
                  className="flex-1 text-xs toggle-elevate"
                  onClick={() => setAnalysisMode("no_topology")}
                  data-testid="button-mode-no-topology"
                >
                  <Unlink className="h-3 w-3 mr-1" />
                  Без топологии
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {analysisMode === "topology"
                  ? "Привязка жалоб к потребителям, группировка по дате/источнику, поиск зон аварий через топологию сети"
                  : "Пространственная кластеризация жалоб: одна дата + радиус 350м. Предпросмотр полигонов кластеров на карте"}
              </p>

              <div className="space-y-2">
                <Label className="text-xs">Слой жалоб (точечный)</Label>
                <Select value={selectedLayerId} onValueChange={setSelectedLayerId}>
                  <SelectTrigger data-testid="select-complaint-layer">
                    <SelectValue placeholder="Выберите слой" />
                  </SelectTrigger>
                  <SelectContent>
                    {pointLayers.map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Поле даты</Label>
                {layerAttributes.data && layerAttributes.data.length > 0 ? (
                  <Select value={dateFieldName} onValueChange={setDateFieldName}>
                    <SelectTrigger data-testid="select-date-field">
                      <SelectValue placeholder="Выберите поле" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">Не указывать (все как одна группа)</SelectItem>
                      {layerAttributes.data.map((attr: string) => (
                        <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Имя поля (напр. Date)"
                    value={dateFieldName}
                    onChange={e => setDateFieldName(e.target.value)}
                    data-testid="input-date-field"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Поле адреса (необязательно)</Label>
                {layerAttributes.data && layerAttributes.data.length > 0 ? (
                  <Select value={addressFieldName} onValueChange={setAddressFieldName}>
                    <SelectTrigger data-testid="select-address-field">
                      <SelectValue placeholder="Выберите поле" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">Не указывать</SelectItem>
                      {layerAttributes.data.map((attr: string) => (
                        <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Имя поля (напр. Adres)"
                    value={addressFieldName}
                    onChange={e => setAddressFieldName(e.target.value)}
                    data-testid="input-address-field"
                  />
                )}
              </div>

              {analysisMode === "topology" && (
                <div className="space-y-2">
                  <Label className="text-xs">Радиус привязки (м)</Label>
                  <Input
                    type="number"
                    value={matchRadius}
                    onChange={e => setMatchRadius(Number(e.target.value) || 100)}
                    min={10}
                    max={500}
                    data-testid="input-match-radius"
                  />
                </div>
              )}

              {analysisMode === "no_topology" && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  Радиус кластеризации: 350м (фиксированный)
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={() => analysisMutation.mutate()}
                disabled={!selectedLayerId || analysisMutation.isPending}
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

              {result.emptyNistCount > 0 && (
                <div className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {result.emptyNistCount} потребител{result.emptyNistCount === 1 ? "ь" : result.emptyNistCount < 5 ? "я" : "ей"} без привязки к источнику (Nist) — не группируются
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Найдено {result.dateGroups.length} групп (дата + источник)
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
                          {group.nist ? (
                            <Badge variant="outline" className="shrink-0">Nist {group.nist}</Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-600">Nist нет</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {group.failureZones.length > 0 && (
                            <Badge variant="destructive" className="shrink-0">{group.failureZones.length} зон</Badge>
                          )}
                          <Badge variant="secondary">{group.complaintCount}</Badge>
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

                        {group.failureZones.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-orange-500" />
                              Вероятные зоны аварий ({group.failureZones.length})
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
                                  <div className="text-xs space-y-0.5">
                                    {zone.incomingSegment && (
                                      <div>
                                        <span className="text-muted-foreground">Участок: </span>
                                        {zone.incomingSegment.from} &rarr; {zone.incomingSegment.to}
                                        {zone.incomingSegment.length > 0 && ` (${zone.incomingSegment.length}м)`}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="flex items-center gap-1">
                                        {confidenceLabel(zone.confidence)}
                                      </span>
                                      <span className="text-muted-foreground">
                                        Жалоб: {zone.complaintCount}
                                      </span>
                                      <span className="text-muted-foreground">
                                        Потребителей ниже: {zone.downstreamConsumerCount}
                                      </span>
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
                Найдено {noTopoResult.clusters.length} кластер{noTopoResult.clusters.length === 1 ? "" : noTopoResult.clusters.length < 5 ? "а" : "ов"} (дата + радиус 350м)
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
                          <div className="text-xs font-medium flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            Жалобы в кластере ({cluster.complaintCount})
                          </div>
                          {cluster.complaints.map((c, ci) => (
                            <div key={ci} className="text-xs pl-4 border-l-2 border-muted py-0.5">
                              <div className="text-muted-foreground">{c.address || "Без адреса"}</div>
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
