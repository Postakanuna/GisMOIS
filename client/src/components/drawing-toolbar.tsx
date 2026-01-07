import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  MousePointer2, 
  Circle, 
  Minus, 
  Pentagon, 
  Move, 
  Trash2,
  Undo2,
  Redo2,
  Save,
  X,
} from "lucide-react";
import type { EditableLayer } from "@shared/schema";

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
  onSave: () => void;
  isSaving: boolean;
}

const TOOL_BUTTONS: { mode: DrawingMode; icon: typeof MousePointer2; label: string; tooltip: string }[] = [
  { mode: "select", icon: MousePointer2, label: "Выбор", tooltip: "Выбор объектов (V)" },
  { mode: "point", icon: Circle, label: "Точка", tooltip: "Создать точку (P)" },
  { mode: "line", icon: Minus, label: "Линия", tooltip: "Создать линию (L)" },
  { mode: "polygon", icon: Pentagon, label: "Полигон", tooltip: "Создать полигон (G)" },
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
  onSave,
  isSaving,
}: DrawingToolbarProps) {
  const isDrawingMode = mode === "point" || mode === "line" || mode === "polygon";
  const canDraw = activeLayer !== null;

  return (
    <>
      <Card className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 bg-background/95 backdrop-blur-sm">
        {/* Active layer indicator */}
        {activeLayer && (
          <div className="flex items-center gap-1 px-2 border-r mr-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: activeLayer.color }}
            />
            <span className="text-xs font-medium truncate max-w-[120px]">{activeLayer.name}</span>
          </div>
        )}

        {/* Drawing tools */}
        {TOOL_BUTTONS.map(({ mode: toolMode, icon: Icon, label, tooltip }) => {
          const isActive = mode === toolMode;
          const isDisabled = !canDraw && toolMode !== "select";
          
          return (
            <Tooltip key={toolMode}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={isActive ? "default" : "ghost"}
                  className={`h-8 px-2 ${isDisabled ? "opacity-50" : ""}`}
                  onClick={() => !isDisabled && onModeChange(toolMode)}
                  disabled={isDisabled}
                  data-testid={`button-tool-${toolMode}`}
                >
                  <Icon className="h-4 w-4 mr-1" />
                  <span className="text-xs">{label}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          );
        })}

        <div className="border-l pl-1 ml-1 flex items-center gap-1">
          {/* Delete */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={onDeleteSelected}
                disabled={!hasSelection}
                data-testid="button-delete-selected"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Удалить выбранное (Del)</TooltipContent>
          </Tooltip>

          {/* Undo/Redo */}
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
            <TooltipContent>Отменить (Ctrl+Z)</TooltipContent>
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
            <TooltipContent>Повторить (Ctrl+Y)</TooltipContent>
          </Tooltip>

          {/* Save */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={onSave}
                disabled={isSaving}
                data-testid="button-save"
              >
                <Save className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Сохранить (Ctrl+S)</TooltipContent>
          </Tooltip>

          {/* Cancel drawing */}
          {isDrawingMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onModeChange("select")}
                  data-testid="button-cancel-draw"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Отменить рисование (Esc)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </Card>

    </>
  );
}
