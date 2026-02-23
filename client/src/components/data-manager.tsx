import { useState, useRef, useCallback, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/contexts/scene-context";
import { parseShapefileWithEncoding } from "@/lib/shapefile-parser";
import { useIsMobile } from "@/hooks/use-mobile";
import { ExcelImportModal } from "@/components/excel-import-modal";
import {
  X,
  GripVertical,
  Database,
  Layers,
  Eye,
  EyeOff,
  Trash2,
  FileUp,
  Loader2,
  Palette,
  Pencil,
  Check,
  FileText,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Map,
  Globe,
  Settings,
  Table2,
  Download,
  FolderOpen,
  FolderClosed,
  FolderPlus,
  AlertTriangle,
  MapPin,
  Plug,
} from "lucide-react";
import { useBaseLayers, type BaseLayerType } from "@/contexts/base-layers-context";
import { useProjection } from "@/contexts/projection-context";
import { ConnectionForm } from "@/components/connection-form";
import { useZuluConnectionContext } from "@/contexts/zulu-connection-context";
import { type ProjectionType } from "@/lib/projections";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LayerStylePanel } from "@/components/layer-style-panel";
import { GeocodeDialog } from "@/components/geocode-dialog";
import { JoinExcelDialog } from "@/components/join-excel-dialog";

interface Folder {
  id: number;
  sceneId: number;
  name: string;
  visible: number;
  displayOrder: number;
  createdAt: string;
}

interface EditableLayer {
  id: number;
  sceneId: number | null;
  folderId?: number | null;
  name: string;
  geometryType: string;
  color: string;
  pointStyle: string;
  lineStyle: string;
  visible: boolean;
  opacity: number;
  featureCount: number;
  source: string;
  sourceFileName: string | null;
  sourceFiles: string[] | null;
  crs: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  styleConfig?: any;
}


interface DataManagerProps {
  onClose: () => void;
  onOpenAttributeTable?: (layerId: number, layerName: string) => void;
}

const MIN_WIDTH = 500;
const MIN_HEIGHT = 300;

