import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Plus, Trash2, Key, Loader2, MapPin, Bot, Save, Check, Eye, EyeOff, X } from "lucide-react";
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
import { ApiKeysManager } from "@/components/api-keys-manager";

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

export default function AdminUsers() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "user",
    firstName: "",
    lastName: "",
    email: "",
  });
  const [newPassword, setNewPassword] = useState("");

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: providerData, isLoading: providerLoading } = useQuery<{ provider: string }>({
    queryKey: ["/api/settings/geocode-provider"],
    enabled: isAdmin,
  });

  const { data: aiProviderData, isLoading: aiProviderLoading } = useQuery<{ provider: string }>({
    queryKey: ["/api/settings/ai-provider"],
    enabled: isAdmin,
  });

  const { data: keysData } = useQuery<KeysData>({
    queryKey: ["/api/settings/keys"],
    enabled: isAdmin,
  });

  const { data: aiProvidersStatus } = useQuery<{ providers: Array<{ id: string; name: string; available: boolean }> }>({
    queryKey: ["/api/ai/providers"],
    enabled: isAdmin,
  });

  const invalidateKeys = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/settings/keys"] });
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

  const updateAiProvider = useMutation({
    mutationFn: async (provider: string) => {
      await apiRequest("PUT", "/api/settings/ai-provider", { provider });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai-provider"] });
      toast({ title: "Сохранено", description: "Провайдер ИИ обновлён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message || "Не удалось обновить настройку", variant: "destructive" });
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
      setNewUser({ username: "", password: "", role: "user", firstName: "", lastName: "", email: "" });
      toast({ title: "Пользователь создан" });
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
            <Link href="/app">
              <Button className="mt-4" data-testid="button-back-home">На главную</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentGeoProvider = providerData?.provider || "yandex";
  const currentAiProvider = aiProviderData?.provider || "openai";
  const openaiStatus = aiProvidersStatus?.providers?.find(p => p.id === "openai");
  const yandexStatus = aiProvidersStatus?.providers?.find(p => p.id === "yandex");

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <Link href="/scenes">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-sm font-semibold">Администрирование</h1>
      </header>
      <div className="container mx-auto p-6">

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4" data-testid="admin-tabs">
          <TabsTrigger value="users" data-testid="tab-users">Пользователи</TabsTrigger>
          <TabsTrigger value="geocoding" data-testid="tab-geocoding">Геокодирование</TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">ИИ-агент</TabsTrigger>
          <TabsTrigger value="connections" data-testid="tab-connections">Внешние подключения</TabsTrigger>
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
                      <TableHead>Имя</TableHead>
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
                          {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : "-"}
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
                Настройка провайдера искусственного интеллекта для чат-ассистента
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="ai-provider">Провайдер ИИ</Label>
                  {aiProviderLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Загрузка...</span>
                    </div>
                  ) : (
                    <Select
                      value={currentAiProvider}
                      onValueChange={(value) => updateAiProvider.mutate(value)}
                      disabled={updateAiProvider.isPending}
                    >
                      <SelectTrigger id="ai-provider" className="max-w-sm" data-testid="select-ai-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                        <SelectItem value="yandex">Yandex GPT</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="border-t pt-4 space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="text-sm font-medium">OpenAI (GPT)</h4>
                      {openaiStatus?.available ? (
                        <Badge variant="outline" className="text-green-600 border-green-600" data-testid="badge-openai-status">
                          <Check className="h-3 w-3 mr-1" />
                          Подключён
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground" data-testid="badge-openai-status">
                          Не настроен
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      OpenAI подключается через интеграцию Replit. Ключи управляются автоматически.
                      {openaiStatus?.available
                        ? " Интеграция активна, модель gpt-4o-mini доступна."
                        : " Для подключения активируйте интеграцию OpenAI в настройках проекта."}
                    </p>
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="text-sm font-medium">Yandex GPT</h4>
                      {yandexStatus?.available ? (
                        <Badge variant="outline" className="text-green-600 border-green-600" data-testid="badge-yandex-status">
                          <Check className="h-3 w-3 mr-1" />
                          Подключён
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground" data-testid="badge-yandex-status">
                          Не настроен
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Yandex GPT использует модель yandexgpt-lite. Для подключения введите API-ключ Yandex Studio и Folder ID.
                    </p>
                    <div className="space-y-4">
                      <SecretKeyField
                        settingKey="ai_yandex_api_key"
                        label="API-ключ Yandex Studio"
                        placeholder="Введите API-ключ Yandex Studio"
                        keysData={keysData}
                        onSaved={invalidateKeys}
                      />
                      <SecretKeyField
                        settingKey="ai_yandex_folder_id"
                        label="Folder ID (Yandex Cloud)"
                        placeholder="Введите Folder ID"
                        keysData={keysData}
                        onSaved={invalidateKeys}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connections">
          <ApiKeysManager />
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
            <div className="grid grid-cols-2 gap-4">
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
                <Label htmlFor="new-lastname">Фамилия</Label>
                <Input
                  id="new-lastname"
                  value={newUser.lastName}
                  onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                  data-testid="input-new-lastname"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-email">Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  data-testid="input-new-email"
                />
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
      </div>
    </div>
  );
}
