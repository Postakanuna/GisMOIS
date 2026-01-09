import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Route, MapPin, Ruler } from "lucide-react";
import type { EditableLayer } from "@shared/schema";

interface TraceRouteResult {
  success: boolean;
  fallback?: boolean;
  coordinates: [number, number][];
  targetFeature?: {
    id: number;
    properties: Record<string, unknown>;
  };
  routeDistance?: number;
  straightLineDistance?: number;
  message?: string;
}

interface TraceRouteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceCoords: [number, number] | null;
  sourceLayerName: string | null;
  availableLayers: EditableLayer[];
  currentLayerId: number | null;
  onRouteResult: (result: TraceRouteResult) => void;
}

export function TraceRouteDialog({
  open,
  onOpenChange,
  sourceCoords,
  sourceLayerName,
  availableLayers,
  currentLayerId,
  onRouteResult,
}: TraceRouteDialogProps) {
  const [targetLayerId, setTargetLayerId] = useState<string>("");

  const targetLayers = availableLayers.filter(l => l.id !== currentLayerId);

  const traceMutation = useMutation({
    mutationFn: async (data: { sourceCoords: [number, number]; targetLayerId: number }) => {
      const response = await apiRequest("POST", "/api/trace-route", data);
      return response.json() as Promise<TraceRouteResult>;
    },
    onSuccess: (result) => {
      onRouteResult(result);
      onOpenChange(false);
    },
  });

  const handleTrace = () => {
    if (!sourceCoords || !targetLayerId) return;
    traceMutation.mutate({
      sourceCoords,
      targetLayerId: parseInt(targetLayerId, 10),
    });
  };

  const selectedTargetLayer = targetLayers.find(l => l.id.toString() === targetLayerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="trace-route-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="h-5 w-5" />
            Трассировка к слою
          </DialogTitle>
          <DialogDescription>
            Построение маршрута от выбранного объекта к ближайшему объекту целевого слоя
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Источник</Label>
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{sourceLayerName || "Выбранный объект"}</span>
            </div>
            {sourceCoords && (
              <p className="text-xs text-muted-foreground">
                Координаты: {sourceCoords[0].toFixed(6)}, {sourceCoords[1].toFixed(6)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-layer">Целевой слой</Label>
            <Select value={targetLayerId} onValueChange={setTargetLayerId}>
              <SelectTrigger id="target-layer" data-testid="select-target-layer">
                <SelectValue placeholder="Выберите слой..." />
              </SelectTrigger>
              <SelectContent>
                {targetLayers.map((layer) => (
                  <SelectItem 
                    key={layer.id} 
                    value={layer.id.toString()}
                    data-testid={`option-layer-${layer.id}`}
                  >
                    {layer.name} ({layer.geometryType})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetLayers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Нет доступных слоёв для трассировки
              </p>
            )}
          </div>

          {traceMutation.isSuccess && traceMutation.data && (
            <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md space-y-1">
              <p className="text-sm font-medium text-green-700 dark:text-green-300">
                Маршрут построен
              </p>
              {traceMutation.data.routeDistance && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Ruler className="h-3 w-3" />
                  Длина маршрута: {(traceMutation.data.routeDistance / 1000).toFixed(2)} км
                </p>
              )}
              {traceMutation.data.fallback && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Использована прямая линия (сервис маршрутизации недоступен)
                </p>
              )}
            </div>
          )}

          {traceMutation.isError && (
            <div className="p-3 bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">
                Ошибка построения маршрута
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-trace"
          >
            Отмена
          </Button>
          <Button
            onClick={handleTrace}
            disabled={!targetLayerId || !sourceCoords || traceMutation.isPending}
            data-testid="button-build-trace"
          >
            {traceMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Построить маршрут
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
