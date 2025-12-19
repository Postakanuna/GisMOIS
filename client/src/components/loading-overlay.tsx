import { Loader2, Map } from "lucide-react";

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
}

export function LoadingOverlay({ isLoading, message = "Загрузка карты..." }: LoadingOverlayProps) {
  if (!isLoading) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      data-testid="loading-overlay"
    >
      <div className="flex flex-col items-center gap-4 rounded-lg bg-card p-6 shadow-lg border border-card-border">
        <div className="relative">
          <Map className="h-12 w-12 text-muted-foreground/50" />
          <Loader2 className="absolute -bottom-1 -right-1 h-6 w-6 text-primary animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
