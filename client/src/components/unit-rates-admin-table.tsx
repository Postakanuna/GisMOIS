import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Save } from "lucide-react";

interface CostUnitRate {
  id: number;
  objectType: string;
  layingType: string | null;
  diameterMm: number | null;
  workType: string;
  pricePerUnit: string;
  unit: string;
  baseYear: number;
  notes: string | null;
}

interface EditableRate extends CostUnitRate {
  _dirty?: boolean;
  _new?: boolean;
}

const WORK_TYPES = ["overhaul", "reconstruction"] as const;
const LAYING_TYPES = ["underground", "above"] as const;

function PipeRatesTable({
  rates,
  baseYear,
  onSave,
  isSaving,
}: {
  rates: CostUnitRate[];
  baseYear: number;
  onSave: (rates: EditableRate[]) => void;
  isSaving: boolean;
}) {
  const { toast } = useToast();
  const pipeRates = rates.filter(r => r.objectType === "pipe");

  const diameters = Array.from(new Set(pipeRates.map(r => r.diameterMm).filter(Boolean) as number[])).sort((a, b) => a - b);

  const [localRates, setLocalRates] = useState<EditableRate[]>(() =>
    pipeRates.map(r => ({ ...r }))
  );
  const [newDiameter, setNewDiameter] = useState("");

  const getRate = (diam: number, workType: string, layingType: string) =>
    localRates.find(r => r.diameterMm === diam && r.workType === workType && r.layingType === layingType);

  const setPrice = (diam: number, workType: string, layingType: string, value: string) => {
    setLocalRates(prev => prev.map(r =>
      r.diameterMm === diam && r.workType === workType && r.layingType === layingType
        ? { ...r, pricePerUnit: value, _dirty: true }
        : r
    ));
  };

  const addDiameter = () => {
    const d = parseInt(newDiameter);
    if (isNaN(d) || d <= 0) {
      toast({ title: "Введите корректный диаметр (мм)", variant: "destructive" });
      return;
    }
    if (localRates.some(r => r.diameterMm === d)) {
      toast({ title: `Диаметр ${d} мм уже существует`, variant: "destructive" });
      return;
    }
    const newRows: EditableRate[] = [];
    for (const layingType of LAYING_TYPES) {
      for (const workType of WORK_TYPES) {
        newRows.push({
          id: -(Math.random() * 100000 | 0),
          objectType: "pipe",
          layingType,
          diameterMm: d,
          workType,
          pricePerUnit: "0",
          unit: "rub_per_m",
          baseYear,
          notes: null,
          _dirty: true,
          _new: true,
        });
      }
    }
    setLocalRates(prev => [...prev, ...newRows]);
    setNewDiameter("");
  };

  const removeDiameter = (diam: number) => {
    setLocalRates(prev => prev.filter(r => r.diameterMm !== diam));
  };

  const allDiameters = Array.from(new Set(localRates.map(r => r.diameterMm).filter(Boolean) as number[])).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left p-2 border border-border font-medium" rowSpan={2}>Д, мм</th>
              <th className="text-center p-2 border border-border font-medium" colSpan={2}>Подземная, руб./м</th>
              <th className="text-center p-2 border border-border font-medium" colSpan={2}>Надземная, руб./м</th>
              <th className="p-2 border border-border" rowSpan={2}></th>
            </tr>
            <tr className="bg-muted/30">
              <th className="text-center p-2 border border-border text-xs font-medium">Капремонт</th>
              <th className="text-center p-2 border border-border text-xs font-medium">Реконструкция</th>
              <th className="text-center p-2 border border-border text-xs font-medium">Капремонт</th>
              <th className="text-center p-2 border border-border text-xs font-medium">Реконструкция</th>
            </tr>
          </thead>
          <tbody>
            {allDiameters.map(diam => (
              <tr key={diam} className="hover:bg-muted/20">
                <td className="p-2 border border-border font-medium text-center">{diam}</td>
                {(["underground", "above"] as const).map(laying =>
                  (["overhaul", "reconstruction"] as const).map(wt => {
                    const r = getRate(diam, wt, laying);
                    return (
                      <td key={`${laying}-${wt}`} className="p-1 border border-border">
                        <Input
                          type="number"
                          value={r?.pricePerUnit ?? ""}
                          onChange={e => setPrice(diam, wt, laying, e.target.value)}
                          className="h-7 text-right text-xs w-full min-w-[90px]"
                          data-testid={`input-rate-pipe-${diam}-${laying}-${wt}`}
                        />
                      </td>
                    );
                  })
                )}
                <td className="p-1 border border-border text-center">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" data-testid={`button-delete-diameter-${diam}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Удалить диаметр {diam} мм?</AlertDialogTitle>
                        <AlertDialogDescription>Все строки для диаметра {diam} мм будут удалены.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeDiameter(diam)}>Удалить</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder="Диаметр, мм"
          value={newDiameter}
          onChange={e => setNewDiameter(e.target.value)}
          className="w-32 h-8"
          data-testid="input-new-diameter"
        />
        <Button size="sm" variant="outline" onClick={addDiameter} data-testid="button-add-diameter">
          <Plus className="h-3 w-3 mr-1" /> Добавить диаметр
        </Button>
      </div>

      <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
        Единица измерения: руб. за 1 м (двухтрубная прокладка)
      </div>

      <div className="flex justify-end">
        <Button onClick={() => onSave(localRates)} disabled={isSaving} data-testid="button-save-pipe-rates">
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Сохранить изменения
        </Button>
      </div>
    </div>
  );
}

function SimpleRatesTable({
  rates,
  objectType,
  baseYear,
  onSave,
  isSaving,
}: {
  rates: CostUnitRate[];
  objectType: string;
  baseYear: number;
  onSave: (rates: EditableRate[]) => void;
  isSaving: boolean;
}) {
  const filtered = rates.filter(r => r.objectType === objectType);
  const [localRates, setLocalRates] = useState<EditableRate[]>(() => {
    const existing = filtered.map(r => ({ ...r }));
    const result: EditableRate[] = [];
    for (const wt of WORK_TYPES) {
      const found = existing.find(r => r.workType === wt);
      result.push(found ?? {
        id: -(Math.random() * 100000 | 0),
        objectType,
        layingType: null,
        diameterMm: null,
        workType: wt,
        pricePerUnit: "0",
        unit: "rub_per_mw",
        baseYear,
        notes: null,
        _new: true,
        _dirty: true,
      });
    }
    return result;
  });

  const setPrice = (workType: string, value: string) => {
    setLocalRates(prev => prev.map(r => r.workType === workType ? { ...r, pricePerUnit: value, _dirty: true } : r));
  };
  const setNotes = (workType: string, value: string) => {
    setLocalRates(prev => prev.map(r => r.workType === workType ? { ...r, notes: value, _dirty: true } : r));
  };

  const workTypeLabel: Record<string, string> = { overhaul: "Капремонт", reconstruction: "Реконструкция" };

  return (
    <div className="space-y-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left p-2 border border-border font-medium">Тип работ</th>
            <th className="text-left p-2 border border-border font-medium">Стоимость, руб./МВт</th>
            <th className="text-left p-2 border border-border font-medium">Примечание</th>
          </tr>
        </thead>
        <tbody>
          {localRates.map(r => (
            <tr key={r.workType} className="hover:bg-muted/20">
              <td className="p-2 border border-border font-medium">{workTypeLabel[r.workType] ?? r.workType}</td>
              <td className="p-1 border border-border">
                <Input
                  type="number"
                  value={r.pricePerUnit}
                  onChange={e => setPrice(r.workType, e.target.value)}
                  className="h-7 text-right w-full"
                  data-testid={`input-rate-${objectType}-${r.workType}`}
                />
              </td>
              <td className="p-1 border border-border">
                <Input
                  value={r.notes ?? ""}
                  onChange={e => setNotes(r.workType, e.target.value)}
                  className="h-7 w-full"
                  placeholder="Примечание..."
                  data-testid={`input-notes-${objectType}-${r.workType}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
        Единица измерения: руб. за 1 МВт установленной мощности
      </div>
      <div className="flex justify-end">
        <Button onClick={() => onSave(localRates)} disabled={isSaving} data-testid={`button-save-${objectType}-rates`}>
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Сохранить изменения
        </Button>
      </div>
    </div>
  );
}

export function UnitRatesAdminTable() {
  const { toast } = useToast();
  const [baseYear] = useState(2025);

  const { data: rates = [], isLoading } = useQuery<CostUnitRate[]>({
    queryKey: ["/api/unit-rates"],
  });

  const [isSaving, setIsSaving] = useState(false);

  const saveRates = useCallback(async (localRates: EditableRate[]) => {
    setIsSaving(true);
    try {
      const ops: Promise<any>[] = [];
      for (const r of localRates) {
        if (!r._dirty) continue;
        if (r._new && r.id < 0) {
          const { id, _dirty, _new, ...data } = r;
          ops.push(apiRequest("POST", "/api/unit-rates", data).then(r => r.json()));
        } else if (r._dirty) {
          const { _dirty, _new, ...data } = r;
          ops.push(apiRequest("PATCH", `/api/unit-rates/${r.id}`, data).then(r => r.json()));
        }
      }

      // Find deleted rates (rates that existed before but not in localRates)
      const existingIds = rates.map(r => r.id);
      const currentIds = new Set(localRates.filter(r => r.id > 0).map(r => r.id));
      const deletedIds = existingIds.filter(id => !currentIds.has(id));
      for (const id of deletedIds) {
        ops.push(apiRequest("DELETE", `/api/unit-rates/${id}`).then(r => r.json()));
      }

      await Promise.all(ops);
      await queryClient.invalidateQueries({ queryKey: ["/api/unit-rates"] });
      toast({ title: "Удельники сохранены" });
    } catch (e: any) {
      toast({ title: "Ошибка сохранения", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [rates, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Справочник удельных стоимостей</h3>
          <p className="text-sm text-muted-foreground">Базовый год цен: {baseYear}. Используется при расчёте программ реконструкции.</p>
        </div>
        <Badge variant="outline" data-testid="badge-base-year">{baseYear} г.</Badge>
      </div>

      <Tabs defaultValue="pipe">
        <TabsList data-testid="tabs-unit-rates-type">
          <TabsTrigger value="pipe" data-testid="tab-pipe">Трубопроводы</TabsTrigger>
          <TabsTrigger value="ctp" data-testid="tab-ctp">ЦТП и ИТП</TabsTrigger>
          <TabsTrigger value="source" data-testid="tab-source">Источники тепла</TabsTrigger>
        </TabsList>

        <TabsContent value="pipe" className="mt-4">
          <PipeRatesTable
            key={rates.filter(r => r.objectType === 'pipe').map(r => r.id).join(',')}
            rates={rates}
            baseYear={baseYear}
            onSave={saveRates}
            isSaving={isSaving}
          />
        </TabsContent>

        <TabsContent value="ctp" className="mt-4">
          <SimpleRatesTable
            key={rates.filter(r => r.objectType === 'ctp').map(r => r.id).join(',')}
            rates={rates}
            objectType="ctp"
            baseYear={baseYear}
            onSave={saveRates}
            isSaving={isSaving}
          />
        </TabsContent>

        <TabsContent value="source" className="mt-4">
          <SimpleRatesTable
            key={rates.filter(r => r.objectType === 'source').map(r => r.id).join(',')}
            rates={rates}
            objectType="source"
            baseYear={baseYear}
            onSave={saveRates}
            isSaving={isSaving}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
