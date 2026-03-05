import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Calculator,
  FileDown,
  ChevronLeft,
  Sparkles,
  Loader2,
  Pencil,
  Check,
  X,
  ListChecks,
} from "lucide-react";

export interface SegmentImportData {
  featureId: number;
  objectName: string;
  diameterMm?: number | null;
  lengthM?: string | number | null;
  accidentCount?: number | null;
  residentCount?: number | null;
  layingType?: string;
  workType?: string;
}

interface ReconstructionProgram {
  id: number;
  sceneId: number;
  name: string;
  periodFrom: number;
  periodTo: number;
  baseYear: number;
  inflationRate: string;
  totalBaseCost: string | null;
  totalIndexedCost: string | null;
  status: "draft" | "approved";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ProgramObject {
  id: number;
  programId: number;
  featureId: number | null;
  objectType: string;
  objectName: string;
  diameterMm: number | null;
  lengthM: string | null;
  capacityMw: string | null;
  layingType: string | null;
  workType: string;
  unitRateId: number | null;
  unitRateValue: string | null;
  baseCost: string | null;
  plannedYear: number | null;
  indexedCost: string | null;
  accidentCount: number | null;
  accidentsPerM: string | null;
  residentCount: number | null;
  sortOrder: number;
}

interface ReconstructionProgramDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sceneId: number;
  initialSegments?: SegmentImportData[];
}

const OBJECT_TYPES = [
  { value: "pipe", label: "Трубопровод" },
  { value: "ctp", label: "ЦТП" },
  { value: "source", label: "Источник" },
];

const WORK_TYPES = [
  { value: "overhaul", label: "Капремонт" },
  { value: "reconstruction", label: "Реконструкция" },
];

const LAYING_TYPES = [
  { value: "underground", label: "Подземная" },
  { value: "above", label: "Надземная" },
];

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + " млн ₽";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + " тыс. ₽";
  return num.toFixed(0) + " ₽";
}

function currentYear() {
  return new Date().getFullYear();
}

