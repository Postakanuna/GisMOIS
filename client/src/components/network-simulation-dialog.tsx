import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Play,
  ChevronDown,
  ChevronRight,
  Home,
  GitBranch,
  MapPin,
  Loader2,
  AlertTriangle,
  Thermometer,
  X,
  GripHorizontal,
  Download,
  Lock,
  ArrowRightLeft,
} from "lucide-react";

interface SimulationResult {
  failurePoint: {
    featureId: number;
    layerId: number;
    name: string;
    type: string;
    coordinates: any;
  };
  source: {
    name: string;
    nist: string;
  } | null;
  affectedConsumers: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
  }>;
  switchableConsumers: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
    alternativeSource: string;
  }>;
  affectedSegments: Array<{
    featureId: number;
    layerId: number;
    from: string;
    to: string;
    length: number;
    coordinates: any;
  }>;
  affectedCTPs: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
  }>;
  switchableCTPs: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
    alternativeSource: string;
  }>;
  affectedNodes: Array<{
    featureId: number;
    layerId: number;
    name: string;
    coordinates: any;
  }>;
  closedValves: Array<{
    featureId: number;
    layerId: number;
    name: string;
    perPod: number | null;
    perObr: number | null;
    coordinates: any;
  }>;
  stats: {
    totalConsumers: number;
    totalSwitchableConsumers: number;
    totalSegments: number;
    totalCTPs: number;
    totalSwitchableCTPs: number;
    totalNodes: number;
    totalLengthM: number;
    totalClosedValves: number;
  };
}

interface NetworkSimulationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureId: number | null;
  layerId: number | null;
  featureName: string;
  featureType: string;
  sceneId: number;
  onSimulationResult: (result: SimulationResult | null) => void;
}

