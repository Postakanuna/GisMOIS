import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  GripHorizontal,
  ShieldCheck,
  X,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Link2Off,
  Copy,
  MapPin,
  ArrowRight,
  RefreshCw,
  Crosshair,
} from "lucide-react";

interface TopologyError {
  featureId: number;
  layerId: number;
  segmentName: string;
  errorType: string;
  field: string;
  currentValue: string;
  suggestedValue: string | null;
  suggestedFeatureId: number | null;
  distance: number | null;
  currentDistance: number | null;
  nist: string;
}

interface TopologyValidationResult {
  totalSegments: number;
  totalPointNodes: number;
  totalErrors: number;
  errors: TopologyError[];
  stats: {
    orphanBegin: number;
    orphanEnd: number;
    orphanBoth: number;
    duplicates: number;
    emptyNames: number;
    selfLoops: number;
    geomMismatchBegin: number;
    geomMismatchEnd: number;
    spatialMismatchBegin: number;
    spatialMismatchEnd: number;
  };
}

interface RecalcBindingResult {
  featureId: number;
  layerId: number;
  segmentName: string;
  field: "Begin_uch" | "End_uch";
  currentValue: string;
  newValue: string;
  distance: number;
  nist: string;
}

interface RecalcResult {
  totalSegments: number;
  changes: RecalcBindingResult[];
  unchanged: number;
  noMatch: number;
}

interface TopologyValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sceneId: number;
}

const errorTypeLabels: Record<string, string> = {
  orphan_begin: "Начало не найдено",
  orphan_end: "Конец не найден",
  orphan_both: "Оба конца не найдены",
  duplicate: "Дубликат участка",
  empty_name: "Пустые имена",
  self_loop: "Петля (начало = конец)",
  geom_mismatch_begin: "Геометрия начала не совпадает",
  geom_mismatch_end: "Геометрия конца не совпадает",
  spatial_mismatch_begin: "Ложная привязка начала",
  spatial_mismatch_end: "Ложная привязка конца",
};

const errorTypeIcons: Record<string, typeof AlertTriangle> = {
  orphan_begin: Link2Off,
  orphan_end: Link2Off,
  orphan_both: Link2Off,
  duplicate: Copy,
  empty_name: AlertTriangle,
  self_loop: AlertTriangle,
  geom_mismatch_begin: MapPin,
  geom_mismatch_end: MapPin,
  spatial_mismatch_begin: Crosshair,
  spatial_mismatch_end: Crosshair,
};

type TabMode = "validate" | "recalc";

