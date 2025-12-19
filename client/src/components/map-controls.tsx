import { Plus, Minus, Compass, Home, Maximize2, MapPin } from "lucide-react";
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
}: MapControlsProps) {
  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
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
              className="rounded-none"
              data-testid="button-fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Полноэкранный режим</TooltipContent>
        </Tooltip>
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
