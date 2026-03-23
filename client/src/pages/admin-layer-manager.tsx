import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { parseShapefileWithEncoding } from "@/lib/shapefile-parser";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Layers,
  Palette,
  Copy,
  Trash2,
  Loader2,
  Search,
  Filter,
  Pencil,
  Table2,
  Download,
  Info,
  Upload,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Map,
  Plus,
  MoreHorizontal,
  X,
  FileUp,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LayerStylePanel } from "@/components/layer-style-panel";
import { LayerAttributeTableWrapper } from "@/components/layer-attribute-table-wrapper";
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
  networkType?: string | null;
}

interface LayerGroup {
  name: string;
  geometryType: string;
  source: string;
  sourceFileName?: string;
  networkType?: string | null;
  adminGroupId?: number | null;
  metadata?: any;
  instances: LayerInstance[];
}

interface SceneInfo {
  id: number;
  name: string;
}

interface AdminLayerGroup {
  id: number;
  name: string;
  displayOrder: number;
  createdAt: string;
}

interface MatrixData {
  matrix: LayerGroup[];
  scenes: SceneInfo[];
  adminGroups: AdminLayerGroup[];
}

const GEOMETRY_LABELS: Record<string, string> = {
  Point: "Точки",
  LineString: "Линии",
  Polygon: "Полигоны",
};

const NETWORK_TYPE_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: "source", label: "Источник", color: "#e53935" },
  { value: "ctp", label: "ЦТП", color: "#8e24aa" },
  { value: "consumer", label: "Потребитель", color: "#43a047" },
  { value: "segment", label: "Участок", color: "#1e88e5" },
  { value: "valve", label: "Задвижка", color: "#f4511e" },
  { value: "node", label: "Узел", color: "#6d4c41" },
  { value: "pump", label: "Насос", color: "#00acc1" },
];

const SERVER_UPLOAD_THRESHOLD = 10 * 1024 * 1024;

