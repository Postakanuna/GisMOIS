import { Layers, Map, Database, Building2, Users, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { LayerConfig } from "@shared/schema";
import type { LayerFilters, ActiveFilters } from "@/hooks/use-zulu-connection";

interface LayerPanelProps {
  layers: LayerConfig[];
  onToggleVisibility: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  layerFilters?: Record<string, LayerFilters>;
  activeFilters?: Record<string, ActiveFilters>;
  onToggleFilter?: (layerId: string, filterType: keyof ActiveFilters, value: string) => void;
}

export function LayerPanel({
  layers,
  onToggleVisibility,
  onOpacityChange,
  layerFilters,
  activeFilters,
  onToggleFilter,
}: LayerPanelProps) {
  const baseLayers = layers.filter((l) => l.type === "base");
  const wmsLayers = layers.filter((l) => l.type === "wms");
  const wfsLayers = layers.filter((l) => l.type === "wfs");

  const renderSublayerFilters = (layer: LayerConfig) => {
    const filters = layerFilters?.[layer.id];
    const active = activeFilters?.[layer.id];
    
    if (!filters || !active || !onToggleFilter) return null;
    
    const rsoValues = Array.from(filters.name_rso).filter(v => v).sort();
    const munizValues = Array.from(filters.muniz_obr).filter(v => v).sort();
    
    if (rsoValues.length === 0 && munizValues.length === 0) return null;

    return (
      <div className="mt-3 space-y-2 pl-2 border-l-2 border-sidebar-border">
        {rsoValues.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full group">
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              <Users className="h-3 w-3" />
              <span>По РСО ({rsoValues.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1 pl-5">
              {rsoValues.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox
                    id={`${layer.id}-rso-${value}`}
                    checked={active.name_rso.includes(value)}
                    onCheckedChange={() => onToggleFilter(layer.id, "name_rso", value)}
                    data-testid={`checkbox-rso-${layer.id}-${value}`}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label
                        htmlFor={`${layer.id}-rso-${value}`}
                        className="text-xs cursor-pointer truncate max-w-[180px]"
                      >
                        {value || "(не указано)"}
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">{value || "(не указано)"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
        
        {munizValues.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full group">
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              <Building2 className="h-3 w-3" />
              <span>По муниципалитету ({munizValues.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1 pl-5">
              {munizValues.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox
                    id={`${layer.id}-muniz-${value}`}
                    checked={active.muniz_obr.includes(value)}
                    onCheckedChange={() => onToggleFilter(layer.id, "muniz_obr", value)}
                    data-testid={`checkbox-muniz-${layer.id}-${value}`}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label
                        htmlFor={`${layer.id}-muniz-${value}`}
                        className="text-xs cursor-pointer truncate max-w-[180px]"
                      >
                        {value || "(не указано)"}
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">{value || "(не указано)"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  };

  const renderLayerItem = (layer: LayerConfig) => {
    const Icon = layer.type === "base" ? Map : layer.type === "wfs" ? Database : Layers;

    return (
      <div
        key={layer.id}
        className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1"
        data-testid={`layer-item-${layer.id}`}
      >
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span 
          className="text-xs font-medium truncate flex-1 min-w-0"
          title={layer.name}
        >
          {layer.name}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => onToggleVisibility(layer.id)}
          data-testid={`button-toggle-layer-${layer.id}`}
        >
          {layer.visible ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
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

      <Accordion type="multiple" defaultValue={["base", "wms", "wfs"]} className="space-y-1">
        {baseLayers.length > 0 && (
          <AccordionItem value="base" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-base-layers">
              <div className="flex items-center gap-2">
                <Map className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Базовые слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({baseLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {baseLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wmsLayers.length > 0 && (
          <AccordionItem value="wms" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-wms-layers">
              <div className="flex items-center gap-2">
                <Layers className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">WMS слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({wmsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {wmsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}

        {wfsLayers.length > 0 && (
          <AccordionItem value="wfs" className="border-none">
            <AccordionTrigger className="py-1 hover:no-underline" data-testid="accordion-wfs-layers">
              <div className="flex items-center gap-2">
                <Database className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">WFS слои</span>
                <span className="text-[10px] text-muted-foreground">
                  ({wfsLayers.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-1 pt-1">
              {wfsLayers.map(renderLayerItem)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
