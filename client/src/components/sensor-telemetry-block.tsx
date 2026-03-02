import { useSensorDataBySensorId } from "@/hooks/use-sensor-data";
import { Badge } from "@/components/ui/badge";
import { Thermometer, Gauge, Building, Users, FileText, WifiOff, AlertTriangle } from "lucide-react";

interface SensorTelemetryBlockProps {
  sensorId: number | string | undefined | null;
}

export function SensorStateBadge({ state }: { state: string | null }) {
  if (!state) return null;
  if (state === "Корректные данные") {
    return (
      <Badge variant="outline" className="text-green-600 border-green-600 dark:text-green-400 dark:border-green-400" data-testid="badge-sensor-state">
        ● {state}
      </Badge>
    );
  }
  if (state === "Отклонение от норматива") {
    return (
      <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-400 dark:border-yellow-400" data-testid="badge-sensor-state">
        ● {state}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-red-600 border-red-600 dark:text-red-400 dark:border-red-400" data-testid="badge-sensor-state">
      ● {state}
    </Badge>
  );
}

function formatVal(val: number | null | undefined, unit: string) {
  if (val == null) return "—";
  return `${val.toFixed(2)} ${unit}`;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("ru-RU");
  } catch {
    return dateStr;
  }
}

export function SensorTelemetryBlock({ sensorId }: SensorTelemetryBlockProps) {
  const reading = useSensorDataBySensorId(sensorId);

  if (sensorId == null || sensorId === "") {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30 border border-border text-sm text-muted-foreground" data-testid="sensor-no-id">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>Датчик не привязан. Укажите <span className="font-mono font-semibold">sensor_id</span> в атрибутах объекта.</span>
      </div>
    );
  }

  if (!reading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30 border border-border text-sm text-muted-foreground" data-testid="sensor-no-data">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Нет данных для датчика <span className="font-mono font-semibold">#{sensorId}</span>. Выполните синхронизацию в настройках.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sensor-telemetry-block">
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <SensorStateBadge state={reading.sensorsState} />
          {reading.sensorDate && (
            <span className="text-xs text-muted-foreground">
              Обновлено: {formatDate(reading.sensorDate)}
            </span>
          )}
        </div>

        {reading.nameKoteln && (
          <p className="text-xs font-medium" data-testid="text-sensor-name">{reading.nameKoteln}</p>
        )}
        {reading.address && (
          <p className="text-xs text-muted-foreground" data-testid="text-sensor-address">{reading.address}</p>
        )}
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Thermometer className="h-3 w-3" />
              <span>Темп. подача</span>
            </div>
            <div className="text-sm font-semibold" data-testid="text-t-forward">
              {formatVal(reading.tForward, "°C")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Thermometer className="h-3 w-3" />
              <span>Темп. обратка</span>
            </div>
            <div className="text-sm font-semibold" data-testid="text-t-reverse">
              {formatVal(reading.tReverse, "°C")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Gauge className="h-3 w-3" />
              <span>Давл. подача</span>
            </div>
            <div className="text-sm font-semibold" data-testid="text-p-forward">
              {formatVal(reading.pForward, "МПа")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Gauge className="h-3 w-3" />
              <span>Давл. обратка</span>
            </div>
            <div className="text-sm font-semibold" data-testid="text-p-revers">
              {formatVal(reading.pRevers, "МПа")}
            </div>
          </div>
        </div>

        {((reading.mkdCount != null && reading.mkdCount > 0) || (reading.mkdPeopleCount != null && reading.mkdPeopleCount > 0)) && (
          <div className="border-t border-border/50 pt-2 flex gap-4 flex-wrap">
            {reading.mkdCount != null && reading.mkdCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Building className="h-3 w-3" />
                <span data-testid="text-mkd-count">МКД: {reading.mkdCount}</span>
              </div>
            )}
            {reading.mkdPeopleCount != null && reading.mkdPeopleCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span data-testid="text-people-count">Жителей: {reading.mkdPeopleCount}</span>
              </div>
            )}
          </div>
        )}

        {reading.activeClaims && reading.activeClaims.length > 0 && (
          <div className="border-t border-border/50 pt-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <FileText className="h-3 w-3" />
              <span>Активные заявки:</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {reading.activeClaims.map(id => (
                <Badge key={id} variant="secondary" className="text-xs" data-testid={`badge-claim-${id}`}>
                  #{id}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
