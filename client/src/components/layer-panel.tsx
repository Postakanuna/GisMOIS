import { Layers, Map, Database } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { LayerConfig } from "@shared/schema";

interface LayerPanelProps {
  layers: LayerConfig[];
  onToggleVisibility: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
}

export function LayerPanel({
  layers,
  onToggleVisibility,
  onOpacityChange,
}: LayerPanelProps) {
  const baseLayers = layers.filter((l) => l.type === "base");
  const wmsLayers = layers.filter((l) => l.type === "wms");
  const wfsLayers = layers.filter((l) => l.type === "wfs");

  const renderLayerItem = (layer: LayerConfig) => {
    const Icon = layer.type === "base" ? Map : layer.type === "wfs" ? Database : Layers;
    const switchId = `switch-layer-${layer.id}`;

    return (
      <div
        key={layer.id}
        className="space-y-3 rounded-md border border-sidebar-border p-3"
        data-testid={`layer-item-${layer.id}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Label 
              htmlFor={switchId} 
              className="text-sm font-medium truncate cursor-pointer flex-1"
            >
              {layer.name}
            </Label>
          </div>
          <Switch
            id={switchId}
            checked={layer.visible}
            onCheckedChange={() => onToggleVisibility(layer.id)}
            data-testid={`switch-toggle-layer-${layer.id}`}
          />
        </div>

        {layer.visible && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground shrink-0">
              Непрозрачность
            </span>
            <Slider
              value={[layer.opacity * 100]}
              onValueChange={([value]) => onOpacityChange(layer.id, value / 100)}
              max={100}
              step={1}
              className="flex-1"
              data-testid={`slider-opacity-${layer.id}`}
            />
            <span className="text-xs text-muted-foreground w-8 text-right font-mono">
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
        )}
      </div>
    );
  };

  if (layers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-sidebar-border">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-medium">Слои карты</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Layers className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            Подключитесь к серверу,
            <br />
            чтобы увидеть доступные слои
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-sidebar-border">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium">Слои карты</h2>
      </div>

      <Accordion type="multiple" defaultValue={["base", "wms", "wfs"]} className="space-y-2">
        {baseLayers.length > 0 && (
          <AccordionItem value="base" className="border-none">
            <AccordionTrigger className="py-2 hover:no-underline" data-testid="accordion-base-layers">
              <div className="flex items-center gap-2">
                <Map className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Базовые слои</span>
                <span className="text-xs text-muted-foreground">
                  ({baseLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pt-2">
              {baseLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wmsLayers.length > 0 && (
          <AccordionItem value="wms" className="border-none">
            <AccordionTrigger className="py-2 hover:no-underline" data-testid="accordion-wms-layers">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">WMS слои</span>
                <span className="text-xs text-muted-foreground">
                  ({wmsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pt-2">
              {wmsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wfsLayers.length > 0 && (
          <AccordionItem value="wfs" className="border-none">
            <AccordionTrigger className="py-2 hover:no-underline" data-testid="accordion-wfs-layers">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">WFS слои</span>
                <span className="text-xs text-muted-foreground">
                  ({wfsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pt-2">
              {wfsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
