import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  MapPin,
  Thermometer,
  Building2,
  Ruler,
  GitBranch,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Pipette,
  Save,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

interface AiTraceParams {
  pipeDiameterSupply: string;
  pipeDiameterReturn: string;
  pipeType: string;
  layingMethod: string;
  flowRate: number;
  velocity: number;
  pressureLoss: number;
  compensators: number;
  valves: number;
  heatChambers: Array<{
    coordinates: [number, number];
    name: string;
    reason: string;
  }>;
  recommendations: string[];
}

interface AutoTraceResult {
  success: boolean;
  connectionPoint: {
    name: string;
    type: string;
    coordinates: [number, number];
    distance: number;
    featureId: number;
    layerId: number;
  };
  route: {
    coordinates: [number, number][];
    totalLength: number;
    turningAngles: Array<{
      angle: number;
      coordinates: [number, number];
    }>;
    segments: Array<{
      from: [number, number];
      to: [number, number];
      length: number;
      name: string;
    }>;
  };
  heatChambers: Array<{
    coordinates: [number, number];
    name: string;
    reason: string;
  }>;
  aiParams: AiTraceParams | null;
  message?: string;
}

interface ConsumerConnectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  consumerCoords: [number, number] | null;
  sceneId: number;
  onTraceResult: (result: AutoTraceResult) => void;
  onConfirm: (result: AutoTraceResult, consumerData: ConsumerFormData) => void;
}

export interface ConsumerFormData {
  name: string;
  address: string;
  buildingType: string;
  floors: number;
  qo: number;
  qgv: number;
  qsv: number;
}

