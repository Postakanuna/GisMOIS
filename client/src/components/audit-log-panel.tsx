import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { SafeUser } from "@shared/models/auth";

interface AuditEntry {
  id: number;
  userId: string | null;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  sceneId: number | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Вход в систему",
  logout: "Выход из системы",
  user_create: "Создание пользователя",
  user_deactivate: "Деактивация пользователя",
  password_change: "Смена пароля",
  password_reset: "Сброс пароля (админ)",
  scene_create: "Создание сцены",
  scene_delete: "Удаление сцены",
  scene_member_add: "Добавление участника сцены",
  scene_member_remove: "Удаление участника сцены",
  layer_create: "Создание слоя",
  layer_delete: "Удаление слоя",
  layer_import: "Импорт слоя",
  feature_create: "Создание объекта",
  feature_update: "Изменение объекта",
  feature_delete: "Удаление объекта",
  feature_batch_delete: "Массовое удаление объектов",
  feature_batch_update: "Массовое изменение объектов",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  auth: "Авторизация",
  user: "Пользователь",
  scene: "Сцена",
  layer: "Слой",
  feature: "Объект",
};

function getActionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("delete") || action.includes("deactivate")) return "destructive";
  if (action.includes("create") || action.includes("import")) return "default";
  if (action === "login" || action === "logout") return "outline";
  return "secondary";
}

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details || Object.keys(details).length === 0) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value !== null && value !== undefined) {
      const label = key === "name" ? "Название" :
                    key === "newUsername" ? "Логин" :
                    key === "role" ? "Роль" :
                    key === "count" ? "Кол-во" :
                    key === "layerId" ? "Слой" :
                    key === "source" ? "Источник" :
                    key === "geometryType" ? "Тип" :
                    key;
      parts.push(`${label}: ${value}`);
    }
  }
  return parts.join(", ");
}

export function AuditLogPanel() {
  const [page, setPage] = useState(1);
  const [filterUserId, setFilterUserId] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", "30");
  if (filterUserId) queryParams.set("userId", filterUserId);
  if (filterAction) queryParams.set("action", filterAction);
  if (filterDateFrom) queryParams.set("dateFrom", filterDateFrom);
  if (filterDateTo) queryParams.set("dateTo", filterDateTo);

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ["/api/admin/audit-log", page, filterUserId, filterAction, filterDateFrom, filterDateTo],
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit-log?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: actions } = useQuery<string[]>({
    queryKey: ["/api/admin/audit-log/actions"],
  });

  const { data: allUsers } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const resetFilters = () => {
    setFilterUserId("");
    setFilterAction("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  };

  const hasFilters = filterUserId || filterAction || filterDateFrom || filterDateTo;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Журнал действий
        </CardTitle>
        <CardDescription>
          История действий пользователей в системе. Хранение — 90 дней.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Пользователь</Label>
            <Select value={filterUserId} onValueChange={(v) => { setFilterUserId(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter-user">
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {allUsers?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Действие</Label>
            <Select value={filterAction} onValueChange={(v) => { setFilterAction(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[220px]" data-testid="select-filter-action">
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {actions?.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTION_LABELS[a] || a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата с</Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
              className="w-[150px]"
              data-testid="input-filter-date-from"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата по</Label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
              className="w-[150px]"
              data-testid="input-filter-date-to"
            />
          </div>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters} data-testid="button-reset-filters">
              Сбросить
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : data?.entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {hasFilters ? "Нет записей по заданным фильтрам" : "Журнал пока пуст"}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Дата и время</TableHead>
                  <TableHead className="w-[120px]">Пользователь</TableHead>
                  <TableHead className="w-[200px]">Действие</TableHead>
                  <TableHead className="w-[100px]">Тип</TableHead>
                  <TableHead>Подробности</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.entries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-audit-date-${entry.id}`}>
                      {new Date(entry.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </TableCell>
                    <TableCell className="font-medium text-sm" data-testid={`text-audit-user-${entry.id}`}>
                      {entry.username || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getActionBadgeVariant(entry.action)} data-testid={`badge-audit-action-${entry.id}`}>
                        {ACTION_LABELS[entry.action] || entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.entityType ? (ENTITY_TYPE_LABELS[entry.entityType] || entry.entityType) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                      {entry.entityId ? `ID: ${entry.entityId}` : ""}
                      {entry.entityId && entry.details ? " · " : ""}
                      {formatDetails(entry.details)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Всего записей: {data?.total || 0}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  {page} / {data?.totalPages || 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= (data?.totalPages || 1)}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
