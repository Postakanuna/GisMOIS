import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Fragment } from "react";
import {
  Pencil, Trash2, Plus, Search,
  ChevronDown, ChevronRight, Tag, Check,
} from "lucide-react";

// ─── Network Type definitions ─────────────────────────────────────────────────
const NETWORK_TYPES: { value: string; label: string; color: string }[] = [
  { value: "segment",  label: "Участок",     color: "#1e88e5" },
  { value: "source",   label: "Источник",    color: "#e53935" },
  { value: "ctp",      label: "ЦТП",         color: "#8e24aa" },
  { value: "consumer", label: "Потребитель", color: "#43a047" },
  { value: "valve",    label: "Задвижка",    color: "#f4511e" },
  { value: "node",     label: "Узел",        color: "#6d4c41" },
  { value: "pump",     label: "Насос",       color: "#00acc1" },
  { value: "accident", label: "Авария",      color: "#e65100" },
];

function networkTypeLabel(nt: string | null | undefined): string {
  if (!nt) return "Для всех";
  return NETWORK_TYPES.find(t => t.value === nt)?.label ?? nt;
}

function networkTypeColor(nt: string | null | undefined): string {
  if (!nt) return "#6b7280";
  return NETWORK_TYPES.find(t => t.value === nt)?.color ?? "#6b7280";
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface FieldLabel {
  id: number;
  fieldName: string;
  label: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FieldValue {
  id: number;
  fieldName: string;
  fieldValue: string;
  label: string;
  networkType: string | null;
  category: string | null;
}

// ─── NetworkType badge picker ─────────────────────────────────────────────────
function NetworkTypePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs justify-start gap-1.5"
          type="button"
          data-testid="button-network-type-picker"
        >
          <Tag className="h-3.5 w-3.5" />
          <span
            className="font-medium"
            style={{ color: networkTypeColor(value) }}
          >
            {networkTypeLabel(value)}
          </span>
          <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start">
        <button
          className="flex w-full items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
          onClick={() => { onChange(null); setOpen(false); }}
        >
          {value === null && <Check className="h-3 w-3 text-primary" />}
          <span className={value === null ? "font-semibold" : ""}>Для всех</span>
        </button>
        {NETWORK_TYPES.map(nt => (
          <button
            key={nt.value}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
            onClick={() => { onChange(nt.value); setOpen(false); }}
          >
            {value === nt.value && <Check className="h-3 w-3 text-primary" />}
            <span
              className={`${value === nt.value ? "font-semibold" : ""}`}
              style={{ color: nt.color }}
            >
              {nt.label}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function FieldLabelsAdminTable() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  // ── Field label CRUD state ─────────────────────────────────────────────────
  const [editingLabel, setEditingLabel] = useState<FieldLabel | null>(null);
  const [editLabelForm, setEditLabelForm] = useState({ label: "", category: "" });
  const [addLabelOpen, setAddLabelOpen] = useState(false);
  const [addLabelForm, setAddLabelForm] = useState({ fieldName: "", label: "", category: "" });
  const [deleteLabelTarget, setDeleteLabelTarget] = useState<FieldLabel | null>(null);

  // ── Field value CRUD state ─────────────────────────────────────────────────
  const [addValueOpen, setAddValueOpen] = useState(false);
  const [addValueForm, setAddValueForm] = useState({
    fieldName: "", fieldValue: "", label: "", networkType: null as string | null,
  });
  const [editingValue, setEditingValue] = useState<FieldValue | null>(null);
  const [editValueForm, setEditValueForm] = useState({
    label: "", networkType: null as string | null,
  });
  const [deleteValueTarget, setDeleteValueTarget] = useState<FieldValue | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: labels = [], isLoading: labelsLoading } = useQuery<FieldLabel[]>({
    queryKey: ["/api/field-labels"],
  });
  const { data: values = [] } = useQuery<FieldValue[]>({
    queryKey: ["/api/field-values"],
  });

  // ── Field label mutations ──────────────────────────────────────────────────
  const updateLabelMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { label: string; category: string } }) =>
      apiRequest("PATCH", `/api/field-labels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-labels"] });
      setEditingLabel(null);
      toast({ title: "Поле обновлено" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const createLabelMutation = useMutation({
    mutationFn: (data: typeof addLabelForm) => apiRequest("POST", "/api/field-labels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-labels"] });
      setAddLabelOpen(false);
      setAddLabelForm({ fieldName: "", label: "", category: "" });
      toast({ title: "Поле добавлено" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const deleteLabelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/field-labels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-labels"] });
      setDeleteLabelTarget(null);
      toast({ title: "Поле удалено" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  // ── Field value mutations ──────────────────────────────────────────────────
  const createValueMutation = useMutation({
    mutationFn: (data: typeof addValueForm) => apiRequest("POST", "/api/field-values", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-values"] });
      setAddValueOpen(false);
      setAddValueForm({ fieldName: "", fieldValue: "", label: "", networkType: null });
      toast({ title: "Значение добавлено" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const updateValueMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof editValueForm }) =>
      apiRequest("PATCH", `/api/field-values/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-values"] });
      setEditingValue(null);
      toast({ title: "Значение обновлено" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const deleteValueMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/field-values/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-values"] });
      setDeleteValueTarget(null);
      toast({ title: "Значение удалено" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  // ── Filtering & grouping ───────────────────────────────────────────────────
  const filteredLabels = labels.filter(
    (l) =>
      l.fieldName.toLowerCase().includes(search.toLowerCase()) ||
      l.label.toLowerCase().includes(search.toLowerCase()) ||
      (l.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function valuesForField(fieldName: string): FieldValue[] {
    return values.filter(v => v.fieldName.toLowerCase() === fieldName.toLowerCase());
  }

  function toggleExpand(fieldName: string) {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  }

  function openAddValue(fieldName: string) {
    setAddValueForm({ fieldName, fieldValue: "", label: "", networkType: null });
    setAddValueOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени поля или расшифровке..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-field-label-search"
          />
        </div>
        <Button onClick={() => setAddLabelOpen(true)} size="sm" data-testid="button-add-field-label">
          <Plus className="h-4 w-4 mr-1.5" />
          Добавить поле
        </Button>
      </div>

      {/* Table */}
      {labelsLoading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Загрузка...</div>
      ) : filteredLabels.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          {search ? "Ничего не найдено" : "Справочник пуст"}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <div className="overflow-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-8" />
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-44">
                    Техническое имя
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">
                    Расшифровка (рус.)
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-32">
                    Категория
                  </th>
                  <th className="w-28 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLabels.map((item) => {
                  const fieldValues = valuesForField(item.fieldName);
                  const isExpanded = expandedFields.has(item.fieldName) || !!search;

                  return (
                    <Fragment key={item.id}>
                      {/* Main row */}
                      <tr
                        key={item.id}
                        className="hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => toggleExpand(item.fieldName)}
                        data-testid={`row-field-label-${item.id}`}
                      >
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {item.fieldName}
                          {fieldValues.length > 0 && (
                            <span className="ml-1.5 text-xs bg-primary/10 text-primary rounded px-1">
                              {fieldValues.length}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-medium">{item.label}</td>
                        <td className="px-3 py-2.5">
                          {item.category && (
                            <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-primary hover:text-primary"
                              title="Добавить расшифровку значения"
                              onClick={() => openAddValue(item.fieldName)}
                              data-testid={`button-add-value-${item.fieldName}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingLabel(item);
                                setEditLabelForm({ label: item.label, category: item.category ?? "" });
                              }}
                              data-testid={`button-edit-field-label-${item.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteLabelTarget(item)}
                              data-testid={`button-delete-field-label-${item.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded: value decodings */}
                      {isExpanded && (
                        <tr key={`${item.id}-values`}>
                          <td colSpan={5} className="p-0 bg-muted/10 border-t border-dashed">
                            {fieldValues.length === 0 ? (
                              <div className="py-2 pl-10 text-xs text-muted-foreground italic">
                                Расшифровки значений не заданы.{" "}
                                <button
                                  className="text-primary underline"
                                  onClick={() => openAddValue(item.fieldName)}
                                >
                                  Добавить первое
                                </button>
                              </div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-dashed">
                                    <th className="text-left pl-10 pr-3 py-1.5 font-medium text-muted-foreground w-20">
                                      Код
                                    </th>
                                    <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-36">
                                      Тип сети
                                    </th>
                                    <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                                      Расшифровка
                                    </th>
                                    <th className="w-20 px-3 py-1.5" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-dashed">
                                  {fieldValues.map(fv => (
                                    <tr key={fv.id} className="hover:bg-muted/20 transition-colors">
                                      <td className="pl-10 pr-3 py-1.5 font-mono font-bold text-primary">
                                        {fv.fieldValue}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <span
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                                          style={{
                                            backgroundColor: networkTypeColor(fv.networkType) + "22",
                                            color: networkTypeColor(fv.networkType),
                                          }}
                                        >
                                          <Tag className="h-2.5 w-2.5" />
                                          {networkTypeLabel(fv.networkType)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-1.5">{fv.label}</td>
                                      <td className="px-3 py-1.5">
                                        <div className="flex items-center gap-1">
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => {
                                              setEditingValue(fv);
                                              setEditValueForm({ label: fv.label, networkType: fv.networkType });
                                            }}
                                            data-testid={`button-edit-value-${fv.id}`}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-destructive hover:text-destructive"
                                            onClick={() => setDeleteValueTarget(fv)}
                                            data-testid={`button-delete-value-${fv.id}`}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/20">
            Полей: {filteredLabels.length}{search && labels.length !== filteredLabels.length ? ` из ${labels.length}` : ""} ·
            Расшифровок значений: {values.length}
          </div>
        </div>
      )}

      {/* ── Add field label dialog ── */}
      <Dialog open={addLabelOpen} onOpenChange={setAddLabelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить поле</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Техническое имя <span className="text-destructive">*</span>
              </label>
              <Input
                value={addLabelForm.fieldName}
                onChange={(e) => setAddLabelForm(f => ({ ...f, fieldName: e.target.value }))}
                placeholder="Например: MyNewField"
                data-testid="input-add-field-name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={addLabelForm.label}
                onChange={(e) => setAddLabelForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Русское название поля"
                data-testid="input-add-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
              <Input
                value={addLabelForm.category}
                onChange={(e) => setAddLabelForm(f => ({ ...f, category: e.target.value }))}
                placeholder="Например: Участок, Узел..."
                data-testid="input-add-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLabelOpen(false)}>Отмена</Button>
            <Button
              onClick={() => {
                if (!addLabelForm.fieldName.trim() || !addLabelForm.label.trim()) {
                  toast({ title: "Заполните обязательные поля", variant: "destructive" });
                  return;
                }
                createLabelMutation.mutate(addLabelForm);
              }}
              disabled={createLabelMutation.isPending}
              data-testid="button-confirm-add-label"
            >
              {createLabelMutation.isPending ? "Добавление..." : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit field label dialog ── */}
      <Dialog open={!!editingLabel} onOpenChange={(open) => !open && setEditingLabel(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Редактировать поле</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Техническое имя</div>
              <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border">{editingLabel?.fieldName}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={editLabelForm.label}
                onChange={(e) => setEditLabelForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Русское название поля"
                data-testid="input-edit-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
              <Input
                value={editLabelForm.category}
                onChange={(e) => setEditLabelForm(f => ({ ...f, category: e.target.value }))}
                placeholder="Например: Участок, Узел..."
                data-testid="input-edit-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLabel(null)}>Отмена</Button>
            <Button
              onClick={() => {
                if (!editingLabel) return;
                updateLabelMutation.mutate({ id: editingLabel.id, data: editLabelForm });
              }}
              disabled={updateLabelMutation.isPending || !editLabelForm.label.trim()}
              data-testid="button-save-edit-label"
            >
              {updateLabelMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete field label dialog ── */}
      <AlertDialog open={!!deleteLabelTarget} onOpenChange={(open) => !open && setDeleteLabelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить поле?</AlertDialogTitle>
            <AlertDialogDescription>
              Будет удалена расшифровка поля{" "}
              <span className="font-mono font-semibold">{deleteLabelTarget?.fieldName}</span>.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteLabelTarget && deleteLabelMutation.mutate(deleteLabelTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-label"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add field value dialog ── */}
      <Dialog open={addValueOpen} onOpenChange={setAddValueOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить расшифровку значения</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Поле</div>
              <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border">{addValueForm.fieldName}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Код значения <span className="text-destructive">*</span>
              </label>
              <Input
                value={addValueForm.fieldValue}
                onChange={(e) => setAddValueForm(f => ({ ...f, fieldValue: e.target.value }))}
                placeholder="Например: 1, 2, 5..."
                data-testid="input-add-field-value"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Тип сети (бейдж)</label>
              <NetworkTypePicker
                value={addValueForm.networkType}
                onChange={(v) => setAddValueForm(f => ({ ...f, networkType: v }))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                «Для всех» — расшифровка применяется ко всем типам слоёв
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={addValueForm.label}
                onChange={(e) => setAddValueForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Например: Теплосеть рабочая: подача и обратка"
                data-testid="input-add-value-label"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddValueOpen(false)}>Отмена</Button>
            <Button
              onClick={() => {
                if (!addValueForm.fieldValue.trim() || !addValueForm.label.trim()) {
                  toast({ title: "Заполните обязательные поля", variant: "destructive" });
                  return;
                }
                createValueMutation.mutate(addValueForm);
              }}
              disabled={createValueMutation.isPending}
              data-testid="button-confirm-add-value"
            >
              {createValueMutation.isPending ? "Добавление..." : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit field value dialog ── */}
      <Dialog open={!!editingValue} onOpenChange={(open) => !open && setEditingValue(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Редактировать расшифровку</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Поле</div>
                <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border">{editingValue?.fieldName}</div>
              </div>
              <div className="w-20">
                <div className="text-xs text-muted-foreground mb-1">Код</div>
                <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border font-bold text-primary">
                  {editingValue?.fieldValue}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Тип сети (бейдж)</label>
              <NetworkTypePicker
                value={editValueForm.networkType}
                onChange={(v) => setEditValueForm(f => ({ ...f, networkType: v }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={editValueForm.label}
                onChange={(e) => setEditValueForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Текстовое описание значения"
                data-testid="input-edit-value-label"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingValue(null)}>Отмена</Button>
            <Button
              onClick={() => {
                if (!editingValue) return;
                updateValueMutation.mutate({ id: editingValue.id, data: editValueForm });
              }}
              disabled={updateValueMutation.isPending || !editValueForm.label.trim()}
              data-testid="button-save-edit-value"
            >
              {updateValueMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete field value dialog ── */}
      <AlertDialog open={!!deleteValueTarget} onOpenChange={(open) => !open && setDeleteValueTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить расшифровку?</AlertDialogTitle>
            <AlertDialogDescription>
              Будет удалена расшифровка{" "}
              <span className="font-mono font-semibold">
                {deleteValueTarget?.fieldName} = {deleteValueTarget?.fieldValue}
              </span>{" "}
              («{deleteValueTarget?.label}»). Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteValueTarget && deleteValueMutation.mutate(deleteValueTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-value"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
