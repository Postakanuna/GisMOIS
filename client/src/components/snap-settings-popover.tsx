import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Magnet } from "lucide-react";
import type { SnapSettings } from "@/hooks/use-drawing";

interface SnapSettingsPopoverProps {
  snapSettings: SnapSettings;
  onUpdateSettings: (updates: Partial<SnapSettings>) => void;
  onToggleSnap: () => void;
  availableLayers: { id: number; name: string; visible: boolean }[];
}

export function SnapSettingsPopover({
  snapSettings,
  onUpdateSettings,
  onToggleSnap,
  availableLayers,
}: SnapSettingsPopoverProps) {
  const visibleLayers = availableLayers.filter(l => l.visible);
  const useAllLayers = snapSettings.snapLayerIds.length === 0;

  const handleLayerToggle = (layerId: number, checked: boolean) => {
    if (checked) {
      onUpdateSettings({ 
        snapLayerIds: [...snapSettings.snapLayerIds, layerId] 
      });
    } else {
      onUpdateSettings({ 
        snapLayerIds: snapSettings.snapLayerIds.filter(id => id !== layerId) 
      });
    }
  };

  const handleLayerModeChange = (mode: string) => {
    if (mode === "all") {
      onUpdateSettings({ snapLayerIds: [] });
    } else {
      onUpdateSettings({ snapLayerIds: visibleLayers.map(l => l.id) });
    }
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant={snapSettings.enabled ? "default" : "ghost"}
              className="h-8 w-8"
              data-testid="button-snap-toggle"
            >
              <Magnet className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Привязка к объектам (S)</TooltipContent>
      </Tooltip>
      
      <PopoverContent className="w-72" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Magnet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">Привязка (Снаппинг)</span>
            </div>
            <Switch
              checked={snapSettings.enabled}
              onCheckedChange={() => onToggleSnap()}
              data-testid="switch-snap-enabled"
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Привязывать к:</Label>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="snap-vertices"
                  checked={snapSettings.snapToVertices}
                  onCheckedChange={(checked) => 
                    onUpdateSettings({ snapToVertices: !!checked })
                  }
                  disabled={!snapSettings.enabled}
                  data-testid="checkbox-snap-vertices"
                />
                <Label 
                  htmlFor="snap-vertices" 
                  className="text-sm font-normal cursor-pointer"
                >
                  Вершинам (узловые точки)
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="snap-edges"
                  checked={snapSettings.snapToEdges}
                  onCheckedChange={(checked) => 
                    onUpdateSettings({ snapToEdges: !!checked })
                  }
                  disabled={!snapSettings.enabled}
                  data-testid="checkbox-snap-edges"
                />
                <Label 
                  htmlFor="snap-edges" 
                  className="text-sm font-normal cursor-pointer"
                >
                  Линиям (рёбра)
                </Label>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Радиус притягивания:
              </Label>
              <span className="text-xs font-mono" data-testid="text-snap-radius">
                {snapSettings.snapRadius} px
              </span>
            </div>
            
            <Slider
              value={[snapSettings.snapRadius]}
              onValueChange={([value]) => onUpdateSettings({ snapRadius: value })}
              min={5}
              max={50}
              step={1}
              disabled={!snapSettings.enabled}
              data-testid="slider-snap-radius"
            />
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>5</span>
              <span>50</span>
            </div>
          </div>

          {visibleLayers.length > 0 && (
            <>
              <Separator />

              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">
                  Слои для привязки:
                </Label>
                
                <RadioGroup
                  value={useAllLayers ? "all" : "selected"}
                  onValueChange={handleLayerModeChange}
                  disabled={!snapSettings.enabled}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value="all" 
                      id="layers-all"
                      data-testid="radio-snap-layers-all"
                    />
                    <Label 
                      htmlFor="layers-all" 
                      className="text-sm font-normal cursor-pointer"
                    >
                      Все видимые слои
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value="selected" 
                      id="layers-selected"
                      data-testid="radio-snap-layers-selected"
                    />
                    <Label 
                      htmlFor="layers-selected" 
                      className="text-sm font-normal cursor-pointer"
                    >
                      Только выбранные:
                    </Label>
                  </div>
                </RadioGroup>

                {!useAllLayers && (
                  <ScrollArea className="h-32 rounded-md border p-2">
                    <div className="space-y-2">
                      {visibleLayers.map((layer) => (
                        <div key={layer.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`layer-${layer.id}`}
                            checked={snapSettings.snapLayerIds.includes(layer.id)}
                            onCheckedChange={(checked) => 
                              handleLayerToggle(layer.id, !!checked)
                            }
                            disabled={!snapSettings.enabled}
                            data-testid={`checkbox-snap-layer-${layer.id}`}
                          />
                          <Label 
                            htmlFor={`layer-${layer.id}`} 
                            className="text-sm font-normal cursor-pointer truncate"
                          >
                            {layer.name}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
