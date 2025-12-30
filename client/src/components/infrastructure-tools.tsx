import { useState } from "react";
import { Plus, Building2, Flame, Droplet, X, Route, Trash2, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FacilityType, Facility, Trace, InsertFacility } from "@shared/schema";

interface InfrastructureToolsProps {
  placementMode: FacilityType | null;
  onSetPlacementMode: (mode: FacilityType | null) => void;
  selectedFacility: Facility | null;
  onCloseSelection: () => void;
  onStartTracing: () => void;
  onDeleteFacility: (id: number) => void;
  isTracing: boolean;
  selectedTrace: Trace | null;
  onCloseTraceInfo: () => void;
  onDeleteTrace: (id: number) => void;
  pendingPlacement: { lon: number; lat: number; type: FacilityType } | null;
  onConfirmPlacement: (facility: InsertFacility) => void;
  onCancelPendingPlacement: () => void;
  facilities: Facility[];
  tracingError: string | null;
  selectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  selectedCount?: number;
  onClearSelection?: () => void;
  onDeleteSelected?: () => void;
  isDeleting?: boolean;
}

const facilityConfig: Record<FacilityType, { icon: typeof Building2; label: string; color: string }> = {
  building: { icon: Building2, label: "Здание", color: "text-blue-500" },
  boilerhouse: { icon: Flame, label: "Котельная", color: "text-orange-500" },
  waterintake: { icon: Droplet, label: "Водозабор", color: "text-cyan-500" },
};

