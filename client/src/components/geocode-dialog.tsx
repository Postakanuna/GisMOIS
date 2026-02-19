import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MapPin, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";

interface GeocodeDialogProps {
  layerId: number;
  layerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface GeocodeInfo {
  layerId: number;
  layerName: string;
  geometryType: string;
  isLine: boolean;
  isPoint: boolean;
  totalFeatures: number;
  alreadyGeocoded: number;
  needsGeocoding: number;
  requestsNeeded: number;
  estimatedSeconds: number;
  fields: string[];
  provider: string;
}

type GeocodeStatus = "idle" | "running" | "complete" | "error";

const PROVIDER_LABELS: Record<string, string> = {
  yandex: "Яндекс Геокодер",
  dadata: "DaData",
};

export function GeocodeDialog({ layerId, layerName, open, onOpenChange }: GeocodeDialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<GeocodeStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<{ success: number; errors: number; skipped: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: info, isLoading: infoLoading } = useQuery<GeocodeInfo>({
    queryKey: ["/api/editable-layers", layerId, "geocode-info"],
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setProgress(0);
      setTotal(0);
      setResult(null);
      setErrorMessage(null);
    }
  }, [open]);

  const startGeocoding = useCallback(async () => {
    setStatus("running");
    setProgress(0);
    setErrorMessage(null);
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/editable-layers/${layerId}/geocode`, {
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Ошибка сервера" }));
        throw new Error(err.message || "Ошибка сервера");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Нет потока данных");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "start") {
                setTotal(data.total);
              } else if (data.type === "progress") {
                setProgress(data.processed);
                setTotal(data.total);
              } else if (data.type === "complete") {
                setResult({
                  success: data.success || 0,
                  errors: data.errors || 0,
                  skipped: data.skipped || 0,
                });
                setStatus("complete");
              } else if (data.type === "error") {
                setErrorMessage(data.message);
                setStatus("error");
              }
            } catch {}
          }
        }
      }

      if (status !== "error") {
        queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", layerId, "geocode-info"] });
        queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setStatus("idle");
        toast({ title: "Отменено", description: "Геокодирование отменено" });
      } else {
        setErrorMessage(err.message);
        setStatus("error");
      }
    }
  }, [layerId, toast]);

  const cancelGeocoding = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;

  const geometryLabel = info?.isLine ? "Линейный" : info?.isPoint ? "Точечный" : info?.geometryType || "";
  const fieldsLabel = info?.fields?.join(", ") || "";
  const providerLabel = info?.provider ? (PROVIDER_LABELS[info.provider] || info.provider) : "";

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (status === "running") return;
      onOpenChange(v);
    }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-geocode">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Геокодирование слоя
          </DialogTitle>
          <DialogDescription>
            Добавление адресных ориентиров через {providerLabel || "API геокодирования"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {infoLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : info ? (
            <>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Слой:</span>
                  <span className="font-medium" data-testid="text-geocode-layer-name">{info.layerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Тип геометрии:</span>
                  <Badge variant="secondary" data-testid="text-geocode-geometry-type">{geometryLabel}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">API-провайдер:</span>
                  <Badge variant="outline" data-testid="text-geocode-provider">{providerLabel}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Всего объектов:</span>
                  <span data-testid="text-geocode-total">{info.totalFeatures}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Уже геокодировано:</span>
                  <span className="text-green-600" data-testid="text-geocode-already">{info.alreadyGeocoded}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Требует обработки:</span>
                  <span className="font-medium" data-testid="text-geocode-needs">{info.needsGeocoding}</span>
                </div>
                <div className="flex justify-between flex-wrap gap-1">
                  <span className="text-muted-foreground">Добавляемые поля:</span>
                  <span className="font-mono text-xs" data-testid="text-geocode-fields">{fieldsLabel}</span>
                </div>
                {info.estimatedSeconds > 5 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Примерное время:</span>
                    <span data-testid="text-geocode-estimate">~{info.estimatedSeconds} сек</span>
                  </div>
                )}
              </div>

              {info.needsGeocoding === 0 && status === "idle" && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-green-500/10 text-green-700 dark:text-green-400 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Все объекты уже геокодированы</span>
                </div>
              )}

              {info.totalFeatures > 500 && status === "idle" && info.needsGeocoding > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Большой объём данных — обработка может занять несколько минут</span>
                </div>
              )}

              {status === "running" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Обработка...</span>
                    <span data-testid="text-geocode-progress">{progress} / {total}</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" data-testid="progress-geocode" />
                </div>
              )}

              {status === "complete" && result && (
                <div className="space-y-2 p-3 rounded-md bg-green-500/10 text-sm">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Геокодирование завершено
                  </div>
                  <div className="space-y-1 text-muted-foreground">
                    <div>Успешно: {result.success}</div>
                    {result.skipped > 0 && <div>Пропущено (уже есть): {result.skipped}</div>}
                    {result.errors > 0 && <div className="text-destructive">Ошибок: {result.errors}</div>}
                  </div>
                </div>
              )}

              {status === "error" && errorMessage && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter className="flex-row gap-2 justify-end">
          {status === "running" ? (
            <Button
              variant="destructive"
              onClick={cancelGeocoding}
              data-testid="button-cancel-geocode"
            >
              <X className="h-4 w-4 mr-1" />
              Отменить
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-geocode"
              >
                Закрыть
              </Button>
              {info && info.needsGeocoding > 0 && status !== "complete" && (
                <Button
                  onClick={startGeocoding}
                  data-testid="button-start-geocode"
                >
                  <MapPin className="h-4 w-4 mr-1" />
                  Запустить
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