export function TopologyValidationDialog({
  open,
  onOpenChange,
  sceneId,
}: TopologyValidationDialogProps) {
  const [tabMode, setTabMode] = useState<TabMode>("validate");
  const [result, setResult] = useState<TopologyValidationResult | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [selectedFixes, setSelectedFixes] = useState<Map<string, { featureId: number; field: string; newValue: string }>>(new Map());
  const [fixResult, setFixResult] = useState<{ applied: number; failed: number } | null>(null);

  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);
  const [selectedRecalcFixes, setSelectedRecalcFixes] = useState<Map<string, { featureId: number; field: string; newValue: string }>>(new Map());
  const [recalcFixResult, setRecalcFixResult] = useState<{ applied: number; failed: number } | null>(null);

  const [position, setPosition] = useState({ x: 20, y: 80 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    };
    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/network-graph/validate-topology", { sceneId });
      return res.json() as Promise<TopologyValidationResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setSelectedFixes(new Map());
      setFixResult(null);
    },
  });

  const fixMutation = useMutation({
    mutationFn: async (fixes: Array<{ featureId: number; field: string; newValue: string }>) => {
      const res = await apiRequest("POST", "/api/network-graph/fix-topology", { fixes });
      return res.json() as Promise<{ applied: number; failed: number }>;
    },
    onSuccess: (data) => {
      setFixResult(data);
      setSelectedFixes(new Map());
      validateMutation.mutate();
    },
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/network-graph/recalculate-bindings", { sceneId });
      return res.json() as Promise<RecalcResult>;
    },
    onSuccess: (data) => {
      setRecalcResult(data);
      setSelectedRecalcFixes(new Map());
      setRecalcFixResult(null);
    },
  });

  const applyRecalcMutation = useMutation({
    mutationFn: async (fixes: Array<{ featureId: number; field: string; newValue: string }>) => {
      const res = await apiRequest("POST", "/api/network-graph/apply-recalculated-bindings", { fixes });
      return res.json() as Promise<{ applied: number; failed: number }>;
    },
    onSuccess: (data) => {
      setRecalcFixResult(data);
      setSelectedRecalcFixes(new Map());
      recalcMutation.mutate();
    },
  });

  const handleClose = () => {
    setResult(null);
    setFixResult(null);
    setSelectedFixes(new Map());
    setRecalcResult(null);
    setRecalcFixResult(null);
    setSelectedRecalcFixes(new Map());
    validateMutation.reset();
    recalcMutation.reset();
    onOpenChange(false);
  };

  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleFix = (error: TopologyError) => {
    if (!error.suggestedValue) return;
    const key = `${error.featureId}-${error.field}`;
    setSelectedFixes(prev => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, { featureId: error.featureId, field: error.field, newValue: error.suggestedValue! });
      }
      return next;
    });
  };

  const selectAllFixesForType = (type: string) => {
    if (!result) return;
    const errorsOfType = result.errors.filter(e => e.errorType === type && e.suggestedValue);
    setSelectedFixes(prev => {
      const next = new Map(prev);
      const allSelected = errorsOfType.every(e => next.has(`${e.featureId}-${e.field}`));
      for (const e of errorsOfType) {
        const key = `${e.featureId}-${e.field}`;
        if (allSelected) {
          next.delete(key);
        } else {
          next.set(key, { featureId: e.featureId, field: e.field, newValue: e.suggestedValue! });
        }
      }
      return next;
    });
  };

  const applyFixes = () => {
    const fixes = Array.from(selectedFixes.values());
    if (fixes.length > 0) {
      fixMutation.mutate(fixes);
    }
  };

  const toggleRecalcFix = (change: RecalcBindingResult) => {
    const key = `${change.featureId}-${change.field}`;
    setSelectedRecalcFixes(prev => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, { featureId: change.featureId, field: change.field, newValue: change.newValue });
      }
      return next;
    });
  };

  const selectAllRecalcFixes = () => {
    if (!recalcResult) return;
    setSelectedRecalcFixes(prev => {
      const next = new Map(prev);
      const allSelected = recalcResult.changes.every(c => next.has(`${c.featureId}-${c.field}`));
      for (const c of recalcResult.changes) {
        const key = `${c.featureId}-${c.field}`;
        if (allSelected) {
          next.delete(key);
        } else {
          next.set(key, { featureId: c.featureId, field: c.field, newValue: c.newValue });
        }
      }
      return next;
    });
  };

  const applyRecalcFixes = () => {
    const fixes = Array.from(selectedRecalcFixes.values());
    if (fixes.length > 0) {
      applyRecalcMutation.mutate(fixes);
    }
  };

  const groupedErrors = result ? groupBy(result.errors, e => e.errorType) : {};

  if (!open) return null;

  return (
    <div
      className="fixed z-50 bg-background border rounded-md shadow-lg"
      style={{ left: position.x, top: position.y, width: 500, maxHeight: "calc(100vh - 100px)" }}
      data-testid="topology-validation-dialog"
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
          <ShieldCheck className="h-4 w-4 text-blue-500" />
          <span className="font-medium text-sm">Проверка топологии</span>
        </div>
        <Button size="icon" variant="ghost" onClick={handleClose} data-testid="button-close-topology">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex border-b">
        <button
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${tabMode === "validate" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          onClick={() => setTabMode("validate")}
          data-testid="tab-validate"
        >
          Проверка ошибок
        </button>
        <button
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${tabMode === "recalc" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          onClick={() => setTabMode("recalc")}
          data-testid="tab-recalc"
        >
          Пересчёт привязок
        </button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 250px)" }}>
        <div className="p-3 space-y-3">
          {tabMode === "validate" && (
            <>
              {!result && (
                <>
                  <div className="text-sm text-muted-foreground">
                    Проверка соответствия начальных и конечных узлов участков (Begin_uch / End_uch) с реальными точечными объектами сети. Поиск ошибок: несуществующие ссылки, дубликаты, петли, ложные привязки по координатам.
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => validateMutation.mutate()}
                    disabled={validateMutation.isPending}
                    data-testid="button-run-topology-check"
                  >
                    {validateMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Проверка...</>
                    ) : (
                      <><Search className="h-4 w-4" />Запустить проверку</>
                    )}
                  </Button>
                  {validateMutation.isError && (
                    <div className="text-sm text-destructive">{(validateMutation.error as Error).message}</div>
                  )}
                </>
              )}

              {result && (
                <div className="space-y-3">
                  <div className="flex items-center flex-wrap gap-2">
                    <Badge variant="outline">Участков: {result.totalSegments}</Badge>
                    <Badge variant="outline">Узлов: {result.totalPointNodes}</Badge>
                    {result.totalErrors === 0 ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Ошибок нет
                      </Badge>
                    ) : (
                      <Badge variant="destructive">{result.totalErrors} ошибок</Badge>
                    )}
                  </div>

                  {(result.stats.spatialMismatchBegin > 0 || result.stats.spatialMismatchEnd > 0) && (
                    <div className="text-xs p-2 rounded-md bg-orange-500/10 border border-orange-500/20">
                      <div className="flex items-center gap-1 font-medium text-orange-600 dark:text-orange-400">
                        <Crosshair className="h-3 w-3" />
                        Ложные привязки: {result.stats.spatialMismatchBegin + result.stats.spatialMismatchEnd}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Рядом с концом участка ({"\u2264"}5м) найден другой объект, отличный от записанного в атрибутах. Атрибут ссылается на далёкий объект.
                      </div>
                    </div>
                  )}

                  {fixResult && (
                    <div className="text-sm p-2 rounded-md bg-muted">
                      Исправлено: {fixResult.applied}, ошибок: {fixResult.failed}
                    </div>
                  )}

                  {selectedFixes.size > 0 && (
                    <Button
                      className="w-full gap-2"
                      onClick={applyFixes}
                      disabled={fixMutation.isPending}
                      data-testid="button-apply-fixes"
                    >
                      {fixMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Применение...</>
                      ) : (
                        <><Wrench className="h-4 w-4" />Применить исправления ({selectedFixes.size})</>
                      )}
                    </Button>
                  )}

                  {Object.entries(groupedErrors).map(([type, errors]) => {
                    const Icon = errorTypeIcons[type] || AlertTriangle;
                    const fixableCount = errors.filter(e => e.suggestedValue).length;
                    const isSpatialMismatch = type === "spatial_mismatch_begin" || type === "spatial_mismatch_end";
                    return (
                      <Card key={type} className="overflow-visible">
                        <Collapsible open={expandedTypes.has(type)} onOpenChange={() => toggleType(type)}>
                          <CollapsibleTrigger className="w-full" data-testid={`trigger-error-type-${type}`}>
                            <div className="flex items-center justify-between p-2 gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {expandedTypes.has(type) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                <Icon className={`h-4 w-4 shrink-0 ${isSpatialMismatch ? "text-orange-500" : "text-orange-500"}`} />
                                <span className="text-sm font-medium truncate">{errorTypeLabels[type] || type}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant="destructive">{errors.length}</Badge>
                                {fixableCount > 0 && (
                                  <Badge variant="secondary" className="gap-1">
                                    <Wrench className="h-3 w-3" /> {fixableCount}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-2 pb-2 space-y-1">
                              {fixableCount > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full gap-1 mb-1"
                                  onClick={() => selectAllFixesForType(type)}
                                  data-testid={`button-select-all-${type}`}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Выбрать все исправления ({fixableCount})
                                </Button>
                              )}
                              {errors.map((error, idx) => {
                                const fixKey = `${error.featureId}-${error.field}`;
                                const isSelected = selectedFixes.has(fixKey);
                                return (
                                  <div key={idx} className={`text-xs border rounded-md p-2 space-y-1 ${isSelected ? "bg-primary/10 border-primary/30" : ""}`}>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="font-medium">{error.field}:</span>
                                      <span className="text-destructive">{error.currentValue || "(пусто)"}</span>
                                      {error.nist && <Badge variant="outline" className="text-[10px]">Nist {error.nist}</Badge>}
                                    </div>
                                    <div className="text-muted-foreground">
                                      ID: {error.featureId}
                                      {error.segmentName && error.segmentName !== " → " && (
                                        <span className="ml-1">| {error.segmentName}</span>
                                      )}
                                    </div>
                                    {isSpatialMismatch && error.currentDistance !== null && (
                                      <div className="text-muted-foreground">
                                        До текущего узла: <span className="text-destructive font-medium">{error.currentDistance}м</span>
                                      </div>
                                    )}
                                    {error.suggestedValue && (
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <ArrowRight className="h-3 w-3 text-green-500" />
                                        <span className="text-green-600 dark:text-green-400 font-medium">{error.suggestedValue}</span>
                                        {error.distance !== null && (
                                          <span className="text-muted-foreground">({error.distance}м)</span>
                                        )}
                                        <Button
                                          variant={isSelected ? "default" : "outline"}
                                          size="sm"
                                          className="ml-auto gap-1"
                                          onClick={() => toggleFix(error)}
                                          data-testid={`button-fix-${error.featureId}-${error.field}`}
                                        >
                                          <Wrench className="h-3 w-3" />
                                          {isSelected ? "Отменить" : "Исправить"}
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </Card>
                    );
                  })}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setResult(null);
                      setSelectedFixes(new Map());
                      setFixResult(null);
                      validateMutation.reset();
                    }}
                    data-testid="button-reset-topology"
                  >
                    Новая проверка
                  </Button>
                </div>
              )}
            </>
          )}

          {tabMode === "recalc" && (
            <>
              {!recalcResult && (
                <>
                  <div className="text-sm text-muted-foreground">
                    Пересчёт привязок Begin_uch / End_uch по фактическим координатам. Для каждого конца участка ищется ближайший точечный объект (узел, потребитель, ЦТП, задвижка, насос, источник) в радиусе {"\u2264"}5м. Если найденный объект отличается от записанного — предлагается замена.
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => recalcMutation.mutate()}
                    disabled={recalcMutation.isPending}
                    data-testid="button-run-recalc"
                  >
                    {recalcMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Сканирование...</>
                    ) : (
                      <><RefreshCw className="h-4 w-4" />Пересчитать привязки</>
                    )}
                  </Button>
                  {recalcMutation.isError && (
                    <div className="text-sm text-destructive">{(recalcMutation.error as Error).message}</div>
                  )}
                </>
              )}

              {recalcResult && (
                <div className="space-y-3">
                  <div className="flex items-center flex-wrap gap-2">
                    <Badge variant="outline">Участков: {recalcResult.totalSegments}</Badge>
                    <Badge variant="outline">Совпадений: {recalcResult.unchanged}</Badge>
                    <Badge variant="outline">Без объекта: {recalcResult.noMatch}</Badge>
                    {recalcResult.changes.length === 0 ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Замен не требуется
                      </Badge>
                    ) : (
                      <Badge variant="destructive">{recalcResult.changes.length} замен</Badge>
                    )}
                  </div>

                  {recalcFixResult && (
                    <div className="text-sm p-2 rounded-md bg-muted">
                      Применено: {recalcFixResult.applied}, ошибок: {recalcFixResult.failed}
                    </div>
                  )}

                  {recalcResult.changes.length > 0 && (
                    <>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1"
                          onClick={selectAllRecalcFixes}
                          data-testid="button-select-all-recalc"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {selectedRecalcFixes.size === recalcResult.changes.length ? "Снять все" : "Выбрать все"} ({recalcResult.changes.length})
                        </Button>
                      </div>

                      {selectedRecalcFixes.size > 0 && (
                        <Button
                          className="w-full gap-2"
                          onClick={applyRecalcFixes}
                          disabled={applyRecalcMutation.isPending}
                          data-testid="button-apply-recalc"
                        >
                          {applyRecalcMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 animate-spin" />Применение...</>
                          ) : (
                            <><Wrench className="h-4 w-4" />Применить замены ({selectedRecalcFixes.size})</>
                          )}
                        </Button>
                      )}

                      <div className="space-y-1 max-h-[400px] overflow-y-auto">
                        {recalcResult.changes.map((change, idx) => {
                          const fixKey = `${change.featureId}-${change.field}`;
                          const isSelected = selectedRecalcFixes.has(fixKey);
                          return (
                            <div key={idx} className={`text-xs border rounded-md p-2 space-y-1 ${isSelected ? "bg-primary/10 border-primary/30" : ""}`}>
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="font-medium">{change.field}:</span>
                                <span className="text-destructive">{change.currentValue || "(пусто)"}</span>
                                <ArrowRight className="h-3 w-3 text-green-500" />
                                <span className="text-green-600 dark:text-green-400 font-medium">{change.newValue}</span>
                                <span className="text-muted-foreground">({change.distance}м)</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="text-muted-foreground">
                                  ID: {change.featureId}
                                  {change.nist && <span className="ml-1">| Nist {change.nist}</span>}
                                </div>
                                <Button
                                  variant={isSelected ? "default" : "outline"}
                                  size="sm"
                                  className="gap-1"
                                  onClick={() => toggleRecalcFix(change)}
                                  data-testid={`button-recalc-fix-${change.featureId}-${change.field}`}
                                >
                                  <Wrench className="h-3 w-3" />
                                  {isSelected ? "Отменить" : "Выбрать"}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setRecalcResult(null);
                      setSelectedRecalcFixes(new Map());
                      setRecalcFixResult(null);
                      recalcMutation.reset();
                    }}
                    data-testid="button-reset-recalc"
                  >
                    Новый пересчёт
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}
