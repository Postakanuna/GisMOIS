import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  Zap,
  Download,
  GripHorizontal,
  Loader2,
  X,
  Filter,
  AlertOctagon,
  MapPin,
  Ruler,
} from "lucide-react";

interface EditableLayer {
  id: number;
  name: string;
  geometryType: string;
  visible?: boolean;
}

interface AccidentSegmentResult {
  featureId: number;
  geometry: { type: string; coordinates: any };
  properties: Record<string, unknown>;
  dpod: string | number | null;
  dobr: string | number | null;
  length: string | number | null;
  sys: string | null;
  beginUch: string | null;
  endUch: string | null;
  accidentCount: number;
  accidentFeatures: Array<{
    id: number;
    geometry: { type: string; coordinates: any };
    properties: Record<string, unknown>;
  }>;
}

interface AccidentAnalysisResult {
  networkLayerName: string;
  accidentLayerName: string;
  totalAccidents: number;
  boundAccidents: number;
  unboundAccidents: number;
  segmentsWithAccidents: number;
  segments: AccidentSegmentResult[];
}

interface AttributeFilter {
  field: string;
  value: string;
}

interface AccidentAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editableLayers: EditableLayer[];
  sceneId: number;
  onHighlightSegment: (segment: AccidentSegmentResult | null) => void;
}

