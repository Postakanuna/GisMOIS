import { useState, useRef } from "react";
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
import { Pencil, Trash2, Plus, Search, DatabaseZap } from "lucide-react";

interface FieldLabel {
  id: number;
  fieldName: string;
  label: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EditForm {
  label: string;
  category: string;
}

export function FieldLabelsAdminTable() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState<FieldLabel | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ label: "", category: "" });
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ fieldName: "", label: "", category: "" });
  const [deleteTarget, setDeleteTarget] = useState<FieldLabel | null>(null);

  const { data: labels = [], isLoading } = useQuery<FieldLabel[]>({
    queryKey: ["/api/field-labels"],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditForm }) =>
      apiRequest("PATCH", `/api/field-labels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-labels"] });
      setEditingItem(null);
      toast({ title: "Запись обновлена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof addForm) => apiRequest("POST", "/api/field-labels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-labels"] });
      setAddDialogOpen(false);
      setAddForm({ fieldName: "", label: "", category: "" });
      toast({ title: "Запись добавлена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/field-labels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-labels"] });
      setDeleteTarget(null);
      toast({ title: "Запись удалена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const filtered = labels.filter(
    (l) =>
      l.fieldName.toLowerCase().includes(search.toLowerCase()) ||
      l.label.toLowerCase().includes(search.toLowerCase()) ||
      (l.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function openEdit(item: FieldLabel) {
    setEditingItem(item);
    setEditForm({ label: item.label, category: item.category ?? "" });
  }

  function handleSaveEdit() {
    if (!editingItem) return;
    updateMutation.mutate({ id: editingItem.id, data: editForm });
  }

  function handleAddSave() {
    if (!addForm.fieldName.trim() || !addForm.label.trim()) {
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
            placeholder="Поиск по имени поля или расшифровке..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-field-label-search"
          />
        </div>
        <Button
          onClick={() => setAddDialogOpen(true)}
          data-testid="button-add-field-label"
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Добавить запись
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          {search ? "Ничего не найдено" : "Справочник пуст"}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-48">
                    Техническое имя
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Расшифровка (рус.)
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-36">
                    Категория
                  </th>
                  <th className="w-20 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-muted/30 transition-colors"
                    data-testid={`row-field-label-${item.id}`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {item.fieldName}
                    </td>
                    <td className="px-4 py-2.5">{item.label}</td>
                    <td className="px-4 py-2.5">
                      {item.category ? (
                        <Badge variant="secondary" className="text-xs">
                          {item.category}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(item)}
                          data-testid={`button-edit-field-label-${item.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(item)}
                          data-testid={`button-delete-field-label-${item.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/20">
            Записей: {filtered.length}{search && labels.length !== filtered.length ? ` из ${labels.length}` : ""}
          </div>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать расшифровку</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Техническое имя поля</div>
              <div className="font-mono text-sm bg-muted px-3 py-1.5 rounded border">
                {editingItem?.fieldName}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={editForm.label}
                onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Русское название поля"
                data-testid="input-edit-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
              <Input
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Например: Участок, Узел, Потребитель..."
                data-testid="input-edit-category"
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
              data-testid="button-save-edit-label"
            >
              {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить новую запись</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Техническое имя поля <span className="text-destructive">*</span>
              </label>
              <Input
                value={addForm.fieldName}
                onChange={(e) => setAddForm((f) => ({ ...f, fieldName: e.target.value }))}
                placeholder="Например: MyNewField"
                data-testid="input-add-field-name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Расшифровка (рус.) <span className="text-destructive">*</span>
              </label>
              <Input
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Русское название поля"
                data-testid="input-add-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
              <Input
                value={addForm.category}
                onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Например: Участок, Узел, Потребитель..."
                data-testid="input-add-category"
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
              data-testid="button-confirm-add-label"
            >
              {createMutation.isPending ? "Добавление..." : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Будет удалена расшифровка поля{" "}
              <span className="font-mono font-semibold">{deleteTarget?.fieldName}</span>.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-label"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