export function DataManager({ onClose, onOpenAttributeTable }: DataManagerProps) {
  const { toast } = useToast();
  const { currentSceneId, canEdit } = useScene();
  const isMobile = useIsMobile();
  const { baseLayers, activeBaseLayer, setActiveBaseLayer } = useBaseLayers();
  const { currentProjection, setProjection, projectionInfo } = useProjection();
  const { connect, connectZws, connectCustomZws, disconnect, status: zuluStatus, error: zuluError } = useZuluConnectionContext();
  type FlatItem = { type: "folder"; folderId: number; displayOrder: number; layers: number[] } | { type: "layer"; layerId: number; displayOrder: number };
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [editingLayerId, setEditingLayerId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedLayerId, setExpandedLayerId] = useState<number | null>(null);
  const [excelParseResult, setExcelParseResult] = useState<{
    fileName: string;
    columns: { index: number; name: string; detectedType: string }[];
    previewRows: Record<string, unknown>[];
    allRows: Record<string, unknown>[];
    totalRows: number;
  } | null>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [styleConfigLayerId, setStyleConfigLayerId] = useState<number | null>(null);
  const [legendLayerId, setLegendLayerId] = useState<number | null>(null);
  const [geocodeLayerId, setGeocodeLayerId] = useState<number | null>(null);
  const [joinLayerId, setJoinLayerId] = useState<number | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<number>>(new Set());
  const [dragLayerId, setDragLayerId] = useState<number | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<number | "ungrouped" | null>(null);
  const [dragType, setDragType] = useState<"layer" | "folder" | null>(null);
  const [dragFolderId, setDragFolderId] = useState<number | null>(null);
  const [dropInsertIndex, setDropInsertIndex] = useState<{ scope: number | "ungrouped"; index: number } | null>(null);
  const currentFlatOrderRef = useRef<FlatItem[]>([]);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<{ flatItems: FlatItem[]; movedLayerId?: number; sourceFolderId?: number | null; targetFolderId?: number | null } | null>(null);
  const dropHandledRef = useRef(false);

  const foldersQueryKey = ["/api/scenes", currentSceneId, "folders"];

  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: foldersQueryKey,
    enabled: !!currentSceneId,
  });

  const { data: sceneLayersRaw = [], isLoading: sceneLoading } = useQuery<EditableLayer[]>({
    queryKey: ["/api/scenes", currentSceneId, "editable-layers"],
    enabled: !!currentSceneId,
  });
  
  // Sort layers by id to maintain consistent order
  const sceneLayers = [...sceneLayersRaw].sort((a, b) => a.displayOrder - b.displayOrder);

  // Single query key for all editable layers operations
  const editableLayersQueryKey = ["/api/scenes", currentSceneId, "editable-layers"];

  const deleteLayerMutation = useMutation({
    mutationFn: async (layerId: number) => {
      await apiRequest("DELETE", `/api/editable-layers/${layerId}`);
      return layerId;
    },
    onMutate: async (layerId: number) => {
      await queryClient.cancelQueries({ queryKey: editableLayersQueryKey });
      const previousLayers = queryClient.getQueryData<EditableLayer[]>(editableLayersQueryKey);
      queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => 
        old ? old.filter(layer => layer.id !== layerId) : []
      );
      return { previousLayers };
    },
    onSuccess: () => {
      toast({ title: "Слой удалён" });
    },
    onError: (_err, _layerId, context) => {
      if (context?.previousLayers) {
        queryClient.setQueryData(editableLayersQueryKey, context.previousLayers);
      }
      toast({ title: "Ошибка удаления слоя", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({ id, visible }: { id: number; visible: boolean }) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, { visible });
      return res.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: editableLayersQueryKey });
      const previousLayers = queryClient.getQueryData<EditableLayer[]>(editableLayersQueryKey);
      queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => 
        old?.map(layer => layer.id === variables.id ? { ...layer, visible: variables.visible } : layer) ?? []
      );
      return { previousLayers };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousLayers) {
        queryClient.setQueryData(editableLayersQueryKey, context.previousLayers);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const updateLayerStyleMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; color?: string; pointStyle?: string; lineStyle?: string; name?: string; styleConfig?: any }) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${id}`, data);
      return res.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: editableLayersQueryKey });
      const previousLayers = queryClient.getQueryData<EditableLayer[]>(editableLayersQueryKey);
      queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => 
        old?.map(layer => layer.id === variables.id ? { ...layer, ...variables } : layer) ?? []
      );
      return { previousLayers };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousLayers) {
        queryClient.setQueryData(editableLayersQueryKey, context.previousLayers);
      }
      toast({ title: "Ошибка обновления", variant: "destructive" });
    },
    onSuccess: () => {
      setEditingLayerId(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/scenes/${currentSceneId}/folders`, { name });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Папка создана" });
      setIsCreatingFolder(false);
      setNewFolderName("");
    },
    onError: () => {
      toast({ title: "Ошибка создания папки", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: foldersQueryKey });
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: number) => {
      await apiRequest("DELETE", `/api/folders/${folderId}`);
    },
    onSuccess: () => {
      toast({ title: "Папка удалена" });
    },
    onError: () => {
      toast({ title: "Ошибка удаления папки", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: foldersQueryKey });
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ folderId, name }: { folderId: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/folders/${folderId}`, { name });
      return res.json();
    },
    onSuccess: () => {
      setEditingFolderId(null);
    },
    onError: () => {
      toast({ title: "Ошибка переименования папки", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: foldersQueryKey });
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const toggleFolderVisibilityMutation = useMutation({
    mutationFn: async ({ folderId, visible }: { folderId: number; visible: boolean }) => {
      const res = await apiRequest("POST", `/api/folders/${folderId}/toggle-visibility`, { visible });
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: foldersQueryKey });
      queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
    },
  });

  const moveLayerToFolderMutation = useMutation({
    mutationFn: async ({ layerId, folderId }: { layerId: number; folderId: number | null }) => {
      const res = await apiRequest("PATCH", `/api/editable-layers/${layerId}/folder`, { folderId });
      return res.json();
    },
  });

  const reorderLayersMutation = useMutation({
    mutationFn: async (data: { layerIds: number[]; displayOrders?: number[] }) => {
      const res = await apiRequest("POST", "/api/editable-layers/reorder", data);
      return res.json();
    },
  });

  const reorderFoldersMutation = useMutation({
    mutationFn: async (data: { folderIds: number[]; displayOrders?: number[] }) => {
      const res = await apiRequest("POST", "/api/layer-folders/reorder", data);
      return res.json();
    },
  });

  const toggleFolderExpanded = (folderId: number) => {
    setExpandedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleStartEditing = (layer: EditableLayer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveName = (layerId: number) => {
    if (editingName.trim()) {
      updateLayerStyleMutation.mutate({ id: layerId, name: editingName.trim() });
    } else {
      setEditingLayerId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, layerId: number) => {
    if (e.key === "Enter") {
      handleSaveName(layerId);
    } else if (e.key === "Escape") {
      setEditingLayerId(null);
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position, isMobile]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.stopPropagation();
    setIsResizing(true);
    dragOffset.current = {
      x: e.clientX,
      y: e.clientY,
    };
  }, [isMobile]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: Math.max(0, e.clientX - dragOffset.current.x),
          y: Math.max(0, e.clientY - dragOffset.current.y),
        });
      } else if (isResizing) {
        const deltaX = e.clientX - dragOffset.current.x;
        const deltaY = e.clientY - dragOffset.current.y;
        setSize(prev => ({
          width: Math.max(MIN_WIDTH, prev.width + deltaX),
          height: Math.max(MIN_HEIGHT, prev.height + deltaY),
        }));
        dragOffset.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing]);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const SERVER_UPLOAD_THRESHOLD = 10 * 1024 * 1024;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress("");

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileSize = file.size;
        const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
        
        if (fileSize > SERVER_UPLOAD_THRESHOLD) {
          setUploadProgress(`Загрузка ${file.name} (${fileSizeMB} МБ) на сервер...`);
          
          const formData = new FormData();
          formData.append("file", file);
          if (currentSceneId) {
            formData.append("sceneId", currentSceneId.toString());
          }
          
          const res = await fetch("/api/datasets/upload", {
            method: "POST",
            body: formData,
            credentials: "include",
          });
          
          if (!res.ok) {
            let errorMessage = "Ошибка загрузки на сервер";
            try {
              const error = await res.json();
              errorMessage = error.message || errorMessage;
            } catch {
              // Response is not JSON, use status text
              errorMessage = `Ошибка сервера: ${res.status} ${res.statusText}`;
            }
            throw new Error(errorMessage);
          }
          
          // Safely parse success response
          try {
            await res.json();
          } catch {
            console.warn("Could not parse upload response as JSON");
          }
          
          setUploadProgress(`Обработка завершена`);
        } else {
          setUploadProgress(`Обработка ${file.name}...`);
          const arrayBuffer = await file.arrayBuffer();
          
          const parsedLayers = await parseShapefileWithEncoding(arrayBuffer, file.name);
          
          if (parsedLayers.length === 0) {
            throw new Error("Не найдено слоёв в архиве");
          }
          
          for (const layer of parsedLayers) {
            if (!layer.geojson.features || layer.geojson.features.length === 0) {
              continue;
            }
            
            const firstFeature = layer.geojson.features[0];
            const geometryType = firstFeature.geometry?.type || "Unknown";
            
            const res = await apiRequest("POST", "/api/datasets/import", {
              name: layer.name,
              geometryType,
              geojson: layer.geojson,
              sourceFileName: file.name,
              sourceFiles: layer.sourceFiles || [],
              crs: layer.sourceCrs || "EPSG:4326",
              sceneId: currentSceneId,
            });

            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Upload failed");
            }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      toast({ title: "Файл загружен успешно" });
    } catch (error) {
      console.error("Shapefile import error:", error);
      toast({
        title: "Ошибка загрузки",
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsParsingExcel(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Ошибка парсинга файла");
      }

      const result = await response.json();
      setExcelParseResult(result);
    } catch (error) {
      console.error("Excel parse error:", error);
      toast({
        title: "Ошибка чтения Excel",
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setIsParsingExcel(false);
      if (excelInputRef.current) {
        excelInputRef.current.value = "";
      }
    }
  };

  const getGeometryIcon = (type: string) => {
    switch (type) {
      case "Point":
        return "●";
      case "LineString":
        return "—";
      case "Polygon":
        return "▢";
      default:
        return "◎";
    }
  };

  const handleLayerDragStart = (e: React.DragEvent, layerId: number) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/layer", String(layerId));
    e.dataTransfer.effectAllowed = "move";
    setDragLayerId(layerId);
    setDragType("layer");
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: number) => {
    e.dataTransfer.setData("text/folder", String(folderId));
    e.dataTransfer.effectAllowed = "move";
    setDragFolderId(folderId);
    setDragType("folder");
  };

  const handleDragEnd = () => {
    if (dropHandledRef.current) {
      dropHandledRef.current = false;
      return;
    }
    setDragLayerId(null);
    setDragFolderId(null);
    setDragType(null);
    setDropTargetFolderId(null);
    setDropInsertIndex(null);
  };

  const handleLayerDragOverInsert = (e: React.DragEvent, scope: number | "ungrouped", index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropInsertIndex({ scope, index });
    setDropTargetFolderId(null);
  };

  const handleInsertDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setDropInsertIndex(null);
    }
  };

  const buildFlatItems = (currentFolders: typeof folders, currentLayers: typeof sceneLayers): FlatItem[] => {
    const items: FlatItem[] = [];
    for (const folder of currentFolders) {
      const folderLayers = currentLayers
        .filter(l => l.folderId === folder.id)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(l => l.id);
      items.push({ type: "folder", folderId: folder.id, displayOrder: folder.displayOrder, layers: folderLayers });
    }
    const ungroupedLayers = currentLayers
      .filter(l => !l.folderId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    for (const layer of ungroupedLayers) {
      items.push({ type: "layer", layerId: layer.id, displayOrder: layer.displayOrder });
    }
    items.sort((a, b) => a.displayOrder - b.displayOrder);
    return items;
  };

  const flattenToGlobalOrder = (flatItems: ReturnType<typeof buildFlatItems>): number[] => {
    const result: number[] = [];
    for (const item of flatItems) {
      if (item.type === "folder") {
        result.push(...item.layers);
      } else {
        result.push(item.layerId);
      }
    }
    return result;
  };

  const applyOptimisticUpdate = (flatItems: FlatItem[], movedLayerId?: number, sourceFolderId?: number | null, targetFolderId?: number | null) => {
    const layerUpdates: Record<number, { displayOrder: number; folderId: number | null }> = {};
    for (let flatIdx = 0; flatIdx < flatItems.length; flatIdx++) {
      const item = flatItems[flatIdx];
      const baseOrder = flatIdx * 1000;
      if (item.type === "folder") {
        for (let j = 0; j < item.layers.length; j++) {
          layerUpdates[item.layers[j]] = { displayOrder: baseOrder + j, folderId: item.folderId };
        }
      } else {
        layerUpdates[item.layerId] = { displayOrder: baseOrder, folderId: null };
      }
    }
    if (movedLayerId !== undefined && targetFolderId !== undefined) {
      const existing = layerUpdates[movedLayerId];
      if (existing) {
        existing.folderId = targetFolderId;
      }
    }
    queryClient.setQueryData<EditableLayer[]>(editableLayersQueryKey, (old) => {
      if (!old) return old;
      return old.map(layer => {
        const update = layerUpdates[layer.id];
        if (update) {
          return { ...layer, displayOrder: update.displayOrder, folderId: update.folderId };
        }
        return layer;
      });
    });
    const folderUpdates: Record<number, number> = {};
    for (let flatIdx = 0; flatIdx < flatItems.length; flatIdx++) {
      const item = flatItems[flatIdx];
      if (item.type === "folder") {
        folderUpdates[item.folderId] = flatIdx * 1000;
      }
    }
    if (Object.keys(folderUpdates).length > 0) {
      queryClient.setQueryData<Folder[]>(foldersQueryKey, (old) => {
        if (!old) return old;
        return old.map(f => {
          const newOrder = folderUpdates[f.id];
          if (newOrder !== undefined) {
            return { ...f, displayOrder: newOrder };
          }
          return f;
        });
      });
    }
  };

  const executeSave = async (flatItems: FlatItem[], movedLayerId?: number, sourceFolderId?: number | null, targetFolderId?: number | null) => {
    const folderIds: number[] = [];
    const folderDisplayOrders: number[] = [];
    const layerIds: number[] = [];
    const layerDisplayOrders: number[] = [];
    for (let flatIdx = 0; flatIdx < flatItems.length; flatIdx++) {
      const item = flatItems[flatIdx];
      const baseOrder = flatIdx * 1000;
      if (item.type === "folder") {
        folderIds.push(item.folderId);
        folderDisplayOrders.push(baseOrder);
        for (let j = 0; j < item.layers.length; j++) {
          layerIds.push(item.layers[j]);
          layerDisplayOrders.push(baseOrder + j);
        }
      } else {
        layerIds.push(item.layerId);
        layerDisplayOrders.push(baseOrder);
      }
    }
    if (folderIds.length > 0) {
      await reorderFoldersMutation.mutateAsync({ folderIds, displayOrders: folderDisplayOrders });
    }
    if (movedLayerId !== undefined && sourceFolderId !== targetFolderId) {
      await moveLayerToFolderMutation.mutateAsync({ layerId: movedLayerId, folderId: targetFolderId ?? null });
    }
    if (layerIds.length > 0) {
      await reorderLayersMutation.mutateAsync({ layerIds, displayOrders: layerDisplayOrders });
    }
  };

  const persistFlatOrder = async (flatItems: FlatItem[], movedLayerId?: number, sourceFolderId?: number | null, targetFolderId?: number | null) => {
    currentFlatOrderRef.current = flatItems;
    applyOptimisticUpdate(flatItems, movedLayerId, sourceFolderId, targetFolderId);

    if (isSavingRef.current) {
      pendingSaveRef.current = { flatItems, movedLayerId, sourceFolderId, targetFolderId };
      return;
    }
    isSavingRef.current = true;

    try {
      await executeSave(flatItems, movedLayerId, sourceFolderId, targetFolderId);
    } catch (err) {
      console.error("[DnD] persistFlatOrder error:", err);
    }

    while (pendingSaveRef.current) {
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      try {
        await executeSave(pending.flatItems, pending.movedLayerId, pending.sourceFolderId, pending.targetFolderId);
      } catch (err) {
        console.error("[DnD] persistFlatOrder pending error:", err);
      }
    }

    isSavingRef.current = false;
    queryClient.invalidateQueries({ queryKey: foldersQueryKey });
    queryClient.invalidateQueries({ queryKey: editableLayersQueryKey });
  };

  const handleDropAtIndex = (e: React.DragEvent, scope: number | "ungrouped", index: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    const layerIdStr = e.dataTransfer.getData("text/layer");
    const folderIdStr = e.dataTransfer.getData("text/folder");
    
    if (folderIdStr && dragType === "folder") {
      const movedFolderId = Number(folderIdStr);
      const flatItems: FlatItem[] = currentFlatOrderRef.current.map(it => 
        it.type === "folder" ? { ...it, layers: [...it.layers] } : { ...it }
      );
      const fromIdx = flatItems.findIndex(it => it.type === "folder" && it.folderId === movedFolderId);
      if (fromIdx >= 0) {
        const [removed] = flatItems.splice(fromIdx, 1);
        const insertAt = index > fromIdx ? index - 1 : index;
        flatItems.splice(Math.min(insertAt, flatItems.length), 0, removed);
        persistFlatOrder(flatItems);
      }
    } else if (layerIdStr && dragType === "layer") {
      const movedLayerId = Number(layerIdStr);
      const layer = sceneLayers.find(l => l.id === movedLayerId);
      if (!layer) {
        dropHandledRef.current = true;
        setDragLayerId(null);
        setDragFolderId(null);
        setDragType(null);
        setDropTargetFolderId(null);
        setDropInsertIndex(null);
        return;
      }
      
      const sourceFolderId = layer.folderId ?? null;
      const flatItems: FlatItem[] = currentFlatOrderRef.current.map(it => 
        it.type === "folder" ? { ...it, layers: [...it.layers] } : { ...it }
      );
      
      if (scope === "ungrouped") {
        const fromIdx = flatItems.findIndex(it => 
          (it.type === "layer" && it.layerId === movedLayerId) ||
          (it.type === "folder" && it.layers.includes(movedLayerId))
        );
        let wasSplicedOut = false;
        if (fromIdx >= 0) {
          const fromItem = flatItems[fromIdx];
          if (fromItem.type === "folder") {
            fromItem.layers = fromItem.layers.filter(id => id !== movedLayerId);
          } else {
            flatItems.splice(fromIdx, 1);
            wasSplicedOut = true;
          }
        }
        const adjustedIndex = wasSplicedOut && fromIdx < index ? index - 1 : index;
        const insertAt = Math.min(adjustedIndex, flatItems.length);
        flatItems.splice(insertAt, 0, { type: "layer", layerId: movedLayerId, displayOrder: 0 });
        persistFlatOrder(flatItems, movedLayerId, sourceFolderId, null);
      } else {
        const targetFolderId = scope as number;
        
        if (sourceFolderId) {
          const srcFolder = flatItems.find(it => it.type === "folder" && it.folderId === sourceFolderId);
          if (srcFolder && srcFolder.type === "folder") {
            srcFolder.layers = srcFolder.layers.filter(id => id !== movedLayerId);
          }
        } else {
          const layerIdx = flatItems.findIndex(it => it.type === "layer" && it.layerId === movedLayerId);
          if (layerIdx >= 0) flatItems.splice(layerIdx, 1);
        }
        
        const tgtFolder = flatItems.find(it => it.type === "folder" && it.folderId === targetFolderId);
        if (tgtFolder && tgtFolder.type === "folder") {
          const filteredLayers = tgtFolder.layers.filter(id => id !== movedLayerId);
          const insertAt = Math.min(index, filteredLayers.length);
          filteredLayers.splice(insertAt, 0, movedLayerId);
          tgtFolder.layers = filteredLayers;
        }
        persistFlatOrder(flatItems, movedLayerId, sourceFolderId, targetFolderId);
      }
    }
    
    dropHandledRef.current = true;
    setDragLayerId(null);
    setDragFolderId(null);
    setDragType(null);
    setDropTargetFolderId(null);
    setDropInsertIndex(null);
  };

  const handleFolderDrop = (e: React.DragEvent, targetFolderId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const layerIdStr = e.dataTransfer.getData("text/layer");
    if (layerIdStr && dragType === "layer") {
      const movedLayerId = Number(layerIdStr);
      const layer = sceneLayers.find(l => l.id === movedLayerId);
      if (layer && layer.folderId !== targetFolderId) {
        const sourceFolderId = layer.folderId ?? null;
        const flatItems: FlatItem[] = currentFlatOrderRef.current.map(it => 
          it.type === "folder" ? { ...it, layers: [...it.layers] } : { ...it }
        );
        if (sourceFolderId) {
          const srcFolder = flatItems.find(it => it.type === "folder" && it.folderId === sourceFolderId);
          if (srcFolder && srcFolder.type === "folder") {
            srcFolder.layers = srcFolder.layers.filter(id => id !== movedLayerId);
          }
        } else {
          const layerIdx = flatItems.findIndex(it => it.type === "layer" && it.layerId === movedLayerId);
          if (layerIdx >= 0) flatItems.splice(layerIdx, 1);
        }
        const tgtFolder = flatItems.find(it => it.type === "folder" && it.folderId === targetFolderId);
        if (tgtFolder && tgtFolder.type === "folder") {
          tgtFolder.layers.push(movedLayerId);
        }
        persistFlatOrder(flatItems, movedLayerId, sourceFolderId, targetFolderId);
      }
    }
    dropHandledRef.current = true;
    setDragLayerId(null);
    setDragFolderId(null);
    setDragType(null);
    setDropTargetFolderId(null);
    setDropInsertIndex(null);
  };

  const handleFolderDragOver = (e: React.DragEvent, targetId: number) => {
    if (dragType === "layer" || dragType === "folder") {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragType === "layer") {
        setDropTargetFolderId(targetId);
        setDropInsertIndex(null);
      }
    }
  };

  const handleDragLeave = () => {
    setDropTargetFolderId(null);
  };

  const renderInsertZone = (scope: number | "ungrouped", index: number) => {
    const isDragging = dragLayerId !== null || dragFolderId !== null;
    const isActive = dropInsertIndex?.scope === scope && dropInsertIndex?.index === index;
    if (!isDragging) return null;
    return (
      <div
        key={`insert-${scope}-${index}`}
        className="relative"
        style={{ height: isActive ? 12 : 8, transition: "height 0.1s" }}
        onDragOver={(e) => handleLayerDragOverInsert(e, scope, index)}
        onDragLeave={handleInsertDragLeave}
        onDrop={(e) => handleDropAtIndex(e, scope, index)}
        data-testid={`drop-zone-${scope}-${index}`}
      >
        {isActive && (
          <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full shadow-sm" />
        )}
      </div>
    );
  };

  const renderLayerRow = (layer: EditableLayer) => (
    <div
      key={layer.id}
      className={`rounded border bg-background ${dragLayerId === layer.id ? "opacity-50" : ""}`}
      draggable={canEdit}
      onDragStart={(e) => handleLayerDragStart(e, layer.id)}
      onDragEnd={handleDragEnd}
      data-testid={`scene-layer-${layer.id}`}
    >
      <div 
        className={`flex items-center gap-1.5 px-2 py-1 ${layer.styleConfig && layer.styleConfig.renderer !== "single" ? "cursor-pointer" : ""}`}
        onClick={() => {
          const sc = layer.styleConfig;
          if (sc && sc.renderer !== "single") {
            setLegendLayerId(legendLayerId === layer.id ? null : layer.id);
          }
        }}
      >
        {canEdit && (
          <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0 cursor-grab" />
        )}
        {((layer.source === "import" && layer.sourceFiles && layer.sourceFiles.length > 0) || (layer as any).metadata) && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedLayerId(expandedLayerId === layer.id ? null : layer.id); }}
            className="shrink-0 hover:bg-muted rounded"
            data-testid={`button-expand-${layer.id}`}
          >
            {expandedLayerId === layer.id ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
        <div 
          className="w-2.5 h-2.5 rounded-sm shrink-0" 
          style={{ backgroundColor: layer.color }}
        />
        <span className="text-sm shrink-0" title={layer.geometryType}>
          {getGeometryIcon(layer.geometryType)}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {editingLayerId === layer.id ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, layer.id)}
                className="h-5 text-xs"
                autoFocus
                data-no-drag
                data-testid={`input-layer-name-${layer.id}`}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={() => handleSaveName(layer.id)}
                data-testid={`button-save-name-${layer.id}`}
              >
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <>
              <span 
                className="text-xs font-medium truncate"
                data-testid={`label-layer-name-${layer.id}`}
              >
                {layer.name}
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                ({layer.featureCount})
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="text-[10px] text-muted-foreground/60 shrink-0 cursor-pointer"
                    data-no-drag
                    data-testid={`label-layer-id-${layer.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const idStr = String(layer.id);
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(idStr).then(() => {
                          toast({ title: "ID скопирован", description: `ID слоя: ${idStr}` });
                        }).catch(() => {
                          toast({ title: "ID слоя", description: idStr });
                        });
                      } else {
                        toast({ title: "ID слоя", description: idStr });
                      }
                    }}
                  >
                    ID:{layer.id}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Нажмите, чтобы скопировать ID слоя</p>
                </TooltipContent>
              </Tooltip>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 shrink-0 opacity-40 hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); handleStartEditing(layer); }}
                  data-testid={`button-edit-name-${layer.id}`}
                >
                  <Pencil className="h-2.5 w-2.5" />
                </Button>
              )}
            </>
          )}
        </div>
      
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); setStyleConfigLayerId(layer.id); }}
              data-testid={`button-layer-style-${layer.id}`}
            >
              <Palette className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Стилизация слоя</p>
          </TooltipContent>
        </Tooltip>
      
        {onOpenAttributeTable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => { e.stopPropagation(); onOpenAttributeTable(layer.id, layer.name); }}
                data-testid={`button-attribute-table-${layer.id}`}
              >
                <Table2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Таблица атрибутов</TooltipContent>
          </Tooltip>
        )}
      
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); toggleVisibilityMutation.mutate({
                id: layer.id,
                visible: !layer.visible,
              }); }}
              data-testid={`button-toggle-visibility-${layer.id}`}
            >
              {layer.visible ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{layer.visible ? "Скрыть" : "Показать"}</TooltipContent>
        </Tooltip>
      
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); setGeocodeLayerId(layer.id); }}
              data-testid={`button-geocode-layer-${layer.id}`}
            >
              <MapPin className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Геокодировать (адресные ориентиры)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); setJoinLayerId(layer.id); }}
              data-testid={`button-join-layer-${layer.id}`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Обогатить из XLSX</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                const url = `/api/editable-layers/${layer.id}/export/shapefile`;
                const a = document.createElement("a");
                a.href = url;
                a.download = `${layer.name}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                toast({ title: "Экспорт", description: `Слой "${layer.name}" экспортируется в Shapefile...` });
              }}
              data-testid={`button-export-layer-${layer.id}`}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Экспорт в Shapefile</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive"
              onClick={(e) => { e.stopPropagation(); deleteLayerMutation.mutate(layer.id); }}
              data-testid={`button-delete-layer-${layer.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Удалить слой</TooltipContent>
        </Tooltip>
      </div>

      
      {expandedLayerId === layer.id && layer.sourceFiles && layer.sourceFiles.length > 0 && (
        <div className="px-2 py-1.5 border-t bg-muted/30">
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[10px] text-muted-foreground">SHP:</span>
            {layer.sourceFiles.map((file, idx) => (
              <Badge key={idx} variant="secondary" className="text-[9px] px-1 py-0 h-4">
                {file}
              </Badge>
            ))}
            {layer.crs && (
              <span className="text-[10px] text-muted-foreground ml-1">
                CRS: {layer.crs}
              </span>
            )}
          </div>
        </div>
      )}
      
      {expandedLayerId === layer.id && (layer as any).metadata && (layer as any).metadata.analysisType === "complaint_analysis" && (() => {
        const meta = (layer as any).metadata as Record<string, unknown>;
        const metaLabelMap: Record<string, string> = {
          analysisMode: "Режим анализа",
          analysisDate: "Дата анализа",
          totalComplaints: "Всего жалоб",
          totalMatched: "Сопоставлено",
          totalUnmatched: "Не сопоставлено",
          emptyNistCount: "Пустой НИСТ",
          dateGroupCount: "Групп по дате/НИСТ",
          failureZoneCount: "Зон отказа",
          totalClustered: "В кластерах",
          totalUnclustered: "Вне кластеров",
          clusterCount: "Кластеров",
          complaintLayerName: "Слой жалоб",
          matchRadius: "Радиус привязки (м)",
          dateFieldName: "Поле даты",
          addressFieldName: "Поле адреса",
        };
        const displayKeys = Object.keys(meta).filter(k => k !== "analysisType" && metaLabelMap[k]);
        return (
          <div className="px-2 py-1.5 border-t bg-muted/30 space-y-0.5" data-testid={`metadata-layer-${layer.id}`}>
            <div className="flex items-center gap-1 mb-1">
              <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />
              <span className="text-[10px] font-medium text-muted-foreground">
                {String(meta.analysisMode || "Анализ жалоб")}
              </span>
            </div>
            {displayKeys.map(key => {
              let value = meta[key];
              if (key === "analysisDate" && typeof value === "string") {
                try {
                  const d = new Date(value);
                  value = `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                } catch {}
              }
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground shrink-0">{metaLabelMap[key]}:</span>
                  <span className="text-[10px] font-medium truncate">{String(value ?? "")}</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {legendLayerId === layer.id && layer.styleConfig && layer.styleConfig.renderer !== "single" && (() => {
        const sc = layer.styleConfig;
        return (
          <div className="px-3 py-2 border-t bg-muted/20 space-y-1" data-testid={`legend-layer-${layer.id}`}>
            <p className="text-[10px] text-muted-foreground font-medium mb-1">
              {sc.renderer === "categorized" ? "Категории" : "Градация"}: {sc.field}
            </p>
            {sc.renderer === "categorized" && sc.categorizedClasses && (
              <div className="space-y-0.5">
                {sc.categorizedClasses.map((cls: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
                      style={{ backgroundColor: cls.style.color }}
                    />
                    <span className="text-[11px] truncate">{cls.label || String(cls.value)}</span>
                  </div>
                ))}
                {sc.defaultStyle && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
                      style={{ backgroundColor: sc.defaultStyle.color }}
                    />
                    <span className="text-[11px] truncate text-muted-foreground">Прочее</span>
                  </div>
                )}
              </div>
            )}
            {sc.renderer === "graduated" && sc.graduatedClasses && (
              <div className="space-y-0.5">
                {sc.graduatedClasses.map((cls: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
                      style={{ backgroundColor: cls.style.color }}
                    />
                    <span className="text-[11px] truncate">{cls.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );

  const containerClasses = isMobile
    ? "fixed inset-0 bg-card flex flex-col z-50"
    : "fixed bg-card border rounded-lg shadow-lg flex flex-col z-50";

  const containerStyle = isMobile
    ? {}
    : {
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      };

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      style={containerStyle}
      data-testid="data-manager-window"
    >
      <div
        className={`flex items-center justify-between px-3 py-2 border-b bg-muted/50 ${isMobile ? '' : 'cursor-move rounded-t-lg'}`}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          {!isMobile && <GripVertical className="h-4 w-4 text-muted-foreground" />}
          <Database className="h-4 w-4" />
          <span className="font-medium text-sm">Менеджер данных</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-no-drag
          data-testid="button-close-data-manager"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden" data-no-drag>
        <Tabs defaultValue="layers" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-3 mt-3 shrink-0 grid w-auto grid-cols-4" data-testid="data-manager-tabs">
            <TabsTrigger value="layers" className="gap-1.5" data-testid="tab-layers">
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Слои</span>
            </TabsTrigger>
            <TabsTrigger value="sources" className="gap-1.5" data-testid="tab-sources">
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Источники</span>
            </TabsTrigger>
            <TabsTrigger value="connections" className="gap-1.5" data-testid="tab-connections">
              <Plug className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Подключения</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5" data-testid="tab-settings">
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Настройки</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="layers" className="flex-1 flex flex-col overflow-hidden mt-0 px-3 pb-3 data-[state=inactive]:hidden">
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Слои сцены ({sceneLayers.length})</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || !canEdit}
                  data-testid="button-upload-shapefile"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileUp className="h-4 w-4 mr-2" />
                  )}
                  SHP
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".zip,.shp"
                  multiple
                  onChange={handleFileChange}
                  data-testid="input-shapefile"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => excelInputRef.current?.click()}
                  disabled={isParsingExcel || !canEdit}
                  data-testid="button-upload-excel"
                >
                  {isParsingExcel ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                  )}
                  XLS
                </Button>
                <input
                  ref={excelInputRef}
                  type="file"
                  className="hidden"
                  accept=".xls,.xlsx"
                  onChange={handleExcelFileChange}
                  data-testid="input-excel"
                />
                {canEdit && !isCreatingFolder && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCreatingFolder(true)}
                    data-testid="button-create-folder"
                  >
                    <FolderPlus className="h-4 w-4 mr-2" />
                    Папка
                  </Button>
                )}
              </div>
            </div>

            {canEdit && isCreatingFolder && (
              <div className="flex items-center gap-1 pb-2">
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      createFolderMutation.mutate(newFolderName.trim());
                    } else if (e.key === "Escape") {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }
                  }}
                  placeholder="Имя папки..."
                  className="h-7 text-xs"
                  autoFocus
                  data-no-drag
                  data-testid="input-new-folder-name"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (newFolderName.trim()) {
                      createFolderMutation.mutate(newFolderName.trim());
                    }
                  }}
                  disabled={!newFolderName.trim() || createFolderMutation.isPending}
                  data-testid="button-confirm-create-folder"
                >
                  <Check className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setIsCreatingFolder(false); setNewFolderName(""); }}
                  data-testid="button-cancel-create-folder"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            
            {uploadProgress && (
              <div className="mb-3 p-2 bg-muted rounded text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {uploadProgress}
              </div>
            )}
            
            <ScrollArea className="flex-1">
              {sceneLoading ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : sceneLayers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>В сцене нет слоёв</p>
                  <p className="text-xs mt-1">Импортируйте shapefile или создайте слой</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {(() => {
                    const rawFlatOrder = buildFlatItems(folders, sceneLayers);
                    const validFlatOrder: FlatItem[] = [];
                    type RenderItem = { type: "folder"; folder: Folder; layers: EditableLayer[]; flatIndex: number } | { type: "layer"; layer: EditableLayer; flatIndex: number };
                    const renderItems: RenderItem[] = [];
                    for (const fi of rawFlatOrder) {
                      if (fi.type === "folder") {
                        const folder = folders.find(f => f.id === fi.folderId);
                        if (!folder) continue;
                        const idx = validFlatOrder.length;
                        validFlatOrder.push(fi);
                        const folderLayers = fi.layers.map(lid => sceneLayers.find(l => l.id === lid)).filter((l): l is EditableLayer => !!l);
                        renderItems.push({ type: "folder" as const, folder, layers: folderLayers, flatIndex: idx });
                      } else {
                        const layer = sceneLayers.find(l => l.id === fi.layerId);
                        if (!layer) continue;
                        const idx = validFlatOrder.length;
                        validFlatOrder.push(fi);
                        renderItems.push({ type: "layer" as const, layer, flatIndex: idx });
                      }
                    }
                    currentFlatOrderRef.current = validFlatOrder;

                    return (
                      <>
                        {renderItems.map((item, _renderIdx) => {
                          if (item.type === "folder") {
                            const { folder, layers: folderLayers, flatIndex } = item;
                            const isExpanded = expandedFolderIds.has(folder.id);
                            const isDragTarget = dropTargetFolderId === folder.id && dragLayerId !== null;
                            return (
                              <Fragment key={`folder-${folder.id}`}>
                                {(dragType === "folder" || dragType === "layer") && renderInsertZone("ungrouped", flatIndex)}
                                <Collapsible
                                  open={isExpanded}
                                  onOpenChange={() => toggleFolderExpanded(folder.id)}
                                  data-testid={`folder-${folder.id}`}
                                >
                          <div
                            className={`rounded border transition-colors ${dragFolderId === folder.id ? "opacity-50" : ""} ${isDragTarget ? "border-primary bg-primary/10" : "bg-muted/30"}`}
                            draggable={canEdit}
                            onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleFolderDrop(e, folder.id)}
                          >
                          <div className="flex items-center gap-1.5 px-2 py-1">
                            {canEdit && (
                              <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0 cursor-grab" />
                            )}
                            <CollapsibleTrigger asChild>
                              <button className="shrink-0 hover:bg-muted rounded p-0.5" data-testid={`button-toggle-folder-${folder.id}`}>
                                {isExpanded ? (
                                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </button>
                            </CollapsibleTrigger>
                            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                              {editingFolderId === folder.id ? (
                                <div className="flex items-center gap-1 flex-1">
                                  <Input
                                    value={editingFolderName}
                                    onChange={(e) => setEditingFolderName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && editingFolderName.trim()) {
                                        renameFolderMutation.mutate({ folderId: folder.id, name: editingFolderName.trim() });
                                      } else if (e.key === "Escape") {
                                        setEditingFolderId(null);
                                      }
                                    }}
                                    className="h-5 text-xs"
                                    autoFocus
                                    data-no-drag
                                    data-testid={`input-folder-name-${folder.id}`}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      if (editingFolderName.trim()) {
                                        renameFolderMutation.mutate({ folderId: folder.id, name: editingFolderName.trim() });
                                      }
                                    }}
                                    data-testid={`button-save-folder-name-${folder.id}`}
                                  >
                                    <Check className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-xs font-medium truncate" data-testid={`label-folder-name-${folder.id}`}>
                                    {folder.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">
                                    ({folderLayers.length})
                                  </span>
                                  {canEdit && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-4 w-4 shrink-0 opacity-40 hover:opacity-100"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingFolderId(folder.id);
                                        setEditingFolderName(folder.name);
                                      }}
                                      data-testid={`button-edit-folder-name-${folder.id}`}
                                    >
                                      <Pencil className="h-2.5 w-2.5" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFolderVisibilityMutation.mutate({ folderId: folder.id, visible: folder.visible !== 1 });
                              }}
                              data-testid={`button-toggle-folder-visibility-${folder.id}`}
                            >
                              {folder.visible === 1 ? (
                                <Eye className="h-3.5 w-3.5" />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteFolderMutation.mutate(folder.id);
                                }}
                                data-testid={`button-delete-folder-${folder.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          <CollapsibleContent>
                            <div
                              className="space-y-0 px-2 pb-1.5"
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            >
                              {folderLayers.length === 0 ? (
                                <div
                                  className="text-[10px] text-muted-foreground text-center py-2"
                                  onDragOver={(e) => { e.preventDefault(); handleLayerDragOverInsert(e, folder.id, 0); }}
                                  onDrop={(e) => handleDropAtIndex(e, folder.id, 0)}
                                  data-testid={`folder-empty-${folder.id}`}
                                >
                                  {dragLayerId !== null ? "Перетащите слой сюда" : "Пусто"}
                                </div>
                              ) : (
                                <>
                                  {folderLayers.map((layer, idx) => (
                                    <Fragment key={layer.id}>
                                      {dragType === "layer" && renderInsertZone(folder.id, idx)}
                                      {renderLayerRow(layer)}
                                    </Fragment>
                                  ))}
                                  {dragType === "layer" && renderInsertZone(folder.id, folderLayers.length)}
                                </>
                              )}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                              </Fragment>
                            );
                          } else {
                            return (
                              <Fragment key={`layer-${item.layer.id}`}>
                                {(dragType === "folder" || dragType === "layer") && renderInsertZone("ungrouped", item.flatIndex)}
                                {renderLayerRow(item.layer)}
                              </Fragment>
                            );
                          }
                        })}
                        {(dragType === "folder" || dragType === "layer") && renderInsertZone("ungrouped", currentFlatOrderRef.current.length)}
                      </>
                    );
                  })()}
            </div>
          )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="sources" className="flex-1 overflow-auto mt-0 px-3 pb-3 data-[state=inactive]:hidden">
            <div className="py-3">
              <div className="text-center py-8 text-muted-foreground">
                <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Внешние источники данных</p>
                <p className="text-xs mt-1">WMS, WFS, ZWS сервисы</p>
                <p className="text-xs text-muted-foreground mt-4">Функционал в разработке</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="connections" className="flex-1 overflow-auto mt-0 px-3 pb-3 data-[state=inactive]:hidden">
            <div className="py-3 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Plug className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Подключение к серверу ГИС Zulu</span>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <ConnectionForm
                    onConnect={connect}
                    onConnectZws={connectZws}
                    onConnectCustomZws={connectCustomZws}
                    onDisconnect={disconnect}
                    status={zuluStatus}
                    error={zuluError}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="flex-1 overflow-auto mt-0 px-3 pb-3 data-[state=inactive]:hidden">
            <div className="py-3 space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Map className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Проекция карты</span>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <RadioGroup
                      value={currentProjection}
                      onValueChange={(value) => {
                        setProjection(value as ProjectionType);
                      }}
                      className="space-y-2"
                      data-testid="projection-radio-group"
                    >
                      {(Object.keys(projectionInfo) as ProjectionType[]).map((projKey) => (
                        <div key={projKey} className="flex items-center space-x-2">
                          <RadioGroupItem
                            value={projKey}
                            id={`projection-${projKey}`}
                            data-testid={`radio-projection-${projKey}`}
                          />
                          <Label
                            htmlFor={`projection-${projKey}`}
                            className="text-sm cursor-pointer"
                          >
                            {projectionInfo[projKey].name}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({projectionInfo[projKey].description})
                            </span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Базовые слои</span>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <RadioGroup
                      value={activeBaseLayer}
                      onValueChange={(value) => {
                        setActiveBaseLayer(value as BaseLayerType);
                      }}
                      className="space-y-2"
                      data-testid="base-layer-radio-group"
                    >
                      {baseLayers.map((layer) => (
                        <div key={layer.id} className="flex items-center space-x-2">
                          <RadioGroupItem
                            value={layer.id}
                            id={`base-layer-${layer.id}`}
                            data-testid={`radio-base-layer-${layer.id}`}
                          />
                          <Label
                            htmlFor={`base-layer-${layer.id}`}
                            className="text-sm cursor-pointer"
                          >
                            {layer.name}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </div>
              </div>
          </TabsContent>
        </Tabs>
      </div>

      {!isMobile && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={handleResizeMouseDown}
          data-testid="resize-handle"
        />
      )}

      {excelParseResult && (
        <ExcelImportModal
          parseResult={excelParseResult}
          onClose={() => setExcelParseResult(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
          }}
        />
      )}

      {geocodeLayerId && (() => {
        const targetLayer = sceneLayers.find(l => l.id === geocodeLayerId);
        if (!targetLayer) return null;
        return (
          <GeocodeDialog
            layerId={targetLayer.id}
            layerName={targetLayer.name}
            open={true}
            onOpenChange={(open) => { if (!open) setGeocodeLayerId(null); }}
          />
        );
      })()}

      {joinLayerId && (() => {
        const targetLayer = sceneLayers.find(l => l.id === joinLayerId);
        if (!targetLayer) return null;
        return (
          <JoinExcelDialog
            layerId={targetLayer.id}
            layerName={targetLayer.name}
            open={true}
            onOpenChange={(open) => { if (!open) setJoinLayerId(null); }}
          />
        );
      })()}

      {styleConfigLayerId && (() => {
        const targetLayer = sceneLayers.find(l => l.id === styleConfigLayerId);
        if (!targetLayer) return null;
        return (
          <LayerStylePanel
            open={true}
            onOpenChange={(open) => { if (!open) setStyleConfigLayerId(null); }}
            layer={targetLayer}
            onSave={(updates) => {
              updateLayerStyleMutation.mutate({ id: targetLayer.id, ...updates });
              setStyleConfigLayerId(null);
            }}
          />
        );
      })()}
    </div>
  );
}