export function ReconstructionProgramDialog({
  open,
  onOpenChange,
  sceneId,
  initialSegments,
}: ReconstructionProgramDialogProps) {
  const { toast } = useToast();
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [showNewProgramForm, setShowNewProgramForm] = useState(false);
  const [showNewObjectForm, setShowNewObjectForm] = useState(false);
  const [aiScheduleBudget, setAiScheduleBudget] = useState("");
  const [editingProgramName, setEditingProgramName] = useState(false);
  const [editProgramNameValue, setEditProgramNameValue] = useState("");
  const [importingSegments, setImportingSegments] = useState(false);
  const pendingSegmentsRef = useRef<SegmentImportData[]>([]);
  const [confirmDeleteProgramId, setConfirmDeleteProgramId] = useState<number | null>(null);

  useEffect(() => {
    if (open && initialSegments && initialSegments.length > 0) {
      pendingSegmentsRef.current = initialSegments;
      setShowNewProgramForm(true);
      setSelectedProgramId(null);
    } else if (!open) {
      pendingSegmentsRef.current = [];
      setImportingSegments(false);
    }
  }, [open, initialSegments]);

  const [newProgram, setNewProgram] = useState({
    name: "",
    periodFrom: String(currentYear()),
    periodTo: String(currentYear() + 4),
    baseYear: String(currentYear()),
    inflationRate: "5",
  });

  const [newObject, setNewObject] = useState({
    objectType: "pipe",
    objectName: "",
    diameterMm: "",
    lengthM: "",
    capacityMw: "",
    layingType: "underground",
    workType: "overhaul",
    accidentCount: "",
    residentCount: "",
  });

  const { data: programs = [], isLoading: programsLoading } = useQuery<ReconstructionProgram[]>({
    queryKey: ["/api/reconstruction-programs", sceneId],
    queryFn: async () => {
      const res = await fetch(`/api/reconstruction-programs?sceneId=${sceneId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && sceneId > 0,
  });

  const { data: selectedProgram } = useQuery<ReconstructionProgram & { objects: ProgramObject[] }>({
    queryKey: ["/api/reconstruction-programs", selectedProgramId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/reconstruction-programs/${selectedProgramId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedProgramId,
  });

  const invalidatePrograms = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/reconstruction-programs", sceneId] });
    if (selectedProgramId) {
      queryClient.invalidateQueries({ queryKey: ["/api/reconstruction-programs", selectedProgramId, "detail"] });
    }
  }, [sceneId, selectedProgramId]);

  const createProgramMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reconstruction-programs", {
        sceneId,
        name: newProgram.name,
        periodFrom: parseInt(newProgram.periodFrom),
        periodTo: parseInt(newProgram.periodTo),
        baseYear: parseInt(newProgram.baseYear),
        inflationRate: newProgram.inflationRate,
      });
      return res.json();
    },
    onSuccess: async (program) => {
      invalidatePrograms();
      setShowNewProgramForm(false);
      setNewProgram({ name: "", periodFrom: String(currentYear()), periodTo: String(currentYear() + 4), baseYear: String(currentYear()), inflationRate: "5" });
      setSelectedProgramId(program.id);

      const segments = pendingSegmentsRef.current;
      if (segments.length > 0) {
        pendingSegmentsRef.current = [];
        setImportingSegments(true);
        try {
          await apiRequest("POST", `/api/reconstruction-programs/${program.id}/objects/batch`, {
            objects: segments.map(s => ({
              featureId: s.featureId,
              objectType: "pipe",
              objectName: s.objectName,
              diameterMm: s.diameterMm ?? null,
              lengthM: s.lengthM ?? null,
              layingType: s.layingType ?? "underground",
              workType: s.workType ?? "overhaul",
              accidentCount: s.accidentCount ?? null,
              residentCount: s.residentCount ?? null,
            })),
          });
          queryClient.invalidateQueries({ queryKey: ["/api/reconstruction-programs", program.id, "detail"] });
          toast({ title: "Программа создана", description: `Импортировано ${segments.length} участков из анализа аварийности` });
        } catch (e: any) {
          toast({ title: "Ошибка импорта участков", description: e.message, variant: "destructive" });
        } finally {
          setImportingSegments(false);
        }
      } else {
        toast({ title: "Программа создана" });
      }
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const deleteProgramMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/reconstruction-programs/${id}`);
    },
    onSuccess: () => {
      invalidatePrograms();
      setSelectedProgramId(null);
      toast({ title: "Программа удалена" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const renameProgramMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/reconstruction-programs/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      invalidatePrograms();
      setEditingProgramName(false);
      toast({ title: "Название обновлено" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const createObjectMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        objectType: newObject.objectType,
        objectName: newObject.objectName,
        workType: newObject.workType,
      };
      if (newObject.objectType === "pipe") {
        if (newObject.diameterMm) body.diameterMm = parseInt(newObject.diameterMm);
        if (newObject.lengthM) body.lengthM = newObject.lengthM;
        if (newObject.layingType) body.layingType = newObject.layingType;
      } else {
        if (newObject.capacityMw) body.capacityMw = newObject.capacityMw;
      }
      if (newObject.accidentCount) body.accidentCount = parseInt(newObject.accidentCount);
      if (newObject.residentCount) body.residentCount = parseInt(newObject.residentCount);
      const res = await apiRequest("POST", `/api/reconstruction-programs/${selectedProgramId}/objects`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidatePrograms();
      setShowNewObjectForm(false);
      setNewObject({ objectType: "pipe", objectName: "", diameterMm: "", lengthM: "", capacityMw: "", layingType: "underground", workType: "overhaul", accidentCount: "", residentCount: "" });
      toast({ title: "Объект добавлен" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const deleteObjectMutation = useMutation({
    mutationFn: async (oid: number) => {
      await apiRequest("DELETE", `/api/reconstruction-programs/${selectedProgramId}/objects/${oid}`);
    },
    onSuccess: () => {
      invalidatePrograms();
      toast({ title: "Объект удалён" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/reconstruction-programs/${selectedProgramId}/calculate`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidatePrograms();
      toast({ title: "Стоимость пересчитана" });
    },
    onError: (e: Error) => toast({ title: "Ошибка расчёта", description: e.message, variant: "destructive" }),
  });

  const aiScheduleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/reconstruction-programs/${selectedProgramId}/ai-schedule`, {
        annualBudget: aiScheduleBudget ? parseFloat(aiScheduleBudget) : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      invalidatePrograms();
      toast({ title: "Распределение выполнено", description: data.comment });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reconstruction-programs/${selectedProgramId}/export`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `program_${selectedProgramId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast({ title: "Экспорт выполнен" }),
    onError: (e: Error) => toast({ title: "Ошибка экспорта", description: e.message, variant: "destructive" }),
  });

  const updateObjectYearMutation = useMutation({
    mutationFn: async ({ oid, plannedYear }: { oid: number; plannedYear: number | null }) => {
      const res = await apiRequest("PATCH", `/api/reconstruction-programs/${selectedProgramId}/objects/${oid}`, { plannedYear });
      return res.json();
    },
    onSuccess: () => invalidatePrograms(),
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const objectsByYear = (() => {
    if (!selectedProgram) return {};
    const map: Record<string, ProgramObject[]> = { unscheduled: [] };
    if (selectedProgram.periodFrom && selectedProgram.periodTo) {
      for (let y = selectedProgram.periodFrom; y <= selectedProgram.periodTo; y++) {
        map[String(y)] = [];
      }
    }
    for (const obj of selectedProgram.objects || []) {
      if (obj.plannedYear && map[String(obj.plannedYear)]) {
        map[String(obj.plannedYear)].push(obj);
      } else {
        map.unscheduled.push(obj);
      }
    }
    return map;
  })();

  const years = selectedProgram
    ? Array.from({ length: selectedProgram.periodTo - selectedProgram.periodFrom + 1 }, (_, i) => selectedProgram.periodFrom + i)
    : [];

  return (
    <DraggableModal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Программа реконструкции"
      defaultWidth={820}
      defaultHeight={600}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {!selectedProgramId ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Сцена #{sceneId} · {programs.length} программ
              </span>
              <Button
                size="sm"
                onClick={() => setShowNewProgramForm(true)}
                data-testid="button-new-program"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Новая программа
              </Button>
            </div>

            {showNewProgramForm && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium">Новая программа</p>
                {pendingSegmentsRef.current.length > 0 && (
                  <div className="flex items-center gap-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-xs text-blue-700 dark:text-blue-300">
                    <ListChecks className="h-3.5 w-3.5 shrink-0" />
                    После создания будет импортировано {pendingSegmentsRef.current.length} участков из анализа аварийности
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs">Название *</Label>
                    <Input
                      value={newProgram.name}
                      onChange={e => setNewProgram(p => ({ ...p, name: e.target.value }))}
                      placeholder="Программа КР и реконструкции…"
                      className="h-7 text-sm"
                      data-testid="input-program-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Период с</Label>
                    <Input
                      type="number"
                      value={newProgram.periodFrom}
                      onChange={e => setNewProgram(p => ({ ...p, periodFrom: e.target.value }))}
                      className="h-7 text-sm"
                      data-testid="input-period-from"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Период по</Label>
                    <Input
                      type="number"
                      value={newProgram.periodTo}
                      onChange={e => setNewProgram(p => ({ ...p, periodTo: e.target.value }))}
                      className="h-7 text-sm"
                      data-testid="input-period-to"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Базовый год цен</Label>
                    <Input
                      type="number"
                      value={newProgram.baseYear}
                      onChange={e => setNewProgram(p => ({ ...p, baseYear: e.target.value }))}
                      className="h-7 text-sm"
                      data-testid="input-base-year"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Индексация, % в год</Label>
                    <Input
                      type="number"
                      value={newProgram.inflationRate}
                      onChange={e => setNewProgram(p => ({ ...p, inflationRate: e.target.value }))}
                      className="h-7 text-sm"
                      data-testid="input-inflation-rate"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowNewProgramForm(false)}>Отмена</Button>
                  <Button
                    size="sm"
                    onClick={() => createProgramMutation.mutate()}
                    disabled={!newProgram.name || createProgramMutation.isPending || importingSegments}
                    data-testid="button-create-program"
                  >
                    {(createProgramMutation.isPending || importingSegments) && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                    {importingSegments ? "Импорт участков…" : "Создать"}
                  </Button>
                </div>
              </div>
            )}

            {programsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : programs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <ListChecks className="h-10 w-10 opacity-30" />
                <p className="text-sm">Нет программ для этой сцены</p>
                <p className="text-xs">Создайте первую программу реконструкции</p>
              </div>
            ) : (
              <ScrollArea className="max-h-80">
                <div className="space-y-2">
                  {programs.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelectedProgramId(p.id)}
                      data-testid={`card-program-${p.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{p.name}</span>
                          <Badge variant={p.status === "approved" ? "default" : "secondary"} className="shrink-0 text-xs">
                            {p.status === "approved" ? "Утверждена" : "Черновик"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.periodFrom}–{p.periodTo} · базовый год {p.baseYear} · индексация {p.inflationRate}%
                        </div>
                        {p.totalBaseCost && (
                          <div className="text-xs text-muted-foreground">
                            Базовая: {fmt(p.totalBaseCost)}
                            {p.totalIndexedCost && <> · Индексиров.: {fmt(p.totalIndexedCost)}</>}
                          </div>
                        )}
                      </div>
                      {confirmDeleteProgramId === p.id ? (
                        <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => { deleteProgramMutation.mutate(p.id); setConfirmDeleteProgramId(null); }}
                            disabled={deleteProgramMutation.isPending}
                            data-testid={`button-confirm-delete-program-${p.id}`}
                          >
                            {deleteProgramMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Удалить"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => setConfirmDeleteProgramId(null)}
                            data-testid={`button-cancel-delete-program-${p.id}`}
                          >
                            Отмена
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 ml-2"
                          onClick={e => { e.stopPropagation(); setConfirmDeleteProgramId(p.id); }}
                          data-testid={`button-delete-program-${p.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Шапка программы */}
            <div className="flex items-start gap-2 px-4 py-3 border-b shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 mt-0.5"
                onClick={() => { setSelectedProgramId(null); setShowNewObjectForm(false); }}
                data-testid="button-back-to-programs"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1 min-w-0">
                {editingProgramName ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editProgramNameValue}
                      onChange={e => setEditProgramNameValue(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                      data-testid="input-edit-program-name"
                    />
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => renameProgramMutation.mutate({ id: selectedProgramId, name: editProgramNameValue })}
                      disabled={!editProgramNameValue || renameProgramMutation.isPending}
                    >
                      {renameProgramMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingProgramName(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold truncate">{selectedProgram?.name}</span>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => { setEditProgramNameValue(selectedProgram?.name || ""); setEditingProgramName(true); }}
                      data-testid="button-rename-program"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {selectedProgram && (
                  <div className="text-xs text-muted-foreground">
                    {selectedProgram.periodFrom}–{selectedProgram.periodTo} · база {selectedProgram.baseYear} г. · индекс {selectedProgram.inflationRate}%
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {selectedProgram?.totalBaseCost && (
                  <div className="text-right text-xs hidden sm:block">
                    <div className="font-medium">{fmt(selectedProgram.totalBaseCost)}</div>
                    {selectedProgram.totalIndexedCost && (
                      <div className="text-muted-foreground">{fmt(selectedProgram.totalIndexedCost)} (индекс.)</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Панель действий */}
            <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20 shrink-0 flex-wrap">
              <Button
                variant="outline" size="sm"
                onClick={() => calculateMutation.mutate()}
                disabled={calculateMutation.isPending}
                data-testid="button-calculate-costs"
              >
                {calculateMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  : <Calculator className="h-3.5 w-3.5 mr-1" />}
                Рассчитать стоимость
              </Button>

              <div className="flex items-center gap-1">
                <Input
                  placeholder="Лимит, ₽/год"
                  value={aiScheduleBudget}
                  onChange={e => setAiScheduleBudget(e.target.value)}
                  className="h-7 text-xs w-28"
                  data-testid="input-ai-budget"
                />
                <Button
                  variant="outline" size="sm"
                  onClick={() => aiScheduleMutation.mutate()}
                  disabled={aiScheduleMutation.isPending}
                  data-testid="button-ai-schedule"
                >
                  {aiScheduleMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  Распределить по годам
                </Button>
              </div>

              <Button
                variant="outline" size="sm"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                data-testid="button-export-program"
              >
                {exportMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  : <FileDown className="h-3.5 w-3.5 mr-1" />}
                Excel
              </Button>

              <Button
                size="sm"
                onClick={() => setShowNewObjectForm(true)}
                className="ml-auto"
                data-testid="button-add-object"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Добавить объект
              </Button>
            </div>

            {/* Форма нового объекта */}
            {showNewObjectForm && (
              <div className="px-4 py-3 border-b bg-muted/10 shrink-0">
                <p className="text-xs font-semibold mb-2">Новый объект</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2">
                    <Label className="text-xs">Название *</Label>
                    <Input
                      value={newObject.objectName}
                      onChange={e => setNewObject(o => ({ ...o, objectName: e.target.value }))}
                      placeholder="ул. Ленина, уч. 1"
                      className="h-7 text-xs"
                      data-testid="input-object-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Тип объекта</Label>
                    <Select value={newObject.objectType} onValueChange={v => setNewObject(o => ({ ...o, objectType: v }))}>
                      <SelectTrigger className="h-7 text-xs" data-testid="select-object-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OBJECT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Вид работ</Label>
                    <Select value={newObject.workType} onValueChange={v => setNewObject(o => ({ ...o, workType: v }))}>
                      <SelectTrigger className="h-7 text-xs" data-testid="select-work-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WORK_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {newObject.objectType === "pipe" && (
                    <>
                      <div>
                        <Label className="text-xs">Диаметр, мм</Label>
                        <Input
                          type="number"
                          value={newObject.diameterMm}
                          onChange={e => setNewObject(o => ({ ...o, diameterMm: e.target.value }))}
                          className="h-7 text-xs"
                          data-testid="input-diameter"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Длина, м</Label>
                        <Input
                          type="number"
                          value={newObject.lengthM}
                          onChange={e => setNewObject(o => ({ ...o, lengthM: e.target.value }))}
                          className="h-7 text-xs"
                          data-testid="input-length"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Прокладка</Label>
                        <Select value={newObject.layingType} onValueChange={v => setNewObject(o => ({ ...o, layingType: v }))}>
                          <SelectTrigger className="h-7 text-xs" data-testid="select-laying-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LAYING_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {(newObject.objectType === "ctp" || newObject.objectType === "source") && (
                    <div>
                      <Label className="text-xs">Мощность, МВт</Label>
                      <Input
                        type="number"
                        value={newObject.capacityMw}
                        onChange={e => setNewObject(o => ({ ...o, capacityMw: e.target.value }))}
                        className="h-7 text-xs"
                        data-testid="input-capacity"
                      />
                    </div>
                  )}

                  <div>
                    <Label className="text-xs">Аварий (история)</Label>
                    <Input
                      type="number"
                      value={newObject.accidentCount}
                      onChange={e => setNewObject(o => ({ ...o, accidentCount: e.target.value }))}
                      className="h-7 text-xs"
                      data-testid="input-accident-count"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Жителей под откл.</Label>
                    <Input
                      type="number"
                      value={newObject.residentCount}
                      onChange={e => setNewObject(o => ({ ...o, residentCount: e.target.value }))}
                      className="h-7 text-xs"
                      data-testid="input-resident-count"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowNewObjectForm(false)}>Отмена</Button>
                  <Button
                    size="sm"
                    onClick={() => createObjectMutation.mutate()}
                    disabled={!newObject.objectName || createObjectMutation.isPending}
                    data-testid="button-save-object"
                  >
                    {createObjectMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                    Добавить
                  </Button>
                </div>
              </div>
            )}

            {/* Список объектов по годам */}
            <ScrollArea className="flex-1">
              <div className="px-4 py-2 space-y-4">
                {/* Нераспределённые */}
                {(objectsByYear.unscheduled || []).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Не распределены по годам</p>
                    <div className="space-y-1">
                      {objectsByYear.unscheduled.map(obj => (
                        <ObjectRow
                          key={obj.id}
                          obj={obj}
                          years={years}
                          onSetYear={(year) => updateObjectYearMutation.mutate({ oid: obj.id, plannedYear: year })}
                          onDelete={() => deleteObjectMutation.mutate(obj.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* По годам */}
                {years.map(year => {
                  const yearObjs = objectsByYear[String(year)] || [];
                  const yearBaseCost = yearObjs.reduce((s, o) => s + (o.baseCost ? parseFloat(o.baseCost) : 0), 0);
                  const yearIndexedCost = yearObjs.reduce((s, o) => s + (o.indexedCost ? parseFloat(o.indexedCost) : 0), 0);
                  return (
                    <div key={year}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold">{year} год</p>
                        {yearBaseCost > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {fmt(String(yearBaseCost))} баз.
                            {yearIndexedCost > 0 && <> · {fmt(String(yearIndexedCost))} индекс.</>}
                          </span>
                        )}
                      </div>
                      {yearObjs.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 pl-2">Нет объектов</p>
                      ) : (
                        <div className="space-y-1">
                          {yearObjs.map(obj => (
                            <ObjectRow
                              key={obj.id}
                              obj={obj}
                              years={years}
                              onSetYear={(year) => updateObjectYearMutation.mutate({ oid: obj.id, plannedYear: year })}
                              onDelete={() => deleteObjectMutation.mutate(obj.id)}
                            />
                          ))}
                        </div>
                      )}
                      <Separator className="mt-3" />
                    </div>
                  );
                })}

                {(!selectedProgram || (selectedProgram.objects?.length === 0 && !showNewObjectForm)) && (
                  <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                    <p className="text-sm">Объекты не добавлены</p>
                    <p className="text-xs">Нажмите «Добавить объект» для начала работы</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </DraggableModal>
  );
}

interface ObjectRowProps {
  obj: ProgramObject;
  years: number[];
  onSetYear: (year: number | null) => void;
  onDelete: () => void;
}

function ObjectRow({ obj, years, onSetYear, onDelete }: ObjectRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const typeLabel = OBJECT_TYPES.find(t => t.value === obj.objectType)?.label ?? obj.objectType;
  const workLabel = WORK_TYPES.find(t => t.value === obj.workType)?.label ?? obj.workType;
  const metrics = obj.objectType === "pipe"
    ? [obj.diameterMm ? `Ø${obj.diameterMm} мм` : null, obj.lengthM ? `${parseFloat(obj.lengthM).toFixed(0)} м` : null].filter(Boolean).join(", ")
    : obj.capacityMw ? `${obj.capacityMw} МВт` : null;

  return (
    <div
      className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs"
      data-testid={`row-object-${obj.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-medium truncate">{obj.objectName}</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{typeLabel}</Badge>
          <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">{workLabel}</Badge>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
          {metrics && <span>{metrics}</span>}
          {obj.baseCost && <span className="font-medium text-foreground">{fmt(obj.baseCost)}</span>}
          {obj.indexedCost && obj.plannedYear && <span>→ {fmt(obj.indexedCost)} ({obj.plannedYear})</span>}
          {obj.accidentCount != null && <span>⚡ {obj.accidentCount} ав.</span>}
          {obj.residentCount != null && <span>👥 {obj.residentCount} жит.</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Select
          value={obj.plannedYear ? String(obj.plannedYear) : "none"}
          onValueChange={v => onSetYear(v === "none" ? null : parseInt(v))}
        >
          <SelectTrigger className="h-6 text-[10px] w-16 px-1" data-testid={`select-year-${obj.id}`}>
            <SelectValue placeholder="Год" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <Button
              variant="destructive"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              data-testid={`button-confirm-delete-object-${obj.id}`}
            >
              Удалить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setConfirmDelete(false)}
              data-testid={`button-cancel-delete-object-${obj.id}`}
            >
              Отмена
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setConfirmDelete(true)}
            data-testid={`button-delete-object-${obj.id}`}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}
