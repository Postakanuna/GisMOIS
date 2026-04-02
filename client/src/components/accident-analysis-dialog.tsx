import { useState, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type SegmentImportData } from "@/components/reconstruction-program-dialog";
import { DraggableModal } from "@/components/ui/draggable-modal";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Zap,
  Download,
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
  CheckCircle2,
  Network,
  BarChart3,
  XCircle,
  Plus,
  Trash2,
  Wrench,
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

interface AnalysisProgress {
  stage: "binding" | "graph_building" | "graph_ready" | "simulating" | "done";
  boundAccidents?: number;
  unboundAccidents?: number;
  totalAccidents?: number;
  segmentsWithAccidents?: number;
  graphNodes?: number;
  graphEdges?: number;
  simulationCurrent?: number;
  simulationTotal?: number;
  consumerLayerCount?: number;
  partialSegments: AccidentSegmentResult[];
}

interface AccidentAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editableLayers: EditableLayer[];
  sceneId: number;
  onHighlightSegment: (segment: AccidentSegmentResult | null) => void;
  initialResult?: AccidentAnalysisResult | null;
  onOpenReconstructionProgram?: (segments: SegmentImportData[]) => void;
  onSavedToLayer?: (layerId: number, layerName: string) => void;
}

export function AccidentAnalysisDialog({
  open,
  onOpenChange,
  editableLayers,
  sceneId,
  onHighlightSegment,
  initialResult,
  onOpenReconstructionProgram,
  onSavedToLayer,
}: AccidentAnalysisDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [networkLayerId, setNetworkLayerId] = useState<number | null>(null);
  const [accidentLayerId, setAccidentLayerId] = useState<number | null>(null);
  const [maxDistance, setMaxDistance] = useState<number>(15);
  const [networkFilterEnabled, setNetworkFilterEnabled] = useState(false);
  const [networkFilters, setNetworkFilters] = useState<AttributeFilter[]>([{ field: "", value: "" }]);
  const [networkAttributes, setNetworkAttributes] = useState<string[]>([]);
  const [accidentFilterEnabled, setAccidentFilterEnabled] = useState(false);
  const [accidentFilters, setAccidentFilters] = useState<AttributeFilter[]>([{ field: "", value: "" }]);
  const [accidentAttributes, setAccidentAttributes] = useState<string[]>([]);
  const [runSimulation, setRunSimulation] = useState(false);
  const [consumerLayerId, setConsumerLayerId] = useState<number | null>(null);
  const [residentField, setResidentField] = useState<string | null>(null);
  const [consumerAttributes, setConsumerAttributes] = useState<string[]>([]);

  const [result, setResult] = useState<AccidentAnalysisResult | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);

  const resultAsImportData = useMemo<SegmentImportData[]>(() => {
    if (!result?.segments) return [];
    return result.segments.map(s => ({
      featureId: s.featureId,
      objectName: s.beginUch && s.endUch
        ? `${s.beginUch} — ${s.endUch}`
        : s.sys
          ? `${s.sys} #${s.featureId}`
          : `Участок #${s.featureId}`,
      diameterMm: s.dpod != null ? (Math.round(parseFloat(String(s.dpod)) * 1000) || null) : null,
      lengthM: s.length != null ? String(s.length) : null,
      accidentCount: s.accidentCount,
      residentCount: s.residentCount,
      consumerCount: s.consumerCount,
      layingType: "underground",
      workType: "overhaul",
    }));
  }, [result]);
  const [saveLayerId, setSaveLayerId] = useState<number | null>(null);
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingLayer, setIsCreatingLayer] = useState(false);
  const [extraLayers, setExtraLayers] = useState<EditableLayer[]>([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);


  useEffect(() => {
    if (initialResult && open) setResult(initialResult);
  }, [initialResult, open]);

  useEffect(() => {
    if (!networkLayerId) {
      setNetworkAttributes([]);
      setNetworkFilterEnabled(false);
      setNetworkFilters([{ field: "", value: "" }]);
      return;
    }
    fetch(`/api/editable-layers/${networkLayerId}/attributes`)
      .then(r => r.ok ? r.json() : [])
      .then((attrs: string[]) => setNetworkAttributes(attrs))
      .catch(() => setNetworkAttributes([]));
  }, [networkLayerId]);

  useEffect(() => {
    if (!accidentLayerId) {
      setAccidentAttributes([]);
      setAccidentFilterEnabled(false);
      setAccidentFilters([{ field: "", value: "" }]);
      return;
    }
    fetch(`/api/editable-layers/${accidentLayerId}/attributes`)
      .then(r => r.ok ? r.json() : [])
      .then((attrs: string[]) => setAccidentAttributes(attrs))
      .catch(() => setAccidentAttributes([]));
  }, [accidentLayerId]);

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
      setNetworkFilterEnabled(false);
      setNetworkFilters([{ field: "", value: "" }]);
      setAccidentFilterEnabled(false);
      setAccidentFilters([{ field: "", value: "" }]);
      if (isAnalyzing) {
        abortControllerRef.current?.abort();
        setIsAnalyzing(false);
        setProgress(null);
      }
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

  const runAnalysis = async () => {
    if (!networkLayerId || !accidentLayerId) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);
    setResult(null);
    setSelectedSegmentId(null);
    onHighlightSegment(null);
    setProgress({ stage: "binding", partialSegments: [] });

    const body: Record<string, unknown> = {
      networkLayerId,
      accidentLayerId,
      maxDistanceMeters: maxDistance,
      sceneId,
      runSimulation,
    };
    const activeNetworkFilters = networkFilterEnabled
      ? networkFilters.filter(f => f.field && f.value)
      : [];
    if (activeNetworkFilters.length > 0) {
      body.networkFilters = activeNetworkFilters;
    }
    const activeAccidentFilters = accidentFilterEnabled
      ? accidentFilters.filter(f => f.field && f.value)
      : [];
    if (activeAccidentFilters.length > 0) {
      body.accidentFilters = activeAccidentFilters;
    }
    if (runSimulation && consumerLayerId) {
      body.consumerLayerId = consumerLayerId;
      if (residentField) body.residentField = residentField;
    }

    try {
      const response = await fetch("/api/analytics/accident-analysis/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ошибка сервера: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "binding") {
              setProgress(prev => ({
                ...(prev ?? { partialSegments: [] }),
                stage: runSimulation ? "graph_building" : "done",
                boundAccidents: event.boundAccidents,
                unboundAccidents: event.unboundAccidents,
                totalAccidents: event.totalAccidents,
                segmentsWithAccidents: event.segmentsWithAccidents,
              }));
            } else if (event.type === "graph_building") {
              setProgress(prev => ({
                ...(prev ?? { partialSegments: [] }),
                stage: "graph_building",
              }));
            } else if (event.type === "graph_ready") {
              setProgress(prev => ({
                ...(prev ?? { partialSegments: [] }),
                stage: "simulating",
                graphNodes: event.nodeCount,
                graphEdges: event.edgeCount,
                simulationCurrent: 0,
                simulationTotal: prev?.segmentsWithAccidents ?? 0,
              }));
            } else if (event.type === "consumers_loaded") {
              setProgress(prev => ({
                ...(prev ?? { partialSegments: [] }),
                consumerLayerCount: event.consumerCount,
              }));
            } else if (event.type === "simulation_progress") {
              setProgress(prev => ({
                ...(prev ?? { partialSegments: [] }),
                stage: "simulating",
                simulationCurrent: event.current,
                simulationTotal: event.total,
                partialSegments: [...(prev?.partialSegments ?? []), event.segment],
              }));
            } else if (event.type === "complete") {
              setResult(event as AccidentAnalysisResult);
              setProgress(null);
              setIsAnalyzing(false);
              if ((event.segments as AccidentSegmentResult[]).length === 0) {
                toast({ title: "Аварии не привязаны", description: "Ни одна авария не попала в зону привязки к сетям.", variant: "destructive" });
              }
            } else if (event.type === "error") {
              toast({ title: "Ошибка анализа", description: event.message || "Не удалось выполнить анализ", variant: "destructive" });
              setIsAnalyzing(false);
              setProgress(null);
            }
          } catch { /* malformed line */ }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({ title: "Ошибка анализа", description: err.message || "Не удалось выполнить анализ", variant: "destructive" });
      }
      setIsAnalyzing(false);
      setProgress(null);
    }
  };

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort();
    setIsAnalyzing(false);
    setProgress(null);
  };

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
    } catch {
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
        body: JSON.stringify({ segments: result.segments, targetLayerId: saveLayerId, bufferMeters: maxDistance }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Ошибка ${res.status}`);
      toast({ title: "Сохранено", description: `${data.saved} полигонов сохранено в слой${data.errors > 0 ? ` (ошибок: ${data.errors})` : ""}` });
      setShowSavePopover(false);
      window.dispatchEvent(new Event("viewport-features-invalidate"));
      // Invalidate schema and features cache for the target layer so attribute table shows fresh data
      if (saveLayerId) {
        queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", saveLayerId, "schema"] });
        queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", saveLayerId, "features"] });
      }
      if (onSavedToLayer && data.layerId && data.layerName) {
        onSavedToLayer(data.layerId, data.layerName);
      }
    } catch (e: any) {
      toast({ title: "Ошибка сохранения", description: e.message || "Не удалось сохранить в слой", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNewLayer = async () => {
    setIsCreatingLayer(true);
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const layerName = `Результаты анализа аварийности (${dateStr})`;
      const res = await fetch("/api/editable-layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: layerName, geometryType: "Polygon", sceneId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Ошибка ${res.status}`);
      const newLayer: EditableLayer = { id: data.id, name: data.name, geometryType: data.geometryType };
      setExtraLayers(prev => [...prev, newLayer]);
      setSaveLayerId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", sceneId, "editable-layers"] });
      toast({ title: "Слой создан", description: layerName });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message || "Не удалось создать слой", variant: "destructive" });
    } finally {
      setIsCreatingLayer(false);
    }
  };

  const dedup = (layers: EditableLayer[]) => {
    const seen = new Set<number>();
    return layers.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
  };
  const polygonLayers = dedup([
    ...editableLayers.filter(l => l.geometryType?.toLowerCase().includes("polygon")),
    ...extraLayers,
  ]);
  const saveTargetLayers = polygonLayers.length > 0 ? polygonLayers : dedup([...editableLayers, ...extraLayers]);
  const canRun = networkLayerId !== null && accidentLayerId !== null;

  if (!open) return null;

  const formatVal = (val: string | number | null) => {
    if (val === null || val === undefined || val === "") return "—";
    return String(val);
  };

  const displaySegments = result?.segments ?? (progress?.partialSegments ?? []);

  return (
    <DraggableModal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Анализ аварийности"
      defaultWidth={420}
      autoHeight
      resizable={false}
      headerIcon={<Zap className="h-4 w-4 text-orange-500" />}
    >
      <div className="overflow-y-auto p-4 space-y-4" style={{ maxHeight: "calc(100vh - 160px)" }}>
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
                {networkLayers.length === 0 && <SelectItem value="__none__" disabled>Нет подходящих слоёв</SelectItem>}
                {networkLayers.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
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
                  variant={networkFilterEnabled ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => { setNetworkFilterEnabled(prev => !prev); if (networkFilterEnabled) setNetworkFilters([{ field: "", value: "" }]); }}
                  data-testid="button-toggle-network-filter"
                >
                  {networkFilterEnabled ? "Убрать фильтр" : "Добавить фильтр"}
                </Button>
              </div>
              {networkFilterEnabled && (
                <div className="space-y-1.5 mt-1">
                  {networkFilters.map((f, idx) => (
                    <div key={idx} className="flex gap-1.5 items-end">
                      <div className="flex-1 space-y-1">
                        {idx === 0 && <Label className="text-xs">Столбец</Label>}
                        <Select value={f.field} onValueChange={v => setNetworkFilters(prev => prev.map((r, i) => i === idx ? { ...r, field: v } : r))}>
                          <SelectTrigger className="h-7 text-xs" data-testid={`select-network-filter-field-${idx}`}>
                            <SelectValue placeholder="Атрибут..." />
                          </SelectTrigger>
                          <SelectContent>
                            {networkAttributes.map(attr => <SelectItem key={attr} value={attr}>{attr}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-28 space-y-1">
                        {idx === 0 && <Label className="text-xs">Значение</Label>}
                        <Input
                          className="h-7 text-xs"
                          placeholder="значение"
                          value={f.value}
                          onChange={e => setNetworkFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                          data-testid={`input-network-filter-value-${idx}`}
                        />
                      </div>
                      {networkFilters.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setNetworkFilters(prev => prev.filter((_, i) => i !== idx))}
                          data-testid={`button-remove-network-filter-${idx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1 w-full mt-1"
                    onClick={() => setNetworkFilters(prev => [...prev, { field: "", value: "" }])}
                    data-testid="button-add-network-filter"
                  >
                    <Plus className="h-3 w-3" />
                    Добавить условие
                  </Button>
                  {networkFilters.length > 1 && (
                    <p className="text-xs text-muted-foreground">Условия применяются вместе (AND)</p>
                  )}
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
                {accidentLayers.length === 0 && <SelectItem value="__none__" disabled>Нет подходящих слоёв</SelectItem>}
                {accidentLayers.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {accidentLayerId !== null && (
            <div className="space-y-1.5 border border-border rounded-md p-2.5 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Фильтр аварий</span>
                </div>
                <Button
                  variant={accidentFilterEnabled ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => { setAccidentFilterEnabled(prev => !prev); if (accidentFilterEnabled) setAccidentFilters([{ field: "", value: "" }]); }}
                  data-testid="button-toggle-accident-filter"
                >
                  {accidentFilterEnabled ? "Убрать фильтр" : "Добавить фильтр"}
                </Button>
              </div>
              {accidentFilterEnabled && (
                <div className="space-y-1.5 mt-1">
                  {accidentFilters.map((f, idx) => (
                    <div key={idx} className="flex gap-1.5 items-end">
                      <div className="flex-1 space-y-1">
                        {idx === 0 && <Label className="text-xs">Столбец</Label>}
                        <Select value={f.field} onValueChange={v => setAccidentFilters(prev => prev.map((r, i) => i === idx ? { ...r, field: v } : r))}>
                          <SelectTrigger className="h-7 text-xs" data-testid={`select-accident-filter-field-${idx}`}>
                            <SelectValue placeholder="Атрибут..." />
                          </SelectTrigger>
                          <SelectContent>
                            {accidentAttributes.map(attr => <SelectItem key={attr} value={attr}>{attr}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-28 space-y-1">
                        {idx === 0 && <Label className="text-xs">Значение</Label>}
                        <Input
                          className="h-7 text-xs"
                          placeholder="значение"
                          value={f.value}
                          onChange={e => setAccidentFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                          data-testid={`input-accident-filter-value-${idx}`}
                        />
                      </div>
                      {accidentFilters.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setAccidentFilters(prev => prev.filter((_, i) => i !== idx))}
                          data-testid={`button-remove-accident-filter-${idx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1 w-full mt-1"
                    onClick={() => setAccidentFilters(prev => [...prev, { field: "", value: "" }])}
                    data-testid="button-add-accident-filter"
                  >
                    <Plus className="h-3 w-3" />
                    Добавить условие
                  </Button>
                  {accidentFilters.length > 1 && (
                    <p className="text-xs text-muted-foreground">Условия применяются вместе (AND)</p>
                  )}
                </div>
              )}
            </div>
          )}

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
                onCheckedChange={(v) => { setRunSimulation(v); if (!v) { setConsumerLayerId(null); setResidentField(null); } }}
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
                      {editableLayers.length === 0 && <SelectItem value="__none__" disabled>Нет слоёв</SelectItem>}
                      {editableLayers.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {consumerLayerId !== null && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Поле с количеством жителей</Label>
                    <Select value={residentField ?? ""} onValueChange={v => setResidentField(v || null)}>
                      <SelectTrigger className="h-7 text-xs" data-testid="select-resident-field">
                        <SelectValue placeholder="Выберите поле..." />
                      </SelectTrigger>
                      <SelectContent>
                        {consumerAttributes.length === 0 && <SelectItem value="__none__" disabled>Нет атрибутов</SelectItem>}
                        {consumerAttributes.map(attr => <SelectItem key={attr} value={attr}>{attr}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {isAnalyzing ? (
          <Button
            variant="destructive"
            className="w-full h-8 text-xs"
            onClick={handleCancelAnalysis}
            data-testid="button-cancel-analysis"
          >
            <XCircle className="h-3.5 w-3.5 mr-2" />
            Отменить анализ
          </Button>
        ) : (
          <Button
            className="w-full h-8 text-xs"
            disabled={!canRun}
            onClick={runAnalysis}
            data-testid="button-run-accident-analysis"
          >
            <Zap className="h-3.5 w-3.5 mr-2" />
            Запустить анализ
          </Button>
        )}

        {/* Progress block */}
        {isAnalyzing && progress && (
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5" data-testid="analysis-progress">
            <div className="text-xs font-medium text-foreground">Анализ выполняется...</div>

            {/* Binding row */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs">
                {(progress.stage !== "binding") ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                )}
                <span className="text-muted-foreground">Привязка аварий</span>
                {progress.boundAccidents !== undefined && (
                  <span className="ml-auto font-medium text-foreground">
                    {progress.boundAccidents} / {progress.totalAccidents}
                  </span>
                )}
              </div>
              {progress.boundAccidents !== undefined && progress.totalAccidents !== undefined && progress.totalAccidents > 0 && (
                <div className="h-1 rounded-full bg-muted overflow-hidden ml-5">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-300"
                    style={{ width: `${Math.round((progress.boundAccidents / progress.totalAccidents) * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Graph build row */}
            {runSimulation && (
              <div className="flex items-center gap-1.5 text-xs">
                {progress.stage === "binding" || progress.stage === "graph_building" ? (
                  progress.stage === "graph_building"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                    : <div className="h-3.5 w-3.5 rounded-full border border-border shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                )}
                <Network className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Граф сети</span>
                {progress.graphNodes !== undefined && (
                  <span className="ml-auto font-medium text-foreground">
                    {progress.graphNodes.toLocaleString("ru-RU")} узлов
                  </span>
                )}
              </div>
            )}

            {/* Simulation progress row */}
            {runSimulation && (progress.stage === "simulating" || (progress.simulationCurrent ?? 0) > 0) && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <BarChart3 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-muted-foreground">Симуляция участков</span>
                  <span className="ml-auto font-medium text-foreground">
                    {progress.simulationCurrent ?? 0} / {progress.simulationTotal ?? "…"}
                  </span>
                </div>
                {(progress.simulationTotal ?? 0) > 0 && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden ml-5">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${Math.round(((progress.simulationCurrent ?? 0) / (progress.simulationTotal ?? 1)) * 100)}%` }}
                    />
                  </div>
                )}
                {progress.consumerLayerCount !== undefined && (
                  <div className="flex items-center gap-1 ml-5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>Потребителей в слое: {progress.consumerLayerCount}</span>
                  </div>
                )}
                {progress.partialSegments.length > 0 && (
                  <div className="ml-5 text-xs text-muted-foreground">
                    Найдено участков: <span className="font-medium text-foreground">{progress.partialSegments.length}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {(result || (isAnalyzing && progress && progress.partialSegments.length > 0)) && (
          <div className="space-y-3">
            {result && (
              <div className="flex items-center flex-wrap gap-2">
                <Badge variant="outline" data-testid="badge-total">Аварий: {result.totalAccidents}</Badge>
                <Badge variant="secondary" data-testid="badge-bound">Привязано: {result.boundAccidents}</Badge>
                {result.unboundAccidents > 0 && (
                  <Badge variant="destructive" data-testid="badge-unbound">Не привязано: {result.unboundAccidents}</Badge>
                )}
              </div>
            )}
            {result && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Участков с авариями: {result.segmentsWithAccidents}
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={handleExportExcel} data-testid="button-export-excel">
                        <Download className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Экспорт в Excel</TooltipContent>
                  </Tooltip>
                  {onOpenReconstructionProgram && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onOpenReconstructionProgram(resultAsImportData)}
                          data-testid="button-open-reconstruction-accident-results"
                        >
                          <Wrench className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Передать в программу реконструкции ({resultAsImportData.length} участков)</TooltipContent>
                    </Tooltip>
                  )}
                  <Popover open={showSavePopover} onOpenChange={setShowSavePopover}>
                    <Tooltip>
                    <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="h-6 w-6" data-testid="button-save-to-layer">
                        <Layers className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Сохранить результаты в слой</TooltipContent>
                    </Tooltip>
                    <PopoverContent className="w-72 p-3" align="end">
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Сохранить буферизованные полигоны (±{maxDistance} м)</p>
                        <Select value={saveLayerId ? String(saveLayerId) : ""} onValueChange={v => setSaveLayerId(Number(v))}>
                          <SelectTrigger className="h-7 text-xs" data-testid="select-save-layer">
                            <SelectValue placeholder="Выберите слой..." />
                          </SelectTrigger>
                          <SelectContent>
                            {saveTargetLayers.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full h-7 text-xs border border-dashed"
                          disabled={isCreatingLayer || isSaving}
                          onClick={handleCreateNewLayer}
                          data-testid="button-create-new-layer"
                        >
                          {isCreatingLayer ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Создание...</> : <><Plus className="h-3 w-3 mr-1" />Создать новый слой</>}
                        </Button>
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
            )}

            {isAnalyzing && progress && progress.partialSegments.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Промежуточные результаты ({progress.partialSegments.length} участков):
              </div>
            )}

            {displaySegments.length === 0 && result ? (
              <div className="text-center py-6 text-muted-foreground text-xs">
                <AlertOctagon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Нет участков с привязанными авариями
              </div>
            ) : (
              <div className="space-y-1.5">
                {displaySegments.map((seg, idx) => (
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
    </DraggableModal>
  );
}

export type { AccidentSegmentResult, AccidentAnalysisResult };
