import { useState, useMemo } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { FolderOpen, FolderPlus, Folder, FolderInput, Plus, Calendar, Pencil, Trash2, Shield, ChevronRight, MoreVertical, ArrowLeft, Home, Map, Crown, UserPen, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { SceneAccessDialog } from "@/components/scene-access-dialog";
import { BugReportButton } from "@/components/bug-report-button";
import { UserButton } from "@/components/user-button";

interface Scene {
  id: number;
  name: string;
  description: string | null;
  folderId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  role: "owner" | "editor" | "viewer";
}

interface SceneFolder {
  id: number;
  name: string;
  parentId: number | null;
  createdBy: string;
  createdAt: string;
}

export default function ScenesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { setCurrentSceneId } = useScene();

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [newSceneDescription, setNewSceneDescription] = useState("");

  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [editSceneName, setEditSceneName] = useState("");
  const [editSceneDescription, setEditSceneDescription] = useState("");

  const [editFolderDialogOpen, setEditFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<SceneFolder | null>(null);
  const [editFolderName, setEditFolderName] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sceneToDelete, setSceneToDelete] = useState<Scene | null>(null);

  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<SceneFolder | null>(null);

  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [accessScene, setAccessScene] = useState<Scene | null>(null);

  const { data: scenes, isLoading: scenesLoading } = useQuery<Scene[]>({
    queryKey: ["/api/scenes"],
  });

  const { data: folders, isLoading: foldersLoading } = useQuery<SceneFolder[]>({
    queryKey: ["/api/scene-folders"],
  });

  const isLoading = scenesLoading || foldersLoading;

  const breadcrumbs = useMemo(() => {
    if (!folders || currentFolderId === null) return [];
    const path: SceneFolder[] = [];
    let id: number | null = currentFolderId;
    while (id !== null) {
      const folder = folders.find(f => f.id === id);
      if (!folder) break;
      path.unshift(folder);
      id = folder.parentId;
    }
    return path;
  }, [folders, currentFolderId]);

  const currentFolders = useMemo(() => {
    if (!folders) return [];
    return folders.filter(f => f.parentId === currentFolderId);
  }, [folders, currentFolderId]);

  const currentScenes = useMemo(() => {
    if (!scenes) return [];
    return scenes.filter(s => s.folderId === currentFolderId);
  }, [scenes, currentFolderId]);

  const folderSceneCounts = useMemo(() => {
    if (!scenes || !folders) return {};
    const counts: Record<number, number> = {};
    for (const folder of folders) {
      counts[folder.id] = scenes.filter(s => s.folderId === folder.id).length;
    }
    return counts;
  }, [scenes, folders]);

  const createSceneMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; folderId?: number | null }) => {
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
    mutationFn: async ({ id, ...data }: { id: number; name?: string; description?: string; folderId?: number | null }) => {
      const res = await apiRequest("PATCH", `/api/scenes/${id}`, data);
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

  const createFolderMutation = useMutation({
    mutationFn: async (data: { name: string; parentId?: number | null }) => {
      const res = await apiRequest("POST", "/api/scene-folders", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scene-folders"] });
      setCreateFolderDialogOpen(false);
      setNewFolderName("");
      toast({ title: "Папка создана" });
    },
    onError: () => {
      toast({ title: "Ошибка создания папки", variant: "destructive" });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/scene-folders/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scene-folders"] });
      setEditFolderDialogOpen(false);
      setEditingFolder(null);
      setEditFolderName("");
      toast({ title: "Папка переименована" });
    },
    onError: () => {
      toast({ title: "Ошибка переименования папки", variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/scene-folders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scene-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes"] });
      setDeleteFolderDialogOpen(false);
      setFolderToDelete(null);
      toast({ title: "Папка удалена" });
    },
    onError: () => {
      toast({ title: "Ошибка удаления папки", variant: "destructive" });
    },
  });

  const handleCreateScene = () => {
    if (!newSceneName.trim()) return;
    createSceneMutation.mutate({
      name: newSceneName.trim(),
      description: newSceneDescription.trim() || undefined,
      folderId: currentFolderId,
    });
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolderMutation.mutate({
      name: newFolderName.trim(),
      parentId: currentFolderId,
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

  const handleMoveScene = (scene: Scene, targetFolderId: number | null) => {
    updateSceneMutation.mutate({
      id: scene.id,
      folderId: targetFolderId,
    });
  };

  const handleEditFolder = (folder: SceneFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderDialogOpen(true);
  };

  const handleUpdateFolder = () => {
    if (!editingFolder || !editFolderName.trim()) return;
    updateFolderMutation.mutate({
      id: editingFolder.id,
      name: editFolderName.trim(),
    });
  };

  const handleDeleteClick = (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation();
    setSceneToDelete(scene);
    setDeleteDialogOpen(true);
  };

  const handleDeleteFolderClick = (folder: SceneFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    setFolderToDelete(folder);
    setDeleteFolderDialogOpen(true);
  };

  const handleAccessClick = (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation();
    setAccessScene(scene);
    setAccessDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!sceneToDelete) return;
    deleteSceneMutation.mutate(sceneToDelete.id);
  };

  const handleConfirmDeleteFolder = () => {
    if (!folderToDelete) return;
    deleteFolderMutation.mutate(folderToDelete.id);
  };

  const handleSelectScene = (sceneId: number) => {
    setCurrentSceneId(sceneId);
    setLocation("/app");
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" data-testid="icon-role-owner" />
            </TooltipTrigger>
            <TooltipContent>Владелец</TooltipContent>
          </Tooltip>
        );
      case "editor":
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <UserPen className="h-3.5 w-3.5 text-blue-500 shrink-0" data-testid="icon-role-editor" />
            </TooltipTrigger>
            <TooltipContent>Редактор</TooltipContent>
          </Tooltip>
        );
      case "viewer":
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" data-testid="icon-role-viewer" />
            </TooltipTrigger>
            <TooltipContent>Просмотр</TooltipContent>
          </Tooltip>
        );
      default:
        return null;
    }
  };

  const availableFoldersForMove = useMemo(() => {
    if (!folders) return [];
    return folders;
  }, [folders]);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 md:px-8">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary cursor-pointer"
            onClick={() => setLocation("/")}
            data-testid="button-home"
            title="На главную"
          >
            <Map className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">ГИС МО «Инженерные сети»</span>
        </div>
        <div className="flex items-center gap-2">
          <UserButton />
        </div>
      </header>

      <main className="mx-auto px-4 md:px-6 py-8 max-w-[1600px]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 min-w-0">
            {currentFolderId !== null && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const parentFolder = folders?.find(f => f.id === currentFolderId);
                  setCurrentFolderId(parentFolder?.parentId ?? null);
                }}
                data-testid="button-go-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
              <button
                onClick={() => setCurrentFolderId(null)}
                className="text-muted-foreground hover:text-foreground transition-colors font-medium"
                data-testid="breadcrumb-root"
              >
                Мои сцены
              </button>
              {breadcrumbs.map((folder) => (
                <span key={folder.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button
                    onClick={() => setCurrentFolderId(folder.id)}
                    className={`font-medium transition-colors ${folder.id === currentFolderId ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    data-testid={`breadcrumb-folder-${folder.id}`}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setNewFolderName("");
                setCreateFolderDialogOpen(true);
              }}
              data-testid="button-create-folder"
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              Папка
            </Button>
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
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
        ) : (currentFolders.length > 0 || currentScenes.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {currentFolders.map((folder) => (
              <Card
                key={`folder-${folder.id}`}
                className="cursor-pointer hover-elevate transition-all"
                onClick={() => setCurrentFolderId(folder.id)}
                data-testid={`card-folder-${folder.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Folder className="h-5 w-5 text-amber-500" />
                      <CardTitle className="text-base">{folder.name}</CardTitle>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-folder-menu-${folder.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => handleEditFolder(folder, e as unknown as React.MouseEvent)} data-testid={`button-edit-folder-${folder.id}`}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Переименовать
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => handleDeleteFolderClick(folder, e as unknown as React.MouseEvent)}
                          data-testid={`button-delete-folder-${folder.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Удалить папку
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {folderSceneCounts[folder.id] || 0} {(() => {
                      const count = folderSceneCounts[folder.id] || 0;
                      const mod10 = count % 10;
                      const mod100 = count % 100;
                      if (mod10 === 1 && mod100 !== 11) return "сцена";
                      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сцены";
                      return "сцен";
                    })()}
                  </p>
                </CardContent>
              </Card>
            ))}

            {currentScenes.map((scene) => (
              <Card
                key={`scene-${scene.id}`}
                className="cursor-pointer hover-elevate transition-all"
                onClick={() => handleSelectScene(scene.id)}
                data-testid={`card-scene-${scene.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FolderOpen className="h-5 w-5 text-primary shrink-0" />
                      <CardTitle className="text-base truncate" title={scene.name}>{scene.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-scene-menu-${scene.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {user?.role === "admin" && (
                            <DropdownMenuItem onClick={(e) => handleAccessClick(scene, e as unknown as React.MouseEvent)} data-testid={`button-access-scene-${scene.id}`}>
                              <Shield className="h-4 w-4 mr-2" />
                              Доступ
                            </DropdownMenuItem>
                          )}
                          {(scene.role === "owner" || scene.role === "editor" || user?.role === "admin") && (
                            <DropdownMenuItem onClick={(e) => handleEditScene(scene, e as unknown as React.MouseEvent)} data-testid={`button-edit-scene-${scene.id}`}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Редактировать
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger data-testid={`button-move-scene-${scene.id}`}>
                              <FolderInput className="h-4 w-4 mr-2" />
                              Переместить
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {scene.folderId !== null && (
                                <DropdownMenuItem
                                  onClick={(e) => { e.stopPropagation(); handleMoveScene(scene, null); }}
                                  data-testid={`button-move-scene-${scene.id}-root`}
                                >
                                  <ArrowLeft className="h-4 w-4 mr-2" />
                                  Корневая папка
                                </DropdownMenuItem>
                              )}
                              {availableFoldersForMove
                                .filter(f => f.id !== scene.folderId)
                                .map(folder => (
                                  <DropdownMenuItem
                                    key={folder.id}
                                    onClick={(e) => { e.stopPropagation(); handleMoveScene(scene, folder.id); }}
                                    data-testid={`button-move-scene-${scene.id}-to-${folder.id}`}
                                  >
                                    <Folder className="h-4 w-4 mr-2 text-amber-500" />
                                    {folder.name}
                                  </DropdownMenuItem>
                                ))}
                              {availableFoldersForMove.filter(f => f.id !== scene.folderId).length === 0 && scene.folderId === null && (
                                <DropdownMenuItem disabled>
                                  Нет папок
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {(scene.role === "owner" || user?.role === "admin") && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={(e) => handleDeleteClick(scene, e as unknown as React.MouseEvent)}
                                data-testid={`button-delete-scene-${scene.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Удалить
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {scene.description && (
                    <CardDescription className="line-clamp-2">
                      {scene.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {format(new Date(scene.updatedAt), "d MMM yyyy", { locale: ru })}
                      </span>
                    </div>
                    {getRoleIcon(scene.role)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="max-w-md mx-auto">
            <CardContent className="pt-6 text-center">
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">
                {currentFolderId !== null ? "Папка пуста" : "Нет доступных сцен"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {currentFolderId !== null
                  ? "Создайте сцену или переместите существующие сцены в эту папку"
                  : "Создайте первую сцену для начала работы с геоданными"}
              </p>
              <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-first-scene">
                <Plus className="h-4 w-4 mr-2" />
                Создать сцену
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderDialogOpen} onOpenChange={setCreateFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая папка</DialogTitle>
            <DialogDescription>
              Создайте папку для группировки сцен
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Название</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Например: Карты теплоснабжения"
                data-testid="input-folder-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
              data-testid="button-confirm-create-folder"
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Folder Dialog */}
      <Dialog open={editFolderDialogOpen} onOpenChange={setEditFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Переименовать папку</DialogTitle>
            <DialogDescription>
              Измените название папки
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-folder-name">Название</Label>
              <Input
                id="edit-folder-name"
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                placeholder="Название папки"
                data-testid="input-edit-folder-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFolderDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleUpdateFolder}
              disabled={!editFolderName.trim() || updateFolderMutation.isPending}
              data-testid="button-confirm-edit-folder"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Delete Folder Confirmation */}
      <AlertDialog open={deleteFolderDialogOpen} onOpenChange={setDeleteFolderDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить папку?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить папку "{folderToDelete?.name}"? Сцены из этой папки не будут удалены — они переместятся в корневую директорию.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteFolder}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-folder"
            >
              {deleteFolderMutation.isPending ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {accessScene && (
        <SceneAccessDialog
          open={accessDialogOpen}
          onOpenChange={setAccessDialogOpen}
          sceneId={accessScene.id}
          sceneName={accessScene.name}
        />
      )}
      <BugReportButton />
    </div>
  );
}
