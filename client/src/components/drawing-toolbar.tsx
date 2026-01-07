import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Plus,
  Undo2,
  Redo2,
  Save,
  X,
  Layers,
} from "lucide-react";
import type { GeometryType, EditableLayer, InsertEditableLayer } from "@shared/schema";

export type DrawingMode = "select" | "point" | "line" | "polygon" | "modify" | null;

interface DrawingToolbarProps {
  mode: DrawingMode;
  onModeChange: (mode: DrawingMode) => void;
  activeLayer: EditableLayer | null;
  editableLayers: EditableLayer[];
  onLayerSelect: (layer: EditableLayer) => void;
  onCreateLayer: (layer: InsertEditableLayer) => void;
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

const LAYER_COLORS = [
  "#1976D2", "#388E3C", "#D32F2F", "#7B1FA2", "#F57C00",
  "#0097A7", "#5D4037", "#455A64", "#C2185B", "#303F9F",
];

export function DrawingToolbar({
  mode,
  onModeChange,
  activeLayer,
  editableLayers,
  onLayerSelect,
  onCreateLayer,
  onDeleteSelected,
  hasSelection,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  isSaving,
}: DrawingToolbarProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerType, setNewLayerType] = useState<GeometryType>("Point");
  const [newLayerColor, setNewLayerColor] = useState(LAYER_COLORS[0]);

  const handleCreateLayer = () => {
    if (!newLayerName.trim()) return;
    
    onCreateLayer({
      name: newLayerName.trim(),
      geometryType: newLayerType,
      color: newLayerColor,
      visible: true,
      opacity: 1,
      pointStyle: "circle",
      lineStyle: "solid",
    });
    
    setNewLayerName("");
    setNewLayerType("Point");
    setNewLayerColor(LAYER_COLORS[0]);
    setShowCreateDialog(false);
  };

  const isDrawingMode = mode === "point" || mode === "line" || mode === "polygon";
  const canDraw = activeLayer !== null;

  return (
    <>
      <Card className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 bg-background/95 backdrop-blur-sm">
        {/* Layer selector */}
        <div className="flex items-center gap-1 px-2 border-r mr-1">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <Select
            value={activeLayer?.id.toString() || ""}
            onValueChange={(value) => {
              const layer = editableLayers.find(l => l.id.toString() === value);
              if (layer) onLayerSelect(layer);
            }}
          >
            <SelectTrigger className="w-[160px] h-8 text-sm" data-testid="select-active-layer">
              <SelectValue placeholder="Выберите слой" />
            </SelectTrigger>
            <SelectContent>
              {editableLayers.map((layer) => (
                <SelectItem key={layer.id} value={layer.id.toString()}>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: layer.color }}
                    />
                    <span>{layer.name}</span>
                    <span className="text-muted-foreground text-xs">({layer.featureCount})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-8 w-8"
                onClick={() => setShowCreateDialog(true)}
                data-testid="button-create-layer"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Создать слой</TooltipContent>
          </Tooltip>
        </div>

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

      {/* Create Layer Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать новый слой</DialogTitle>
            <DialogDescription>
              Укажите параметры нового редактируемого слоя
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="layer-name">Название слоя</Label>
              <Input
                id="layer-name"
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                placeholder="Например: Новые объекты"
                data-testid="input-layer-name"
              />
            </div>
            
            <div className="grid gap-2">
              <Label>Тип геометрии</Label>
              <Select value={newLayerType} onValueChange={(v) => setNewLayerType(v as GeometryType)}>
                <SelectTrigger data-testid="select-geometry-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Point">Точки</SelectItem>
                  <SelectItem value="LineString">Линии</SelectItem>
                  <SelectItem value="Polygon">Полигоны</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid gap-2">
              <Label>Цвет</Label>
              <div className="flex gap-2 flex-wrap">
                {LAYER_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-md border-2 transition-all ${
                      newLayerColor === color ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewLayerColor(color)}
                    data-testid={`button-color-${color.replace("#", "")}`}
                  />
                ))}
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Отмена
            </Button>
            <Button 
              onClick={handleCreateLayer} 
              disabled={!newLayerName.trim()}
              data-testid="button-confirm-create-layer"
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
