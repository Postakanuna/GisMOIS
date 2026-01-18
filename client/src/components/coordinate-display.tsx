import { MapPin, Magnet } from "lucide-react";

interface CoordinateDisplayProps {
  coordinates: [number, number] | null;
  zoom: number;
  snapEnabled?: boolean;
}

export function CoordinateDisplay({ coordinates, zoom, snapEnabled }: CoordinateDisplayProps) {
  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 rounded-lg bg-card/90 backdrop-blur-sm px-3 py-2 shadow-lg border border-card-border"
      data-testid="coordinate-display"
    >
      <div className="flex items-center gap-2">
        <MapPin className="h-3 w-3 text-muted-foreground" />
        {coordinates ? (
          <span className="text-xs font-mono" data-testid="text-mouse-coordinates">
            {coordinates[0].toFixed(6)}, {coordinates[1].toFixed(6)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Наведите курсор на карту
          </span>
        )}
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Масштаб:</span>
        <span className="text-xs font-mono font-medium" data-testid="text-zoom-level">
          {zoom.toFixed(1)}
        </span>
      </div>

      {snapEnabled && (
        <>
          <div className="h-4 w-px bg-border" />
          <div 
            className="flex items-center gap-1"
            data-testid="snap-indicator"
          >
            <Magnet className="h-3 w-3 text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">Привязка</span>
          </div>
        </>
      )}
    </div>
  );
}