export default function AdminLayerManager() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // filters
  const [searchFilter, setSearchFilter] = useState("");
  const [geometryFilter, setGeometryFilter] = useState<string>("all");

  // palette
  const [selectedGroup, setSelectedGroup] = useState<LayerGroup | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // scene visibility modal
  const [sceneVisibilityGroup, setSceneVisibilityGroup] = useState<LayerGroup | null>(null);
  const [sceneVisibilityChanges, setSceneVisibilityChanges] = useState<Set<number>>(new Set());

  // rename
  const [renameGroup, setRenameGroup] = useState<LayerGroup | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // metadata
  const [metadataGroup, setMetadataGroup] = useState<LayerGroup | null>(null);
  const [metaDescription, setMetaDescription] = useState("");
  const [metaSource, setMetaSource] = useState("");
  const [metaResponsible, setMetaResponsible] = useState("");
  const [metaUpdated, setMetaUpdated] = useState("");

  // attribute table
  const [attrTableLayer, setAttrTableLayer] = useState<{ id: number; name: string } | null>(null);

  // export dialog
  const [exportGroup, setExportGroup] = useState<LayerGroup | null>(null);
  const [exportSceneId, setExportSceneId] = useState<string>("");
  const [exportFormat, setExportFormat] = useState<string>("geojson");

  // SHP upload
  const [shpUploadOpen, setShpUploadOpen] = useState(false);
  const [uploadTargetScenes, setUploadTargetScenes] = useState<number[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadPercent, setUploadPercent] = useState(0);

  // clone dialog (legacy for bulk-clone)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneTargetScenes, setCloneTargetScenes] = useState<number[]>([]);

  // remove confirm
  const [removeConfirm, setRemoveConfirm] = useState<{ layerId: number; sceneName: string } | null>(null);

  // admin layer groups management
  const [groupsManagerOpen, setGroupsManagerOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editGroupId, setEditGroupId] = useState<number | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<AdminLayerGroup | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ["/api/admin/layer-matrix"],
  });

  const scenes = matrixData?.scenes || [];
  const adminGroups = matrixData?.adminGroups || [];

  // ─── mutations ────────────────────────────────────────────
  const cloneMutation = useMutation({
    mutationFn: async (params: { sourceLayerId: number; targetSceneIds: number[] }) => {
      const res = await apiRequest("POST", "/api/admin/clone-layer-to-scenes", params);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setCloneDialogOpen(false);
      setCloneTargetScenes([]);
      toast({ title: "Слой добавлен", description: `Скопирован в ${data.created?.length || 0} сцен(ы)` });
    },
    onError: () => toast({ title: "Ошибка", description: "Не удалось скопировать слой", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (layerId: number) => {
      const res = await apiRequest("DELETE", "/api/admin/remove-layer-from-scene", { layerId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setRemoveConfirm(null);
      toast({ title: "Слой удалён" });
    },
    onError: () => toast({ title: "Ошибка", description: "Не удалось удалить слой", variant: "destructive" }),
  });

  const updateNetworkTypeMutation = useMutation({
    mutationFn: async (params: { layerIds: number[]; networkType: string | null }) => {
      await Promise.all(params.layerIds.map(id =>
        apiRequest("PATCH", `/api/editable-layers/${id}`, { networkType: params.networkType })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      toast({ title: "Тип сети обновлён" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const applyPaletteMutation = useMutation({
    mutationFn: async (params: { layerIds: number[]; palette: any }) => {
      const res = await apiRequest("POST", "/api/admin/apply-palette", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setPaletteOpen(false);
      toast({ title: "Палитра применена" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: async (params: { oldName: string; geometryType: string; newName: string }) => {
      const res = await apiRequest("POST", "/api/admin/rename-layer", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      setRenameGroup(null);
      toast({ title: "Слой переименован" });
    },
    onError: () => toast({ title: "Ошибка переименования", variant: "destructive" }),
  });

  const metadataMutation = useMutation({
    mutationFn: async (params: { layerName: string; geometryType: string; metadata: Record<string, unknown> }) => {
      const res = await apiRequest("POST", "/api/admin/layer-metadata", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setMetadataGroup(null);
      toast({ title: "Метаданные сохранены" });
    },
    onError: () => toast({ title: "Ошибка сохранения метаданных", variant: "destructive" }),
  });

  const createGroupMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/admin/layer-groups", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setNewGroupName("");
      toast({ title: "Группа создана" });
    },
    onError: () => toast({ title: "Ошибка создания группы", variant: "destructive" }),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (params: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/layer-groups/${params.id}`, { name: params.name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setEditGroupId(null);
      setEditGroupName("");
      toast({ title: "Группа переименована" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/layer-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setDeleteGroupConfirm(null);
      toast({ title: "Группа удалена" });
    },
    onError: () => toast({ title: "Ошибка удаления группы", variant: "destructive" }),
  });

  const assignGroupMutation = useMutation({
    mutationFn: async (params: { layerName: string; geometryType: string; adminGroupId: number | null }) => {
      const res = await apiRequest("POST", "/api/admin/assign-layer-group", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
    },
    onError: () => toast({ title: "Ошибка назначения группы", variant: "destructive" }),
  });

  // ─── filtered matrix ──────────────────────────────────────
  const filteredMatrix = useMemo(() => {
    if (!matrixData?.matrix) return [];
    return matrixData.matrix.filter((group) => {
      const matchesSearch = !searchFilter || group.name.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesGeometry = geometryFilter === "all" || group.geometryType === geometryFilter;
      return matchesSearch && matchesGeometry;
    });
  }, [matrixData?.matrix, searchFilter, geometryFilter]);

  // ─── grouped matrix ───────────────────────────────────────
  const { groupedLayers, ungroupedLayers } = useMemo(() => {
    const grouped: Record<number, LayerGroup[]> = {};
    const ungrouped: LayerGroup[] = [];
    for (const group of filteredMatrix) {
      if (group.adminGroupId) {
        if (!grouped[group.adminGroupId]) grouped[group.adminGroupId] = [];
        grouped[group.adminGroupId].push(group);
      } else {
        ungrouped.push(group);
      }
    }
    return { groupedLayers: grouped, ungroupedLayers: ungrouped };
  }, [filteredMatrix]);

  // ─── helpers ──────────────────────────────────────────────
  const getAnySourceInstance = (group: LayerGroup) => group.instances[0];

  const handleOpenPalette = (group: LayerGroup) => { setSelectedGroup(group); setPaletteOpen(true); };

  const handlePaletteSave = (updates: { color?: string; pointStyle?: string; lineStyle?: string; opacity?: number; styleConfig?: StyleConfig }) => {
    if (!selectedGroup) return;
    applyPaletteMutation.mutate({ layerIds: selectedGroup.instances.map(i => i.layerId), palette: updates });
  };

  const handleBulkClone = (group: LayerGroup) => {
    setSelectedGroup(group);
    const existingSceneIds = new Set(group.instances.filter(i => i.sceneId).map(i => i.sceneId));
    setCloneTargetScenes(scenes.filter(s => !existingSceneIds.has(s.id)).map(s => s.id));
    setCloneDialogOpen(true);
  };

  const handleCloneConfirm = () => {
    if (!selectedGroup) return;
    const source = getAnySourceInstance(selectedGroup);
    if (!source) return;
    cloneMutation.mutate({ sourceLayerId: source.layerId, targetSceneIds: cloneTargetScenes });
  };

  // ─── scene visibility modal ───────────────────────────────
  const openSceneVisibility = (group: LayerGroup) => {
    setSceneVisibilityGroup(group);
    const present = new Set(group.instances.filter(i => i.sceneId !== null).map(i => i.sceneId as number));
    setSceneVisibilityChanges(present);
  };

  const applySceneVisibilityMutation = useMutation({
    mutationFn: async (params: { group: LayerGroup; toAdd: number[]; toRemove: number[] }) => {
      const source = getAnySourceInstance(params.group);
      if (!source) throw new Error("No source instance");
      for (const sceneId of params.toRemove) {
        const inst = params.group.instances.find(i => i.sceneId === sceneId);
        if (inst) await apiRequest("DELETE", "/api/admin/remove-layer-from-scene", { layerId: inst.layerId });
      }
      if (params.toAdd.length > 0) {
        await apiRequest("POST", "/api/admin/clone-layer-to-scenes", {
          sourceLayerId: source.layerId,
          targetSceneIds: params.toAdd,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      setSceneVisibilityGroup(null);
      toast({ title: "Сцены обновлены" });
    },
    onError: () => toast({ title: "Ошибка обновления сцен", variant: "destructive" }),
  });

  const handleApplySceneVisibility = () => {
    if (!sceneVisibilityGroup) return;
    const currentPresent = new Set(sceneVisibilityGroup.instances.filter(i => i.sceneId !== null).map(i => i.sceneId as number));
    const toAdd = Array.from(sceneVisibilityChanges).filter(id => !currentPresent.has(id));
    const toRemove = Array.from(currentPresent).filter(id => !sceneVisibilityChanges.has(id));
    applySceneVisibilityMutation.mutate({ group: sceneVisibilityGroup, toAdd, toRemove });
  };

  // ─── rename ───────────────────────────────────────────────
  const openRename = (group: LayerGroup) => {
    setRenameGroup(group);
    setRenameValue(group.name);
  };

  const handleRenameConfirm = () => {
    if (!renameGroup || !renameValue.trim()) return;
    renameMutation.mutate({ oldName: renameGroup.name, geometryType: renameGroup.geometryType, newName: renameValue.trim() });
  };

  // ─── metadata ─────────────────────────────────────────────
  const openMetadata = (group: LayerGroup) => {
    setMetadataGroup(group);
    const m = group.metadata || {};
    setMetaDescription(m.description || "");
    setMetaSource(m.source || group.sourceFileName || "");
    setMetaResponsible(m.responsible || "");
    setMetaUpdated(m.updatedAt || "");
  };

  const handleMetadataSave = () => {
    if (!metadataGroup) return;
    metadataMutation.mutate({
      layerName: metadataGroup.name,
      geometryType: metadataGroup.geometryType,
      metadata: { description: metaDescription, source: metaSource, responsible: metaResponsible, updatedAt: metaUpdated },
    });
  };

  // ─── export ───────────────────────────────────────────────
  const openExport = (group: LayerGroup) => {
    setExportGroup(group);
    const firstWithScene = group.instances.find(i => i.sceneId !== null);
    setExportSceneId(firstWithScene ? String(firstWithScene.layerId) : "");
    setExportFormat("geojson");
  };

  const handleExport = () => {
    if (!exportSceneId) return;
    window.open(`/api/editable-layers/${exportSceneId}/export/${exportFormat}`, "_blank");
    setExportGroup(null);
  };

  // ─── SHP upload ───────────────────────────────────────────
  const handleShpFile = async (files: FileList) => {
    if (!files || files.length === 0) return;
    if (uploadTargetScenes.length === 0) {
      toast({ title: "Выберите хотя бы одну сцену", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress("");
    setUploadPercent(0);

    try {
      const file = files[0];
      const fileSize = file.size;
      let uploadedLayerIds: number[] = [];

      if (fileSize > SERVER_UPLOAD_THRESHOLD) {
        setUploadProgress(`Загрузка ${file.name} (${(fileSize / 1024 / 1024).toFixed(1)} МБ)...`);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("sceneId", String(uploadTargetScenes[0]));
        const res = await fetch("/api/datasets/upload", { method: "POST", body: formData, credentials: "include" });
        if (!res.ok) throw new Error((await res.json()).message || "Ошибка загрузки");
        const { uploadId } = await res.json();
        if (uploadId) {
          await new Promise<void>((resolve, reject) => {
            const es = new EventSource(`/api/uploads/${uploadId}/progress`);
            es.onmessage = (ev) => {
              try {
                const d = JSON.parse(ev.data);
                setUploadPercent(d.progress || 0);
                if (d.status === "processing") setUploadProgress(`Обработка...`);
                if (d.status === "completed") {
                  if (d.layerId) uploadedLayerIds.push(d.layerId);
                  es.close(); resolve();
                }
                if (d.status === "failed") { es.close(); reject(new Error(d.error || "Ошибка")); }
              } catch { /* ignore */ }
            };
            es.onerror = () => { es.close(); reject(new Error("Потеряно соединение")); };
          });
        }
      } else {
        setUploadProgress(`Обработка ${file.name}...`);
        const arrayBuffer = await file.arrayBuffer();
        const parsedLayers = await parseShapefileWithEncoding(arrayBuffer, file.name);
        if (parsedLayers.length === 0) throw new Error("Нет слоёв в архиве");
        for (const layer of parsedLayers) {
          if (!layer.geojson.features?.length) continue;
          const firstFeature = layer.geojson.features[0];
          const geometryType = firstFeature.geometry?.type || "Unknown";
          const res = await apiRequest("POST", "/api/datasets/import", {
            name: layer.name,
            geometryType,
            geojson: layer.geojson,
            sourceFileName: file.name,
            sourceFiles: layer.sourceFiles || [],
            crs: layer.sourceCrs || "EPSG:4326",
            sceneId: uploadTargetScenes[0],
          });
          if (!res.ok) throw new Error((await res.json()).message || "Ошибка импорта");
          const newLayer = await res.json();
          if (newLayer?.id) uploadedLayerIds.push(newLayer.id);
        }
      }

      // Clone to remaining selected scenes
      const remainingScenes = uploadTargetScenes.slice(1);
      if (remainingScenes.length > 0 && uploadedLayerIds.length > 0) {
        setUploadProgress("Распространение по сценам...");
        for (const layerId of uploadedLayerIds) {
          await apiRequest("POST", "/api/admin/clone-layer-to-scenes", {
            sourceLayerId: layerId,
            targetSceneIds: remainingScenes,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/admin/layer-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      setShpUploadOpen(false);
      setUploadTargetScenes([]);
      toast({ title: "Файл загружен", description: `Слой добавлен в ${uploadTargetScenes.length} сцен(ы)` });
    } catch (error) {
      toast({
        title: "Ошибка загрузки",
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress("");
      setUploadPercent(0);
    }
  };

  // ─── render helpers ───────────────────────────────────────
  const renderLayerRow = (group: LayerGroup, idx: number, isGrouped = false) => {
    const sourceInst = getAnySourceInstance(group);
    return (
      <tr
        key={`${group.name}__${group.geometryType}`}
        className={`border-b hover:bg-muted/30 transition-colors ${
          isGrouped ? "bg-primary/[0.03]" : idx % 2 === 0 ? "" : "bg-muted/10"
        }`}
        style={{ height: "52px" }}
      >
        <td
          className={`py-0 border-r ${isGrouped ? "border-l-[3px] border-l-primary/30 pl-7 pr-3" : "px-3"}`}
          style={{ height: "52px", width: "380px", minWidth: "380px" }}
        >
          <div className="flex items-center gap-1.5 h-full">
            <div className="w-3 h-3 rounded-full flex-shrink-0 border" style={{ backgroundColor: sourceInst?.color || "#ccc" }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate max-w-[200px] text-sm" data-testid={`text-layer-name-${idx}`}>
                {group.name}
              </div>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1 py-0">{GEOMETRY_LABELS[group.geometryType] || group.geometryType}</Badge>
                <span className="text-[10px] text-muted-foreground">{sourceInst?.featureCount || 0} obj</span>
                <Select
                  value={group.networkType || "__none__"}
                  onValueChange={(val) => {
                    const newType = val === "__none__" ? null : val;
                    updateNetworkTypeMutation.mutate({ layerIds: group.instances.map(i => i.layerId), networkType: newType });
                  }}
                >
                  <SelectTrigger className="h-4 text-[10px] w-auto min-w-[70px] px-1 py-0" data-testid={`select-network-type-${idx}`}>
                    <SelectValue placeholder="Тип" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {NETWORK_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </td>

        {/* Action buttons */}
        <td className="px-2 py-0" style={{ height: "52px" }}>
          <div className="flex items-center gap-0.5 justify-center flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openRename(group)} data-testid={`button-rename-${idx}`}>
                  <Pencil className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Переименовать</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openSceneVisibility(group)} data-testid={`button-scenes-${idx}`}>
                  <Map className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Управление сценами</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-6 w-6"
                  onClick={() => {
                    const inst = group.instances.find(i => i.sceneId !== null);
                    if (inst) setAttrTableLayer({ id: inst.layerId, name: group.name });
                    else toast({ title: "Нет экземпляров слоя", variant: "destructive" });
                  }}
                  data-testid={`button-table-${idx}`}
                >
                  <Table2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Таблица атрибутов</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openExport(group)} data-testid={`button-export-${idx}`}>
                  <Download className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Экспорт</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openMetadata(group)} data-testid={`button-metadata-${idx}`}>
                  <Info className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Метаданные</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleOpenPalette(group)} data-testid={`button-palette-${idx}`}>
                  <Palette className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Единая палитра</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleBulkClone(group)} data-testid={`button-bulk-clone-${idx}`}>
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Добавить во все сцены</TooltipContent>
            </Tooltip>

            {/* Assign to group */}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" data-testid={`button-group-${idx}`}>
                      <Folder className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => assignGroupMutation.mutate({ layerName: group.name, geometryType: group.geometryType, adminGroupId: null })}>
                      <X className="h-3 w-3 mr-2" /> Без группы
                    </DropdownMenuItem>
                    {adminGroups.length > 0 && <DropdownMenuSeparator />}
                    {adminGroups.map(ag => (
                      <DropdownMenuItem
                        key={ag.id}
                        onClick={() => assignGroupMutation.mutate({ layerName: group.name, geometryType: group.geometryType, adminGroupId: ag.id })}
                        className={group.adminGroupId === ag.id ? "font-semibold" : ""}
                      >
                        <Folder className="h-3 w-3 mr-2" /> {ag.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipTrigger>
              <TooltipContent>Переместить в группу</TooltipContent>
            </Tooltip>
          </div>
        </td>
      </tr>
    );
  };

  const renderGroupHeader = (ag: AdminLayerGroup) => {
    const isCollapsed = collapsedGroups.has(ag.id);
    const layerCount = (groupedLayers[ag.id] || []).length;
    return (
      <tr key={`group-header-${ag.id}`} className="border-b bg-muted/50">
        <td colSpan={1} className="py-0 border-r border-l-[3px] border-l-primary/60 pl-2 pr-3">
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 hover:text-foreground transition-colors w-full text-left py-1.5"
            onClick={() => setCollapsedGroups(prev => {
              const next = new Set(prev);
              if (next.has(ag.id)) next.delete(ag.id);
              else next.add(ag.id);
              return next;
            })}
            data-testid={`button-group-header-${ag.id}`}
          >
            {isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />
              : <ChevronDown className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />}
            <FolderOpen className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />
            <span className="truncate">{ag.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1 flex-shrink-0 bg-primary/10 text-primary/80 border-0">
              {layerCount}
            </Badge>
          </button>
        </td>
        <td className="bg-muted/50" />
      </tr>
    );
  };

  const renderGroupFooter = (ag: AdminLayerGroup) => (
    <tr key={`group-footer-${ag.id}`}>
      <td colSpan={2} className="border-l-[3px] border-l-primary/20 bg-primary/[0.02]" style={{ height: "4px", padding: 0 }} />
    </tr>
  );

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

  // ─── build rows ───────────────────────────────────────────
  const leftRows: JSX.Element[] = [];
  let rowIdx = 0;

  for (const ag of adminGroups) {
    const agLayers = groupedLayers[ag.id] || [];
    if (agLayers.length === 0 && searchFilter) continue;
    leftRows.push(renderGroupHeader(ag));
    if (!collapsedGroups.has(ag.id)) {
      for (const g of agLayers) {
        leftRows.push(renderLayerRow(g, rowIdx, true));
        rowIdx++;
      }
      leftRows.push(renderGroupFooter(ag));
    }
  }
  for (const g of ungroupedLayers) {
    leftRows.push(renderLayerRow(g, rowIdx));
    rowIdx++;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/gis/scenes">
          <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-sm font-semibold" data-testid="text-page-title">Менеджер слоёв</h1>
        </div>
        <Badge variant="secondary" data-testid="badge-layer-count">{filteredMatrix.length} слоёв</Badge>
        <Badge variant="outline" data-testid="badge-scene-count">{scenes.length} сцен</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => setGroupsManagerOpen(true)} data-testid="button-manage-groups">
                <FolderPlus className="h-4 w-4 mr-1.5" />
                Группы
              </Button>
            </TooltipTrigger>
            <TooltipContent>Управление группами слоёв</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={() => setShpUploadOpen(true)} data-testid="button-shp-upload">
                <FileUp className="h-4 w-4 mr-1.5" />
                Загрузить SHP
              </Button>
            </TooltipTrigger>
            <TooltipContent>Загрузить Shapefile</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="max-w-full mx-auto px-6 py-4 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Поиск слоя..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} className="pl-10" data-testid="input-search-layers" />
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
            <table className="border-collapse text-sm w-full">
              <thead>
                <tr className="border-b bg-muted/50" style={{ height: "44px" }}>
                  <th className="px-3 py-0 text-left font-medium border-r" style={{ height: "44px", width: "380px", minWidth: "380px" }}>Слой</th>
                  <th className="px-2 py-0 text-center font-medium" style={{ height: "44px" }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {leftRows.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="text-center py-12 text-muted-foreground">
                      {searchFilter || geometryFilter !== "all" ? "Нет слоёв, подходящих под фильтр" : "Нет загруженных слоёв"}
                    </td>
                  </tr>
                ) : leftRows}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── Scene Visibility Modal ── */}
      <Dialog open={!!sceneVisibilityGroup} onOpenChange={(o) => !o && setSceneVisibilityGroup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Сцены — «{sceneVisibilityGroup?.name}»</DialogTitle>
            <DialogDescription>Отметьте сцены, в которых должен присутствовать слой</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto border rounded-md p-2">
            {scenes.map(scene => (
              <label key={scene.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                <Checkbox
                  checked={sceneVisibilityChanges.has(scene.id)}
                  onCheckedChange={(checked) => {
                    setSceneVisibilityChanges(prev => {
                      const next = new Set(prev);
                      if (checked) next.add(scene.id); else next.delete(scene.id);
                      return next;
                    });
                  }}
                  data-testid={`checkbox-scene-vis-${scene.id}`}
                />
                <span className="text-sm">{scene.name}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSceneVisibilityGroup(null)}>Отмена</Button>
            <Button onClick={handleApplySceneVisibility} disabled={applySceneVisibilityMutation.isPending} data-testid="button-apply-scenes">
              {applySceneVisibilityMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename Dialog ── */}
      <Dialog open={!!renameGroup} onOpenChange={(o) => !o && setRenameGroup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Переименовать слой</DialogTitle>
            <DialogDescription>Новое имя будет применено ко всем экземплярам слоя во всех сценах</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Текущее имя</Label>
              <p className="text-sm font-medium">{renameGroup?.name}</p>
            </div>
            <div>
              <Label htmlFor="rename-input" className="text-sm">Новое имя</Label>
              <Input
                id="rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRenameConfirm()}
                className="mt-1"
                data-testid="input-rename-layer"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameGroup(null)}>Отмена</Button>
            <Button onClick={handleRenameConfirm} disabled={!renameValue.trim() || renameMutation.isPending} data-testid="button-rename-confirm">
              {renameMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Metadata Dialog ── */}
      <Dialog open={!!metadataGroup} onOpenChange={(o) => !o && setMetadataGroup(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Метаданные — «{metadataGroup?.name}»</DialogTitle>
            <DialogDescription>Справочная информация о слое</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="meta-desc" className="text-sm">Описание</Label>
              <Textarea id="meta-desc" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} className="mt-1 resize-none" rows={3} placeholder="Что содержит этот слой..." data-testid="textarea-meta-description" />
            </div>
            <div>
              <Label htmlFor="meta-source" className="text-sm">Источник данных</Label>
              <Input id="meta-source" value={metaSource} onChange={(e) => setMetaSource(e.target.value)} className="mt-1" placeholder="Файл, организация, URL..." data-testid="input-meta-source" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="meta-resp" className="text-sm">Ответственный</Label>
                <Input id="meta-resp" value={metaResponsible} onChange={(e) => setMetaResponsible(e.target.value)} className="mt-1" placeholder="Имя, отдел..." data-testid="input-meta-responsible" />
              </div>
              <div>
                <Label htmlFor="meta-upd" className="text-sm">Дата обновления</Label>
                <Input id="meta-upd" type="date" value={metaUpdated} onChange={(e) => setMetaUpdated(e.target.value)} className="mt-1" data-testid="input-meta-updated" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetadataGroup(null)}>Отмена</Button>
            <Button onClick={handleMetadataSave} disabled={metadataMutation.isPending} data-testid="button-metadata-save">
              {metadataMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Export Dialog ── */}
      <Dialog open={!!exportGroup} onOpenChange={(o) => !o && setExportGroup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Экспорт — «{exportGroup?.name}»</DialogTitle>
            <DialogDescription>Выберите экземпляр слоя и формат экспорта</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-sm">Сцена</Label>
              <Select value={exportSceneId} onValueChange={setExportSceneId}>
                <SelectTrigger className="mt-1" data-testid="select-export-scene">
                  <SelectValue placeholder="Выберите сцену" />
                </SelectTrigger>
                <SelectContent>
                  {exportGroup?.instances.filter(i => i.sceneId !== null).map(inst => (
                    <SelectItem key={inst.layerId} value={String(inst.layerId)}>
                      {scenes.find(s => s.id === inst.sceneId)?.name || `Сцена ${inst.sceneId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Формат</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="mt-1" data-testid="select-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="geojson">GeoJSON</SelectItem>
                  <SelectItem value="shapefile">Shapefile (ZIP)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportGroup(null)}>Отмена</Button>
            <Button onClick={handleExport} disabled={!exportSceneId} data-testid="button-export-confirm">
              <Download className="h-4 w-4 mr-2" />
              Скачать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── SHP Upload Dialog ── */}
      <Dialog open={shpUploadOpen} onOpenChange={(o) => !isUploading && setShpUploadOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Загрузить Shapefile</DialogTitle>
            <DialogDescription>ZIP-архив с файлами .shp, .dbf, .prj (и опционально .cpg, .shx)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-2 block">Целевые сцены</Label>
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto border rounded-md p-2">
                {scenes.map(scene => (
                  <label key={scene.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                    <Checkbox
                      checked={uploadTargetScenes.includes(scene.id)}
                      onCheckedChange={(checked) => {
                        setUploadTargetScenes(prev => checked ? [...prev, scene.id] : prev.filter(id => id !== scene.id));
                      }}
                      data-testid={`checkbox-upload-scene-${scene.id}`}
                    />
                    <span className="text-sm">{scene.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {isUploading ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{uploadProgress}</p>
                <Progress value={uploadPercent} className="h-2" />
              </div>
            ) : (
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const files = e.dataTransfer.files; if (files.length > 0) handleShpFile(files); }}
                data-testid="dropzone-shp"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Перетащите ZIP-архив или нажмите для выбора</p>
                <p className="text-xs text-muted-foreground mt-1">Файлы до 10 МБ обрабатываются в браузере, крупнее — на сервере</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.shp"
              className="hidden"
              onChange={(e) => { if (e.target.files) handleShpFile(e.target.files); e.target.value = ""; }}
              data-testid="input-shp-file"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShpUploadOpen(false)} disabled={isUploading}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Groups Manager Dialog ── */}
      <Dialog open={groupsManagerOpen} onOpenChange={setGroupsManagerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Управление группами слоёв</DialogTitle>
            <DialogDescription>Создавайте группы для организации слоёв в менеджере</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && newGroupName.trim() && createGroupMutation.mutate(newGroupName)}
                placeholder="Название новой группы..."
                className="flex-1"
                data-testid="input-new-group"
              />
              <Button
                onClick={() => newGroupName.trim() && createGroupMutation.mutate(newGroupName)}
                disabled={!newGroupName.trim() || createGroupMutation.isPending}
                size="sm"
                data-testid="button-create-group"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {adminGroups.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Нет групп</p>
              )}
              {adminGroups.map(ag => (
                <div key={ag.id} className="flex items-center gap-2 border rounded-md px-3 py-2">
                  <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  {editGroupId === ag.id ? (
                    <Input
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") updateGroupMutation.mutate({ id: ag.id, name: editGroupName });
                        if (e.key === "Escape") setEditGroupId(null);
                      }}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      data-testid={`input-edit-group-${ag.id}`}
                    />
                  ) : (
                    <span className="text-sm flex-1 truncate">{ag.name}</span>
                  )}
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {(groupedLayers[ag.id] || []).length}
                  </Badge>
                  {editGroupId === ag.id ? (
                    <>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateGroupMutation.mutate({ id: ag.id, name: editGroupName })}>
                        <Loader2 className={`h-3 w-3 ${updateGroupMutation.isPending ? "animate-spin" : "hidden"}`} />
                        {!updateGroupMutation.isPending && <span className="text-xs">✓</span>}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditGroupId(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditGroupId(ag.id); setEditGroupName(ag.name); }} data-testid={`button-edit-group-${ag.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteGroupConfirm(ag)} data-testid={`button-delete-group-${ag.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupsManagerOpen(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Clone Dialog ── */}
      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Добавить слой во все сцены</DialogTitle>
            <DialogDescription>«{selectedGroup?.name}» будет скопирован в выбранные сцены</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-2">
            {scenes.map((scene) => {
              const alreadyExists = selectedGroup?.instances.some(i => i.sceneId === scene.id);
              if (alreadyExists) return null;
              return (
                <label key={scene.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                  <Checkbox
                    checked={cloneTargetScenes.includes(scene.id)}
                    onCheckedChange={(checked) => {
                      setCloneTargetScenes(prev => checked ? [...prev, scene.id] : prev.filter(id => id !== scene.id));
                    }}
                    data-testid={`checkbox-clone-scene-${scene.id}`}
                  />
                  <span className="text-sm">{scene.name}</span>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleCloneConfirm} disabled={cloneTargetScenes.length === 0 || cloneMutation.isPending} data-testid="button-clone-confirm">
              {cloneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              Добавить ({cloneTargetScenes.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Palette ── */}
      {selectedGroup && (() => {
        const source = getAnySourceInstance(selectedGroup);
        if (!source) return null;
        return (
          <LayerStylePanel
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            layer={{
              id: source.layerId,
              name: `${selectedGroup.name} (${selectedGroup.instances.length} экз.)`,
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

      {/* ── Attribute Table (LayerAttributeTableWrapper reused) ── */}
      {attrTableLayer && (
        <LayerAttributeTableWrapper
          layerId={attrTableLayer.id}
          layerName={attrTableLayer.name}
          onClose={() => setAttrTableLayer(null)}
        />
      )}

      {/* ── Remove Confirm ── */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(o) => !o && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить слой из сцены?</AlertDialogTitle>
            <AlertDialogDescription>
              Слой будет удалён из сцены «{removeConfirm?.sceneName}». Данные (объекты) будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeConfirm && removeMutation.mutate(removeConfirm.layerId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Group Confirm ── */}
      <AlertDialog open={!!deleteGroupConfirm} onOpenChange={(o) => !o && setDeleteGroupConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить группу «{deleteGroupConfirm?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Слои из группы не будут удалены — они перейдут в раздел «Без группы».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteGroupConfirm && deleteGroupMutation.mutate(deleteGroupConfirm.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
