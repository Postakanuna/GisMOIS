import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useScene } from "@/contexts/scene-context";
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
import { FolderOpen, Plus, Users, Calendar, LogOut, Settings, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Scene {
  id: number;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  role: "owner" | "editor" | "viewer";
}

export default function ScenesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const { setCurrentSceneId } = useScene();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [newSceneDescription, setNewSceneDescription] = useState("");
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [editSceneName, setEditSceneName] = useState("");
  const [editSceneDescription, setEditSceneDescription] = useState("");
  
  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sceneToDelete, setSceneToDelete] = useState<Scene | null>(null);

  const { data: scenes, isLoading } = useQuery<Scene[]>({
    queryKey: ["/api/scenes"],
  });

  const createSceneMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/scenes", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes"] });
      setCreateDialogOpen(false);
      setNewSceneName("");
      setNewSceneDescription("");
      toast({ title: "Сцена создана" });
    },
    onError: () => {
      toast({ title: "Ошибка создания сцены", variant: "destructive" });
    },
  });

  const updateSceneMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: number; name: string; description?: string }) => {
      const res = await apiRequest("PATCH", `/api/scenes/${id}`, { name, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes"] });
      setEditDialogOpen(false);
      setEditingScene(null);
      setEditSceneName("");
      setEditSceneDescription("");
      toast({ title: "Сцена обновлена" });
    },
    onError: () => {
      toast({ title: "Ошибка обновления сцены", variant: "destructive" });
    },
  });

  const deleteSceneMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/scenes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes"] });
      setDeleteDialogOpen(false);
      setSceneToDelete(null);
      toast({ title: "Сцена удалена" });
    },
    onError: () => {
      toast({ title: "Ошибка удаления сцены", variant: "destructive" });
    },
  });

  const handleCreateScene = () => {
    if (!newSceneName.trim()) return;
    createSceneMutation.mutate({
      name: newSceneName.trim(),
      description: newSceneDescription.trim() || undefined,
    });
  };

  const handleEditScene = (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingScene(scene);
    setEditSceneName(scene.name);
    setEditSceneDescription(scene.description || "");
    setEditDialogOpen(true);
  };

  const handleUpdateScene = () => {
    if (!editingScene || !editSceneName.trim()) return;
    updateSceneMutation.mutate({
      id: editingScene.id,
      name: editSceneName.trim(),
      description: editSceneDescription.trim() || undefined,
    });
  };

  const handleDeleteClick = (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation();
    setSceneToDelete(scene);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!sceneToDelete) return;
    deleteSceneMutation.mutate(sceneToDelete.id);
  };

  const handleSelectScene = (sceneId: number) => {
    setCurrentSceneId(sceneId);
    setLocation("/");
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return <Badge variant="default" data-testid="badge-role-owner">Владелец</Badge>;
      case "editor":
        return <Badge variant="secondary" data-testid="badge-role-editor">Редактор</Badge>;
      case "viewer":
        return <Badge variant="outline" data-testid="badge-role-viewer">Просмотр</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">ГИС МО "Инженерные сети"</h1>
            <p className="text-sm text-muted-foreground">Выберите сцену для работы</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {user?.firstName || user?.username}
            </span>
            {user?.role === "admin" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/admin")}
                data-testid="button-admin"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium">Мои сцены</h2>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-scene">
                <Plus className="h-4 w-4 mr-2" />
                Создать сцену
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая сцена</DialogTitle>
                <DialogDescription>
                  Создайте новую сцену для работы с геоданными
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="scene-name">Название</Label>
                  <Input
                    id="scene-name"
                    value={newSceneName}
                    onChange={(e) => setNewSceneName(e.target.value)}
                    placeholder="Например: Район №5"
                    data-testid="input-scene-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scene-description">Описание (необязательно)</Label>
                  <Textarea
                    id="scene-description"
                    value={newSceneDescription}
                    onChange={(e) => setNewSceneDescription(e.target.value)}
                    placeholder="Краткое описание сцены"
                    data-testid="input-scene-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Отмена
                </Button>
                <Button
                  onClick={handleCreateScene}
                  disabled={!newSceneName.trim() || createSceneMutation.isPending}
                  data-testid="button-confirm-create-scene"
                >
                  Создать
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : scenes && scenes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scenes.map((scene) => (
              <Card
                key={scene.id}
                className="cursor-pointer hover-elevate transition-all"
                onClick={() => handleSelectScene(scene.id)}
                data-testid={`card-scene-${scene.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">{scene.name}</CardTitle>
                    </div>
                    {getRoleBadge(scene.role)}
                  </div>
                  {scene.description && (
                    <CardDescription className="line-clamp-2">
                      {scene.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {format(new Date(scene.updatedAt), "d MMM yyyy", { locale: ru })}
                        </span>
                      </div>
                    </div>
                    {(scene.role === "owner" || scene.role === "editor") && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => handleEditScene(scene, e)}
                          data-testid={`button-edit-scene-${scene.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {scene.role === "owner" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={(e) => handleDeleteClick(scene, e)}
                            data-testid={`button-delete-scene-${scene.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="max-w-md mx-auto">
            <CardContent className="pt-6 text-center">
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">Нет доступных сцен</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Создайте первую сцену для начала работы с геоданными
              </p>
              <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-first-scene">
                <Plus className="h-4 w-4 mr-2" />
                Создать сцену
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Edit Scene Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать сцену</DialogTitle>
            <DialogDescription>
              Измените название или описание сцены
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-scene-name">Название</Label>
              <Input
                id="edit-scene-name"
                value={editSceneName}
                onChange={(e) => setEditSceneName(e.target.value)}
                placeholder="Например: Район №5"
                data-testid="input-edit-scene-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-scene-description">Описание (необязательно)</Label>
              <Textarea
                id="edit-scene-description"
                value={editSceneDescription}
                onChange={(e) => setEditSceneDescription(e.target.value)}
                placeholder="Краткое описание сцены"
                data-testid="input-edit-scene-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleUpdateScene}
              disabled={!editSceneName.trim() || updateSceneMutation.isPending}
              data-testid="button-confirm-edit-scene"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Scene Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сцену?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить сцену "{sceneToDelete?.name}"? Это действие нельзя отменить. Все слои и данные сцены будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-scene"
            >
              {deleteSceneMutation.isPending ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