export function ConsumerConnectDialog({
  isOpen,
  onClose,
  consumerCoords,
  sceneId,
  onTraceResult,
  onConfirm,
}: ConsumerConnectDialogProps) {
  const [formData, setFormData] = useState<ConsumerFormData>({
    name: "",
    address: "",
    buildingType: "residential",
    floors: 5,
    qo: 0,
    qgv: 0,
    qsv: 0,
  });

  const [traceResult, setTraceResult] = useState<AutoTraceResult | null>(null);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [showRouteDetails, setShowRouteDetails] = useState(false);
  const [layerName, setLayerName] = useState("");
  const [showSaveLayer, setShowSaveLayer] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { toast } = useToast();

  const traceMutation = useMutation({
    mutationFn: async (data: {
      consumerCoords: [number, number];
      sceneId: number;
      consumer: ConsumerFormData;
    }) => {
      const response = await apiRequest("POST", "/api/auto-trace", data);
      return response.json() as Promise<AutoTraceResult>;
    },
    onSuccess: (result) => {
      setTraceResult(result);
      onTraceResult(result);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: {
      sceneId: number;
      layerName: string;
      route: AutoTraceResult["route"];
      heatChambers: AutoTraceResult["heatChambers"];
      consumerCoords: [number, number];
      connectionPoint: AutoTraceResult["connectionPoint"];
      aiParams: AutoTraceResult["aiParams"];
      consumer: ConsumerFormData;
    }) => {
      const response = await apiRequest("POST", "/api/auto-trace/save-layer", data);
      return response.json();
    },
    onSuccess: (result) => {
      toast({ title: "Слои созданы", description: result.message });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/scenes/${sceneId}/editable-layers`] });
      setShowSaveLayer(false);
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось сохранить слой", variant: "destructive" });
    },
  });

  const handleTrace = () => {
    if (!consumerCoords) return;
    traceMutation.mutate({
      consumerCoords,
      sceneId,
      consumer: formData,
    });
  };

  const handleSaveLayer = () => {
    if (!traceResult || !consumerCoords || !layerName.trim()) return;
    saveMutation.mutate({
      sceneId,
      layerName: layerName.trim(),
      route: traceResult.route,
      heatChambers: traceResult.heatChambers,
      consumerCoords,
      connectionPoint: traceResult.connectionPoint,
      aiParams: traceResult.aiParams,
      consumer: formData,
    });
  };

  const handleConfirm = () => {
    if (traceResult) {
      onConfirm(traceResult, formData);
      setConfirmed(true);
      setLayerName(formData.name || "Новая трасса");
      toast({ title: "Объект создан", description: "Потребитель добавлен на карту. Можете сохранить маршрут в отдельный слой." });
    }
  };

  const handleClose = () => {
    onClose();
    setTraceResult(null);
    setShowSaveLayer(false);
    setConfirmed(false);
    setLayerName("");
    traceMutation.reset();
    saveMutation.reset();
  };

  const updateField = (field: keyof ConsumerFormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const totalLoad = formData.qo + formData.qgv + formData.qsv;

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Подключение потребителя"
      defaultWidth={560}
      defaultHeight={520}
      minWidth={380}
      minHeight={300}
    >
      <div className="h-full flex flex-col overflow-hidden" data-testid="consumer-connect-dialog">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Создание нового потребителя с автоматической трассировкой тепловой сети
          </p>

          {consumerCoords && (
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-sm">
                Координаты: {consumerCoords[0].toFixed(6)}, {consumerCoords[1].toFixed(6)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="consumer-name">Наименование</Label>
              <Input
                id="consumer-name"
                placeholder="Жилой дом №..."
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                data-testid="input-consumer-name"
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="consumer-address">Адрес</Label>
              <Input
                id="consumer-address"
                placeholder="ул. Ленина, д. 1"
                value={formData.address}
                onChange={(e) => updateField("address", e.target.value)}
                data-testid="input-consumer-address"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="building-type">Тип здания</Label>
              <Select
                value={formData.buildingType}
                onValueChange={(v) => updateField("buildingType", v)}
              >
                <SelectTrigger id="building-type" data-testid="select-building-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Жилой дом</SelectItem>
                  <SelectItem value="social">Соц. объект</SelectItem>
                  <SelectItem value="commercial">Коммерческий</SelectItem>
                  <SelectItem value="industrial">Промышленный</SelectItem>
                  <SelectItem value="administrative">Административный</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="floors">Этажность</Label>
              <Input
                id="floors"
                type="number"
                min={1}
                max={50}
                value={formData.floors}
                onChange={(e) => updateField("floors", parseInt(e.target.value) || 1)}
                data-testid="input-floors"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Thermometer className="h-4 w-4" />
              Тепловые нагрузки (Гкал/ч)
            </Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="qo" className="text-xs text-muted-foreground">
                  Отопление (Qо)
                </Label>
                <Input
                  id="qo"
                  type="number"
                  step="0.001"
                  min={0}
                  value={formData.qo || ""}
                  onChange={(e) => updateField("qo", parseFloat(e.target.value) || 0)}
                  placeholder="0.000"
                  data-testid="input-qo"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="qgv" className="text-xs text-muted-foreground">
                  ГВС (Qгв)
                </Label>
                <Input
                  id="qgv"
                  type="number"
                  step="0.001"
                  min={0}
                  value={formData.qgv || ""}
                  onChange={(e) => updateField("qgv", parseFloat(e.target.value) || 0)}
                  placeholder="0.000"
                  data-testid="input-qgv"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="qsv" className="text-xs text-muted-foreground">
                  Вентиляция (Qсв)
                </Label>
                <Input
                  id="qsv"
                  type="number"
                  step="0.001"
                  min={0}
                  value={formData.qsv || ""}
                  onChange={(e) => updateField("qsv", parseFloat(e.target.value) || 0)}
                  placeholder="0.000"
                  data-testid="input-qsv"
                />
              </div>
            </div>
            {totalLoad > 0 && (
              <p className="text-xs text-muted-foreground">
                Суммарная нагрузка: <strong>{totalLoad.toFixed(3)}</strong> Гкал/ч
              </p>
            )}
          </div>

          {traceResult && traceResult.success && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-sm">Результаты трассировки</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Card className="p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <GitBranch className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs text-muted-foreground">Точка подключения</span>
                    </div>
                    <p className="text-sm font-medium truncate" title={traceResult.connectionPoint.name}>
                      {traceResult.connectionPoint.name}
                    </p>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {traceResult.connectionPoint.type}
                    </Badge>
                  </Card>

                  <Card className="p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Ruler className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs text-muted-foreground">Протяжённость</span>
                    </div>
                    <p className="text-sm font-medium">
                      {traceResult.route.totalLength >= 1000
                        ? `${(traceResult.route.totalLength / 1000).toFixed(2)} км`
                        : `${Math.round(traceResult.route.totalLength)} м`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {traceResult.route.segments.length} участков
                    </p>
                  </Card>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Card className="p-2.5 text-center">
                    <p className="text-xs text-muted-foreground">Повороты</p>
                    <p className="text-lg font-semibold">{traceResult.route.turningAngles.length}</p>
                  </Card>
                  <Card className="p-2.5 text-center">
                    <p className="text-xs text-muted-foreground">Тепл. камеры</p>
                    <p className="text-lg font-semibold">{traceResult.heatChambers.length}</p>
                  </Card>
                  <Card className="p-2.5 text-center">
                    <p className="text-xs text-muted-foreground">Расстояние</p>
                    <p className="text-lg font-semibold">
                      {Math.round(traceResult.connectionPoint.distance)} м
                    </p>
                  </Card>
                </div>

                <Collapsible open={showRouteDetails} onOpenChange={setShowRouteDetails}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer">
                    {showRouteDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Детали маршрута
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {traceResult.route.segments.map((seg, i) => (
                        <div key={i} className="flex justify-between text-xs p-1.5 bg-muted rounded">
                          <span className="truncate mr-2">{seg.name || `Участок ${i + 1}`}</span>
                          <span className="text-muted-foreground whitespace-nowrap">{Math.round(seg.length)} м</span>
                        </div>
                      ))}
                    </div>
                    {traceResult.heatChambers.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs font-medium">Тепловые камеры:</p>
                        {traceResult.heatChambers.map((tc, i) => (
                          <div key={i} className="flex justify-between text-xs p-1.5 bg-blue-50 dark:bg-blue-950 rounded">
                            <span>{tc.name}</span>
                            <span className="text-muted-foreground">{tc.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {traceResult.aiParams && (
                  <Collapsible open={showAiDetails} onOpenChange={setShowAiDetails}>
                    <CollapsibleTrigger className="flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer">
                      {showAiDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <Zap className="h-3.5 w-3.5" />
                      AI-расчёт параметров
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Card className="p-2">
                            <p className="text-xs text-muted-foreground">Диаметр подающей</p>
                            <p className="text-sm font-medium">{traceResult.aiParams.pipeDiameterSupply}</p>
                          </Card>
                          <Card className="p-2">
                            <p className="text-xs text-muted-foreground">Диаметр обратной</p>
                            <p className="text-sm font-medium">{traceResult.aiParams.pipeDiameterReturn}</p>
                          </Card>
                          <Card className="p-2">
                            <p className="text-xs text-muted-foreground">Тип прокладки</p>
                            <p className="text-sm font-medium">{traceResult.aiParams.layingMethod}</p>
                          </Card>
                          <Card className="p-2">
                            <p className="text-xs text-muted-foreground">Расход, т/ч</p>
                            <p className="text-sm font-medium">{traceResult.aiParams.flowRate.toFixed(2)}</p>
                          </Card>
                          <Card className="p-2">
                            <p className="text-xs text-muted-foreground">Скорость, м/с</p>
                            <p className="text-sm font-medium">{traceResult.aiParams.velocity.toFixed(2)}</p>
                          </Card>
                          <Card className="p-2">
                            <p className="text-xs text-muted-foreground">Потери давления</p>
                            <p className="text-sm font-medium">{traceResult.aiParams.pressureLoss.toFixed(1)} м.в.ст.</p>
                          </Card>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline">
                            <Pipette className="h-3 w-3 mr-1" />
                            Задвижки: {traceResult.aiParams.valves}
                          </Badge>
                          <Badge variant="outline">
                            Компенсаторы: {traceResult.aiParams.compensators}
                          </Badge>
                        </div>
                        {traceResult.aiParams.recommendations.length > 0 && (
                          <div className="mt-1">
                            <p className="text-xs font-medium mb-1">Рекомендации:</p>
                            <ul className="space-y-0.5">
                              {traceResult.aiParams.recommendations.map((rec, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                                  <span className="text-primary mt-0.5">•</span>
                                  {rec}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                <Separator />

                {confirmed && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">
                        Потребитель создан
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Объект добавлен на карту. Теперь вы можете сохранить маршрут и тепловые камеры в отдельные слои.
                      </p>
                    </div>
                  </div>
                )}

                {confirmed && !saveMutation.isSuccess && (
                  !showSaveLayer ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowSaveLayer(true)}
                      data-testid="button-show-save-layer"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Сохранить маршрут в новый слой
                    </Button>
                  ) : (
                    <div className="space-y-2 p-3 border rounded-md bg-muted/50">
                      <Label htmlFor="layer-name" className="text-sm font-medium">
                        Название слоя
                      </Label>
                      <Input
                        id="layer-name"
                        value={layerName}
                        onChange={(e) => setLayerName(e.target.value)}
                        placeholder="Подключение ..."
                        data-testid="input-layer-name"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleSaveLayer}
                          disabled={!layerName.trim() || saveMutation.isPending}
                          data-testid="button-save-layer"
                        >
                          {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowSaveLayer(false)}
                          data-testid="button-cancel-save-layer"
                        >
                          Отмена
                        </Button>
                      </div>
                    </div>
                  )
                )}

                {saveMutation.isSuccess && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Слои успешно созданы
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {traceResult && !traceResult.success && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950 rounded-md flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Трассировка не выполнена
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {traceResult.message || "Не удалось найти точку подключения к тепловой сети"}
                </p>
              </div>
            </div>
          )}

          {traceMutation.isError && (
            <div className="p-3 bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">
                Ошибка при выполнении трассировки
              </p>
            </div>
          )}
        </div>

        <div className="border-t p-3 flex justify-end gap-2 shrink-0 bg-background">
          <Button variant="outline" size="sm" onClick={handleClose} data-testid="button-cancel-consumer">
            {confirmed ? "Закрыть" : "Отмена"}
          </Button>

          {!traceResult ? (
            <Button
              size="sm"
              onClick={handleTrace}
              disabled={!consumerCoords || traceMutation.isPending || !formData.name}
              data-testid="button-run-trace"
            >
              {traceMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {traceMutation.isPending ? "Трассировка..." : "Выполнить трассировку"}
            </Button>
          ) : (
            traceResult.success && !confirmed && (
              <Button size="sm" onClick={handleConfirm} data-testid="button-confirm-consumer">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Подтвердить и создать
              </Button>
            )
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
