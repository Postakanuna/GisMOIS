import { Plus, Minus, Compass, Home, Maximize2, MapPin, Ruler, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetRotation: () => void;
  onResetView: () => void;
  onFullscreen: () => void;
  rotation: number;
  ticketMode?: boolean;
  onToggleTicketMode?: () => void;
  measureActive?: boolean;
  onToggleMeasure?: () => void;
  onForceReload?: () => void;
  isReloading?: boolean;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onResetRotation,
  onResetView,
  onFullscreen,
  rotation,
  ticketMode,
  onToggleTicketMode,
  measureActive,
  onToggleMeasure,
  onForceReload,
  isReloading,
}: MapControlsProps) {
  return (
    <div className="absolute top-14 sm:top-4 right-4 z-10 flex flex-col gap-2">
      <div className="flex flex-col rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border overflow-hidden">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onZoomIn}
              className="rounded-none border-b border-card-border"
              data-testid="button-zoom-in"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Приблизить</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onZoomOut}
              className="rounded-none"
              data-testid="button-zoom-out"
            >
              <Minus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Отдалить</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-col rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border overflow-hidden">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onResetRotation}
              className="rounded-none border-b border-card-border"
              style={{ transform: `rotate(${rotation}rad)` }}
              data-testid="button-reset-rotation"
            >
              <Compass className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Сбросить вращение</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onResetView}
              className="rounded-none border-b border-card-border"
              data-testid="button-reset-view"
            >
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Вернуться к начальному виду</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onFullscreen}
              className="rounded-none border-b border-card-border"
              data-testid="button-fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Полноэкранный режим</TooltipContent>
        </Tooltip>

        {onForceReload && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={onForceReload}
                disabled={isReloading}
                className="rounded-none border-b border-card-border"
                data-testid="button-force-reload"
              >
                <RefreshCw className={`h-4 w-4 ${isReloading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isReloading ? "Обновление..." : "Перезагрузить слои"}
            </TooltipContent>
          </Tooltip>
        )}

        {onToggleMeasure && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={measureActive ? "default" : "ghost"}
                onClick={onToggleMeasure}
                className={`rounded-none ${measureActive ? "bg-primary text-primary-foreground" : ""}`}
                data-testid="button-measure"
              >
                <Ruler className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {measureActive ? "Выключить линейку" : "Линейка (измерения)"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {onToggleTicketMode && (
        <div className="flex flex-col rounded-lg bg-card/90 backdrop-blur-sm shadow-lg border border-card-border overflow-hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={ticketMode ? "default" : "ghost"}
                onClick={onToggleTicketMode}
                className={`rounded-none ${ticketMode ? "bg-primary text-primary-foreground" : ""}`}
                data-testid="button-ticket-mode"
              >
                <MapPin className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {ticketMode ? "Выключить режим меток" : "Добавить метку"}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
