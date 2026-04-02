import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers, Loader2, CheckCircle2, GitMerge } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface EditableLayer {
  id: number;
  name: string;
  geometryType: string;
}

interface SpatialJoinResult {
  success: boolean;
  processedDistricts: number;
  updatedDistricts: number;
  totalSitesFound: number;
  sitesFieldName: string;
  sumFieldName: string;
}

interface SpatialJoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editableLayers: EditableLayer[];
}

export function SpatialJoinDialog({ open, onOpenChange, editableLayers }: SpatialJoinDialogProps) {
  const { toast } = useToast();

  const [baseLayerId, setBaseLayerId] = useState<string>("");
  const [enrichLayerId, setEnrichLayerId] = useState<string>("");
  const [sumField, setSumField] = useState<string>("AccidentCount");
  const [sitesFieldName, setSitesFieldName] = useState<string>("acc_sites");
  const [sumFieldName, setSumFieldName] = useState<string>("acc_total");
  const [result, setResult] = useState<SpatialJoinResult | null>(null);

  const polygonLayers = editableLayers.filter(l =>
    l.geometryType?.toLowerCase().includes("polygon")
  );

  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analytics/spatial-join", {
        baseLayerId: Number(baseLayerId),
        enrichLayerId: Number(enrichLayerId),
        sumField: sumField.trim() || undefined,
        sitesFieldName: sitesFieldName.trim() || "acc_sites",
        sumFieldName: sumFieldName.trim() || "acc_total",
      });
      return res as SpatialJoinResult;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: "Пространственное объединение выполнено",
        description: `Обновлено ${data.updatedDistricts} округов. Найдено ${data.totalSitesFound} пересечений с аварийными участками.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Ошибка",
        description: err?.message || "Не удалось выполнить пространственное объединение",
        variant: "destructive",
      });
    },
  });

  const canRun = baseLayerId && enrichLayerId && baseLayerId !== enrichLayerId;

  return (
    <DraggableModal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Пространственное объединение слоёв"
      headerIcon={<GitMerge className="h-4 w-4" />}
      defaultWidth={480}
      autoHeight
    >
      <div className="space-y-5 p-1">
        <p className="text-sm text-muted-foreground">
          Для каждого полигона базового слоя (городские округа) найдёт пересекающиеся объекты
          из слоя аварийности, подсчитает их количество и просуммирует указанное поле.
          Результат запишется в атрибуты базового слоя.
        </p>

        {/* Base layer */}
        <div className="space-y-1.5">
          <Label>Базовый слой (городские округа)</Label>
          <Select value={baseLayerId} onValueChange={setBaseLayerId}>
            <SelectTrigger data-testid="select-base-layer">
              <SelectValue placeholder="Выберите слой округов..." />
            </SelectTrigger>
            <SelectContent>
              {polygonLayers.map(l => (
                <SelectItem key={l.id} value={String(l.id)}>
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    {l.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Enrich layer */}
        <div className="space-y-1.5">
          <Label>Слой аварийных участков</Label>
          <Select value={enrichLayerId} onValueChange={setEnrichLayerId}>
            <SelectTrigger data-testid="select-enrich-layer">
              <SelectValue placeholder="Выберите слой аварийности..." />
            </SelectTrigger>
            <SelectContent>
              {polygonLayers.map(l => (
                <SelectItem key={l.id} value={String(l.id)}>
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    {l.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Field to sum */}
        <div className="space-y-1.5">
          <Label>Поле для суммирования</Label>
          <Input
            data-testid="input-sum-field"
            placeholder="AccidentCount"
            value={sumField}
            onChange={e => setSumField(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Название поля из слоя аварийности, значения которого нужно суммировать.
          </p>
        </div>

        {/* Output field names */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Поле: кол-во участков</Label>
              <Input
                data-testid="input-sites-field-name"
                placeholder="acc_sites"
                value={sitesFieldName}
                maxLength={10}
                onChange={e => setSitesFieldName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Поле: сумма аварий</Label>
              <Input
                data-testid="input-sum-field-name"
                placeholder="acc_total"
                value={sumFieldName}
                maxLength={10}
                onChange={e => setSumFieldName(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Имена полей ограничены 10 символами для совместимости с форматом SHP.
          </p>
        </div>

        {/* Result panel */}
        {result && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium text-sm">
              <CheckCircle2 className="h-4 w-4" />
              Объединение выполнено успешно
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">Обработано округов:</div>
              <div className="font-medium">{result.processedDistricts}</div>
              <div className="text-muted-foreground">Обновлено округов:</div>
              <div className="font-medium">{result.updatedDistricts}</div>
              <div className="text-muted-foreground">Всего пересечений:</div>
              <div className="font-medium">{result.totalSitesFound}</div>
              <div className="text-muted-foreground">Поле участков:</div>
              <div className="font-mono text-xs font-medium">{result.sitesFieldName}</div>
              <div className="text-muted-foreground">Поле аварий:</div>
              <div className="font-mono text-xs font-medium">{result.sumFieldName}</div>
            </div>
          </div>
        )}

        {/* Run button */}
        <Button
          className="w-full"
          disabled={!canRun || joinMutation.isPending}
          onClick={() => { setResult(null); joinMutation.mutate(); }}
          data-testid="button-run-spatial-join"
        >
          {joinMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Выполняется анализ...
            </>
          ) : (
            <>
              <GitMerge className="h-4 w-4 mr-2" />
              Выполнить объединение
            </>
          )}
        </Button>
      </div>
    </DraggableModal>
  );
}
