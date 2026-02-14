import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";

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

interface ComplaintAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editableLayers: EditableLayer[];
  sceneId: number;
  onAnalysisResult: (result: ComplaintAnalysisResult | null) => void;
  onHighlightZone: (zone: FailureZone | null) => void;
}

export function ComplaintAnalysisDialog({
  open,
  onOpenChange,
  editableLayers,
  sceneId,
  onAnalysisResult,
  onHighlightZone,
}: ComplaintAnalysisDialogProps) {
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [dateFieldName, setDateFieldName] = useState<string>("");
  const [addressFieldName, setAddressFieldName] = useState<string>("");
  const [matchRadius, setMatchRadius] = useState<number>(100);
  const [result, setResult] = useState<ComplaintAnalysisResult | null>(null);
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
      const res = await apiRequest("POST", "/api/complaint-analysis", {
        complaintLayerId: Number(selectedLayerId),
        sceneId,
        dateFieldName,
        addressFieldName,
        matchRadius,
      });
      return res.json() as Promise<ComplaintAnalysisResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      onAnalysisResult(data);
    },
  });

  const [exporting, setExporting] = useState(false);

  const handleClose = () => {
    setResult(null);
    setHighlightedZoneKey(null);
    analysisMutation.reset();
    onAnalysisResult(null);
    onHighlightZone(null);
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
    if (highlightedZoneKey === key) {
      setHighlightedZoneKey(null);
      onHighlightZone(null);
    } else {
      setHighlightedZoneKey(key);
      onHighlightZone(zone);
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

      <ScrollArea className="max-h-[calc(100vh-200px)]">
        <div className="p-3 space-y-3">
          {!result && (
            <>
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
                          <Badge variant="outline" className="shrink-0">Nist {group.nist}</Badge>
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
                            <div className="font-medium">{c.name}</div>
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
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setResult(null);
                  setHighlightedZoneKey(null);
                  analysisMutation.reset();
                  onAnalysisResult(null);
                  onHighlightZone(null);
                }}
                data-testid="button-reset-analysis"
              >
                Новый анализ
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export type { ComplaintAnalysisResult };