export function InfrastructureTools({
  placementMode,
  onSetPlacementMode,
  selectedFacility,
  onCloseSelection,
  onStartTracing,
  onDeleteFacility,
  isTracing,
  selectedTrace,
  onCloseTraceInfo,
  onDeleteTrace,
  pendingPlacement,
  onConfirmPlacement,
  onCancelPendingPlacement,
  facilities,
  tracingError,
  selectionMode = false,
  onToggleSelectionMode,
  selectedCount = 0,
  onClearSelection,
  onDeleteSelected,
  isDeleting = false,
}: InfrastructureToolsProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSelectedDialogOpen, setDeleteSelectedDialogOpen] = useState(false);
  
  const [facilityName, setFacilityName] = useState("");
  const [freeHeatCapacity, setFreeHeatCapacity] = useState("");
  const [freeWaterCapacity, setFreeWaterCapacity] = useState("");
  const [requiredHeatLoad, setRequiredHeatLoad] = useState("");
  const [requiredWaterSupply, setRequiredWaterSupply] = useState("");

  const handleSelectTool = (type: FacilityType) => {
    onSetPlacementMode(type);
    setToolsOpen(false);
  };

  const handleCancelPlacement = () => {
    onSetPlacementMode(null);
  };

  const handleConfirmDelete = () => {
    if (selectedFacility) {
      onDeleteFacility(selectedFacility.id);
      setDeleteDialogOpen(false);
    }
  };

  const formatLength = (meters: number): string => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} км`;
    }
    return `${Math.round(meters)} м`;
  };

  const resetFormFields = () => {
    setFacilityName("");
    setFreeHeatCapacity("");
    setFreeWaterCapacity("");
    setRequiredHeatLoad("");
    setRequiredWaterSupply("");
  };

  const handleConfirmPlacement = () => {
    if (!pendingPlacement) return;

    const existingCount = facilities.filter(f => f.type === pendingPlacement.type).length + 1;
    const defaultName = `${facilityConfig[pendingPlacement.type].label} ${existingCount}`;

    const facility: InsertFacility = {
      type: pendingPlacement.type,
      name: facilityName.trim() || defaultName,
      lon: pendingPlacement.lon,
      lat: pendingPlacement.lat,
    };

    if (pendingPlacement.type === "boilerhouse") {
      facility.freeHeatCapacity = freeHeatCapacity ? parseFloat(freeHeatCapacity) : undefined;
    } else if (pendingPlacement.type === "waterintake") {
      facility.freeWaterCapacity = freeWaterCapacity ? parseFloat(freeWaterCapacity) : undefined;
    } else if (pendingPlacement.type === "building") {
      facility.requiredHeatLoad = requiredHeatLoad ? parseFloat(requiredHeatLoad) : undefined;
      facility.requiredWaterSupply = requiredWaterSupply ? parseFloat(requiredWaterSupply) : undefined;
    }

    onConfirmPlacement(facility);
    resetFormFields();
  };

  const handleCancelPendingPlacement = () => {
    onCancelPendingPlacement();
    resetFormFields();
  };

  return (
    <>
      {/* Add facility button - positioned with map controls in top-right */}
      <div className="absolute top-[220px] right-4 z-10 flex flex-col gap-2">
        <div className="flex flex-col rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border overflow-hidden">
          {onToggleSelectionMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={selectionMode ? "default" : "ghost"}
                  onClick={onToggleSelectionMode}
                  className="rounded-none"
                  data-testid="button-selection-mode"
                >
                  <MousePointer2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {selectionMode ? "Отключить выделение" : "Выделение объектов (Ctrl+тянуть для прямоугольника)"}
              </TooltipContent>
            </Tooltip>
          )}
          
          {placementMode ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleCancelPlacement}
                  className="rounded-none"
                  data-testid="button-cancel-placement"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Отмена: {facilityConfig[placementMode].label}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Popover open={toolsOpen} onOpenChange={setToolsOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="rounded-none"
                  data-testid="button-add-facility"
                  title="Добавить объект"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="left" align="start" className="w-auto p-2">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground px-2 py-1">
                    Добавить объект
                  </p>
                  {(Object.keys(facilityConfig) as FacilityType[]).map((type) => {
                    const config = facilityConfig[type];
                    const Icon = config.icon;
                    return (
                      <Button
                        key={type}
                        variant="ghost"
                        className="justify-start gap-2"
                        onClick={() => handleSelectTool(type)}
                        data-testid={`button-add-${type}`}
                      >
                        <Icon className={`h-4 w-4 ${config.color}`} />
                        {config.label}
                      </Button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Placement mode indicator */}
      {placementMode && (
        <div className="absolute bottom-4 left-4 z-10">
          <div className="flex items-center gap-2 rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border p-2">
            <div className="flex items-center gap-2 px-2">
              {(() => {
                const config = facilityConfig[placementMode];
                const Icon = config.icon;
                return (
                  <>
                    <Icon className={`h-4 w-4 ${config.color}`} />
                    <span className="text-sm font-medium">
                      Разместите {config.label.toLowerCase()} на карте
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Tracing indicator */}
      {isTracing && (
        <div className="absolute bottom-4 left-4 z-10">
          <div className="flex items-center gap-2 rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border p-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm">Построение трассировки...</span>
          </div>
        </div>
      )}

      {selectedFacility && (
        <div className="absolute bottom-4 right-4 z-10 rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border p-4 min-w-64">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              {(() => {
                const config = facilityConfig[selectedFacility.type];
                const Icon = config.icon;
                return (
                  <>
                    <Icon className={`h-5 w-5 ${config.color}`} />
                    <div>
                      <h3 className="font-medium">{selectedFacility.name}</h3>
                      <p className="text-xs text-muted-foreground">{config.label}</p>
                    </div>
                  </>
                );
              })()}
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onCloseSelection}
              data-testid="button-close-facility-info"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-xs text-muted-foreground mb-3 space-y-1">
            <p>Широта: {selectedFacility.lat.toFixed(6)}</p>
            <p>Долгота: {selectedFacility.lon.toFixed(6)}</p>
            {selectedFacility.type === "boilerhouse" && selectedFacility.freeHeatCapacity !== undefined && (
              <p className="text-orange-600 dark:text-orange-400 font-medium">
                Свободная мощность: {selectedFacility.freeHeatCapacity} Гкал/ч
              </p>
            )}
            {selectedFacility.type === "waterintake" && selectedFacility.freeWaterCapacity !== undefined && (
              <p className="text-cyan-600 dark:text-cyan-400 font-medium">
                Свободная мощность: {selectedFacility.freeWaterCapacity} м³/ч
              </p>
            )}
            {selectedFacility.type === "building" && (
              <>
                {selectedFacility.requiredHeatLoad !== undefined && (
                  <p className="text-orange-600 dark:text-orange-400 font-medium">
                    Потребность тепла: {selectedFacility.requiredHeatLoad} Гкал/ч
                  </p>
                )}
                {selectedFacility.requiredWaterSupply !== undefined && (
                  <p className="text-cyan-600 dark:text-cyan-400 font-medium">
                    Потребность воды: {selectedFacility.requiredWaterSupply} м³/ч
                  </p>
                )}
              </>
            )}
          </div>
          
          {tracingError && selectedFacility.type === "building" && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2 mb-3">
              {tracingError}
            </div>
          )}

          <div className="flex gap-2">
            {selectedFacility.type === "building" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onStartTracing}
                    disabled={isTracing}
                    className="flex-1"
                    data-testid="button-start-tracing"
                  >
                    <Route className="h-4 w-4 mr-2" />
                    Трассировка
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Построить трассировку до котельной и водозабора
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                  data-testid="button-delete-facility"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Удалить объект</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {selectedTrace && (
        <div className="absolute bottom-4 right-4 z-10 rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border p-4 min-w-64">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Route className={`h-5 w-5 ${selectedTrace.type === "heating" ? "text-orange-500" : "text-cyan-500"}`} />
              <div>
                <h3 className="font-medium">
                  {selectedTrace.type === "heating" ? "Теплотрасса" : "Водопровод"}
                </h3>
                <p className="text-xs text-muted-foreground">Инженерная сеть</p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onCloseTraceInfo}
              data-testid="button-close-trace-info"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="bg-muted/50 rounded-md p-3 mb-3">
            <p className="text-sm text-muted-foreground">Протяжённость</p>
            <p className="text-2xl font-bold" data-testid="text-trace-length">
              {formatLength(selectedTrace.length)}
            </p>
          </div>

          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            onClick={() => onDeleteTrace(selectedTrace.id)}
            data-testid="button-delete-trace"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Удалить трассировку
          </Button>
        </div>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить объект?</DialogTitle>
            <DialogDescription>
              Объект "{selectedFacility?.name}" будет удалён. Связанные трассировки также будут удалены.
              Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingPlacement} onOpenChange={(open) => !open && handleCancelPendingPlacement()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingPlacement && facilityConfig[pendingPlacement.type].label}
            </DialogTitle>
            <DialogDescription>
              Введите параметры объекта
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="facility-name">Название</Label>
              <Input
                id="facility-name"
                placeholder={pendingPlacement ? `${facilityConfig[pendingPlacement.type].label} ${facilities.filter(f => f.type === pendingPlacement.type).length + 1}` : ""}
                value={facilityName}
                onChange={(e) => setFacilityName(e.target.value)}
                data-testid="input-facility-name"
              />
            </div>

            {pendingPlacement?.type === "boilerhouse" && (
              <div className="space-y-2">
                <Label htmlFor="heat-capacity">Свободная мощность (Гкал/ч)</Label>
                <Input
                  id="heat-capacity"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Например: 10.5"
                  value={freeHeatCapacity}
                  onChange={(e) => setFreeHeatCapacity(e.target.value)}
                  data-testid="input-heat-capacity"
                />
              </div>
            )}

            {pendingPlacement?.type === "waterintake" && (
              <div className="space-y-2">
                <Label htmlFor="water-capacity">Свободная мощность (м³/ч)</Label>
                <Input
                  id="water-capacity"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Например: 100"
                  value={freeWaterCapacity}
                  onChange={(e) => setFreeWaterCapacity(e.target.value)}
                  data-testid="input-water-capacity"
                />
              </div>
            )}

            {pendingPlacement?.type === "building" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="required-heat">Потребность тепла (Гкал/ч)</Label>
                  <Input
                    id="required-heat"
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="Например: 2.5"
                    value={requiredHeatLoad}
                    onChange={(e) => setRequiredHeatLoad(e.target.value)}
                    data-testid="input-required-heat"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="required-water">Потребность воды (м³/ч)</Label>
                  <Input
                    id="required-water"
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="Например: 15"
                    value={requiredWaterSupply}
                    onChange={(e) => setRequiredWaterSupply(e.target.value)}
                    data-testid="input-required-water"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={handleCancelPendingPlacement}>
              Отмена
            </Button>
            <Button onClick={handleConfirmPlacement} data-testid="button-confirm-placement">
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedCount > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border p-2">
            <span className="text-sm px-2" data-testid="text-selected-count">
              Выбрано: {selectedCount}
            </span>
            {onClearSelection && (
              <Button
                size="sm"
                variant="outline"
                onClick={onClearSelection}
                data-testid="button-clear-selection"
              >
                <X className="h-4 w-4 mr-1" />
                Снять
              </Button>
            )}
            {onDeleteSelected && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteSelectedDialogOpen(true)}
                disabled={isDeleting}
                data-testid="button-delete-selected"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {isDeleting ? "Удаление..." : "Удалить"}
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={deleteSelectedDialogOpen} onOpenChange={setDeleteSelectedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить выбранные объекты?</DialogTitle>
            <DialogDescription>
              Вы собираетесь удалить {selectedCount} объектов. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteSelectedDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onDeleteSelected?.();
                setDeleteSelectedDialogOpen(false);
              }}
              data-testid="button-confirm-delete-selected"
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
