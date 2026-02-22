import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Layers,
  Palette,
  Copy,
  Trash2,
  Loader2,
  Search,
  Minus,
  Filter,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LayerStylePanel } from "@/components/layer-style-panel";
import type { StyleConfig } from "@shared/schema";

interface LayerInstance {
  layerId: number;
  sceneId: number | null;
  sceneName: string | null;
  color: string;
  pointStyle: string;
  lineStyle: string;
  opacity: number;
  visible: boolean;
  featureCount: number;
  styleConfig?: any;
}

interface LayerGroup {
  name: string;
  geometryType: string;
  source: string;
  sourceFileName?: string;
  instances: LayerInstance[];
}

interface SceneInfo {
  id: number;
  name: string;
}

interface MatrixData {
  matrix: LayerGroup[];
  scenes: SceneInfo[];
}

const GEOMETRY_LABELS: Record<string, string> = {
  Point: "Точки",
  LineString: "Линии",
  Polygon: "Полигоны",
};

export default function AdminLayerManager() {
  const { toast } = useToast();
  const [searchFilter, setSearchFilter] = useState("");
  const [geometryFilter, setGeometryFilter] = useState<string>("all");
  const [selectedGroup, setSelectedGroup] = useState<LayerGroup | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{ layerId: number; sceneName: string } | null>(null);
  const [cloneTargetScenes, setCloneTargetScenes] = useState<number[]>([]);

  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ["/api/admin/layer-matrix"],
  });

  const cloneMutation = useMutation({
    mutationFn: async (params: { sourceLayerId: number; targetSceneIds: number[]; palette?: any }) => {
      const res = await apiRequest("POST", "/api/admin/clone-layer-to-scenes", params);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setCloneDialogOpen(false);
      setCloneTargetScenes([]);
      toast({
        title: "Слой добавлен",
        description: `Слой скопирован в ${data.created?.length || 0} сцен(ы)`,
      });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось скопировать слой", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (layerId: number) => {
      const res = await apiRequest("DELETE", "/api/admin/remove-layer-from-scene", { layerId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setRemoveConfirm(null);
      toast({ title: "Слой удалён", description: "Слой удалён из сцены" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось удалить слой", variant: "destructive" });
    },
  });

  const applyPaletteMutation = useMutation({
    mutationFn: async (params: { layerIds: number[]; palette: any }) => {
      const res = await apiRequest("POST", "/api/admin/apply-palette", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setPaletteOpen(false);
      toast({ title: "Палитра применена", description: "Стили обновлены во всех выбранных сценах" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось применить палитру", variant: "destructive" });
    },
  });

  const filteredMatrix = useMemo(() => {
    if (!matrixData?.matrix) return [];
    return matrixData.matrix.filter((group) => {
      const matchesSearch = !searchFilter ||
        group.name.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesGeometry = geometryFilter === "all" || group.geometryType === geometryFilter;
      return matchesSearch && matchesGeometry;
    });
  }, [matrixData?.matrix, searchFilter, geometryFilter]);

  const scenes = matrixData?.scenes || [];

  const getInstanceForScene = (group: LayerGroup, sceneId: number): LayerInstance | undefined => {
    return group.instances.find((inst) => inst.sceneId === sceneId);
  };

  const getUnassignedInstance = (group: LayerGroup): LayerInstance | undefined => {
    return group.instances.find((inst) => inst.sceneId === null);
  };

  const getAnySourceInstance = (group: LayerGroup): LayerInstance | undefined => {
    return group.instances[0];
  };

  const handleCellClick = (group: LayerGroup, sceneId: number) => {
    const existing = getInstanceForScene(group, sceneId);
    if (existing) {
      setRemoveConfirm({
        layerId: existing.layerId,
        sceneName: scenes.find((s) => s.id === sceneId)?.name || `Сцена ${sceneId}`,
      });
    } else {
      const source = getAnySourceInstance(group);
      if (source) {
        setSelectedGroup(group);
        setCloneTargetScenes([sceneId]);
        setCloneDialogOpen(true);
      }
    }
  };

  const handleOpenPalette = (group: LayerGroup) => {
    setSelectedGroup(group);
    setPaletteOpen(true);
  };

  const handlePaletteSave = (updates: {
    color?: string;
    pointStyle?: string;
    lineStyle?: string;
    opacity?: number;
    styleConfig?: StyleConfig;
  }) => {
    if (!selectedGroup) return;
    const layerIds = selectedGroup.instances.map((i) => i.layerId);
    applyPaletteMutation.mutate({
      layerIds,
      palette: updates,
    });
  };

  const handleCloneConfirm = () => {
    if (!selectedGroup) return;
    const source = getAnySourceInstance(selectedGroup);
    if (!source) return;
    cloneMutation.mutate({
      sourceLayerId: source.layerId,
      targetSceneIds: cloneTargetScenes,
    });
  };

  const handleBulkClone = (group: LayerGroup) => {
    setSelectedGroup(group);
    const existingSceneIds = new Set(group.instances.filter(i => i.sceneId).map(i => i.sceneId));
    const available = scenes.filter(s => !existingSceneIds.has(s.id));
    setCloneTargetScenes(available.map(s => s.id));
    setCloneDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-full mx-auto space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-full mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/scenes">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Менеджер слоёв</h1>
          </div>
          <Badge variant="secondary" data-testid="badge-layer-count">
            {filteredMatrix.length} слоёв
          </Badge>
          <Badge variant="outline" data-testid="badge-scene-count">
            {scenes.length} сцен
          </Badge>
        </div>
      </div>

      <div className="max-w-full mx-auto px-6 py-4 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск слоя..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-10"
              data-testid="input-search-layers"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={geometryFilter} onValueChange={setGeometryFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-geometry-filter">
                <SelectValue placeholder="Тип геометрии" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                <SelectItem value="Point">Точки</SelectItem>
                <SelectItem value="LineString">Линии</SelectItem>
                <SelectItem value="Polygon">Полигоны</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <ScrollArea className="w-full">
              <div className="min-w-max">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="sticky left-0 z-20 bg-muted/95 backdrop-blur px-4 py-3 text-left font-medium min-w-[300px] border-r">
                        Слой
                      </th>
                      <th className="sticky left-[300px] z-20 bg-muted/95 backdrop-blur px-2 py-3 text-center font-medium w-[80px] border-r">
                        Действия
                      </th>
                      {scenes.map((scene) => (
                        <th
                          key={scene.id}
                          className="px-2 py-3 text-center font-medium min-w-[120px] border-r last:border-r-0"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate max-w-[110px] mx-auto cursor-default" data-testid={`text-scene-header-${scene.id}`}>
                                {scene.name}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{scene.name}</TooltipContent>
                          </Tooltip>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatrix.length === 0 ? (
                      <tr>
                        <td colSpan={scenes.length + 2} className="text-center py-12 text-muted-foreground">
                          {searchFilter || geometryFilter !== "all"
                            ? "Нет слоёв, подходящих под фильтр"
                            : "Нет загруженных слоёв"}
                        </td>
                      </tr>
                    ) : (
                      filteredMatrix.map((group, idx) => {
                        const sourceInst = getAnySourceInstance(group);
                        return (
                          <tr
                            key={`${group.name}__${group.geometryType}`}
                            className={`border-b hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                            data-testid={`row-layer-${idx}`}
                          >
                            <td className="sticky left-0 z-10 bg-background px-4 py-2.5 border-r">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0 border"
                                  style={{ backgroundColor: sourceInst?.color || "#ccc" }}
                                />
                                <div className="min-w-0">
                                  <div className="font-medium truncate max-w-[220px]" data-testid={`text-layer-name-${idx}`}>
                                    {group.name}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                                      {GEOMETRY_LABELS[group.geometryType] || group.geometryType}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      {sourceInst?.featureCount || 0} объектов
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="sticky left-[300px] z-10 bg-background px-1 py-2.5 border-r">
                              <div className="flex items-center gap-0.5 justify-center">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleOpenPalette(group)}
                                      data-testid={`button-palette-${idx}`}
                                    >
                                      <Palette className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Единая палитра</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleBulkClone(group)}
                                      data-testid={`button-bulk-clone-${idx}`}
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Добавить во все сцены</TooltipContent>
                                </Tooltip>
                              </div>
                            </td>
                            {scenes.map((scene) => {
                              const instance = getInstanceForScene(group, scene.id);
                              return (
                                <td
                                  key={scene.id}
                                  className="px-2 py-2.5 text-center border-r last:border-r-0"
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`w-8 h-8 rounded-md border-2 flex items-center justify-center transition-all mx-auto
                                          ${instance
                                            ? "border-primary bg-primary/10 hover:bg-primary/20 cursor-pointer"
                                            : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/50 cursor-pointer"
                                          }`}
                                        onClick={() => handleCellClick(group, scene.id)}
                                        data-testid={`cell-layer-${idx}-scene-${scene.id}`}
                                      >
                                        {instance ? (
                                          <div className="flex flex-col items-center">
                                            <div
                                              className="w-3 h-3 rounded-full"
                                              style={{ backgroundColor: instance.color }}
                                            />
                                          </div>
                                        ) : (
                                          <Minus className="h-3 w-3 text-muted-foreground/30" />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {instance
                                        ? `${group.name} в "${scene.name}" (${instance.featureCount} объектов) — нажмите для удаления`
                                        : `Добавить "${group.name}" в "${scene.name}"`}
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить слой в сцены</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">Слой</Label>
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-clone-layer-name">
                {selectedGroup?.name} ({GEOMETRY_LABELS[selectedGroup?.geometryType || ""] || selectedGroup?.geometryType})
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Целевые сцены</Label>
              <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-2">
                {scenes.map((scene) => {
                  const alreadyExists = selectedGroup?.instances.some(
                    (i) => i.sceneId === scene.id
                  );
                  if (alreadyExists) return null;
                  return (
                    <label
                      key={scene.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1"
                    >
                      <Checkbox
                        checked={cloneTargetScenes.includes(scene.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setCloneTargetScenes((prev) => [...prev, scene.id]);
                          } else {
                            setCloneTargetScenes((prev) => prev.filter((id) => id !== scene.id));
                          }
                        }}
                        data-testid={`checkbox-clone-scene-${scene.id}`}
                      />
                      <span className="text-sm">{scene.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
              Слой будет скопирован с текущим оформлением. Чтобы изменить стиль для всех экземпляров, используйте кнопку «Палитра» после клонирования.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCloneConfirm}
              disabled={cloneTargetScenes.length === 0 || cloneMutation.isPending}
              data-testid="button-clone-confirm"
            >
              {cloneMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Добавить ({cloneTargetScenes.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedGroup && (() => {
        const source = getAnySourceInstance(selectedGroup);
        if (!source) return null;
        return (
          <LayerStylePanel
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            layer={{
              id: source.layerId,
              name: `${selectedGroup.name} (все сцены: ${selectedGroup.instances.length} экз.)`,
              geometryType: selectedGroup.geometryType,
              color: source.color,
              pointStyle: source.pointStyle,
              lineStyle: source.lineStyle,
              opacity: source.opacity,
              styleConfig: source.styleConfig,
            }}
            onSave={handlePaletteSave}
          />
        );
      })()}

      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить слой из сцены?</AlertDialogTitle>
            <AlertDialogDescription>
              Слой и все его объекты будут удалены из сцены "{removeConfirm?.sceneName}".
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeConfirm && removeMutation.mutate(removeConfirm.layerId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

