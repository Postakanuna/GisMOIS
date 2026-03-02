import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Circle, 
  Minus, 
  Pentagon, 
  Move, 
  MousePointer2,
  Trash2,
  Undo2,
  Redo2,
  X,
  Table2,
  Route,
  Zap,
  Building2,
  Info,
} from "lucide-react";
import type { EditableLayer } from "@shared/schema";
import type { SnapSettings } from "@/hooks/use-drawing";
import { SnapSettingsPopover } from "./snap-settings-popover";

export type DrawingMode = "select" | "point" | "line" | "polygon" | "modify" | null;

interface DrawingToolbarProps {
  mode: DrawingMode;
  onModeChange: (mode: DrawingMode) => void;
  activeLayer: EditableLayer | null;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  undoDescription?: string | null;
  redoDescription?: string | null;
  selectedCount?: number;
  onClearSelection?: () => void;
  isDeleting?: boolean;
  showAttributeTable?: boolean;
  onToggleAttributeTable?: () => void;
  featureCount?: number;
  showFeatureInfo?: boolean;
  onToggleFeatureInfo?: () => void;
  hasSelectedFeature?: boolean;
  onTraceRoute?: () => void;
  onSimulation?: () => void;
  onConsumerConnect?: () => void;
  // Snap props
  snapSettings?: SnapSettings;
  onUpdateSnapSettings?: (updates: Partial<SnapSettings>) => void;
  onToggleSnap?: () => void;
  snapLayers?: { id: number; name: string; visible: boolean }[];
  editMode?: boolean;
}

const ALL_TOOL_BUTTONS: { mode: DrawingMode; icon: typeof Circle; label: string; tooltip: string; geometryType?: string }[] = [
  { mode: "select", icon: MousePointer2, label: "Выбор", tooltip: "Режим выбора (V)" },
  { mode: "point", icon: Circle, label: "Точка", tooltip: "Создать точку (P)", geometryType: "Point" },
  { mode: "line", icon: Minus, label: "Линия", tooltip: "Создать линию (L)", geometryType: "LineString" },
  { mode: "polygon", icon: Pentagon, label: "Полигон", tooltip: "Создать полигон (G)", geometryType: "Polygon" },
  { mode: "modify", icon: Move, label: "Редакт.", tooltip: "Редактировать вершины (M)" },
];


export function DrawingToolbar({
  mode,
  onModeChange,
  activeLayer,
  onDeleteSelected,
  hasSelection,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoDescription,
  redoDescription,
  selectedCount = 0,
  onClearSelection,
  isDeleting = false,
  showAttributeTable = false,
  onToggleAttributeTable,
  featureCount = 0,
  showFeatureInfo = false,
  onToggleFeatureInfo,
  hasSelectedFeature = false,
  onTraceRoute,
  onSimulation,
  onConsumerConnect,
  snapSettings,
  onUpdateSnapSettings,
  onToggleSnap,
  snapLayers = [],
  editMode = false,
}: DrawingToolbarProps) {
  const canDraw = activeLayer !== null;

  // Filter tool buttons based on active layer's geometry type
  const toolButtons = ALL_TOOL_BUTTONS.filter(tool => {
    // Always show modify
    if (!tool.geometryType) return true;
    // Only show geometry tool matching layer type
    if (activeLayer) {
      return tool.geometryType === activeLayer.geometryType;
    }
    // Show all when no layer selected
    return true;
  });

  return (
    <>
      <Card className="absolute top-14 sm:top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 bg-background/95 backdrop-blur-sm">
        {/* Drawing tools - only visible in edit mode */}
        {editMode && toolButtons.map(({ mode: toolMode, icon: Icon, tooltip }) => {
          const isActive = mode === toolMode;
          const isDisabled = !canDraw && toolMode !== "select";
          
          return (
            <span key={toolMode} className="contents">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={isActive ? "default" : "ghost"}
                    className={`h-8 w-8 ${isDisabled ? "opacity-50" : ""}`}
                    onClick={() => !isDisabled && onModeChange(toolMode)}
                    disabled={isDisabled}
                    data-testid={`button-tool-${toolMode}`}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
              </Tooltip>
              
              {/* Insert snap button after modify tool */}
              {toolMode === "modify" && snapSettings && onToggleSnap && onUpdateSnapSettings && (
                <SnapSettingsPopover
                  snapSettings={snapSettings}
                  onUpdateSettings={onUpdateSnapSettings}
                  onToggleSnap={onToggleSnap}
                  availableLayers={snapLayers}
                />
              )}
            </span>
          );
        })}

        {/* Attribute table button */}
        {onToggleAttributeTable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={showAttributeTable ? "default" : "ghost"}
                className="h-8 w-8"
                onClick={onToggleAttributeTable}
                disabled={featureCount === 0}
                data-testid="button-toggle-attribute-table"
              >
                <Table2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Таблица атрибутов (T)</TooltipContent>
          </Tooltip>
        )}

        {/* Feature info button */}
        {onToggleFeatureInfo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={showFeatureInfo ? "default" : "ghost"}
                className="h-8 w-8"
                onClick={onToggleFeatureInfo}
                disabled={!hasSelectedFeature}
                data-testid="button-toggle-feature-info"
              >
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Информация об объекте (I)</TooltipContent>
          </Tooltip>
        )}

        {/* Selection info */}
        {selectedCount > 0 && (
          <div className="border-l pl-1 ml-1 flex items-center gap-1">
            <span className="text-xs px-2 whitespace-nowrap" data-testid="text-selected-count">
              Выбрано: {selectedCount}
            </span>
            {onClearSelection && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={onClearSelection}
                    data-testid="button-clear-selection"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Снять выделение</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        <div className="border-l pl-1 ml-1 flex items-center gap-1">
          {/* Trace Route - only when exactly 1 feature selected, always visible */}
          {onTraceRoute && selectedCount === 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onTraceRoute}
                  data-testid="button-trace-route"
                >
                  <Route className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Трассировка к слою</TooltipContent>
            </Tooltip>
          )}

          {/* Network Simulation - only when exactly 1 feature selected */}
          {onSimulation && selectedCount === 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onSimulation}
                  data-testid="button-simulation"
                >
                  <Zap className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Симуляция отключения</TooltipContent>
            </Tooltip>
          )}

          {/* Consumer Connect - only when exactly 1 feature selected */}
          {onConsumerConnect && selectedCount === 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onConsumerConnect}
                  data-testid="button-consumer-connect"
                >
                  <Building2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Подключить потребителя</TooltipContent>
            </Tooltip>
          )}

          {/* Delete / Undo / Redo - edit mode only */}
          {editMode && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={selectedCount > 0 ? "destructive" : "ghost"}
                    className="h-8 w-8"
                    onClick={onDeleteSelected}
                    disabled={!hasSelection && selectedCount === 0}
                    data-testid="button-delete-selected"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isDeleting ? "Удаление..." : "Удалить выбранное (Del)"}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={onUndo}
                    disabled={!canUndo}
                    data-testid="button-undo"
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {undoDescription ? `Отменить: ${undoDescription}` : "Отменить (Ctrl+Z)"}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={onRedo}
                    disabled={!canRedo}
                    data-testid="button-redo"
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {redoDescription ? `Повторить: ${redoDescription}` : "Повторить (Ctrl+Y)"}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </Card>

    </>
  );
}
