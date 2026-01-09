import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Map, Settings, Menu, Layers, ArrowLeft, Pencil, Database, FolderOpen } from "lucide-react";
import { UserButton } from "@/components/user-button";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
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
import { TraceRouteDialog } from "@/components/trace-route-dialog";
import { useZuluConnectionContext } from "@/contexts/zulu-connection-context";
import { useScene } from "@/contexts/scene-context";
import { useDrawing } from "@/hooks/use-drawing";
import type { ConnectionStatus, EditableLayer, GeometryType } from "@shared/schema";

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
}: SidebarContentPanelProps) {
  return (
    <ScrollArea className="h-full w-full min-w-0">
      <div className="p-4 min-w-0 max-w-full overflow-hidden">
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
      <span className="text-xs text-muted-foreground hidden sm:inline">
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
  const drawing = useDrawing();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<"layers" | "featureInfo">("layers");
  const [selectedFeatures, setSelectedFeatures] = useState<SelectedFeatureData[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [showAttributeTable, setShowAttributeTable] = useState(false);
  const [showDataManager, setShowDataManager] = useState(false);
  const selectionActionsRef = useRef<{ clearSelection: () => void; deleteSelected: () => void } | null>(null);
  const [activeSceneDataset, setActiveSceneDataset] = useState<SceneDataset | null>(null);
  const [showTraceDialog, setShowTraceDialog] = useState(false);
  const [traceSourceInfo, setTraceSourceInfo] = useState<{
    coords: [number, number];
    layerName: string;
    layerId: number;
  } | null>(null);
  const [traceRouteCoords, setTraceRouteCoords] = useState<[number, number][] | null>(null);

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
    const featureData = drawing.features.find((_, idx) => idx === feature.featureIndex);
    
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

          <SidebarContent className="min-w-0 overflow-hidden">
            <SidebarGroup className="min-w-0 overflow-hidden">
              <SidebarGroupContent className="min-w-0 overflow-hidden">
                {sidebarView === "layers" ? (
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
                <SheetContent side="left" className="w-80 p-0">
                  <div className="flex items-center gap-2 border-b px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                      <Map className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div>
                      <h1 className="text-sm font-semibold">ГИС МО</h1>
                      <p className="text-xs text-muted-foreground">Инженерные сети</p>
                    </div>
                  </div>
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
                  />
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
              <ConnectionStatusBadge status={zuluConnection.status} />
              <div className="h-4 w-px bg-border" />
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
                canUndo={drawing.canUndo}
                canRedo={drawing.canRedo}
                onUndo={drawing.undo}
                onRedo={drawing.redo}
                onSave={drawing.save}
                isSaving={drawing.isSaving}
                selectedCount={drawing.drawingMode === 'select' ? selectedFeatures.length : 0}
                onClearSelection={() => selectionActionsRef.current?.clearSelection()}
                showAttributeTable={showAttributeTable}
                onToggleAttributeTable={() => setShowAttributeTable(prev => !prev)}
                featureCount={drawing.features.length}
                onTraceRoute={handleOpenTraceDialog}
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
              activeSceneDataset={activeSceneDataset}
              onDatasetFeatureUpdated={handleDatasetFeatureUpdated}
              traceRouteCoordinates={traceRouteCoords}
            />

            {/* Attribute Table Modal */}
            <DraggableModal
              isOpen={showAttributeTable && editMode && drawing.activeLayer !== null && drawing.features.length > 0}
              onClose={() => setShowAttributeTable(false)}
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
                  onSchemaUpdate={drawing.updateSchema}
                  layerName={drawing.activeLayer.name}
                />
              )}
            </DraggableModal>

            {/* Data Manager */}
            {showDataManager && (
              <DataManager onClose={() => setShowDataManager(false)} />
            )}

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
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
