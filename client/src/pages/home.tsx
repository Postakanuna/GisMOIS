import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Map, Settings, Menu, Layers, ArrowLeft, Pencil, Database, FolderOpen, AlertTriangle, ShieldCheck, LayoutGrid, Shield, Smartphone, Globe, Cpu, Puzzle, Settings2, Home as HomeIcon } from "lucide-react";
import { UserButton } from "@/components/user-button";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LayerPanel } from "@/components/layer-panel";
import { MapViewer, type SelectedFeatureData } from "@/components/map-viewer";
import { DrawingToolbar } from "@/components/drawing-toolbar";
import { AttributeTable } from "@/components/attribute-table";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { DataManager } from "@/components/data-manager";
import { LayerAttributeTableWrapper } from "@/components/layer-attribute-table-wrapper";
import { TraceRouteDialog } from "@/components/trace-route-dialog";
import { NetworkSimulationDialog, type SimulationResult } from "@/components/network-simulation-dialog";
import { ConsumerConnectDialog, type ConsumerFormData } from "@/components/consumer-connect-dialog";
import { ComplaintAnalysisDialog, type ComplaintAnalysisResult } from "@/components/complaint-analysis-dialog";
import { TopologyValidationDialog } from "@/components/topology-validation-dialog";
import { GeocodeDialog } from "@/components/geocode-dialog";
import { LayerStylePanel } from "@/components/layer-style-panel";
import { AiChatPanel, WELCOME_MESSAGE, type ChatMessage } from "@/components/ai-chat-panel";
import { useZuluConnectionContext } from "@/contexts/zulu-connection-context";
import { useScene } from "@/contexts/scene-context";
import { useDrawing } from "@/hooks/use-drawing";
import type { ConnectionStatus, EditableLayer, GeometryType, DrawnFeature } from "@shared/schema";

interface SceneDataset {
  id: number;
  sceneId: number;
  datasetId: number;
  layerName: string | null;
  isVisible: number;
  opacity: number;
  color: string;
  pointStyle: string;
  lineStyle: string;
  zIndex: number;
  dataset: {
    id: number;
    name: string;
    originalFilename: string;
    geometryType: string;
    crs: string;
    featureCount: number;
    createdBy: string;
    createdAt: string;
  };
}

interface SidebarContentPanelProps extends Pick<ReturnType<typeof useZuluConnectionContext>, 'layers' | 'toggleLayerVisibility' | 'setLayerOpacity' | 'layerFilters' | 'activeFilters' | 'toggleFilter'> {
  editableLayers: EditableLayer[];
  activeEditableLayer: EditableLayer | null;
  onSelectEditableLayer: (layer: EditableLayer) => void;
  onCreateEditableLayer: (name: string, geometryType: GeometryType) => void;
  onDeleteEditableLayer: (layerId: number) => void;
  editMode: boolean;
  onToggleEditMode: () => void;
  activeSceneDataset: SceneDataset | null;
  onSelectSceneDataset: (sd: SceneDataset | null) => void;
  onOpenAttributeTable?: (layerId: number, layerName: string) => void;
  onOpenStyleConfig?: (layerId: number) => void;
  onOpenGeocodeDialog?: (layerId: number) => void;
  onToggleAiChat?: () => void;
  connectionStatus: ConnectionStatus;
}

function SidebarContentPanel({
  layers,
  toggleLayerVisibility,
  setLayerOpacity,
  layerFilters,
  activeFilters,
  toggleFilter,
  editableLayers,
  activeEditableLayer,
  onSelectEditableLayer,
  onCreateEditableLayer,
  onDeleteEditableLayer,
  editMode,
  onToggleEditMode,
  activeSceneDataset,
  onSelectSceneDataset,
  onOpenAttributeTable,
  onOpenStyleConfig,
  onOpenGeocodeDialog,
  onToggleAiChat,
  connectionStatus,
}: SidebarContentPanelProps) {
  return (
    <ScrollArea className="h-full w-full min-w-0">
      <div className="p-4 min-w-0 max-w-full overflow-hidden">
        <div className="mb-3">
          <ConnectionStatusBadge status={connectionStatus} />
        </div>
        <LayerPanel
          layers={layers}
          onToggleVisibility={toggleLayerVisibility}
          onOpacityChange={setLayerOpacity}
          layerFilters={layerFilters}
          activeFilters={activeFilters}
          onToggleFilter={toggleFilter}
          editableLayers={editableLayers}
          activeEditableLayer={activeEditableLayer}
          onSelectEditableLayer={onSelectEditableLayer}
          onCreateEditableLayer={onCreateEditableLayer}
          onDeleteEditableLayer={onDeleteEditableLayer}
          editMode={editMode}
          onToggleEditMode={onToggleEditMode}
          activeSceneDataset={activeSceneDataset}
          onSelectSceneDataset={onSelectSceneDataset}
          onOpenAttributeTable={onOpenAttributeTable}
          onOpenStyleConfig={onOpenStyleConfig}
          onOpenGeocodeDialog={onOpenGeocodeDialog}
          onToggleAiChat={onToggleAiChat}
        />
      </div>
    </ScrollArea>
  );
}

