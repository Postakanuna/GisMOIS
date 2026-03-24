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
import { Pencil, Trash2, Plus, Search, ChevronDown, ChevronRight, Hash } from "lucide-react";

interface FieldValue {
  id: number;
  fieldName: string;
  fieldValue: string;
  label: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export function FieldValuesAdminTable() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  const [editingItem, setEditingItem] = useState<FieldValue | null>(null);
  const [editForm, setEditForm] = useState({ label: "", category: "" });

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ fieldName: "", fieldValue: "", label: "", category: "" });

  const [deleteTarget, setDeleteTarget] = useState<FieldValue | null>(null);

  const { data: values = [], isLoading } = useQuery<FieldValue[]>({
    queryKey: ["/api/field-values"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof addForm) => apiRequest("POST", "/api/field-values", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-values"] });
      setAddDialogOpen(false);
      setAddForm({ fieldName: "", fieldValue: "", label: "", category: "" });
      toast({ title: "Значение добавлено" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { label: string; category: string } }) =>
      apiRequest("PATCH", `/api/field-values/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-values"] });
      setEditingItem(null);
      toast({ title: "Запись обновлена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/field-values/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-values"] });
      setDeleteTarget(null);
      toast({ title: "Запись удалена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const filtered = values.filter(
    (v) =>
      v.fieldName.toLowerCase().includes(search.toLowerCase()) ||
      v.fieldValue.toLowerCase().includes(search.toLowerCase()) ||
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      (v.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // Group values by fieldName
  const grouped: Record<string, FieldValue[]> = {};
  for (const item of filtered) {
    if (!grouped[item.fieldName]) grouped[item.fieldName] = [];
    grouped[item.fieldName].push(item);
  }
  const fieldNames = Object.keys(grouped).sort();

  function toggleField(fieldName: string) {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  }

  function openAddForField(fieldName: string) {
    setAddForm({ fieldName, fieldValue: "", label: "", category: "" });
    setAddDialogOpen(true);
  }

  function openAddEmpty() {
    setAddForm({ fieldName: "", fieldValue: "", label: "", category: "" });
    setAddDialogOpen(true);
  }

  function openEdit(item: FieldValue) {
    setEditingItem(item);
    setEditForm({ label: item.label, category: item.category ?? "" });
  }

  function handleSaveEdit() {
    if (!editingItem) return;
    updateMutation.mutate({ id: editingItem.id, data: editForm });
  }

  function handleAddSave() {
    if (!addForm.fieldName.trim() || !addForm.fieldValue.trim() || !addForm.label.trim()) {
      toast({ title: "Заполните обязательные поля", variant: "destructive" });
      return;
    }
    createMutation.mutate(addForm);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по полю, коду или расшифровке..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-field-value-search"
          />
        </div>
        <Button
          onClick={openAddEmpty}
          data-testid="button-add-field-value"
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Добавить
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Загрузка...</div>
      ) : fieldNames.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          {search ? "Ничего не найдено" : "Справочник значений пуст"}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden divide-y">
          {fieldNames.map((fieldName) => {
            const items = grouped[fieldName];
            const isExpanded = expandedFields.has(fieldName) || !!search;
            return (
              <div key={fieldName} data-testid={`group-field-${fieldName}`}>
                {/* Field group header */}
                <div
                  className="flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 cursor-pointer select-none transition-colors"
                  onClick={() => toggleField(fieldName)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded && !search
                      ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="font-mono text-sm font-semibold text-foreground">{fieldName}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {items.length} {items.length === 1 ? "значение" : items.length < 5 ? "значения" : "значений"}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs shrink-0"
                    onClick={(e) => { e.stopPropagation(); openAddForField(fieldName); }}
                    data-testid={`button-add-value-${fieldName}`}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Добавить значение
                  </Button>
                </div>

                {/* Values list */}
                {(isExpanded || !!search) && (
                  <div className="divide-y bg-background">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-4 py-2 pl-10 hover:bg-muted/20 transition-colors"
                        data-testid={`row-field-value-${item.id}`}
                      >
                        <Hash className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        <span className="font-mono text-sm font-bold text-primary w-16 shrink-0">
                          {item.fieldValue}
                        </span>
                        <span className="text-sm flex-1 min-w-0 truncate">{item.label}</span>
                        {item.category && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {item.category}
                          </Badge>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(item)}
                            data-testid={`button-edit-value-${item.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(item)}
                            data-testid={`button-delete-value-${item.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Полей: {fieldNames.length} · Значений: {filtered.length}
        {search && values.length !== filtered.length ? ` (из ${values.length})` : ""}
      </div>

      {/* Add dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить расшифровку значения</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Техническое имя поля <span className="text-destructive">*</span>
              </label>
              <Input
                value={addForm.fieldName}
                onChange={(e) => setAddForm((f) => ({ ...f, fieldName: e.target.value }))}
                placeholder="Например: ZType, zMode, ZStatus..."
                data-testid="input-add-field-name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Код значения <span className="text-destructive">*</span>
              </label>
              <Input
                value={addForm.fieldValue}
                onChange={(e) => setAddForm((f) => ({ ...f, fieldValue: e.target.value }))}
                placeholder="Например: 1, 2, 5..."
                data-testid="input-add-field-value"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Например: Теплосеть рабочая: подача и обратка"
                data-testid="input-add-value-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
              <Input
                value={addForm.category}
                onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Например: Линии, Узлы, Участки..."
                data-testid="input-add-value-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleAddSave}
              disabled={createMutation.isPending}
              data-testid="button-confirm-add-value"
            >
              {createMutation.isPending ? "Добавление..." : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать расшифровку</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Поле</div>
                <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border">
                  {editingItem?.fieldName}
                </div>
              </div>
              <div className="w-24">
                <div className="text-xs text-muted-foreground mb-1">Код</div>
                <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border font-bold text-primary">
                  {editingItem?.fieldValue}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={editForm.label}
                onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Текстовое описание значения"
                data-testid="input-edit-value-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
              <Input
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Например: Линии, Узлы..."
                data-testid="input-edit-value-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              Отмена
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending || !editForm.label.trim()}
              data-testid="button-save-edit-value"
            >
              {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить расшифровку?</AlertDialogTitle>
            <AlertDialogDescription>
              Будет удалена расшифровка значения{" "}
              <span className="font-mono font-semibold">{deleteTarget?.fieldName} = {deleteTarget?.fieldValue}</span>{" "}
              («{deleteTarget?.label}»). Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
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
