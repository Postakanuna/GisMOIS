import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Plus, Trash2, Key, Loader2, MapPin, Bot, Save, Check, Eye, EyeOff, X, Pencil, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser } from "@shared/models/auth";
import { Switch } from "@/components/ui/switch";
import { ApiKeysManager } from "@/components/api-keys-manager";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { BugReportsPanel } from "@/components/bug-reports-panel";
import { SensorIntegrationPanel } from "@/components/sensor-integration-panel";
import { Bug } from "lucide-react";
type AdminAiProvider = {
  id: number;
  name: string;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type AdminUser = SafeUser;

type KeysData = Record<string, { masked: string; isSet: boolean }>;

function SecretKeyField({ settingKey, label, placeholder, keysData, onSaved }: {
  settingKey: string;
  label: string;
  placeholder: string;
  keysData?: KeysData;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const info = keysData?.[settingKey];

  const saveMutation = useMutation({
    mutationFn: async (val: string) => {
      await apiRequest("PUT", "/api/settings/keys", { key: settingKey, value: val });
    },
    onSuccess: () => {
      setValue("");
      setShowInput(false);
      onSaved();
      toast({ title: "Сохранено" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/settings/keys/${settingKey}`);
    },
    onSuccess: () => {
      onSaved();
      toast({ title: "Ключ удалён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {info?.isSet && !showInput ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/50 text-sm">
            <Check className="h-4 w-4 text-green-600 shrink-0" />
            <span className="text-muted-foreground font-mono">{info.masked}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowInput(true)} data-testid={`button-change-${settingKey}`}>
            Изменить
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid={`button-delete-${settingKey}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              type={showValue ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              data-testid={`input-${settingKey}`}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowValue(!showValue)}
              data-testid={`button-toggle-visibility-${settingKey}`}
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate(value)}
            disabled={!value.trim() || saveMutation.isPending}
            data-testid={`button-save-${settingKey}`}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
          {info?.isSet && (
            <Button variant="ghost" size="sm" onClick={() => { setShowInput(false); setValue(""); }} data-testid={`button-cancel-${settingKey}`}>
              Отмена
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DebugSettingsTab() {
  const { data: debugSetting, isLoading } = useQuery<{ value: string }>({
    queryKey: ["/api/settings/debug-overlay"],
  });

  const updateMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/settings/debug-overlay", { enabled });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/settings/debug-overlay"], data);
      window.dispatchEvent(new CustomEvent("debug-settings-changed", { detail: data }));
    },
  });

  const isEnabled = debugSetting?.value === "1";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          Режим отладки
        </CardTitle>
        <CardDescription>Глобальные настройки диагностики системы</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Загрузка настроек...</span>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Диагностика слоёв на карте</Label>
              <p className="text-xs text-muted-foreground">Показывает оверлей с информацией о загруженных слоях, количестве объектов, состоянии загрузки и проекции</p>
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={(val) => updateMutation.mutate(val)}
              disabled={updateMutation.isPending}
              data-testid="toggle-debug-layer-overlay"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminUsers() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "user",
    lastName: "",
    firstName: "",
    middleName: "",
    position: "",
    organization: "",
    phone: "",
    email: "",
  });
  const [editUser, setEditUser] = useState({
    username: "",
    role: "user",
    lastName: "",
    firstName: "",
    middleName: "",
    position: "",
    organization: "",
    phone: "",
    email: "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AdminAiProvider | null>(null);
  const [providerForm, setProviderForm] = useState({ name: "", baseUrl: "", apiKey: "", model: "", isActive: true, isDefault: false });
  const [testingConnection, setTestingConnection] = useState(false);

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: providerData, isLoading: providerLoading } = useQuery<{ provider: string }>({
    queryKey: ["/api/settings/geocode-provider"],
    enabled: isAdmin,
  });

  const { data: keysData } = useQuery<KeysData>({
    queryKey: ["/api/settings/keys"],
    enabled: isAdmin,
  });

  const { data: aiEnabledData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/settings/ai-enabled"],
    enabled: isAdmin,
  });

  const { data: aiProviders, isLoading: aiProvidersLoading } = useQuery<AdminAiProvider[]>({
    queryKey: ["/api/admin/ai-providers"],
    enabled: isAdmin,
  });

  const invalidateKeys = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/settings/keys"] });
  };

  const invalidateAiProviders = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-providers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] });
  };

  const updateProvider = useMutation({
    mutationFn: async (provider: string) => {
      await apiRequest("PUT", "/api/settings/geocode-provider", { provider });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/geocode-provider"] });
      toast({ title: "Сохранено", description: "Провайдер геокодирования обновлён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message || "Не удалось обновить настройку", variant: "destructive" });
    },
  });

  const toggleAiEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PUT", "/api/settings/ai-enabled", { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai-enabled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] });
      toast({ title: "Сохранено" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createProviderMutation = useMutation({
    mutationFn: async (data: { name: string; baseUrl?: string; apiKey?: string; model?: string; isActive?: boolean; isDefault?: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/ai-providers", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateAiProviders();
      setProviderDialogOpen(false);
      setEditingProvider(null);
      toast({ title: "Провайдер создан" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const updateProviderMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/admin/ai-providers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateAiProviders();
      setProviderDialogOpen(false);
      setEditingProvider(null);
      toast({ title: "Провайдер обновлён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/ai-providers/${id}`);
    },
    onSuccess: () => {
      invalidateAiProviders();
      toast({ title: "Провайдер удалён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: typeof newUser) => {
      const res = await apiRequest("POST", "/api/admin/users", userData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setCreateDialogOpen(false);
      setNewUser({ username: "", password: "", role: "user", lastName: "", firstName: "", middleName: "", position: "", organization: "", phone: "", email: "" });
      toast({ title: "Пользователь создан" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, userData }: { userId: string; userData: typeof editUser }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}`, userData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditDialogOpen(false);
      setSelectedUserId(null);
      toast({ title: "Данные пользователя обновлены" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Пользователь деактивирован" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      await apiRequest("PATCH", `/api/admin/users/${userId}/password`, { password });
    },
    onSuccess: () => {
      setResetPasswordDialogOpen(false);
      setSelectedUserId(null);
      setNewPassword("");
      toast({ title: "Пароль изменен" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Доступ запрещен</p>
            <Link href="/gis/app">
              <Button className="mt-4" data-testid="button-back-home">На главную</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentGeoProvider = providerData?.provider || "yandex";
  const aiEnabled = aiEnabledData?.enabled ?? true;

  const openProviderDialog = (provider?: AdminAiProvider) => {
    if (provider) {
      setEditingProvider(provider);
      setProviderForm({
        name: provider.name,
        baseUrl: provider.baseUrl || "",
        apiKey: "",
        model: provider.model || "",
        isActive: provider.isActive,
        isDefault: provider.isDefault,
      });
    } else {
      setEditingProvider(null);
      setProviderForm({ name: "", baseUrl: "", apiKey: "", model: "", isActive: true, isDefault: false });
    }
    setProviderDialogOpen(true);
  };

  const handleSaveProvider = () => {
    if (editingProvider) {
      const data: Record<string, unknown> = {
        name: providerForm.name,
        baseUrl: providerForm.baseUrl || null,
        model: providerForm.model || null,
        isActive: providerForm.isActive,
        isDefault: providerForm.isDefault,
      };
      if (providerForm.apiKey) {
        data.apiKey = providerForm.apiKey;
      }
      updateProviderMutation.mutate({ id: editingProvider.id, data });
    } else {
      const data: Record<string, unknown> = {
        name: providerForm.name,
        isActive: providerForm.isActive,
        isDefault: providerForm.isDefault,
      };
      if (providerForm.baseUrl) data.baseUrl = providerForm.baseUrl;
      if (providerForm.apiKey) data.apiKey = providerForm.apiKey;
      if (providerForm.model) data.model = providerForm.model;
      createProviderMutation.mutate(data as any);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const body: Record<string, unknown> = {
        baseUrl: providerForm.baseUrl,
        model: providerForm.model || undefined,
      };
      if (providerForm.apiKey) {
        body.apiKey = providerForm.apiKey;
      } else if (editingProvider) {
        body.providerId = editingProvider.id;
      }
      const res = await apiRequest("POST", "/api/admin/ai-providers/test", body);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Успешно", description: data.message });
      } else {
        toast({ title: "Ошибка подключения", description: data.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setTestingConnection(false);
    }
  };

  const isProviderConfigured = (p: AdminAiProvider) => !!(p.baseUrl && p.apiKey);

  const canTestConnection = !!(providerForm.baseUrl && (providerForm.apiKey || (editingProvider && editingProvider.apiKey)));

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <Link href="/gis/scenes">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-sm font-semibold">Администрирование</h1>
      </header>
      <div className="container mx-auto p-6">

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="grid w-full grid-cols-8" data-testid="admin-tabs">
          <TabsTrigger value="users" data-testid="tab-users">Пользователи</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Журнал действий</TabsTrigger>
          <TabsTrigger value="geocoding" data-testid="tab-geocoding">Геокодирование</TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">ИИ-агент</TabsTrigger>
          <TabsTrigger value="connections" data-testid="tab-connections">Внешние подключения</TabsTrigger>
          <TabsTrigger value="sensors" data-testid="tab-sensors">Датчики ТИ</TabsTrigger>
          <TabsTrigger value="bugs" data-testid="tab-bugs">Сведения об ошибках</TabsTrigger>
          <TabsTrigger value="debug" data-testid="tab-debug">Режим отладки</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Пользователи системы</CardTitle>
              <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-user">
                <Plus className="mr-2 h-4 w-4" />
                Добавить
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Логин</TableHead>
                      <TableHead>ФИО</TableHead>
                      <TableHead>Должность / Организация</TableHead>
                      <TableHead>Контакты</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users?.map((u) => (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell className="font-medium" data-testid={`text-username-${u.id}`}>
                          {u.username}
                        </TableCell>
                        <TableCell data-testid={`text-name-${u.id}`}>
                          {[u.lastName, u.firstName, u.middleName].filter(Boolean).join(" ") || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-position-${u.id}`}>
                          <div>{u.position || "-"}</div>
                          {u.organization && <div className="text-xs text-muted-foreground">{u.organization}</div>}
                        </TableCell>
                        <TableCell data-testid={`text-contacts-${u.id}`}>
                          <div>{u.phone || "-"}</div>
                          {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "default" : "secondary"} data-testid={`badge-role-${u.id}`}>
                            {u.role === "admin" ? "Админ" : "Пользователь"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.isActive === "true" ? "outline" : "destructive"} data-testid={`badge-status-${u.id}`}>
                            {u.isActive === "true" ? "Активен" : "Неактивен"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedUserId(u.id);
                                setEditUser({
                                  username: u.username,
                                  role: u.role,
                                  lastName: u.lastName || "",
                                  firstName: u.firstName || "",
                                  middleName: u.middleName || "",
                                  position: u.position || "",
                                  organization: u.organization || "",
                                  phone: u.phone || "",
                                  email: u.email || "",
                                });
                                setEditDialogOpen(true);
                              }}
                              data-testid={`button-edit-user-${u.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedUserId(u.id);
                                setResetPasswordDialogOpen(true);
                              }}
                              data-testid={`button-reset-password-${u.id}`}
                            >
                              <Key className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteUserMutation.mutate(u.id)}
                              disabled={u.id === user?.id || deleteUserMutation.isPending}
                              data-testid={`button-delete-user-${u.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="geocoding">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Геокодирование
              </CardTitle>
              <CardDescription>
                Выбор API-провайдера и настройка ключей для обратного геокодирования (определение адреса по координатам)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="geocode-provider">Провайдер геокодирования</Label>
                  {providerLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Загрузка...</span>
                    </div>
                  ) : (
                    <Select
                      value={currentGeoProvider}
                      onValueChange={(value) => updateProvider.mutate(value)}
                      disabled={updateProvider.isPending}
                    >
                      <SelectTrigger id="geocode-provider" className="max-w-sm" data-testid="select-geocode-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yandex">Яндекс Геокодер</SelectItem>
                        <SelectItem value="dadata">DaData</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {currentGeoProvider === "yandex" ? (
                      <p>Яндекс Геокодер определяет адрес по координатам. Поддерживает до 40 запросов/сек.</p>
                    ) : (
                      <p>DaData определяет адрес и ФИАС ID по координатам. Поддерживает до 10 запросов/сек.</p>
                    )}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-4">API-ключи провайдеров</h4>
                  <div className="space-y-4">
                    <SecretKeyField
                      settingKey="geocode_yandex_api_key"
                      label="API-ключ Яндекс Геокодера"
                      placeholder="Введите API-ключ Яндекс Геокодера"
                      keysData={keysData}
                      onSaved={invalidateKeys}
                    />
                    <SecretKeyField
                      settingKey="geocode_dadata_api_key"
                      label="API-ключ DaData"
                      placeholder="Введите API-ключ DaData"
                      keysData={keysData}
                      onSaved={invalidateKeys}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                ИИ-агент
              </CardTitle>
              <CardDescription>
                Настройка провайдеров искусственного интеллекта для чат-ассистента
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="ai-enabled-switch">Включить ИИ-агента</Label>
                    <p className="text-sm text-muted-foreground">
                      Когда выключено, пользователи не смогут использовать чат-ассистента
                    </p>
                  </div>
                  <Switch
                    id="ai-enabled-switch"
                    checked={aiEnabled}
                    onCheckedChange={(checked) => toggleAiEnabled.mutate(checked)}
                    disabled={toggleAiEnabled.isPending}
                    data-testid="switch-ai-enabled"
                  />
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                    <h4 className="text-sm font-medium">Провайдеры ИИ</h4>
                    <Button onClick={() => openProviderDialog()} data-testid="button-add-provider">
                      <Plus className="mr-2 h-4 w-4" />
                      Добавить провайдера
                    </Button>
                  </div>

                  {aiProvidersLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : !aiProviders?.length ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Нет настроенных провайдеров. Добавьте провайдера для начала работы.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Название</TableHead>
                          <TableHead>Base URL</TableHead>
                          <TableHead>Модель</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead className="text-right">Действия</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aiProviders.map((p) => (
                          <TableRow key={p.id} data-testid={`row-provider-${p.id}`}>
                            <TableCell className="font-medium" data-testid={`text-provider-name-${p.id}`}>
                              <div className="flex items-center gap-2 flex-wrap">
                                {p.name}
                                {p.isDefault && (
                                  <Badge variant="secondary" data-testid={`badge-default-${p.id}`}>
                                    По умолчанию
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm" data-testid={`text-provider-url-${p.id}`}>
                              {p.baseUrl || "—"}
                            </TableCell>
                            <TableCell className="text-sm" data-testid={`text-provider-model-${p.id}`}>
                              {p.model || "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 flex-wrap">
                                {p.isActive ? (
                                  <Badge variant="outline" className="text-green-600 border-green-600" data-testid={`badge-active-${p.id}`}>
                                    Активен
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-active-${p.id}`}>
                                    Неактивен
                                  </Badge>
                                )}
                                {isProviderConfigured(p) ? (
                                  <Badge variant="outline" className="text-green-600 border-green-600" data-testid={`badge-configured-${p.id}`}>
                                    <Check className="h-3 w-3 mr-1" />
                                    Настроен
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-configured-${p.id}`}>
                                    Не полностью
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openProviderDialog(p)}
                                  data-testid={`button-edit-provider-${p.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteProviderMutation.mutate(p.id)}
                                  disabled={deleteProviderMutation.isPending}
                                  data-testid={`button-delete-provider-${p.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connections">
          <ApiKeysManager />
        </TabsContent>

        <TabsContent value="sensors">
          <SensorIntegrationPanel />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogPanel />
        </TabsContent>

        <TabsContent value="bugs">
          <Card>
            <CardHeader>
              <CardTitle>Сведения об ошибках</CardTitle>
              <CardDescription>Отчёты пользователей о выявленных проблемах</CardDescription>
            </CardHeader>
            <CardContent>
              <BugReportsPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="debug">
          <DebugSettingsTab />
        </TabsContent>

      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый пользователь</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-username">Логин *</Label>
                <Input
                  id="new-username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  data-testid="input-new-username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">Пароль *</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  data-testid="input-new-password"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-lastname">Фамилия</Label>
                <Input
                  id="new-lastname"
                  value={newUser.lastName}
                  onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                  data-testid="input-new-lastname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-firstname">Имя</Label>
                <Input
                  id="new-firstname"
                  value={newUser.firstName}
                  onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                  data-testid="input-new-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-middlename">Отчество</Label>
                <Input
                  id="new-middlename"
                  value={newUser.middleName}
                  onChange={(e) => setNewUser({ ...newUser, middleName: e.target.value })}
                  data-testid="input-new-middlename"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-position">Должность</Label>
                <Input
                  id="new-position"
                  value={newUser.position}
                  onChange={(e) => setNewUser({ ...newUser, position: e.target.value })}
                  data-testid="input-new-position"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-organization">Организация</Label>
                <Input
                  id="new-organization"
                  value={newUser.organization}
                  onChange={(e) => setNewUser({ ...newUser, organization: e.target.value })}
                  data-testid="input-new-organization"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-phone">Номер телефона</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  data-testid="input-new-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-email">Электронная почта</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  data-testid="input-new-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">Роль</Label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Пользователь</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create">
              Отмена
            </Button>
            <Button
              onClick={() => createUserMutation.mutate(newUser)}
              disabled={!newUser.username || !newUser.password || createUserMutation.isPending}
              data-testid="button-confirm-create"
            >
              {createUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактирование пользователя</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Логин *</Label>
              <Input
                id="edit-username"
                value={editUser.username}
                onChange={(e) => setEditUser({ ...editUser, username: e.target.value })}
                data-testid="input-edit-username"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-lastname">Фамилия</Label>
                <Input
                  id="edit-lastname"
                  value={editUser.lastName}
                  onChange={(e) => setEditUser({ ...editUser, lastName: e.target.value })}
                  data-testid="input-edit-lastname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-firstname">Имя</Label>
                <Input
                  id="edit-firstname"
                  value={editUser.firstName}
                  onChange={(e) => setEditUser({ ...editUser, firstName: e.target.value })}
                  data-testid="input-edit-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-middlename">Отчество</Label>
                <Input
                  id="edit-middlename"
                  value={editUser.middleName}
                  onChange={(e) => setEditUser({ ...editUser, middleName: e.target.value })}
                  data-testid="input-edit-middlename"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-position">Должность</Label>
                <Input
                  id="edit-position"
                  value={editUser.position}
                  onChange={(e) => setEditUser({ ...editUser, position: e.target.value })}
                  data-testid="input-edit-position"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-organization">Организация</Label>
                <Input
                  id="edit-organization"
                  value={editUser.organization}
                  onChange={(e) => setEditUser({ ...editUser, organization: e.target.value })}
                  data-testid="input-edit-organization"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Номер телефона</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editUser.phone}
                  onChange={(e) => setEditUser({ ...editUser, phone: e.target.value })}
                  data-testid="input-edit-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Электронная почта</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editUser.email}
                  onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
                  data-testid="input-edit-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Роль</Label>
              <Select value={editUser.role} onValueChange={(v) => setEditUser({ ...editUser, role: v })}>
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Пользователь</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
              Отмена
            </Button>
            <Button
              onClick={() => selectedUserId && updateUserMutation.mutate({ userId: selectedUserId, userData: editUser })}
              disabled={!editUser.username || updateUserMutation.isPending}
              data-testid="button-confirm-edit"
            >
              {updateUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сброс пароля</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-password">Новый пароль</Label>
              <Input
                id="reset-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-reset-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordDialogOpen(false)} data-testid="button-cancel-reset">
              Отмена
            </Button>
            <Button
              onClick={() => selectedUserId && resetPasswordMutation.mutate({ userId: selectedUserId, password: newPassword })}
              disabled={!newPassword || resetPasswordMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetPasswordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProvider ? "Редактирование провайдера" : "Новый провайдер"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider-name">Название провайдера *</Label>
              <Input
                id="provider-name"
                value={providerForm.name}
                onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                placeholder="Например: OpenAI"
                data-testid="input-provider-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-base-url">Base URL</Label>
              <Input
                id="provider-base-url"
                value={providerForm.baseUrl}
                onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                data-testid="input-provider-base-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-api-key">API-ключ</Label>
              <Input
                id="provider-api-key"
                type="password"
                value={providerForm.apiKey}
                onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                placeholder={editingProvider ? "Оставьте пустым, чтобы сохранить текущий" : "Введите API-ключ"}
                data-testid="input-provider-api-key"
              />
              {editingProvider && editingProvider.apiKey && (
                <p className="text-xs text-muted-foreground">
                  Текущий ключ: {editingProvider.apiKey}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-model">Модель</Label>
              <Input
                id="provider-model"
                value={providerForm.model}
                onChange={(e) => setProviderForm({ ...providerForm, model: e.target.value })}
                placeholder="gpt-4o-mini"
                data-testid="input-provider-model"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="provider-active">Активен</Label>
              <Switch
                id="provider-active"
                checked={providerForm.isActive}
                onCheckedChange={(checked) => setProviderForm({ ...providerForm, isActive: checked })}
                data-testid="switch-provider-active"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="provider-default">По умолчанию</Label>
              <Switch
                id="provider-default"
                checked={providerForm.isDefault}
                onCheckedChange={(checked) => setProviderForm({ ...providerForm, isDefault: checked })}
                data-testid="switch-provider-default"
              />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!canTestConnection || testingConnection}
              data-testid="button-test-connection"
            >
              {testingConnection ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
              Тестировать соединение
            </Button>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setProviderDialogOpen(false)} data-testid="button-cancel-provider">
                Отмена
              </Button>
              <Button
                onClick={handleSaveProvider}
                disabled={!providerForm.name.trim() || createProviderMutation.isPending || updateProviderMutation.isPending}
                data-testid="button-save-provider"
              >
                {(createProviderMutation.isPending || updateProviderMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
