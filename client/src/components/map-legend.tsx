import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StyleConfig, CategorizedClass, GraduatedClass } from "@shared/schema";

interface LegendLayer {
  id: number;
  name: string;
  color: string;
  visible: boolean;
  styleConfig?: any;
}

interface MapLegendProps {
  layers: LegendLayer[];
}

export function MapLegend({ layers }: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(false);

  const styledLayers = layers.filter(l => {
    if (!l.visible) return false;
    const sc = l.styleConfig as StyleConfig | undefined;
    return sc && sc.renderer !== "single";
  });

  if (styledLayers.length === 0) return null;

  return (
    <div
      className="absolute bottom-4 right-4 bg-background/95 backdrop-blur-sm border rounded-md shadow-sm z-[100] max-w-[240px] text-xs"
      data-testid="map-legend"
    >
      <button
        className="flex items-center gap-1 px-3 py-1.5 w-full text-left font-medium hover-elevate"
        onClick={() => setCollapsed(prev => !prev)}
        data-testid="button-legend-toggle"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Легенда
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-2">
          {styledLayers.map(layer => {
            const sc = layer.styleConfig as StyleConfig;
            return (
              <div key={layer.id} data-testid={`legend-layer-${layer.id}`}>
                <p className="font-medium text-muted-foreground mb-1 truncate">{layer.name}</p>
                {sc.renderer === "categorized" && sc.categorizedClasses && (
                  <div className="space-y-0.5">
                    {sc.categorizedClasses.map((cls: CategorizedClass, i: number) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
                          style={{ backgroundColor: cls.style.color }}
                        />
                        <span className="truncate">{cls.label || String(cls.value)}</span>
                      </div>
                    ))}
                    {sc.defaultStyle && (
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
                          style={{ backgroundColor: sc.defaultStyle.color }}
                        />
                        <span className="truncate text-muted-foreground">Прочее</span>
                      </div>
                    )}
                  </div>
                )}
                {sc.renderer === "graduated" && sc.graduatedClasses && (
                  <div className="space-y-0.5">
                    {sc.graduatedClasses.map((cls: GraduatedClass, i: number) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
                          style={{ backgroundColor: cls.style.color }}
                        />
                        <span className="truncate">{cls.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