export function AccidentAnalysisDialog({
  open,
  onOpenChange,
  editableLayers,
  onHighlightSegment,
}: AccidentAnalysisDialogProps) {
  const { toast } = useToast();

  const [networkLayerId, setNetworkLayerId] = useState<number | null>(null);
  const [accidentLayerId, setAccidentLayerId] = useState<number | null>(null);
  const [maxDistance, setMaxDistance] = useState<number>(50);
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>({ field: "", value: "" });
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [networkAttributes, setNetworkAttributes] = useState<string[]>([]);
  const [result, setResult] = useState<AccidentAnalysisResult | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);

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
    if (!networkLayerId) {
      setNetworkAttributes([]);
      setFilterEnabled(false);
      setAttributeFilter({ field: "", value: "" });
      return;
    }
    fetch(`/api/editable-layers/${networkLayerId}/attributes`)
      .then(r => r.ok ? r.json() : [])
      .then((attrs: string[]) => setNetworkAttributes(attrs))
      .catch(() => setNetworkAttributes([]));
  }, [networkLayerId]);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setSelectedSegmentId(null);
      onHighlightSegment(null);
    }
  }, [open]);

  const lineLayerTypes = ["LineString", "MultiLineString", "line", "polyline"];
  const pointLayerTypes = ["Point", "MultiPoint", "point"];

  const networkLayers = editableLayers.filter(l =>
    lineLayerTypes.some(t => l.geometryType?.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase() === l.geometryType?.toLowerCase())
  );
  const accidentLayers = editableLayers.filter(l =>
    pointLayerTypes.some(t => l.geometryType?.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase() === l.geometryType?.toLowerCase())
  );

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        networkLayerId,
        accidentLayerId,
        maxDistanceMeters: maxDistance,
      };
      if (filterEnabled && attributeFilter.field && attributeFilter.value) {
        body.attributeFilter = attributeFilter;
      }
      const res = await apiRequest("POST", "/api/analytics/accident-analysis", body);
      return res.json();
    },
    onSuccess: (data: AccidentAnalysisResult) => {
      setResult(data);
      setSelectedSegmentId(null);
      onHighlightSegment(null);
      if (data.segments.length === 0) {
        toast({ title: "Аварии не привязаны", description: "Ни одна авария не попала в зону привязки к сетям.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Ошибка анализа", description: err.message || "Не удалось выполнить анализ", variant: "destructive" });
    },
  });

  const handleSegmentClick = (segment: AccidentSegmentResult) => {
    setSelectedSegmentId(segment.featureId);
    onHighlightSegment(segment);
  };

  const handleExportExcel = async () => {
    if (!result) return;
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Анализ аварийности");
      ws.columns = [
        { header: "№", key: "rank", width: 6 },
        { header: "Sys", key: "sys", width: 14 },
        { header: "Участок (от)", key: "begin", width: 20 },
        { header: "Участок (до)", key: "end", width: 20 },
        { header: "L (м)", key: "l", width: 12 },
        { header: "Dpod", key: "dpod", width: 12 },
        { header: "Dobr", key: "dobr", width: 12 },
        { header: "Кол-во аварий", key: "count", width: 15 },
      ];
      ws.getRow(1).font = { bold: true };
      result.segments.forEach((seg, idx) => {
        ws.addRow({
          rank: idx + 1,
          sys: seg.sys ?? "",
          begin: seg.beginUch ?? "",
          end: seg.endUch ?? "",
          l: seg.length ?? "",
          dpod: seg.dpod ?? "",
          dobr: seg.dobr ?? "",
          count: seg.accidentCount,
        });
      });
      const metaWs = workbook.addWorksheet("Метаданные");
      metaWs.columns = [{ header: "Параметр", key: "p", width: 30 }, { header: "Значение", key: "v", width: 40 }];
      metaWs.getRow(1).font = { bold: true };
      metaWs.addRow({ p: "Дата анализа", v: new Date().toLocaleString("ru-RU") });
      metaWs.addRow({ p: "Слой сетей", v: result.networkLayerName });
      metaWs.addRow({ p: "Слой аварий", v: result.accidentLayerName });
      metaWs.addRow({ p: "Порог расстояния (м)", v: maxDistance });
      metaWs.addRow({ p: "Всего аварий", v: result.totalAccidents });
      metaWs.addRow({ p: "Привязано", v: result.boundAccidents });
      metaWs.addRow({ p: "Не привязано", v: result.unboundAccidents });
      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `accident_analysis_${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Ошибка экспорта", description: "Не удалось создать файл Excel", variant: "destructive" });
    }
  };

  const canRun = networkLayerId !== null && accidentLayerId !== null;

  if (!open) return null;

  const formatVal = (val: string | number | null) => {
    if (val === null || val === undefined || val === "") return "—";
    return String(val);
  };

  return (
    <div
      className="fixed z-50 w-[420px] bg-background border border-border rounded-lg shadow-2xl flex flex-col"
      style={{ left: position.x, top: position.y, maxHeight: "calc(100vh - 100px)" }}
      data-testid="accident-analysis-dialog"
    >
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40 rounded-t-lg cursor-grab select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
          <Zap className="h-4 w-4 text-orange-500" />
          <span className="font-semibold text-sm">Анализ аварийности</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onOpenChange(false)} data-testid="button-close-accident-dialog">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Слой сетей (линии)</Label>
            <Select
              value={networkLayerId !== null ? String(networkLayerId) : ""}
              onValueChange={v => { setNetworkLayerId(Number(v)); setResult(null); setSelectedSegmentId(null); onHighlightSegment(null); }}
            >
              <SelectTrigger data-testid="select-network-layer" className="h-8 text-xs">
                <SelectValue placeholder="Выберите слой сетей..." />
              </SelectTrigger>
              <SelectContent>
                {networkLayers.length === 0 && (
                  <SelectItem value="__none__" disabled>Нет подходящих слоёв</SelectItem>
                )}
                {networkLayers.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {networkLayerId !== null && (
            <div className="space-y-1.5 border border-border rounded-md p-2.5 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Фильтр объектов сети</span>
                </div>
                <Button
                  variant={filterEnabled ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => {
                    setFilterEnabled(prev => !prev);
                    if (filterEnabled) setAttributeFilter({ field: "", value: "" });
                  }}
                  data-testid="button-toggle-filter"
                >
                  {filterEnabled ? "Убрать фильтр" : "Добавить фильтр"}
                </Button>
              </div>
              {filterEnabled && (
                <div className="flex gap-2 mt-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Столбец</Label>
                    <Select
                      value={attributeFilter.field}
                      onValueChange={v => setAttributeFilter(prev => ({ ...prev, field: v }))}
                    >
                      <SelectTrigger className="h-7 text-xs" data-testid="select-filter-field">
                        <SelectValue placeholder="Атрибут..." />
                      </SelectTrigger>
                      <SelectContent>
                        {networkAttributes.map(attr => (
                          <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs">Значение</Label>
                    <Input
                      className="h-7 text-xs"
                      placeholder="например: 1"
                      value={attributeFilter.value}
                      onChange={e => setAttributeFilter(prev => ({ ...prev, value: e.target.value }))}
                      data-testid="input-filter-value"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Слой аварий (точки)</Label>
            <Select
              value={accidentLayerId !== null ? String(accidentLayerId) : ""}
              onValueChange={v => { setAccidentLayerId(Number(v)); setResult(null); setSelectedSegmentId(null); onHighlightSegment(null); }}
            >
              <SelectTrigger data-testid="select-accident-layer" className="h-8 text-xs">
                <SelectValue placeholder="Выберите слой аварий..." />
              </SelectTrigger>
              <SelectContent>
                {accidentLayers.length === 0 && (
                  <SelectItem value="__none__" disabled>Нет подходящих слоёв</SelectItem>
                )}
                {accidentLayers.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Макс. расстояние привязки (м)</Label>
            <Input
              type="number"
              min={1}
              max={5000}
              value={maxDistance}
              onChange={e => setMaxDistance(Number(e.target.value))}
              className="h-8 text-xs"
              data-testid="input-max-distance"
            />
          </div>
        </div>

        <Button
          className="w-full h-8 text-xs"
          disabled={!canRun || analysisMutation.isPending}
          onClick={() => analysisMutation.mutate()}
          data-testid="button-run-accident-analysis"
        >
          {analysisMutation.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Анализ...</>
          ) : (
            <><Zap className="h-3.5 w-3.5 mr-2" />Запустить анализ</>
          )}
        </Button>

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-muted/40 rounded-md border border-border">
                <div className="text-lg font-bold">{result.totalAccidents}</div>
                <div className="text-xs text-muted-foreground">Всего аварий</div>
              </div>
              <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800">
                <div className="text-lg font-bold text-green-600 dark:text-green-400">{result.boundAccidents}</div>
                <div className="text-xs text-muted-foreground">Привязано</div>
              </div>
              <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded-md border border-red-200 dark:border-red-800">
                <div className="text-lg font-bold text-red-600 dark:text-red-400">{result.unboundAccidents}</div>
                <div className="text-xs text-muted-foreground">Не привязано</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Участков с авариями: {result.segmentsWithAccidents}
              </span>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={handleExportExcel} data-testid="button-export-excel">
                <Download className="h-3 w-3" />
                Excel
              </Button>
            </div>

            {result.segments.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-xs">
                <AlertOctagon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Нет участков с привязанными авариями
              </div>
            ) : (
              <div className="space-y-2">
                {result.segments.map((seg, idx) => (
                  <Card
                    key={seg.featureId}
                    className={`p-3 cursor-pointer transition-all hover:shadow-md border ${
                      selectedSegmentId === seg.featureId
                        ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                    onClick={() => handleSegmentClick(seg)}
                    data-testid={`card-segment-${seg.featureId}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? "bg-red-500 text-white" :
                        idx === 1 ? "bg-orange-400 text-white" :
                        idx === 2 ? "bg-yellow-400 text-white" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium truncate">
                            {seg.sys ? `${seg.sys} ` : ""}
                            {seg.beginUch && seg.endUch
                              ? `${seg.beginUch} — ${seg.endUch}`
                              : seg.beginUch || seg.endUch || `Участок #${seg.featureId}`}
                          </div>
                          <Badge variant="destructive" className="text-xs flex-shrink-0" data-testid={`badge-count-${seg.featureId}`}>
                            {seg.accidentCount} ав.
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          {(seg.dpod !== null && seg.dpod !== "") && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-dpod-${seg.featureId}`}>
                              <span className="font-medium">Dpod:</span>
                              <span>{formatVal(seg.dpod)}</span>
                            </div>
                          )}
                          {(seg.dobr !== null && seg.dobr !== "") && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-dobr-${seg.featureId}`}>
                              <span className="font-medium">Dobr:</span>
                              <span>{formatVal(seg.dobr)}</span>
                            </div>
                          )}
                          {(seg.length !== null && seg.length !== "") && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-length-${seg.featureId}`}>
                              <Ruler className="h-3 w-3" />
                              <span>{formatVal(seg.length)} м</span>
                            </div>
                          )}
                        </div>
                        {selectedSegmentId === seg.featureId && (
                          <div className="mt-1.5 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <MapPin className="h-3 w-3" />
                            <span>Показан на карте</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export type { AccidentSegmentResult, AccidentAnalysisResult };