export function NetworkSimulationDialog({
  open,
  onOpenChange,
  featureId,
  layerId,
  featureName,
  featureType,
  sceneId,
  onSimulationResult,
}: NetworkSimulationDialogProps) {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [consumersOpen, setConsumersOpen] = useState(true);
  const [switchableOpen, setSwitchableOpen] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [ctpsOpen, setCtpsOpen] = useState(false);
  const [switchableCtpsOpen, setSwitchableCtpsOpen] = useState(false);
  const [nodesOpen, setNodesOpen] = useState(false);
  const [valvesOpen, setValvesOpen] = useState(false);

  const [position, setPosition] = useState({ x: 20, y: 80 });
  const dragRef = useRef<HTMLDivElement>(null);
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
    const handleMouseUp = () => {
      isDragging.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const simulationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/network-graph/simulate", {
        featureId,
        layerId,
        sceneId,
      });
      return res.json() as Promise<SimulationResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      onSimulationResult(data);
    },
    onError: (error: Error) => {
      console.error("Simulation error:", error);
    },
  });

  const [exporting, setExporting] = useState(false);

  const handleClose = () => {
    setResult(null);
    simulationMutation.reset();
    onSimulationResult(null);
    onOpenChange(false);
  };

  const handleExport = async () => {
    if (!result || !featureId || !layerId) return;
    setExporting(true);
    try {
      const res = await fetch("/api/network-graph/simulate/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId, layerId, sceneId }),
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
      let filename = "simulation_report.xlsx";
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

  const featureTypeLabel = featureType === "LineString" ? "Участок сети" : "Узел/объект";

  if (!open) return null;

  return (
    <div
      ref={dragRef}
      className="fixed z-[9999] w-[420px] max-h-[80vh] flex flex-col rounded-md border bg-background shadow-lg"
      style={{ left: position.x, top: position.y }}
      data-testid="dialog-network-simulation"
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b cursor-grab active:cursor-grabbing select-none shrink-0"
        onMouseDown={handleMouseDown}
      >
        <GripHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
        <span className="text-sm font-semibold flex-1">Симуляция отключения</span>
        <Button size="icon" variant="ghost" onClick={handleClose} data-testid="button-close-simulation">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4 flex-1 overflow-hidden flex flex-col p-4">
        <Card className="p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{featureTypeLabel}</Badge>
            <span className="text-sm font-medium truncate" data-testid="text-simulation-feature-name">{featureName || "Без названия"}</span>
          </div>
          {result?.source && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Thermometer className="h-3 w-3" />
              <span>Источник: {result.source.name} (Nist: {result.source.nist})</span>
            </div>
          )}
        </Card>

        {!result && !simulationMutation.isPending && !simulationMutation.isError && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground py-8">
            <GitBranch className="h-12 w-12 opacity-30" />
            <p className="text-sm text-center">
              Нажмите кнопку для анализа зоны отключения от выбранного объекта
            </p>
          </div>
        )}

        {simulationMutation.isError && (
          <Card className="p-3 border-destructive">
            <p className="text-sm text-destructive" data-testid="text-simulation-error">
              {simulationMutation.error?.message || "Ошибка анализа"}
            </p>
          </Card>
        )}

        {result && (
          <ScrollArea className="flex-1">
            <div className="space-y-3 pr-3">
              <Card className="p-3">
                <h4 className="text-sm font-medium mb-2">Сводка</h4>
                <div className="grid grid-cols-2 gap-2">
                  <StatItem
                    icon={<Home className="h-4 w-4" />}
                    label="Потребителей"
                    value={result.stats.totalConsumers}
                    testId="text-stat-consumers"
                  />
                  <StatItem
                    icon={<GitBranch className="h-4 w-4" />}
                    label="Участков"
                    value={result.stats.totalSegments}
                    testId="text-stat-segments"
                  />
                  <StatItem
                    icon={<Thermometer className="h-4 w-4" />}
                    label="ЦТП"
                    value={result.stats.totalCTPs}
                    testId="text-stat-ctps"
                  />
                  <StatItem
                    icon={<MapPin className="h-4 w-4" />}
                    label="Узлов"
                    value={result.stats.totalNodes}
                    testId="text-stat-nodes"
                  />
                  {result.stats.totalSwitchableConsumers > 0 && (
                    <StatItem
                      icon={<ArrowRightLeft className="h-4 w-4" />}
                      label="Переключаемых"
                      value={result.stats.totalSwitchableConsumers}
                      testId="text-stat-switchable"
                    />
                  )}
                  {result.stats.totalClosedValves > 0 && (
                    <StatItem
                      icon={<Lock className="h-4 w-4" />}
                      label="Закр. задвижек"
                      value={result.stats.totalClosedValves}
                      testId="text-stat-closed-valves"
                    />
                  )}
                </div>
                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                  Общая длина затронутых сетей: {result.stats.totalLengthM} м
                </div>
              </Card>

              {result.affectedConsumers.length > 0 && (
                <CollapsibleSection
                  title="Потребители"
                  count={result.affectedConsumers.length}
                  open={consumersOpen}
                  onOpenChange={setConsumersOpen}
                  testId="section-consumers"
                >
                  {result.affectedConsumers.map((c, i) => (
                    <div key={c.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-consumer-${i}`}>
                      <Home className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.address || c.name}</span>
                    </div>
                  ))}
                </CollapsibleSection>
              )}

              {result.switchableConsumers && result.switchableConsumers.length > 0 && (
                <CollapsibleSection
                  title="Переключаемые потребители"
                  count={result.switchableConsumers.length}
                  open={switchableOpen}
                  onOpenChange={setSwitchableOpen}
                  testId="section-switchable-consumers"
                >
                  <div className="text-xs text-muted-foreground mb-2">
                    Получают тепло от альтернативного источника
                  </div>
                  {result.switchableConsumers.map((c, i) => (
                    <div key={c.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-switchable-consumer-${i}`}>
                      <ArrowRightLeft className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
                      <span className="truncate">{c.address || c.name}</span>
                      <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">{c.alternativeSource}</Badge>
                    </div>
                  ))}
                </CollapsibleSection>
              )}

              {result.affectedSegments.length > 0 && (
                <CollapsibleSection
                  title="Участки сети"
                  count={result.affectedSegments.length}
                  open={segmentsOpen}
                  onOpenChange={setSegmentsOpen}
                  testId="section-segments"
                >
                  {result.affectedSegments.map((s, i) => (
                    <div key={s.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-segment-${i}`}>
                      <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{s.from} → {s.to}</span>
                      <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">{s.length}м</Badge>
                    </div>
                  ))}
                </CollapsibleSection>
              )}

              {result.affectedCTPs.length > 0 && (
                <CollapsibleSection
                  title="ЦТП"
                  count={result.affectedCTPs.length}
                  open={ctpsOpen}
                  onOpenChange={setCtpsOpen}
                  testId="section-ctps"
                >
                  {result.affectedCTPs.map((c, i) => (
                    <div key={c.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-ctp-${i}`}>
                      <Thermometer className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.name}</span>
                      {c.address && <span className="text-muted-foreground truncate">({c.address})</span>}
                    </div>
                  ))}
                </CollapsibleSection>
              )}

              {result.switchableCTPs && result.switchableCTPs.length > 0 && (
                <CollapsibleSection
                  title="Переключаемые ЦТП"
                  count={result.switchableCTPs.length}
                  open={switchableCtpsOpen}
                  onOpenChange={setSwitchableCtpsOpen}
                  testId="section-switchable-ctps"
                >
                  <div className="text-xs text-muted-foreground mb-2">
                    Получают тепло от альтернативного источника
                  </div>
                  {result.switchableCTPs.map((c, i) => (
                    <div key={c.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-switchable-ctp-${i}`}>
                      <ArrowRightLeft className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
                      <span className="truncate">{c.name}</span>
                      <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">{c.alternativeSource}</Badge>
                    </div>
                  ))}
                </CollapsibleSection>
              )}

              {result.affectedNodes.length > 0 && (
                <CollapsibleSection
                  title="Узлы"
                  count={result.affectedNodes.length}
                  open={nodesOpen}
                  onOpenChange={setNodesOpen}
                  testId="section-nodes"
                >
                  {result.affectedNodes.map((n, i) => (
                    <div key={n.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-node-${i}`}>
                      <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{n.name}</span>
                    </div>
                  ))}
                </CollapsibleSection>
              )}

              {result.closedValves && result.closedValves.length > 0 && (
                <CollapsibleSection
                  title="Закрытые задвижки"
                  count={result.closedValves.length}
                  open={valvesOpen}
                  onOpenChange={setValvesOpen}
                  testId="section-closed-valves"
                >
                  <div className="text-xs text-muted-foreground mb-2">
                    Эти задвижки ограничили зону распространения отключения
                  </div>
                  {result.closedValves.map((v, i) => (
                    <div key={v.featureId + "-" + i} className="text-xs py-1 border-b last:border-b-0 flex items-center gap-2" data-testid={`item-closed-valve-${i}`}>
                      <Lock className="h-3 w-3 text-orange-500 shrink-0" />
                      <span className="truncate">{v.name}</span>
                      <div className="ml-auto flex gap-1 shrink-0">
                        {v.perPod !== null && (
                          <Badge variant="secondary" className="text-[10px]">Под: {v.perPod}</Badge>
                        )}
                        {v.perObr !== null && (
                          <Badge variant="secondary" className="text-[10px]">Обр: {v.perObr}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </CollapsibleSection>
              )}
            </div>
          </ScrollArea>
        )}

        <div className="flex gap-2 shrink-0">
          <Button
            onClick={() => simulationMutation.mutate()}
            disabled={simulationMutation.isPending || !featureId}
            className="flex-1"
            data-testid="button-run-simulation"
          >
            {simulationMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Анализ...
              </>
            ) : result ? (
              <>
                <Play className="h-4 w-4 mr-2" />
                Повторить анализ
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Запуск анализа
              </>
            )}
          </Button>
          {result && (
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
              data-testid="button-export-simulation"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  XLSX
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatItem({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: number; testId: string }) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
  testId,
}: {
  title: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="overflow-visible">
        <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 hover-elevate" data-testid={`button-toggle-${testId}`}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">{title}</span>
          <Badge variant="secondary" className="ml-auto">{count}</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0">
            {children}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export type { SimulationResult };
