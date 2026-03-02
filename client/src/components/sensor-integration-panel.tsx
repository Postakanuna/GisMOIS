import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Pencil, RefreshCw, Wifi, WifiOff, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SensorObjectBinding, SensorReading } from "@/hooks/use-sensor-data";

interface SensorConfig {
  id: number;
  apiUrl: string;
  apiToken: string;
  pollingIntervalMinutes: number;
  isEnabled: number;
  lastSyncAt: string | null;
}

interface EditableLayer {
  id: number;
  name: string;
  networkType: string | null;
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  source: "Источник",
  ctp: "ЦТП",
  consumer: "Потребитель",
};

function sensorStateBadge(state: string | null) {
  if (!state) return <Badge variant="outline" className="text-muted-foreground">Нет данных</Badge>;
  if (state === "Корректные данные") return <Badge variant="outline" className="text-green-600 border-green-600">{state}</Badge>;
  if (state === "Отклонение от норматива") return <Badge variant="outline" className="text-yellow-600 border-yellow-600">{state}</Badge>;
  return <Badge variant="outline" className="text-red-600 border-red-600">{state}</Badge>;
}

export function SensorIntegrationPanel() {
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [editingBinding, setEditingBinding] = useState<SensorObjectBinding | null>(null);
  const [bindingForm, setBindingForm] = useState({
    idCdsKoteln: "",
    objectType: "ctp",
    layerId: "",
    objectName: "",
  });

  const { data: config, isLoading: configLoading } = useQuery<SensorConfig | null>({
    queryKey: ["/api/admin/sensor-integration/config"],
  });

  const { data: bindings, isLoading: bindingsLoading } = useQuery<SensorObjectBinding[]>({
    queryKey: ["/api/admin/sensor-integration/bindings"],
  });

  const { data: readings } = useQuery<SensorReading[]>({
    queryKey: ["/api/sensor-readings"],
    staleTime: 60_000,
  });

  const { data: layers } = useQuery<EditableLayer[]>({
    queryKey: ["/api/layers"],
    staleTime: 120_000,
  });

  const [localConfig, setLocalConfig] = useState<Partial<SensorConfig>>({});

  const effectiveConfig = { ...config, ...localConfig };

  const saveConfigMutation = useMutation({
    mutationFn: async (data: Partial<SensorConfig>) => {
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
        apiUrl: effectiveConfig.apiUrl || config?.apiUrl,
        apiToken: effectiveConfig.apiToken || config?.apiToken,
      });
    },
    onSuccess: (res: any) => {
      if (res.success) {
        toast({ title: "Подключение успешно", description: `Всего объектов: ${res.total ?? "—"}` });
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
        toast({ title: "Синхронизация выполнена", description: `Синхронизировано объектов: ${res.synced}` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createBindingMutation = useMutation({
    mutationFn: async (data: typeof bindingForm) => {
      return await apiRequest("POST", "/api/admin/sensor-integration/bindings", {
        idCdsKoteln: Number(data.idCdsKoteln),
        objectType: data.objectType,
        layerId: Number(data.layerId),
        objectName: data.objectName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sensor-integration/bindings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sensor-bindings"] });
      setBindingDialogOpen(false);
      toast({ title: "Привязка создана" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const updateBindingMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof bindingForm }) => {
      return await apiRequest("PUT", `/api/admin/sensor-integration/bindings/${id}`, {
        idCdsKoteln: Number(data.idCdsKoteln),
        objectType: data.objectType,
        layerId: Number(data.layerId),
        objectName: data.objectName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sensor-integration/bindings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sensor-bindings"] });
      setBindingDialogOpen(false);
      setEditingBinding(null);
      toast({ title: "Привязка обновлена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteBindingMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/sensor-integration/bindings/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sensor-integration/bindings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sensor-bindings"] });
      toast({ title: "Привязка удалена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  function openAddBinding() {
    setEditingBinding(null);
    setBindingForm({ idCdsKoteln: "", objectType: "ctp", layerId: "", objectName: "" });
    setBindingDialogOpen(true);
  }

  function openEditBinding(b: SensorObjectBinding) {
    setEditingBinding(b);
    setBindingForm({
      idCdsKoteln: String(b.idCdsKoteln),
      objectType: b.objectType,
      layerId: String(b.layerId),
      objectName: b.objectName,
    });
    setBindingDialogOpen(true);
  }

  function handleSaveBinding() {
    if (!bindingForm.idCdsKoteln || !bindingForm.layerId) return;
    if (editingBinding) {
      updateBindingMutation.mutate({ id: editingBinding.id, data: bindingForm });
    } else {
      createBindingMutation.mutate(bindingForm);
    }
  }

  const handleToggleEnabled = (checked: boolean) => {
    setLocalConfig(prev => ({ ...prev, isEnabled: checked ? 1 : 0 }));
  };

  const handleSaveConfig = () => {
    const payload: Record<string, unknown> = {};
    if (localConfig.apiUrl !== undefined) payload.apiUrl = localConfig.apiUrl;
    if (localConfig.apiToken !== undefined) payload.apiToken = localConfig.apiToken;
    if (localConfig.pollingIntervalMinutes !== undefined) payload.pollingIntervalMinutes = localConfig.pollingIntervalMinutes;
    if (localConfig.isEnabled !== undefined) payload.isEnabled = localConfig.isEnabled === 1;
    saveConfigMutation.mutate(payload as any);
  };

  const isEnabled = effectiveConfig.isEnabled === 1;
  const networkLayers = (layers || []).filter(l => l.networkType && ["source", "ctp", "consumer"].includes(l.networkType));
  const cacheCount = readings?.length ?? 0;

  const getReadingForBinding = (b: SensorObjectBinding) =>
    readings?.find(r => r.idCdsKoteln === b.idCdsKoteln);

  if (configLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Config section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Настройки подключения
          </CardTitle>
          <CardDescription>
            Подключение к внешнему API для получения данных датчиков температуры и давления (mvitu.arki.mosreg.ru)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label>Включить интеграцию датчиков</Label>
                <p className="text-sm text-muted-foreground">
                  Автоматически получать данные о температуре и давлении с объектов ТИ
                </p>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={handleToggleEnabled}
                data-testid="switch-sensor-enabled"
              />
            </div>

            <div className="space-y-2">
              <Label>API URL</Label>
              <Input
                value={effectiveConfig.apiUrl ?? "https://mvitu.arki.mosreg.ru/api/edds/bot/koteln_last_sensors_state/index.php"}
                onChange={e => setLocalConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                placeholder="https://mvitu.arki.mosreg.ru/api/edds/bot/koteln_last_sensors_state/index.php"
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

            <div className="text-sm text-muted-foreground space-y-1">
              {config?.lastSyncAt && (
                <p>Последняя синхронизация: {new Date(config.lastSyncAt).toLocaleString("ru-RU")}</p>
              )}
              <p>Объектов в кэше: <span className="font-medium">{cacheCount}</span></p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSaveConfig}
                disabled={saveConfigMutation.isPending || Object.keys(localConfig).length === 0}
                data-testid="button-save-sensor-config"
              >
                {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Сохранить настройки
              </Button>
              <Button
                variant="outline"
                onClick={() => testConnectionMutation.mutate()}
                disabled={testConnectionMutation.isPending}
                data-testid="button-test-sensor-connection"
              >
                {testConnectionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Проверить подключение
              </Button>
              <Button
                variant="outline"
                onClick={() => syncNowMutation.mutate()}
                disabled={syncNowMutation.isPending}
                data-testid="button-sync-sensors-now"
              >
                {syncNowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Синхронизировать сейчас
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bindings section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Привязка объектов к датчикам</CardTitle>
              <CardDescription className="mt-1">
                Свяжите слои карты (Источник, ЦТП, Потребитель) с объектами внешней системы мониторинга
              </CardDescription>
            </div>
            <Button onClick={openAddBinding} data-testid="button-add-sensor-binding">
              <Plus className="h-4 w-4 mr-2" />
              Добавить привязку
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bindingsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !bindings?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Нет привязок. Нажмите «Добавить привязку», чтобы связать объект карты с датчиком.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID датчика</TableHead>
                  <TableHead>Объект ТИ</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Слой карты</TableHead>
                  <TableHead>Статус датчика</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bindings.map(b => {
                  const reading = getReadingForBinding(b);
                  const layer = (layers || []).find(l => l.id === b.layerId);
                  return (
                    <TableRow key={b.id} data-testid={`row-sensor-binding-${b.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-koteln-id-${b.id}`}>
                        {b.idCdsKoteln}
                      </TableCell>
                      <TableCell data-testid={`text-binding-name-${b.id}`}>
                        <div className="text-sm font-medium">{b.objectName || reading?.nameKoteln || "—"}</div>
                        {reading?.address && (
                          <div className="text-xs text-muted-foreground">{reading.address}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{OBJECT_TYPE_LABELS[b.objectType] ?? b.objectType}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {layer?.name ?? `Слой #${b.layerId}`}
                      </TableCell>
                      <TableCell>
                        {sensorStateBadge(reading?.sensorsState ?? null)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditBinding(b)}
                            data-testid={`button-edit-binding-${b.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteBindingMutation.mutate(b.id)}
                            disabled={deleteBindingMutation.isPending}
                            data-testid={`button-delete-binding-${b.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Binding Dialog */}
      <Dialog open={bindingDialogOpen} onOpenChange={setBindingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBinding ? "Редактировать привязку" : "Добавить привязку"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>ID датчика (id_cds_koteln)</Label>
              <Input
                type="number"
                value={bindingForm.idCdsKoteln}
                onChange={e => setBindingForm(prev => ({ ...prev, idCdsKoteln: e.target.value }))}
                placeholder="Например: 10170"
                data-testid="input-binding-koteln-id"
              />
              {readings && readings.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Или выбрать из кэша:</Label>
                  <Select onValueChange={val => {
                    const r = readings.find(r => String(r.idCdsKoteln) === val);
                    if (r) setBindingForm(prev => ({
                      ...prev,
                      idCdsKoteln: String(r.idCdsKoteln),
                      objectName: prev.objectName || r.nameKoteln || "",
                    }));
                  }}>
                    <SelectTrigger data-testid="select-reading-from-cache">
                      <SelectValue placeholder="Выбрать объект из кэша..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {readings.map(r => (
                        <SelectItem key={r.idCdsKoteln} value={String(r.idCdsKoteln)}>
                          <span className="font-mono text-xs mr-2">{r.idCdsKoteln}</span>
                          {r.nameKoteln || r.address || "—"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Тип объекта</Label>
              <Select
                value={bindingForm.objectType}
                onValueChange={val => setBindingForm(prev => ({ ...prev, objectType: val }))}
              >
                <SelectTrigger data-testid="select-binding-object-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="source">Источник</SelectItem>
                  <SelectItem value="ctp">ЦТП</SelectItem>
                  <SelectItem value="consumer">Потребитель</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Слой карты</Label>
              {networkLayers.length > 0 ? (
                <Select
                  value={bindingForm.layerId}
                  onValueChange={val => setBindingForm(prev => ({ ...prev, layerId: val }))}
                >
                  <SelectTrigger data-testid="select-binding-layer">
                    <SelectValue placeholder="Выберите слой..." />
                  </SelectTrigger>
                  <SelectContent>
                    {networkLayers.map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name} ({OBJECT_TYPE_LABELS[l.networkType!] ?? l.networkType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
                  value={bindingForm.layerId}
                  onChange={e => setBindingForm(prev => ({ ...prev, layerId: e.target.value }))}
                  placeholder="ID слоя карты"
                  data-testid="input-binding-layer-id"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label>Название объекта (необязательно)</Label>
              <Input
                value={bindingForm.objectName}
                onChange={e => setBindingForm(prev => ({ ...prev, objectName: e.target.value }))}
                placeholder="ЦТП №1 кот. «Восточная»"
                data-testid="input-binding-object-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindingDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSaveBinding}
              disabled={!bindingForm.idCdsKoteln || !bindingForm.layerId || createBindingMutation.isPending || updateBindingMutation.isPending}
              data-testid="button-save-binding"
            >
              {(createBindingMutation.isPending || updateBindingMutation.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
