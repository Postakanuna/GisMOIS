import { useState } from "react";
import { Plus, Building2, Flame, Droplet, X, Route, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { FacilityType, Facility, Trace } from "@shared/schema";

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
}: InfrastructureToolsProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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

  return (
    <>
      <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2">
        {placementMode ? (
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
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancelPlacement}
              data-testid="button-cancel-placement"
            >
              <X className="h-4 w-4 mr-1" />
              Отмена
            </Button>
          </div>
        ) : (
          <Popover open={toolsOpen} onOpenChange={setToolsOpen}>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                className="h-12 w-12 rounded-full shadow-lg"
                data-testid="button-add-facility"
              >
                <Plus className="h-6 w-6" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-2">
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

        {isTracing && (
          <div className="flex items-center gap-2 rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border p-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm">Построение трассировки...</span>
          </div>
        )}
      </div>

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

          <div className="text-xs text-muted-foreground mb-3">
            <p>Широта: {selectedFacility.lat.toFixed(6)}</p>
            <p>Долгота: {selectedFacility.lon.toFixed(6)}</p>
          </div>

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
    </>
  );
}
