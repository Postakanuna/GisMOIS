import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Key, Plus, Trash2, Copy, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ApiKey {
  id: number;
  name: string;
  sceneId: number | null;
  permissions: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Scene {
  id: number;
  name: string;
}

type Permission = "create_point" | "read_scenes" | "read_layers";

const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: "create_point", label: "Создание точек" },
  { value: "read_scenes", label: "Чтение сцен" },
  { value: "read_layers", label: "Чтение слоёв" },
];

export function ApiKeysManager() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeySceneId, setNewKeySceneId] = useState<string>("");
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>(["create_point", "read_scenes", "read_layers"]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const { data: apiKeys = [], isLoading: isLoadingKeys } = useQuery<ApiKey[]>({
    queryKey: ["/api/api-keys"],
  });

  const { data: scenes = [] } = useQuery<Scene[]>({
    queryKey: ["/api/scenes"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; sceneId?: number; permissions: string[] }) => {
      const res = await apiRequest("POST", "/api/api-keys", data);
      return res.json();
    },
    onSuccess: (response) => {
      setCreatedToken(response.token);
      setNewKeyName("");
      setNewKeySceneId("");
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({
        title: "API ключ создан",
        description: "Скопируйте токен, он больше не будет показан!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка создания ключа",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/api-keys/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({
        title: "API ключ отозван",
        description: "Ключ больше не может использоваться",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка отзыва ключа",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    const sceneIdValue = newKeySceneId && newKeySceneId !== "all" ? parseInt(newKeySceneId) : undefined;
    createMutation.mutate({
      name: newKeyName.trim(),
      sceneId: isNaN(sceneIdValue as number) ? undefined : sceneIdValue,
      permissions: selectedPermissions,
    });
  };

  const handleCopyToken = async () => {
    if (createdToken) {
      await navigator.clipboard.writeText(createdToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    }
  };

  const handleCloseDialog = () => {
    setIsCreateOpen(false);
    setCreatedToken(null);
    setTokenCopied(false);
    setSelectedPermissions(["create_point", "read_scenes", "read_layers"]);
  };

  const togglePermission = (permission: Permission) => {
    setSelectedPermissions(prev => 
      prev.includes(permission) 
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    );
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Никогда";
    return new Date(dateStr).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <CardTitle>API ключи</CardTitle>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={(open) => {
            if (!open) handleCloseDialog();
            else setIsCreateOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-api-key">
                <Plus className="h-4 w-4 mr-1" />
                Создать ключ
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Создать API ключ</DialogTitle>
                <DialogDescription>
                  API ключ позволяет внешним приложениям (например, Telegram бот) создавать точки на карте.
                </DialogDescription>
              </DialogHeader>

              {createdToken ? (
                <div className="space-y-4">
                  <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                    <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                      Сохраните токен! Он показывается только один раз.
                    </AlertDescription>
                  </Alert>
                  <div className="flex items-center gap-2">
                    <Input 
                      value={createdToken} 
                      readOnly 
                      className="font-mono text-sm"
                      data-testid="input-created-token"
                    />
                    <Button 
                      size="icon" 
                      variant="outline" 
                      onClick={handleCopyToken}
                      data-testid="button-copy-token"
                    >
                      {tokenCopied ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCloseDialog} data-testid="button-close-token-dialog">
                      Готово
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="api-key-name">Название</Label>
                    <Input
                      id="api-key-name"
                      placeholder="Например: Telegram бот"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      data-testid="input-api-key-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="api-key-scene">Ограничить сценой (опционально)</Label>
                    <Select value={newKeySceneId} onValueChange={setNewKeySceneId}>
                      <SelectTrigger data-testid="select-api-key-scene">
                        <SelectValue placeholder="Все сцены" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все сцены</SelectItem>
                        {scenes.map((scene) => (
                          <SelectItem key={scene.id} value={scene.id.toString()}>
                            {scene.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Разрешения</Label>
                    <div className="space-y-2">
                      {PERMISSIONS.map((perm) => (
                        <div key={perm.value} className="flex items-center space-x-2">
                          <Checkbox
                            id={`perm-${perm.value}`}
                            checked={selectedPermissions.includes(perm.value)}
                            onCheckedChange={() => togglePermission(perm.value)}
                            data-testid={`checkbox-permission-${perm.value}`}
                          />
                          <label
                            htmlFor={`perm-${perm.value}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            {perm.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <DialogFooter>
                    <Button 
                      variant="outline" 
                      onClick={() => setIsCreateOpen(false)}
                      data-testid="button-cancel-create-key"
                    >
                      Отмена
                    </Button>
                    <Button 
                      onClick={handleCreate} 
                      disabled={!newKeyName.trim() || createMutation.isPending || selectedPermissions.length === 0}
                      data-testid="button-confirm-create-key"
                    >
                      Создать
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>
          Управление токенами доступа для внешних интеграций
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingKeys ? (
          <div className="text-center py-4 text-muted-foreground">Загрузка...</div>
        ) : apiKeys.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            Нет API ключей. Создайте первый ключ для интеграции с внешними сервисами.
          </div>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between gap-4 p-3 border rounded-md bg-card flex-wrap"
                data-testid={`api-key-item-${key.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{key.name}</span>
                    {!key.isActive && (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Отозван
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {key.sceneId 
                      ? `Сцена: ${scenes.find(s => s.id === key.sceneId)?.name || key.sceneId}`
                      : "Все сцены"
                    }
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {key.permissions.map((perm) => (
                      <Badge key={perm} variant="outline" className="text-xs">
                        {PERMISSIONS.find(p => p.value === perm)?.label || perm}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Последнее использование: {formatDate(key.lastUsedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {key.isActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => revokeMutation.mutate(key.id)}
                      disabled={revokeMutation.isPending}
                      data-testid={`button-revoke-key-${key.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