function FeatureInfoSidebarPanel({
  features,
  onBack,
}: {
  features: SelectedFeatureData[];
  onBack: () => void;
}) {
  return (
    <ScrollArea className="h-full w-full min-w-0">
      <div className="p-4 space-y-4 min-w-0 max-w-full overflow-hidden">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={onBack} data-testid="button-back-to-layers">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold">Атрибуты объектов</h2>
        </div>
        <Separator />
        {features.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет выбранных объектов</p>
        ) : (
          <div className="space-y-4">
            {features.map((feature, idx) => (
              <div key={`${feature.layerId}-${feature.featureIndex}`} className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  {feature.layerName} (объект {feature.featureIndex + 1})
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1">
                  {Object.entries(feature.properties)
                    .filter(([key]) => key !== 'geometry')
                    .map(([key, value]) => (
                      <div key={key} className="flex gap-2 text-xs">
                        <span className="font-medium text-muted-foreground min-w-0 break-all">{key}:</span>
                        <span className="min-w-0 break-all">{String(value ?? '-')}</span>
                      </div>
                    ))}
                </div>
                {idx < features.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const statusConfig = {
    disconnected: { color: "bg-muted-foreground", text: "Не подключено" },
    connecting: { color: "bg-yellow-500 animate-pulse", text: "Подключение..." },
    connected: { color: "bg-green-500", text: "Подключено" },
    error: { color: "bg-destructive", text: "Ошибка" },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2" data-testid="connection-status-badge">
      <div className={`h-2 w-2 rounded-full ${config.color}`} />
      <span className="text-xs text-muted-foreground">
        {config.text}
      </span>
    </div>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const zuluConnection = useZuluConnectionContext();
  const { currentScene, currentSceneId } = useScene();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<"layers" | "featureInfo" | "ai-chat">("layers");
  const [aiChatMessages, setAiChatMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [selectedFeatures, setSelectedFeatures] = useState<SelectedFeatureData[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [showAttributeTable, setShowAttributeTable] = useState(false);
  const [showDataManager, setShowDataManager] = useState(false);
  const selectionActionsRef = useRef<{ clearSelection: () => void; deleteSelected: () => void } | null>(null);
  const drawActionsRef = useRef<{ removeLastPoint: () => boolean; abortDrawing: () => void } | null>(null);
  const mapActionsRef = useRef<{ zoomToFeature: (feature: DrawnFeature) => void } | null>(null);
  const drawing = useDrawing({ drawActionsRef });
  const attributeTableCloseRef = useRef<{ tryClose: () => boolean } | null>(null);
  const [activeSceneDataset, setActiveSceneDataset] = useState<SceneDataset | null>(null);
  const [showTraceDialog, setShowTraceDialog] = useState(false);
  const [importedLayerTable, setImportedLayerTable] = useState<{ layerId: number; layerName: string } | null>(null);
  const [traceSourceInfo, setTraceSourceInfo] = useState<{
    coords: [number, number];
    layerName: string;
    layerId: number;
  } | null>(null);
  const [traceRouteCoords, setTraceRouteCoords] = useState<[number, number][] | null>(null);
  const [showSimulationDialog, setShowSimulationDialog] = useState(false);
  const [simulationFeatureInfo, setSimulationFeatureInfo] = useState<{
    featureId: number;
    layerId: number;
    name: string;
    featureType: string;
  } | null>(null);
  const [simulationHighlightData, setSimulationHighlightData] = useState<{
    segments: Array<{ coordinates: any }>;
    points: Array<{ coordinates: any; type: string }>;
    polygons?: Array<{ coordinates: number[][] }>;
    failurePoint?: { coordinates: any; type: string };
  } | null>(null);
  const [showComplaintDialog, setShowComplaintDialog] = useState(false);
  const [complaintResult, setComplaintResult] = useState<ComplaintAnalysisResult | null>(null);
  const [showTopologyDialog, setShowTopologyDialog] = useState(false);
  const [layerPanelStyleConfigId, setLayerPanelStyleConfigId] = useState<number | null>(null);
  const [layerPanelGeocodeId, setLayerPanelGeocodeId] = useState<number | null>(null);
  const [showSubsystemsDialog, setShowSubsystemsDialog] = useState(false);
  const [showConsumerConnectDialog, setShowConsumerConnectDialog] = useState(false);
  const [consumerConnectCoords, setConsumerConnectCoords] = useState<[number, number] | null>(null);
  const [consumerConnectMode, setConsumerConnectMode] = useState(false);

  const updateDatasetFeatureMutation = useMutation({
    mutationFn: async ({ datasetId, featureId, geometry }: { datasetId: number; featureId: number; geometry: { type: string; coordinates: unknown } }) => {
      const res = await apiRequest("PATCH", `/api/datasets/${datasetId}/features/${featureId}`, { 
        geometryType: geometry.type,
        coordinates: geometry.coordinates,
      });
      return res.json();
    },
    onSuccess: (_, { datasetId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/datasets", datasetId, "features"] });
    },
  });

  useEffect(() => {
    if (!currentSceneId) {
      setLocation("/scenes");
    }
  }, [currentSceneId, setLocation]);

  const handleSelectedFeaturesChange = useCallback((features: SelectedFeatureData[]) => {
    setSelectedFeatures(features);
  }, []);

  const handleShowFeatureInfo = useCallback(() => {
    setSidebarView("featureInfo");
  }, []);

  const handleBackToLayers = useCallback(() => {
    setSidebarView("layers");
  }, []);

  const toggleEditMode = useCallback(() => {
    setEditMode(prev => !prev);
    if (editMode) {
      drawing.setDrawingMode("select");
    }
  }, [editMode, drawing]);

  const handleCreateEditableLayer = useCallback((name: string, geometryType: GeometryType) => {
    drawing.createLayer({
      name,
      geometryType,
      color: "#3B82F6",
      pointStyle: "circle",
      lineStyle: "solid",
      visible: true,
      opacity: 1,
      source: "user",
      crs: "EPSG:4326",
    });
  }, [drawing]);

  const handleSelectSceneDataset = useCallback((sd: SceneDataset | null) => {
    setActiveSceneDataset(sd);
    // When selecting scene dataset, deselect editable layer and vice versa
    if (sd) {
      drawing.selectLayer(null as unknown as EditableLayer);
    }
  }, [drawing]);

  const handleDatasetFeatureUpdated = useCallback((datasetId: number, featureId: number, geometry: { type: string; coordinates: unknown }) => {
    updateDatasetFeatureMutation.mutate({ datasetId, featureId, geometry });
  }, [updateDatasetFeatureMutation]);

  const handleOpenTraceDialog = useCallback(() => {
    if (selectedFeatures.length !== 1 || !drawing.activeLayer) return;
    
    const feature = selectedFeatures[0];
    const realFeatureId = feature.properties?.featureId as number | undefined;
    const featureData = realFeatureId
      ? drawing.features.find(f => f.id === realFeatureId)
      : drawing.features.find((_, idx) => idx === feature.featureIndex);
    
    if (featureData) {
      let coords: [number, number] | null = null;
      const rawCoords = featureData.coordinates as unknown;
      
      if (featureData.geometryType === "Point") {
        coords = rawCoords as [number, number];
      } else if (featureData.geometryType === "LineString") {
        const lineCoords = rawCoords as [number, number][];
        if (lineCoords.length > 0) {
          const midIdx = Math.floor(lineCoords.length / 2);
          coords = lineCoords[midIdx];
        }
      } else if (featureData.geometryType === "Polygon") {
        const polyCoords = rawCoords as [number, number][][];
        if (polyCoords.length > 0 && polyCoords[0].length > 0) {
          const ring = polyCoords[0];
          let sumX = 0, sumY = 0;
          for (const pt of ring) {
            sumX += pt[0];
            sumY += pt[1];
          }
          coords = [sumX / ring.length, sumY / ring.length];
        }
      }
      
      if (coords) {
        setTraceSourceInfo({
          coords,
          layerName: drawing.activeLayer.name,
          layerId: drawing.activeLayer.id,
        });
        setShowTraceDialog(true);
      }
    }
  }, [selectedFeatures, drawing.activeLayer, drawing.features]);

  const handleTraceRouteResult = useCallback((result: { coordinates: [number, number][] }) => {
    setTraceRouteCoords(result.coordinates);
  }, []);

  const handleOpenSimulationDialog = useCallback(() => {
    if (selectedFeatures.length !== 1) return;
    const feature = selectedFeatures[0];
    const realFeatureId = feature.properties?.featureId as number | undefined;
    if (!realFeatureId) return;
    const featureLayerId = feature.layerId;
    const geomProp = feature.properties?.["geometry"];
    const geometryType = (feature.properties?.geometryType as string) || 
                         (geomProp && typeof geomProp === "object" && "getType" in geomProp ? (geomProp as any).getType() : "") || "";
    const name = (feature.properties?.Name as string) || 
                 (feature.properties?.name as string) || 
                 (feature.properties?.["Naim_tepl"] as string) || "";
    setSimulationFeatureInfo({
      featureId: realFeatureId,
      layerId: featureLayerId,
      name,
      featureType: geometryType,
    });
    setShowSimulationDialog(true);
  }, [selectedFeatures]);

  const handleConsumerConnect = useCallback(() => {
    setShowConsumerConnectDialog(true);
  }, []);

  const handleConsumerTraceResult = useCallback((result: any) => {
    if (result.success && result.route?.coordinates) {
      setTraceRouteCoords(result.route.coordinates);
    }
  }, []);

  const handleConsumerConfirm = useCallback(async (result: any, consumerData: ConsumerFormData) => {
    if (!currentSceneId) return;

    const coords = result.consumerCoords || consumerConnectCoords;
    if (!coords) return;

    try {
      let consumerLayerId: number | null = null;
      for (const layer of drawing.editableLayers) {
        if (layer.geometryType === "Point") {
          const features = await apiRequest("GET", `/api/editable-layers/${layer.id}/features`).then(r => r.json());
          if (features.length > 0) {
            const props = features[0].properties as Record<string, unknown>;
            if (props.Adres || props.Dom || props.Ylitsa || props.Hzdan) {
              consumerLayerId = layer.id;
              break;
            }
          }
        }
      }

      if (consumerLayerId) {
        await apiRequest("POST", `/api/editable-layers/${consumerLayerId}/features`, {
          geometryType: "Point",
          coordinates: coords,
          properties: {
            Name: consumerData.name,
            Adres: consumerData.address,
            Hzdan: consumerData.floors,
            Qo_r: consumerData.qo,
            Qgv_r: consumerData.qgv,
            Qsv_r: consumerData.qsv,
          },
        });
        queryClient.invalidateQueries({ queryKey: [`/api/editable-layers/${consumerLayerId}/features`] });
      }

      setTraceRouteCoords(result.route?.coordinates || null);
    } catch (error) {
      console.error("Error creating consumer:", error);
    }
  }, [currentSceneId, drawing.editableLayers, consumerConnectCoords]);

  // Handle undo - during drawing mode, remove last point; otherwise use normal undo
  const handleUndo = useCallback(() => {
    // If we're in line or polygon drawing mode, try to remove the last point first
    if (drawing.drawingMode === 'line' || drawing.drawingMode === 'polygon') {
      const removed = drawActionsRef.current?.removeLastPoint();
      if (removed) {
        return; // Successfully removed a point during drawing
      }
    }
    // Fall back to normal undo (undo completed actions)
    drawing.undo();
  }, [drawing.drawingMode, drawing]);

  // Auto-close attribute table modal when prerequisites are no longer met
  useEffect(() => {
    if (showAttributeTable && (!editMode || !drawing.activeLayer || drawing.features.length === 0)) {
      setShowAttributeTable(false);
    }
  }, [showAttributeTable, editMode, drawing.activeLayer, drawing.features.length]);

  const sidebarStyle = {
    "--sidebar-width": "24rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar className="hidden md:flex border-r border-sidebar-border">
          <SidebarHeader className="flex flex-row items-center justify-between gap-2 border-b border-sidebar-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                <Map className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-semibold">ГИС МО</h1>
                <p className="text-xs text-muted-foreground">Инженерные сети</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className={`min-w-0 ${sidebarView === "ai-chat" ? "overflow-hidden flex flex-col" : "overflow-hidden"}`}>
            <SidebarGroup className={`min-w-0 ${sidebarView === "ai-chat" ? "overflow-hidden flex-1 flex flex-col min-h-0" : "overflow-hidden"}`}>
              <SidebarGroupContent className={`min-w-0 ${sidebarView === "ai-chat" ? "overflow-hidden flex-1 flex flex-col min-h-0" : "overflow-hidden"}`}>
                {sidebarView === "ai-chat" ? (
                  <AiChatPanel onBack={handleBackToLayers} messages={aiChatMessages} onMessagesChange={setAiChatMessages} />
                ) : sidebarView === "layers" ? (
                  <SidebarContentPanel
                    layers={zuluConnection.layers}
                    toggleLayerVisibility={zuluConnection.toggleLayerVisibility}
                    setLayerOpacity={zuluConnection.setLayerOpacity}
                    layerFilters={zuluConnection.layerFilters}
                    activeFilters={zuluConnection.activeFilters}
                    toggleFilter={zuluConnection.toggleFilter}
                    editableLayers={drawing.editableLayers}
                    activeEditableLayer={drawing.activeLayer}
                    onSelectEditableLayer={drawing.selectLayer}
                    onCreateEditableLayer={handleCreateEditableLayer}
                    onDeleteEditableLayer={drawing.deleteLayer}
                    editMode={editMode}
                    onToggleEditMode={toggleEditMode}
                    activeSceneDataset={activeSceneDataset}
                    onSelectSceneDataset={handleSelectSceneDataset}
                    onOpenAttributeTable={(layerId, layerName) => {
                      setImportedLayerTable({ layerId, layerName });
                    }}
                    onOpenStyleConfig={(layerId) => setLayerPanelStyleConfigId(layerId)}
                    onOpenGeocodeDialog={(layerId) => setLayerPanelGeocodeId(layerId)}
                    onToggleAiChat={() => setSidebarView("ai-chat")}
                    connectionStatus={zuluConnection.status}
                  />
                ) : (
                  <FeatureInfoSidebarPanel
                    features={selectedFeatures}
                    onBack={handleBackToLayers}
                  />
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-1 flex-col min-w-0">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="hidden md:flex" data-testid="button-sidebar-toggle" />

              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="md:hidden"
                    data-testid="button-mobile-menu"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80 p-0 flex flex-col">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                        <Map className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div>
                        <h1 className="text-sm font-semibold">ГИС МО</h1>
                        <p className="text-xs text-muted-foreground">Инженерные сети</p>
                      </div>
                    </div>
                  </div>
                  {sidebarView === "ai-chat" ? (
                    <AiChatPanel onBack={handleBackToLayers} messages={aiChatMessages} onMessagesChange={setAiChatMessages} />
                  ) : (
                    <SidebarContentPanel
                      layers={zuluConnection.layers}
                      toggleLayerVisibility={zuluConnection.toggleLayerVisibility}
                      setLayerOpacity={zuluConnection.setLayerOpacity}
                      layerFilters={zuluConnection.layerFilters}
                      activeFilters={zuluConnection.activeFilters}
                      toggleFilter={zuluConnection.toggleFilter}
                      editableLayers={drawing.editableLayers}
                      activeEditableLayer={drawing.activeLayer}
                      onSelectEditableLayer={drawing.selectLayer}
                      onCreateEditableLayer={handleCreateEditableLayer}
                      onDeleteEditableLayer={drawing.deleteLayer}
                      editMode={editMode}
                      onToggleEditMode={toggleEditMode}
                      activeSceneDataset={activeSceneDataset}
                      onSelectSceneDataset={handleSelectSceneDataset}
                      onOpenAttributeTable={(layerId, layerName) => {
                        setImportedLayerTable({ layerId, layerName });
                      }}
                      onOpenStyleConfig={(layerId) => setLayerPanelStyleConfigId(layerId)}
                      onOpenGeocodeDialog={(layerId) => setLayerPanelGeocodeId(layerId)}
                      onToggleAiChat={() => setSidebarView("ai-chat")}
                      connectionStatus={zuluConnection.status}
                    />
                  )}
                </SheetContent>
              </Sheet>

              <div className="flex items-center gap-2 md:hidden">
                <Map className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold">ГИС МО</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {currentScene && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation("/scenes")}
                      className="gap-1 max-w-[150px]"
                      data-testid="button-current-scene"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0" />
                      <span className="truncate hidden sm:inline">{currentScene.name}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Сменить сцену</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDataManager(true)}
                    data-testid="button-open-data-manager"
                  >
                    <Database className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Менеджер данных</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showComplaintDialog ? "default" : "ghost"}
                    size="icon"
                    onClick={() => setShowComplaintDialog(prev => !prev)}
                    data-testid="button-open-complaint-analysis"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Анализ жалоб</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showTopologyDialog ? "default" : "ghost"}
                    size="icon"
                    onClick={() => setShowTopologyDialog(prev => !prev)}
                    data-testid="button-open-topology-check"
                  >
                    <ShieldCheck className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Проверка топологии</TooltipContent>
              </Tooltip>
              <Button 
                variant={editMode ? "default" : "ghost"} 
                size="sm"
                onClick={toggleEditMode}
                data-testid="button-toggle-edit-mode"
                className="gap-1"
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Редактор</span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowSubsystemsDialog(true)}
                    data-testid="button-open-subsystems"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Подсистемы</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/">
                    <Button variant="ghost" size="icon" data-testid="button-back-landing">
                      <HomeIcon className="h-4 w-4" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>На главную</TooltipContent>
              </Tooltip>
              <Link href="/settings">
                <Button variant="ghost" size="icon" data-testid="button-open-settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
              <ThemeToggle />
              <UserButton />
            </div>
          </header>

          <main className="relative flex-1 overflow-hidden">
            {editMode && (
              <DrawingToolbar
                mode={drawing.drawingMode}
                onModeChange={drawing.setDrawingMode}
                activeLayer={drawing.activeLayer}
                onDeleteSelected={() => {
                  if (drawing.drawingMode === 'select' && selectedFeatures.length > 0) {
                    selectionActionsRef.current?.deleteSelected();
                  } else if (drawing.selectedFeatureIds.length > 0) {
                    drawing.deleteSelectedFeatures();
                  }
                }}
                hasSelection={drawing.selectedFeatureIds.length > 0 || selectedFeatures.length > 0}
                canUndo={drawing.canUndo || drawing.drawingMode === 'line' || drawing.drawingMode === 'polygon'}
                canRedo={drawing.canRedo}
                onUndo={handleUndo}
                onRedo={drawing.redo}
                onSave={drawing.save}
                isSaving={drawing.isSaving}
                selectedCount={drawing.drawingMode === 'select' ? selectedFeatures.length : 0}
                onClearSelection={() => selectionActionsRef.current?.clearSelection()}
                showAttributeTable={showAttributeTable}
                onToggleAttributeTable={() => setShowAttributeTable(prev => !prev)}
                featureCount={drawing.features.length}
                onTraceRoute={handleOpenTraceDialog}
                onSimulation={handleOpenSimulationDialog}
                onConsumerConnect={handleConsumerConnect}
                snapSettings={drawing.snapSettings}
                onUpdateSnapSettings={drawing.updateSnapSettings}
                onToggleSnap={drawing.toggleSnap}
                snapLayers={[
                  ...drawing.editableLayers.map(l => ({
                    id: l.id,
                    name: l.name,
                    visible: l.visible ?? true,
                  })),
                  ...zuluConnection.layers.filter(l => l.visible).map(l => ({
                    id: parseInt(l.id) || 0,
                    name: l.name || l.id,
                    visible: l.visible,
                  })),
                ]}
              />
            )}
            
            <MapViewer
              layers={zuluConnection.layers}
              connection={zuluConnection.connection}
              isConnected={zuluConnection.status === "connected" || zuluConnection.status === "connecting"}
              activeFilters={zuluConnection.activeFilters}
              onFiltersDiscovered={zuluConnection.setLayerFilters}
              onLayerLoadError={zuluConnection.handleLayerLoadError}
              onLayerLoadSuccess={zuluConnection.handleLayerLoadSuccess}
              tickets={zuluConnection.tickets}
              ticketMode={zuluConnection.ticketMode}
              onToggleTicketMode={() => zuluConnection.setTicketMode(!zuluConnection.ticketMode)}
              onCreateTicket={zuluConnection.createTicket}
              allEditableLayers={drawing.editableLayers}
              onSelectedFeaturesChange={handleSelectedFeaturesChange}
              onShowFeatureInfo={handleShowFeatureInfo}
              editMode={editMode}
              drawingMode={drawing.drawingMode}
              activeEditableLayer={drawing.activeLayer}
              editableFeatures={drawing.features}
              onFeatureCreated={drawing.createFeature}
              onFeatureUpdated={drawing.updateFeature}
              selectedEditableFeatureIds={drawing.selectedFeatureIds}
              onEditableFeatureSelect={drawing.selectFeature}
              onClearEditableSelection={drawing.clearSelection}
              onSelectEditableLayer={drawing.selectLayer}
              selectionActionsRef={selectionActionsRef}
              drawActionsRef={drawActionsRef}
              activeSceneDataset={activeSceneDataset}
              onDatasetFeatureUpdated={handleDatasetFeatureUpdated}
              traceRouteCoordinates={traceRouteCoords}
              simulationHighlightData={simulationHighlightData}
              snapSettings={drawing.snapSettings}
              mapActionsRef={mapActionsRef}
            />

            {/* Attribute Table Modal */}
            <DraggableModal
              isOpen={showAttributeTable && editMode && drawing.activeLayer !== null && drawing.features.length > 0}
              onClose={() => setShowAttributeTable(false)}
              onBeforeClose={() => {
                if (attributeTableCloseRef.current?.tryClose()) {
                  return true;
                }
                return false;
              }}
              title={`Таблица атрибутов: ${drawing.activeLayer?.name || ''}`}
              defaultWidth={900}
              defaultHeight={400}
              minWidth={500}
              minHeight={250}
            >
              {drawing.activeLayer && (
                <AttributeTable
                  features={drawing.features}
                  selectedFeatureIds={drawing.selectedFeatureIds}
                  layerSchema={drawing.layerSchema || null}
                  onFeatureSelect={drawing.selectFeature}
                  onFeatureUpdate={(featureId, properties) => {
                    drawing.updateFeature(featureId, { properties });
                  }}
                  onBatchUpdate={drawing.batchUpdateFeatures}
                  onBatchDelete={drawing.batchDeleteFeatures}
                  onSchemaUpdate={drawing.updateSchema}
                  onSelectAll={drawing.selectAllFeatures}
                  onClearSelection={drawing.clearSelection}
                  onZoomToFeature={(feature) => mapActionsRef.current?.zoomToFeature(feature)}
                  onRequestClose={() => setShowAttributeTable(false)}
                  closeRef={attributeTableCloseRef}
                  layerName={drawing.activeLayer.name}
                />
              )}
            </DraggableModal>

            {/* Data Manager */}
            {showDataManager && (
              <DataManager 
                onClose={() => setShowDataManager(false)} 
                onOpenAttributeTable={(layerId, layerName) => {
                  setImportedLayerTable({ layerId, layerName });
                }}
              />
            )}

            {/* Layer Attribute Table from Data Manager */}
            {importedLayerTable && (
              <LayerAttributeTableWrapper
                layerId={importedLayerTable.layerId}
                layerName={importedLayerTable.layerName}
                onClose={() => setImportedLayerTable(null)}
                onZoomToFeature={(feature) => mapActionsRef.current?.zoomToFeature(feature)}
              />
            )}

            {/* Layer Panel Style Config */}
            {layerPanelStyleConfigId !== null && (() => {
              const layer = drawing.editableLayers.find(l => l.id === layerPanelStyleConfigId);
              if (!layer) return null;
              return (
                <LayerStylePanel
                  open={true}
                  onOpenChange={(open) => { if (!open) setLayerPanelStyleConfigId(null); }}
                  layer={{
                    id: layer.id,
                    color: layer.color,
                    pointStyle: layer.pointStyle,
                    lineStyle: layer.lineStyle,
                    opacity: layer.opacity,
                    geometryType: layer.geometryType,
                    styleConfig: layer.styleConfig,
                  }}
                  onSave={async (updates) => {
                    await apiRequest("PATCH", `/api/editable-layers/${layer.id}`, updates);
                    queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/editable-layers/viewport-features"] });
                    setLayerPanelStyleConfigId(null);
                  }}
                />
              );
            })()}

            {/* Layer Panel Geocode Dialog */}
            {layerPanelGeocodeId !== null && (() => {
              const layer = drawing.editableLayers.find(l => l.id === layerPanelGeocodeId);
              return (
                <GeocodeDialog
                  layerId={layerPanelGeocodeId}
                  layerName={layer?.name || ""}
                  open={true}
                  onOpenChange={(open) => { if (!open) setLayerPanelGeocodeId(null); }}
                />
              );
            })()}

            {/* Trace Route Dialog */}
            <TraceRouteDialog
              open={showTraceDialog}
              onOpenChange={setShowTraceDialog}
              sourceCoords={traceSourceInfo?.coords || null}
              sourceLayerName={traceSourceInfo?.layerName || null}
              availableLayers={drawing.editableLayers}
              currentLayerId={traceSourceInfo?.layerId || null}
              onRouteResult={handleTraceRouteResult}
            />

            {/* Complaint Analysis Dialog */}
            <ComplaintAnalysisDialog
              open={showComplaintDialog}
              onOpenChange={setShowComplaintDialog}
              editableLayers={drawing.editableLayers}
              sceneId={currentSceneId || 0}
              onAnalysisResult={(result) => {
                setComplaintResult(result);
                if (!result) {
                  setSimulationHighlightData(null);
                }
              }}
              onHighlightZone={(zone) => {
                if (!zone) {
                  setSimulationHighlightData(null);
                  return;
                }
                const segments = zone.affectedSegments.map((s: any) => ({ coordinates: s.coordinates }));
                const points = zone.affectedConsumers.map((c: any) => ({ coordinates: c.coordinates, type: "consumer" }));
                setSimulationHighlightData({
                  segments,
                  points,
                  failurePoint: zone.zoneCoordinates ? {
                    coordinates: zone.zoneCoordinates,
                    type: zone.zoneType === "node" || zone.zoneType === "ctp" || zone.zoneType === "consumer" ? "node" : "segment",
                  } : undefined,
                });
              }}
              onHighlightPolygons={(data) => {
                if (!data) {
                  setSimulationHighlightData(null);
                  return;
                }
                setSimulationHighlightData({
                  segments: [],
                  points: data.points.map(p => ({ coordinates: p.coordinates, type: p.type })),
                  polygons: data.polygons,
                });
              }}
            />

            {/* Network Simulation Dialog */}
            <NetworkSimulationDialog
              open={showSimulationDialog}
              onOpenChange={setShowSimulationDialog}
              featureId={simulationFeatureInfo?.featureId || null}
              layerId={simulationFeatureInfo?.layerId || null}
              featureName={simulationFeatureInfo?.name || ""}
              featureType={simulationFeatureInfo?.featureType || ""}
              sceneId={currentSceneId || 0}
              onSimulationResult={(result: SimulationResult | null) => {
                if (!result) {
                  setSimulationHighlightData(null);
                  return;
                }
                const segments = result.affectedSegments.map(s => ({ coordinates: s.coordinates }));
                const points = [
                  ...result.affectedConsumers.map(c => ({ coordinates: c.coordinates, type: "consumer" })),
                  ...result.affectedCTPs.map(c => ({ coordinates: c.coordinates, type: "ctp" })),
                  ...result.affectedNodes.map(n => ({ coordinates: n.coordinates, type: "node" })),
                ];
                setSimulationHighlightData({
                  segments,
                  points,
                  failurePoint: {
                    coordinates: result.failurePoint.coordinates,
                    type: result.failurePoint.type,
                  },
                });
              }}
            />

            <ConsumerConnectDialog
              open={showConsumerConnectDialog}
              onOpenChange={setShowConsumerConnectDialog}
              consumerCoords={consumerConnectCoords}
              sceneId={currentSceneId || 0}
              onTraceResult={handleConsumerTraceResult}
              onConfirm={handleConsumerConfirm}
            />

            <TopologyValidationDialog
              open={showTopologyDialog}
              onOpenChange={setShowTopologyDialog}
              sceneId={currentSceneId || 0}
            />

            <Dialog open={showSubsystemsDialog} onOpenChange={setShowSubsystemsDialog}>
              <DialogContent className="max-w-2xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle>Подсистемы «Аналитические инструменты»</DialogTitle>
                  <DialogDescription>Подсистемы 1–6, реализованные в данном модуле</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[55vh] pr-4">
                  <div className="space-y-2">
                    {[
                      { id: 1, name: "Многопользовательская работа и мониторинг", desc: "Управление доступом, ролями, контроль работы системы", where: "Панель администратора", icon: Shield, action: () => { setShowSubsystemsDialog(false); setLocation("/admin/users"); } },
                      { id: 2, name: "Мобильный доступ через веб-службы", desc: "Адаптивный веб-интерфейс для мобильных устройств", where: "Все страницы (адаптивный дизайн)", icon: Smartphone, action: null },
                      { id: 3, name: "Удалённый доступ через веб-службы", desc: "Внешний API с управлением ключами доступа", where: "Администрирование → Внешние подключения", icon: Globe, action: () => { setShowSubsystemsDialog(false); setLocation("/admin/users"); } },
                      { id: 4, name: "Интеграция с АСУ ТП", desc: "Обмен данными через внешний API", where: "Администрирование → Внешние подключения", icon: Cpu, action: () => { setShowSubsystemsDialog(false); setLocation("/admin/users"); } },
                      { id: 5, name: "Геоинформационные плагины", desc: "Управление слоями, импорт/экспорт данных", where: "Менеджер данных", icon: Puzzle, action: () => { setShowSubsystemsDialog(false); setShowDataManager(true); } },
                      { id: 6, name: "Настройка интерфейса", desc: "Темы, стилизация слоёв, конфигурация отображения", where: "Настройки", icon: Settings2, action: () => { setShowSubsystemsDialog(false); setLocation("/settings"); } },
                    ].map((sub) => {
                      const Icon = sub.icon;
                      return (
                        <div
                          key={sub.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border bg-card ${sub.action ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
                          onClick={sub.action || undefined}
                          data-testid={`subsystem-nav-${sub.id}`}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground">#{sub.id}</span>
                              <span className="text-sm font-medium">{sub.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{sub.desc}</p>
                            <p className="text-xs text-primary/70 mt-0.5">{sub.where}</p>
                          </div>
                          {sub.action && (
                            <Badge variant="outline" className="text-xs shrink-0 mt-1">Перейти</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
