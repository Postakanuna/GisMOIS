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
  };
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
};

export function TopologyValidationDialog({
  open,
  onOpenChange,
  sceneId,
}: TopologyValidationDialogProps) {
  const [result, setResult] = useState<TopologyValidationResult | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [selectedFixes, setSelectedFixes] = useState<Map<string, { featureId: number; field: string; newValue: string }>>(new Map());
  const [fixResult, setFixResult] = useState<{ applied: number; failed: number } | null>(null);

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

  const handleClose = () => {
    setResult(null);
    setFixResult(null);
    setSelectedFixes(new Map());
    validateMutation.reset();
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

  const groupedErrors = result ? groupBy(result.errors, e => e.errorType) : {};

  if (!open) return null;

  return (
    <div
      className="fixed z-50 bg-background border rounded-md shadow-lg"
      style={{ left: position.x, top: position.y, width: 460, maxHeight: "calc(100vh - 100px)" }}
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

      <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
        <div className="p-3 space-y-3">
          {!result && (
            <>
              <div className="text-sm text-muted-foreground">
                Проверка соответствия начальных и конечных узлов участков (Begin_uch / End_uch) с реальными точечными объектами сети. Поиск ошибок: несуществующие ссылки, дубликаты, петли, несоответствие геометрии.
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
                return (
                  <Card key={type} className="overflow-visible">
                    <Collapsible open={expandedTypes.has(type)} onOpenChange={() => toggleType(type)}>
                      <CollapsibleTrigger className="w-full" data-testid={`trigger-error-type-${type}`}>
                        <div className="flex items-center justify-between p-2 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {expandedTypes.has(type) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            <Icon className="h-4 w-4 shrink-0 text-orange-500" />
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
                                <div className="text-muted-foreground">ID: {error.featureId}</div>
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
