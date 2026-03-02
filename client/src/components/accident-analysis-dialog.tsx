import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
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
  Layers,
  Users,
  Home,
  AlertTriangle,
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
  consumerCount: number | null;
  residentCount: number | null;
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
  initialResult?: AccidentAnalysisResult | null;
}

export function AccidentAnalysisDialog({
  open,
  onOpenChange,
  editableLayers,
  sceneId,
  onHighlightSegment,
  initialResult,
}: AccidentAnalysisDialogProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [networkLayerId, setNetworkLayerId] = useState<number | null>(null);
  const [accidentLayerId, setAccidentLayerId] = useState<number | null>(null);
  const [maxDistance, setMaxDistance] = useState<number>(15);
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>({ field: "", value: "" });
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [networkAttributes, setNetworkAttributes] = useState<string[]>([]);
  const [runSimulation, setRunSimulation] = useState(false);
  const [consumerLayerId, setConsumerLayerId] = useState<number | null>(null);
  const [residentField, setResidentField] = useState<string | null>(null);
  const [consumerAttributes, setConsumerAttributes] = useState<string[]>([]);
  const [result, setResult] = useState<AccidentAnalysisResult | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
  const [saveLayerId, setSaveLayerId] = useState<number | null>(null);
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
    if (initialResult && open) {
      setResult(initialResult);
    }
  }, [initialResult, open]);

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
    if (!consumerLayerId) {
      setConsumerAttributes([]);
      setResidentField(null);
      return;
    }
    fetch(`/api/editable-layers/${consumerLayerId}/attributes`)
      .then(r => r.ok ? r.json() : [])
      .then((attrs: string[]) => setConsumerAttributes(attrs))
      .catch(() => setConsumerAttributes([]));
  }, [consumerLayerId]);

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
        sceneId,
        runSimulation,
      };
      if (filterEnabled && attributeFilter.field && attributeFilter.value) {
        body.attributeFilter = attributeFilter;
      }
      if (runSimulation && consumerLayerId) {
        body.consumerLayerId = consumerLayerId;
        if (residentField) body.residentField = residentField;
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
      const hasConsumers = result.segments.some(s => s.consumerCount !== null);
      ws.columns = [
        { header: "№", key: "rank", width: 6 },
        { header: "Sys", key: "sys", width: 14 },
        { header: "Участок (от)", key: "begin", width: 20 },
        { header: "Участок (до)", key: "end", width: 20 },
        { header: "L (м)", key: "l", width: 12 },
        { header: "Dpod", key: "dpod", width: 12 },
        { header: "Dobr", key: "dobr", width: 12 },
        { header: "Кол-во аварий", key: "count", width: 15 },
        ...(hasConsumers ? [
          { header: "Потребители (откл.)", key: "consumers", width: 20 },
          { header: "Жители (откл.)", key: "residents", width: 18 },
        ] : []),
      ];
      ws.getRow(1).font = { bold: true };
      result.segments.forEach((seg, idx) => {
        const row: Record<string, unknown> = {
          rank: idx + 1,
          sys: seg.sys ?? "",
          begin: seg.beginUch ?? "",
          end: seg.endUch ?? "",
          l: seg.length ?? "",
          dpod: seg.dpod ?? "",
          dobr: seg.dobr ?? "",
          count: seg.accidentCount,
        };
        if (hasConsumers) {
          row.consumers = seg.consumerCount ?? 0;
          row.residents = seg.residentCount ?? 0;
        }
        ws.addRow(row);
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

  const handleSaveToLayer = async () => {
    if (!result || !saveLayerId) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/analytics/accident-analysis/save-buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          segments: result.segments,
          targetLayerId: saveLayerId,
          bufferMeters: 5,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Ошибка ${res.status}`);
      toast({ title: "Сохранено", description: `${data.saved} полигонов сохранено в слой${data.errors > 0 ? ` (ошибок: ${data.errors})` : ""}` });
      setShowSavePopover(false);
      window.dispatchEvent(new Event("viewport-features-invalidate"));
    } catch (e: any) {
      toast({ title: "Ошибка сохранения", description: e.message || "Не удалось сохранить в слой", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const polygonLayers = editableLayers.filter(l =>
    l.geometryType?.toLowerCase().includes("polygon")
  );
  const saveTargetLayers = polygonLayers.length > 0 ? polygonLayers : editableLayers;

  const canRun = networkLayerId !== null && accidentLayerId !== null;

  if (!open) return null;

  const formatVal = (val: string | number | null) => {
    if (val === null || val === undefined || val === "") return "—";
    return String(val);
  };

  return (
    <div
      className={isMobile
        ? "fixed inset-0 z-[9999] bg-background flex flex-col"
        : "fixed z-50 w-[420px] bg-background border border-border rounded-lg shadow-2xl flex flex-col"}
      style={isMobile ? undefined : { left: position.x, top: position.y, maxHeight: "calc(100vh - 100px)" }}
      data-testid="accident-analysis-dialog"
    >
      <div
        className={isMobile
          ? "flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 shrink-0"
          : "flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40 rounded-t-lg cursor-grab select-none"}
        onMouseDown={isMobile ? undefined : handleMouseDown}
      >
        <div className="flex items-center gap-2">
          {!isMobile && <GripHorizontal className="h-4 w-4 text-muted-foreground" />}
          <Zap className="h-4 w-4 text-orange-500" />
          <span className="font-semibold text-sm">Анализ аварийности</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} data-testid="button-close-accident-dialog">
          <X className="h-4 w-4" />
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

          <div className="space-y-2 border border-border rounded-md p-2.5 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Анализ отключаемых потребителей</span>
              </div>
              <Switch
                checked={runSimulation}
                onCheckedChange={(v) => {
                  setRunSimulation(v);
                  if (!v) { setConsumerLayerId(null); setResidentField(null); }
                }}
                data-testid="switch-run-simulation"
              />
            </div>
            {runSimulation && (
              <div className="space-y-2 mt-1">
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span className="text-xs">Ресурсоёмкая операция — симуляция на каждый участок</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Слой потребителей</Label>
                  <Select
                    value={consumerLayerId !== null ? String(consumerLayerId) : ""}
                    onValueChange={v => { setConsumerLayerId(Number(v)); setResidentField(null); }}
                  >
                    <SelectTrigger className="h-7 text-xs" data-testid="select-consumer-layer">
                      <SelectValue placeholder="Выберите слой..." />
                    </SelectTrigger>
                    <SelectContent>
                      {editableLayers.length === 0 && (
                        <SelectItem value="__none__" disabled>Нет слоёв</SelectItem>
                      )}
                      {editableLayers.map(l => (
                        <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {consumerLayerId !== null && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Поле с количеством жителей</Label>
                    <Select
                      value={residentField ?? ""}
                      onValueChange={v => setResidentField(v || null)}
                    >
                      <SelectTrigger className="h-7 text-xs" data-testid="select-resident-field">
                        <SelectValue placeholder="Выберите поле..." />
                      </SelectTrigger>
                      <SelectContent>
                        {consumerAttributes.length === 0 && (
                          <SelectItem value="__none__" disabled>Нет атрибутов</SelectItem>
                        )}
                        {consumerAttributes.map(attr => (
                          <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
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
            <div className="flex items-center flex-wrap gap-2">
              <Badge variant="outline" data-testid="badge-total">Аварий: {result.totalAccidents}</Badge>
              <Badge variant="secondary" data-testid="badge-bound">Привязано: {result.boundAccidents}</Badge>
              {result.unboundAccidents > 0 && (
                <Badge variant="destructive" data-testid="badge-unbound">Не привязано: {result.unboundAccidents}</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Участков с авариями: {result.segmentsWithAccidents}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={handleExportExcel} data-testid="button-export-excel">
                  <Download className="h-3 w-3" />
                  Excel
                </Button>
                <Popover open={showSavePopover} onOpenChange={setShowSavePopover}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 text-xs gap-1" data-testid="button-save-to-layer">
                      <Layers className="h-3 w-3" />
                      В слой
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="end">
                    <div className="space-y-2">
                      <p className="text-xs font-medium">Сохранить буферизованные полигоны (±5 м)</p>
                      <Select value={saveLayerId ? String(saveLayerId) : ""} onValueChange={v => setSaveLayerId(Number(v))}>
                        <SelectTrigger className="h-7 text-xs" data-testid="select-save-layer">
                          <SelectValue placeholder="Выберите слой..." />
                        </SelectTrigger>
                        <SelectContent>
                          {saveTargetLayers.map(l => (
                            <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs"
                        disabled={!saveLayerId || isSaving}
                        onClick={handleSaveToLayer}
                        data-testid="button-confirm-save-to-layer"
                      >
                        {isSaving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Сохранение...</> : "Сохранить"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {result.segments.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-xs">
                <AlertOctagon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Нет участков с привязанными авариями
              </div>
            ) : (
              <div className="space-y-1.5">
                {result.segments.map((seg, idx) => (
                  <div
                    key={seg.featureId}
                    className={`text-xs border rounded-md p-2 space-y-1 cursor-pointer transition-colors ${
                      selectedSegmentId === seg.featureId
                        ? "bg-primary/10 border-primary/30"
                        : "hover:bg-muted/40"
                    }`}
                    onClick={() => handleSegmentClick(seg)}
                    data-testid={`card-segment-${seg.featureId}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-muted-foreground shrink-0">{idx + 1}.</span>
                        <span className="font-medium truncate">
                          {seg.sys ? `${seg.sys} ` : ""}
                          {seg.beginUch && seg.endUch
                            ? `${seg.beginUch} — ${seg.endUch}`
                            : seg.beginUch || seg.endUch || `Участок #${seg.featureId}`}
                        </span>
                      </div>
                      <Badge variant="destructive" className="shrink-0" data-testid={`badge-count-${seg.featureId}`}>
                        {seg.accidentCount} ав.
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground pl-4">
                      {(seg.dpod !== null && seg.dpod !== "") && (
                        <span data-testid={`text-dpod-${seg.featureId}`}>
                          <span className="font-medium">Dpod:</span> {formatVal(seg.dpod)}
                        </span>
                      )}
                      {(seg.dobr !== null && seg.dobr !== "") && (
                        <span data-testid={`text-dobr-${seg.featureId}`}>
                          <span className="font-medium">Dobr:</span> {formatVal(seg.dobr)}
                        </span>
                      )}
                      {(seg.length !== null && seg.length !== "") && (
                        <span className="flex items-center gap-0.5" data-testid={`text-length-${seg.featureId}`}>
                          <Ruler className="h-3 w-3" />
                          {formatVal(seg.length)} м
                        </span>
                      )}
                    </div>
                    {seg.consumerCount !== null && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-4 text-xs">
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium" data-testid={`text-consumers-${seg.featureId}`}>
                          <Users className="h-3 w-3" />
                          {seg.consumerCount} потреб.
                        </span>
                        {seg.residentCount !== null && seg.residentCount > 0 && (
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium" data-testid={`text-residents-${seg.featureId}`}>
                            <Home className="h-3 w-3" />
                            {seg.residentCount} жит.
                          </span>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant={selectedSegmentId === seg.featureId ? "default" : "outline"}
                      className="w-full h-6 gap-1 mt-0.5"
                      onClick={e => { e.stopPropagation(); handleSegmentClick(seg); }}
                      data-testid={`button-show-segment-${seg.featureId}`}
                    >
                      <MapPin className="h-3 w-3" />
                      Показать на карте
                    </Button>
                  </div>
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
