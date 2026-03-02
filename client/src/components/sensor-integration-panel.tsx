import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCw, Wifi, WifiOff, Activity, Info, Layers, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SensorReading } from "@/hooks/use-sensor-data";

interface SensorConfig {
  id: number;
  apiUrl: string;
  apiToken: string;
  pollingIntervalMinutes: number;
  isEnabled: number;
  isDebugMode: number;
  lastSyncAt: string | null;
}

interface EditableLayer {
  id: number;
  name: string;
  networkType: string | null;
}

const NETWORK_TYPE_LABELS: Record<string, string> = {
  source: "Источник",
  ctp: "ЦТП",
  consumer: "Потребитель",
};

export function SensorIntegrationPanel() {
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);
  const [localConfig, setLocalConfig] = useState<Partial<SensorConfig>>({});

  const { data: config, isLoading: configLoading } = useQuery<SensorConfig | null>({
    queryKey: ["/api/admin/sensor-integration/config"],
  });

  const { data: readings } = useQuery<SensorReading[]>({
    queryKey: ["/api/sensor-readings"],
    staleTime: 60_000,
  });

  const { data: layers } = useQuery<EditableLayer[]>({
    queryKey: ["/api/layers"],
    staleTime: 120_000,
  });

  const effectiveConfig = { ...config, ...localConfig };

  const saveConfigMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return await apiRequest("PUT", "/api/admin/sensor-integration/config", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sensor-integration/config"] });
      setLocalConfig({});
      toast({ title: "Настройки сохранены" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/admin/sensor-integration/test", {
        apiUrl: effectiveConfig.apiUrl ?? config?.apiUrl,
        apiToken: effectiveConfig.apiToken ?? config?.apiToken,
      });
    },
    onSuccess: (res: any) => {
      if (res.success) {
        toast({ title: "Подключение успешно", description: `Всего объектов в системе: ${res.total ?? "—"}` });
      } else {
        toast({ title: "Ошибка подключения", description: res.error, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/admin/sensor-integration/sync", {});
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sensor-integration/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sensor-readings"] });
      if (res.error) {
        toast({ title: "Ошибка синхронизации", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Синхронизация выполнена", description: `Объектов в кэше: ${res.synced}` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveConfig = () => {
    const payload: Record<string, unknown> = {};
    if (localConfig.apiUrl !== undefined) payload.apiUrl = localConfig.apiUrl;
    if (localConfig.apiToken !== undefined) payload.apiToken = localConfig.apiToken;
    if (localConfig.pollingIntervalMinutes !== undefined) payload.pollingIntervalMinutes = localConfig.pollingIntervalMinutes;
    if (localConfig.isEnabled !== undefined) payload.isEnabled = localConfig.isEnabled === 1;
    if (localConfig.isDebugMode !== undefined) payload.isDebugMode = localConfig.isDebugMode === 1;
    saveConfigMutation.mutate(payload);
  };

  const isEnabled = effectiveConfig.isEnabled === 1;
  const isDebugMode = effectiveConfig.isDebugMode === 1;
  const cacheCount = readings?.length ?? 0;
  const networkLayers = (layers || []).filter(l =>
    l.networkType && ["source", "ctp", "consumer"].includes(l.networkType)
  );

  if (configLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Настройки подключения
          </CardTitle>
          <CardDescription>
            Подключение к внешнему API мониторинга ТИ (mvitu.arki.mosreg.ru) для получения данных датчиков температуры и давления
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label>Включить интеграцию</Label>
                <p className="text-sm text-muted-foreground">
                  Автоматически получать данные с датчиков по расписанию
                </p>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={checked => setLocalConfig(prev => ({ ...prev, isEnabled: checked ? 1 : 0 }))}
                data-testid="switch-sensor-enabled"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label className="flex items-center gap-1.5">
                  <Bug className="h-3.5 w-3.5 text-muted-foreground" />
                  Режим отладки
                </Label>
                <p className="text-sm text-muted-foreground">
                  Выводить детальные логи опроса API в серверную консоль
                </p>
              </div>
              <Switch
                checked={isDebugMode}
                onCheckedChange={checked => setLocalConfig(prev => ({ ...prev, isDebugMode: checked ? 1 : 0 }))}
                data-testid="switch-sensor-debug"
              />
            </div>

            {isDebugMode && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
                <p className="font-medium">Режим отладки активен</p>
                <p className="text-muted-foreground">Подробные логи каждого запроса к API, пагинация, SSL-ошибки и статусы ответов будут выводиться в консоль сервера с тегом <span className="font-mono">[sensor-sync]</span>.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>API URL</Label>
              <Input
                value={effectiveConfig.apiUrl ?? "https://mvitu.arki.mosreg.ru/api/edds/bot/koteln_last_sensors_state/index.php"}
                onChange={e => setLocalConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                data-testid="input-sensor-api-url"
              />
            </div>

            <div className="space-y-2">
              <Label>API Токен (HTTP-X-API-TOKEN)</Label>
              <div className="flex gap-2">
                <Input
                  type={showToken ? "text" : "password"}
                  value={effectiveConfig.apiToken ?? ""}
                  onChange={e => setLocalConfig(prev => ({ ...prev, apiToken: e.target.value }))}
                  placeholder="Введите токен доступа"
                  data-testid="input-sensor-api-token"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken(v => !v)}
                  data-testid="button-toggle-token-visibility"
                >
                  {showToken ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Интервал синхронизации (минуты)</Label>
              <Input
                type="number"
                min={5}
                value={effectiveConfig.pollingIntervalMinutes ?? 15}
                onChange={e => setLocalConfig(prev => ({ ...prev, pollingIntervalMinutes: Number(e.target.value) }))}
                className="max-w-[160px]"
                data-testid="input-sensor-interval"
              />
            </div>

            <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-sm space-y-1">
              {config?.lastSyncAt ? (
                <p className="text-muted-foreground">
                  Последняя синхронизация: <span className="font-medium text-foreground">{new Date(config.lastSyncAt).toLocaleString("ru-RU")}</span>
                </p>
              ) : (
                <p className="text-muted-foreground">Синхронизация ещё не выполнялась</p>
              )}
              <p className="text-muted-foreground">
                Объектов в кэше: <span className="font-medium text-foreground">{cacheCount}</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSaveConfig}
                disabled={saveConfigMutation.isPending || Object.keys(localConfig).length === 0}
                data-testid="button-save-sensor-config"
              >
                {saveConfigMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Сохранить
              </Button>
              <Button
                variant="outline"
                onClick={() => testConnectionMutation.mutate()}
                disabled={testConnectionMutation.isPending}
                data-testid="button-test-sensor-connection"
              >
                {testConnectionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Проверить подключение
              </Button>
              <Button
                variant="outline"
                onClick={() => syncNowMutation.mutate()}
                disabled={syncNowMutation.isPending}
                data-testid="button-sync-sensors-now"
              >
                {syncNowMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <RefreshCw className="h-4 w-4 mr-2" />
                }
                Синхронизировать сейчас
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* How to bind */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Как привязать объект к датчику
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Откройте таблицу атрибутов нужного слоя (Источник / ЦТП / Потребитель) на странице карты.
              </li>
              <li>
                Добавьте поле <span className="font-mono font-semibold text-foreground">sensor_id</span> (тип: Число) через редактор схемы слоя — кнопка <span className="font-medium text-foreground">«Схема»</span> в таблице атрибутов.
              </li>
              <li>
                Заполните значение <span className="font-mono font-semibold text-foreground">sensor_id</span> для каждого объекта — это идентификатор объекта ТИ из системы мониторинга (<span className="font-mono">id_cds_koteln</span>).
              </li>
              <li>
                После синхронизации данных — кликните объект на карте и откройте вкладку <span className="font-medium text-foreground">«Телеметрия»</span> в информационном окне.
              </li>
            </ol>

            <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">Где найти id_cds_koteln?</p>
              <p>Выполните синхронизацию, затем найдите ID нужного объекта в кэше. ID отображается в ответе API и соответствует конкретному объекту ТИ (котельной или ЦТП) в системе мониторинга Московской области.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Network layers info */}
      {networkLayers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Сетевые слои карты
            </CardTitle>
            <CardDescription>
              Слои с заданным сетевым типом — к ним можно привязывать датчики
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {networkLayers.map(layer => (
                <div key={layer.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0" data-testid={`row-network-layer-${layer.id}`}>
                  <span className="text-sm font-medium">{layer.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {NETWORK_TYPE_LABELS[layer.networkType!] ?? layer.networkType}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
