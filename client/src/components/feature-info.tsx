import { X, Copy, Check, MapPin, Loader2 } from "lucide-react";
import { useState } from "react";
import { getFieldLabel, getFieldValueLabel } from "@shared/field-labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FeatureInfo } from "@shared/schema";

interface FeatureInfoPanelProps {
  feature: FeatureInfo | null;
  onClose: () => void;
  coordinates?: [number, number];
}

export function FeatureInfoPanel({
  feature,
  onClose,
  coordinates,
}: FeatureInfoPanelProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!feature) return null;

  const copyToClipboard = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return getFieldValueLabel(key, value);
  };

  const isLoading = feature.properties._loading === true;
  const entries = Object.entries(feature.properties).filter(
    ([key]) => !key.startsWith("_") && key !== "geometry"
  );

  return (
    <Card
      className="absolute bottom-4 right-4 w-80 z-10 shadow-lg backdrop-blur-sm bg-card/95"
      data-testid="card-feature-info"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 space-y-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          {feature.layerName}
        </CardTitle>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-close-feature-info"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {coordinates && (
          <div className="rounded-md bg-muted p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Координаты</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() =>
                  copyToClipboard(`${coordinates[0].toFixed(6)}, ${coordinates[1].toFixed(6)}`, "coords")
                }
                data-testid="button-copy-coordinates"
              >
                {copiedKey === "coords" ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            <p className="text-xs font-mono mt-1" data-testid="text-coordinates">
              {coordinates[0].toFixed(6)}, {coordinates[1].toFixed(6)}
            </p>
          </div>
        )}

        <ScrollArea className="h-auto max-h-72 overflow-auto">
          <div className="space-y-1 pr-3">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Загрузка атрибутов...</span>
              </div>
            ) : entries.length > 0 ? (
              entries.map(([key, value], index) => (
                <div
                  key={key}
                  className={`flex items-start justify-between gap-2 py-1.5 px-2 rounded-md ${
                    index % 2 === 0 ? "bg-muted/50" : ""
                  }`}
                  data-testid={`row-property-${key}`}
                >
                  <span className="text-xs text-muted-foreground shrink-0 max-w-[40%]">
                    {getFieldLabel(key)}
                  </span>
                  <span className="text-xs text-right break-all font-mono">
                    {formatValue(key, value)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                Нет данных для отображения
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
