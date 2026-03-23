import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Map, Menu, Layers, ArrowLeft, Pencil, FolderOpen, AlertTriangle, ShieldCheck, BarChart3, Zap, Wrench, Trash2 } from "lucide-react";
import { UserButton } from "@/components/user-button";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

import { LayerPanel } from "@/components/layer-panel";
import { MapViewer, type SelectedFeatureData } from "@/components/map-viewer";
import { HiddenCategoriesProvider } from "@/contexts/hidden-categories-context";
import { DrawingToolbar } from "@/components/drawing-toolbar";
import { AttributeTable } from "@/components/attribute-table";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { DataManager } from "@/components/data-manager";
import { LayerAttributeTableWrapper } from "@/components/layer-attribute-table-wrapper";
import { TraceRouteDialog } from "@/components/trace-route-dialog";
import { NetworkSimulationDialog, type SimulationResult } from "@/components/network-simulation-dialog";
import { ConsumerConnectDialog, type ConsumerFormData } from "@/components/consumer-connect-dialog";
import { ComplaintAnalysisDialog, type ComplaintAnalysisResult } from "@/components/complaint-analysis-dialog";
import { ReconstructionProgramDialog, type SegmentImportData } from "@/components/reconstruction-program-dialog";
import { AccidentAnalysisDialog, type AccidentSegmentResult, type AccidentAnalysisResult } from "@/components/accident-analysis-dialog";
import { TopologyValidationDialog } from "@/components/topology-validation-dialog";
import { GeoAnalysisModal } from "@/components/geo-analysis-modal";
import { FeatureInfoModal } from "@/components/feature-info-modal";
import { SensorTelemetryBlock } from "@/components/sensor-telemetry-block";
import { GeocodeDialog } from "@/components/geocode-dialog";
import { LayerStylePanel } from "@/components/layer-style-panel";
import { AiChatPanel, WELCOME_MESSAGE, type ChatMessage, type AiProvider } from "@/components/ai-chat-panel";
import { MapSearchBar } from "@/components/map-search-bar";
import { BugReportButton } from "@/components/bug-report-button";
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
  aiChatActive?: boolean;
  aiChatContent?: ReactNode;
  aiHeaderActions?: ReactNode;
  onOpenDataManager?: () => void;
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
  aiChatActive,
  aiChatContent,
  aiHeaderActions,
  onOpenDataManager,
  connectionStatus,
}: SidebarContentPanelProps) {
  return (
    <div className="h-full w-full min-w-0 overflow-hidden flex flex-col">
      <div className="p-4 min-w-0 max-w-full overflow-hidden flex flex-col flex-1 min-h-0">
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
          aiChatActive={aiChatActive}
          aiChatContent={aiChatContent}
          aiHeaderActions={aiHeaderActions}
          onOpenDataManager={onOpenDataManager}
          connectionStatus={connectionStatus}
        />
      </div>
    </div>
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
                {feature.properties.sensor_id != null && feature.properties.sensor_id !== "" && (
                  <SensorTelemetryBlock sensorId={feature.properties.sensor_id as number | string} />
                )}
                {idx < features.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
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
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [selectedAiProvider, setSelectedAiProvider] = useState<string>("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvidersLoaded, setAiProvidersLoaded] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<SelectedFeatureData[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [showAttributeTable, setShowAttributeTable] = useState(false);
  const [showFeatureInfo, setShowFeatureInfo] = useState(false);
  const [showDataManager, setShowDataManager] = useState(false);
  const [showGeoAnalysis, setShowGeoAnalysis] = useState(false);
  const selectionActionsRef = useRef<{
    clearSelection: () => void;
    deleteSelected: () => void;
    deleteFeatures: (ids: number[]) => void;
  } | null>(null);
  const drawActionsRef = useRef<{ removeLastPoint: () => boolean; abortDrawing: () => void } | null>(null);
  const mapActionsRef = useRef<{ zoomToFeature: (feature: DrawnFeature) => void; zoomToCoordinates: (lat: number, lon: number, zoom?: number) => void; panToFeatureIfOutsideViewport: (feature: DrawnFeature) => void } | null>(null);
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
  const [reconstructionCoords, setReconstructionCoords] = useState<Array<{ coordinates: any; name: string; currentDiameter: number; requiredDiameter: number }> | null>(null);
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
  const [showAccidentDialog, setShowAccidentDialog] = useState(false);
  const [aiAccidentResult, setAiAccidentResult] = useState<AccidentAnalysisResult | null>(null);
  const [aiComplaintNoTopoResult, setAiComplaintNoTopoResult] = useState<any>(null);
  const [aiSimulationResult, setAiSimulationResult] = useState<SimulationResult | null>(null);
  const [showTopologyDialog, setShowTopologyDialog] = useState(false);
  const [showReconstructionProgram, setShowReconstructionProgram] = useState(false);
  const [reconstructionImportSegments, setReconstructionImportSegments] = useState<SegmentImportData[]>([]);
  const [aiReconstructionProgramId, setAiReconstructionProgramId] = useState<number | null>(null);
  const [layerPanelStyleConfigId, setLayerPanelStyleConfigId] = useState<number | null>(null);
  const [layerPanelGeocodeId, setLayerPanelGeocodeId] = useState<number | null>(null);

  const [showConsumerConnectDialog, setShowConsumerConnectDialog] = useState(false);
  const [consumerConnectCoords, setConsumerConnectCoords] = useState<[number, number] | null>(null);
  const [consumerConnectFeatureRef, setConsumerConnectFeatureRef] = useState<{ layerId: number; featureId: number } | null>(null);

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
      window.dispatchEvent(new Event("viewport-features-invalidate"));
    },
  });

  useEffect(() => {
    if (!currentSceneId) {
      setLocation("/gis/scenes");
    }
  }, [currentSceneId, setLocation]);

  useEffect(() => {
    fetch("/api/ai/providers")
      .then(r => r.json())
      .then((data: { enabled: boolean; providers?: AiProvider[]; default?: string }) => {
        setAiEnabled(data.enabled);
        if (data.providers) setAiProviders(data.providers);
        if (data.default) setSelectedAiProvider(data.default);
        setAiProvidersLoaded(true);
      })
      .catch(() => setAiProvidersLoaded(true));
  }, []);

  const handleSelectedFeaturesChange = useCallback((features: SelectedFeatureData[]) => {
    setSelectedFeatures(features);
  }, []);

  const handleShowFeatureInfo = useCallback(() => {
    setSidebarView("featureInfo");
  }, []);

  const handleBackToLayers = useCallback(() => {
    setSidebarView("layers");
  }, []);

  const handleToggleAiChat = useCallback(() => {
    setSidebarView(v => v === "ai-chat" ? "layers" : "ai-chat");
  }, []);

  const toggleEditMode = useCallback(() => {
    if (editMode) {
      // Exiting edit mode: flush session trash to server, then reset
      drawing.flushSessionDeletes();
      drawing.clearSession();
      drawing.setDrawingMode("select");
    } else {
      // Entering edit mode: start a fresh session
      drawing.clearSession();
    }
    setEditMode(prev => !prev);
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
    if (selectedFeatures.length !== 1) return;

    const feature = selectedFeatures[0];
    const realFeatureId = feature.properties?.featureId as number | undefined;
    const featureData = realFeatureId
      ? drawing.features.find(f => f.id === realFeatureId)
      : drawing.features.find((_, idx) => idx === feature.featureIndex);

    if (featureData && featureData.geometryType === "Point") {
      const coords = featureData.coordinates as [number, number];
      setConsumerConnectCoords(coords);
      if (realFeatureId) {
        setConsumerConnectFeatureRef({ layerId: feature.layerId, featureId: realFeatureId });
      }
      setShowConsumerConnectDialog(true);
    }
  }, [selectedFeatures, drawing.features]);

  const handleConsumerTraceResult = useCallback((result: any) => {
    if (result.success && result.route?.coordinates) {
      setTraceRouteCoords(result.route.coordinates);
    }
    if (result.capacityAnalysis?.pipeIssues?.length > 0) {
      setReconstructionCoords(
        result.capacityAnalysis.pipeIssues.map((issue: any) => ({
          coordinates: issue.coordinates,
          name: issue.name,
          currentDiameter: Math.min(issue.currentDpod || 0, issue.currentDobr || Infinity),
          requiredDiameter: issue.requiredDiameter,
        }))
      );
    } else {
      setReconstructionCoords(null);
    }
  }, []);

  const handleConsumerConfirm = useCallback(async (result: any, consumerData: ConsumerFormData) => {
    if (result.route?.coordinates) {
      setTraceRouteCoords(result.route.coordinates);
    }

    if (!consumerConnectFeatureRef) return;

    try {
      await apiRequest("PATCH", `/api/editable-layers/${consumerConnectFeatureRef.layerId}/features/${consumerConnectFeatureRef.featureId}`, {
        properties: {
          Name: consumerData.name,
          Adres: consumerData.address,
          Hzdan: consumerData.floors,
          Qo_r: consumerData.qo,
          Qgv_r: consumerData.qgv,
          Qsv_r: consumerData.qsv,
        },
      });
      queryClient.invalidateQueries({ queryKey: [`/api/editable-layers/${consumerConnectFeatureRef.layerId}/features`] });
      window.dispatchEvent(new Event("viewport-features-invalidate"));
    } catch (error) {
      console.error("Error updating consumer:", error);
    }
  }, [consumerConnectFeatureRef]);

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

  // Auto-close attribute table modal only when the layer disappears or has no features
  // (NOT when editMode changes — table stays open in read-only mode)
  useEffect(() => {
    if (showAttributeTable && (!drawing.activeLayer || drawing.features.length === 0)) {
      setShowAttributeTable(false);
    }
  }, [showAttributeTable, drawing.activeLayer, drawing.features.length]);

  // Auto-close feature info modal when no feature is selected
  useEffect(() => {
    if (showFeatureInfo && selectedFeatures.length === 0) {
      setShowFeatureInfo(false);
    }
  }, [showFeatureInfo, selectedFeatures.length]);

  const sidebarStyle = {
    "--sidebar-width": "24rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  const aiIsDisabled = !aiEnabled || aiProviders.length === 0;
  const aiHasHistory = aiChatMessages.some(m => m.id !== "welcome");

  const aiHeaderActions: ReactNode = aiHasHistory ? (
    <Button
      size="icon"
      variant="ghost"
      onClick={() => setAiChatMessages([WELCOME_MESSAGE])}
      className="h-7 w-7"
      title="Очистить чат"
      data-testid="button-clear-chat"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  ) : null;

  return (
    <HiddenCategoriesProvider>
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar className="hidden md:flex border-r border-sidebar-border">
          <SidebarHeader className="flex flex-row items-center gap-2 border-b border-sidebar-border px-8 h-14 shrink-0">
            <Link href="/" className="flex items-center gap-2 cursor-pointer" data-testid="button-home-sidebar">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                <Map className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sm">ГИС МО «Инженерные сети»</span>
            </Link>
          </SidebarHeader>

          <MapSearchBar
            onZoomToCoordinates={(lat, lon, zoom) => mapActionsRef.current?.zoomToCoordinates(lat, lon, zoom)}
            onZoomToFeature={(feature) => mapActionsRef.current?.zoomToFeature(feature)}
          />

          <SidebarContent className="min-w-0 overflow-hidden flex flex-col">
            <SidebarGroup className="min-w-0 overflow-hidden flex-1 flex flex-col min-h-0">
              <SidebarGroupContent className="min-w-0 overflow-hidden flex-1 flex flex-col min-h-0">
                {sidebarView === "featureInfo" ? (
                  <FeatureInfoSidebarPanel
                    features={selectedFeatures}
                    onBack={handleBackToLayers}
                  />
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
                      const editableLayer = drawing.editableLayers.find(l => l.id === layerId);
                      if (editableLayer) {
                        drawing.selectLayer(editableLayer);
                        setShowAttributeTable(true);
                      } else {
                        setImportedLayerTable({ layerId, layerName });
                      }
                    }}
                    onOpenStyleConfig={(layerId) => setLayerPanelStyleConfigId(layerId)}
                    onOpenGeocodeDialog={(layerId) => setLayerPanelGeocodeId(layerId)}
                    onToggleAiChat={handleToggleAiChat}
                    aiChatActive={sidebarView === "ai-chat"}
                    aiChatContent={<AiChatPanel messages={aiChatMessages} onMessagesChange={setAiChatMessages} sceneId={currentSceneId} providers={aiProviders} selectedProvider={selectedAiProvider} onProviderChange={setSelectedAiProvider} isDisabled={aiIsDisabled} providersLoaded={aiProvidersLoaded} onComplaintAnalysisResult={(result) => { setAiComplaintNoTopoResult(result); setShowComplaintDialog(true); }} onSimulationResult={(result, featureInfo) => { setSimulationFeatureInfo({ featureId: featureInfo.featureId, layerId: featureInfo.layerId, name: featureInfo.name, featureType: featureInfo.featureType }); setAiSimulationResult(result); setShowSimulationDialog(true); }} onAccidentAnalysisResult={(result) => { setAiAccidentResult(result); setShowAccidentDialog(true); }} onReconstructionProgramCreated={(programId) => { setAiReconstructionProgramId(programId); setShowReconstructionProgram(true); }} />}
                    aiHeaderActions={aiHeaderActions}
                    onOpenDataManager={() => setShowDataManager(true)}
                    connectionStatus={zuluConnection.status}
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
                  <Link href="/" className="flex items-center gap-2 border-b px-4 h-14 shrink-0" data-testid="button-home-mobile-sheet">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                      <Map className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <span className="font-semibold text-sm">ГИС МО «Инженерные сети»</span>
                  </Link>
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
                    onToggleAiChat={handleToggleAiChat}
                    aiChatActive={sidebarView === "ai-chat"}
                    aiChatContent={<AiChatPanel messages={aiChatMessages} onMessagesChange={setAiChatMessages} sceneId={currentSceneId} providers={aiProviders} selectedProvider={selectedAiProvider} onProviderChange={setSelectedAiProvider} isDisabled={aiIsDisabled} providersLoaded={aiProvidersLoaded} onComplaintAnalysisResult={(result) => { setAiComplaintNoTopoResult(result); setShowComplaintDialog(true); }} onSimulationResult={(result, featureInfo) => { setSimulationFeatureInfo({ featureId: featureInfo.featureId, layerId: featureInfo.layerId, name: featureInfo.name, featureType: featureInfo.featureType }); setAiSimulationResult(result); setShowSimulationDialog(true); }} onAccidentAnalysisResult={(result) => { setAiAccidentResult(result); setShowAccidentDialog(true); }} onReconstructionProgramCreated={(programId) => { setAiReconstructionProgramId(programId); setShowReconstructionProgram(true); }} />}
                    aiHeaderActions={aiHeaderActions}
                    onOpenDataManager={() => setShowDataManager(true)}
                    connectionStatus={zuluConnection.status}
                  />
                </SheetContent>
              </Sheet>

              <Link href="/" className="flex items-center gap-2 md:hidden" data-testid="button-home-mobile">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                  <Map className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-semibold text-sm">ГИС МО «Инженерные сети»</span>
              </Link>
            </div>

            <div className="flex items-center gap-2">
              {currentScene && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation("/gis/scenes")}
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
              {drawing.editableLayers.length >= 2 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showGeoAnalysis ? "default" : "ghost"}
                      size="icon"
                      onClick={() => setShowGeoAnalysis(prev => !prev)}
                      data-testid="button-open-analytics"
                    >
                      <BarChart3 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Геопространственный анализ</TooltipContent>
                </Tooltip>
              )}
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
                    variant={showAccidentDialog ? "default" : "ghost"}
                    size="icon"
                    onClick={() => setShowAccidentDialog(prev => !prev)}
                    data-testid="button-open-accident-analysis"
                  >
                    <Zap className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Анализ аварийности</TooltipContent>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showReconstructionProgram ? "default" : "ghost"}
                    size="icon"
                    onClick={() => setShowReconstructionProgram(prev => !prev)}
                    data-testid="button-open-reconstruction-program"
                  >
                    <Wrench className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Программа реконструкции</TooltipContent>
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
              <UserButton />
            </div>
          </header>

          <main className="relative flex-1 overflow-hidden">
            {drawing.editableLayers.length > 0 && (
              <DrawingToolbar
                mode={drawing.drawingMode}
                onModeChange={drawing.setDrawingMode}
                activeLayer={drawing.activeLayer}
                editMode={editMode}
                onDeleteSelected={() => {
                  const ids = drawing.selectedFeatureIds;
                  if (ids.length > 0) {
                    drawing.deleteFromSession(ids);
                  }
                }}
                hasSelection={drawing.selectedFeatureIds.length > 0 || selectedFeatures.length > 0}
                canUndo={drawing.canUndo || drawing.drawingMode === 'line' || drawing.drawingMode === 'polygon'}
                canRedo={drawing.canRedo}
                onUndo={handleUndo}
                onRedo={drawing.redo}
                undoDescription={drawing.undoDescription}
                redoDescription={drawing.redoDescription}
                selectedCount={selectedFeatures.length}
                onClearSelection={() => selectionActionsRef.current?.clearSelection()}
                showAttributeTable={showAttributeTable}
                onToggleAttributeTable={() => setShowAttributeTable(prev => !prev)}
                featureCount={drawing.features.length}
                showFeatureInfo={showFeatureInfo}
                onToggleFeatureInfo={() => setShowFeatureInfo(prev => !prev)}
                hasSelectedFeature={selectedFeatures.length > 0}
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
              onFeatureCreated={drawing.createFeature}
              onFeatureUpdated={drawing.updateFeature}
              selectedEditableFeatureIds={drawing.selectedFeatureIds}
              onEditableFeatureSelect={drawing.selectFeature}
              onMultiSelectFeatures={drawing.selectAllFeatures}
              onClearEditableSelection={drawing.clearSelection}
              onSelectEditableLayer={drawing.selectLayer}
              selectionActionsRef={selectionActionsRef}
              drawActionsRef={drawActionsRef}
              activeSceneDataset={activeSceneDataset}
              onDatasetFeatureUpdated={handleDatasetFeatureUpdated}
              traceRouteCoordinates={traceRouteCoords}
              reconstructionHighlight={reconstructionCoords}
              simulationHighlightData={simulationHighlightData}
              snapSettings={drawing.snapSettings}
              mapActionsRef={mapActionsRef}
            />

            {/* Attribute Table Modal */}
            <DraggableModal
              isOpen={showAttributeTable && drawing.activeLayer !== null && drawing.features.length > 0}
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
                  onBatchDelete={(ids) => {
                    drawing.deleteFromSession(ids);
                  }}
                  onSchemaUpdate={drawing.updateSchema}
                  onSelectAll={drawing.selectAllFeatures}
                  onClearSelection={drawing.clearSelection}
                  onZoomToFeature={(feature) => mapActionsRef.current?.zoomToFeature(feature)}
                  onFeatureSelectWithPan={(feature) => mapActionsRef.current?.panToFeatureIfOutsideViewport(feature)}
                  onRequestClose={() => setShowAttributeTable(false)}
                  closeRef={attributeTableCloseRef}
                  layerName={drawing.activeLayer.name}
                  readOnly={!editMode}
                />
              )}
            </DraggableModal>

            {/* Feature Info Modal */}
            <FeatureInfoModal
              isOpen={showFeatureInfo && selectedFeatures.length > 0}
              onClose={() => setShowFeatureInfo(false)}
              feature={selectedFeatures[0] ?? null}
            />

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
                    window.dispatchEvent(new Event("viewport-features-invalidate"));
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
              onOpenChange={(open) => { setShowComplaintDialog(open); if (!open) setAiComplaintNoTopoResult(null); }}
              editableLayers={drawing.editableLayers}
              sceneId={currentSceneId || 0}
              initialNoTopoResult={aiComplaintNoTopoResult}
              onOpenReconstructionProgram={() => { setShowReconstructionProgram(true); }}
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

            {/* Accident Analysis Dialog */}
            <AccidentAnalysisDialog
              open={showAccidentDialog}
              onOpenChange={(open) => { setShowAccidentDialog(open); if (!open) { setSimulationHighlightData(null); setAiAccidentResult(null); } }}
              initialResult={aiAccidentResult}
              editableLayers={drawing.editableLayers}
              sceneId={currentSceneId || 0}
              onSavedToLayer={(layerId, layerName) => {
                const notifyMsg: ChatMessage = {
                  id: `ai-saved-${Date.now()}`,
                  role: "assistant",
                  content: `Результаты анализа аварийности сохранены в слой "${layerName}". Теперь я знаю об этом слое и смогу ответить на ваши вопросы по данным о проблемных участках — спрашивайте.`,
                  timestamp: new Date(),
                };
                setAiChatMessages(prev => [...prev, notifyMsg]);
              }}
              onOpenReconstructionProgram={(segments: SegmentImportData[]) => {
                setReconstructionImportSegments(segments);
                setShowReconstructionProgram(true);
              }}
              onHighlightSegment={(segment: AccidentSegmentResult | null) => {
                if (!segment) {
                  setSimulationHighlightData(null);
                  return;
                }
                const segCoords = segment.geometry.coordinates;
                const lineCoordsList: any[] = [];
                if (segment.geometry.type === "LineString") {
                  lineCoordsList.push(segCoords);
                } else if (segment.geometry.type === "MultiLineString") {
                  for (const part of segCoords) {
                    lineCoordsList.push(part);
                  }
                }
                const accidentPoints = segment.accidentFeatures
                  .filter(a => a.geometry && a.geometry.type === "Point")
                  .map(a => ({ coordinates: a.geometry.coordinates, type: "accident" }));
                setSimulationHighlightData({
                  segments: lineCoordsList.map(coords => ({ coordinates: coords })),
                  points: accidentPoints,
                });
              }}
            />

            {/* Network Simulation Dialog */}
            <NetworkSimulationDialog
              open={showSimulationDialog}
              onOpenChange={(open) => { setShowSimulationDialog(open); if (!open) setAiSimulationResult(null); }}
              featureId={simulationFeatureInfo?.featureId || null}
              layerId={simulationFeatureInfo?.layerId || null}
              featureName={simulationFeatureInfo?.name || ""}
              featureType={simulationFeatureInfo?.featureType || ""}
              sceneId={currentSceneId || 0}
              initialResult={aiSimulationResult}
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
              isOpen={showConsumerConnectDialog}
              onClose={() => {
                setShowConsumerConnectDialog(false);
                setConsumerConnectCoords(null);
                setConsumerConnectFeatureRef(null);
                setTraceRouteCoords(null);
                setReconstructionCoords(null);
              }}
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

            <GeoAnalysisModal
              isOpen={showGeoAnalysis}
              onClose={() => setShowGeoAnalysis(false)}
              editableLayers={drawing.editableLayers}
              sceneId={currentSceneId}
            />

            <ReconstructionProgramDialog
              open={showReconstructionProgram}
              onOpenChange={(open) => {
                setShowReconstructionProgram(open);
                if (!open) {
                  setReconstructionImportSegments([]);
                  setAiReconstructionProgramId(null);
                }
              }}
              sceneId={currentSceneId || 0}
              initialSegments={reconstructionImportSegments}
              initialProgramId={aiReconstructionProgramId}
            />

          </main>
        </div>
      </div>
      <BugReportButton />
    </SidebarProvider>
    </HiddenCategoriesProvider>
  );
}
