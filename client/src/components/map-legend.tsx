import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StyleConfig, CategorizedClass, GraduatedClass, StyleClassItem } from "@shared/schema";
import { isHeatNetworkStyle, getHeatNetworkIconUrl, type HeatNetworkPointStyle } from "@/lib/heat-network-icons";
import { isHeatNetworkLineStyle, getLinePreviewDataUrl, type HeatNetworkLineStyle } from "@/lib/heat-network-lines";

function LegendSymbol({ style }: { style: { color: string; pointStyle?: string; lineStyle?: string } }) {
  const color = style.color || "#888";

  if (style.pointStyle && style.pointStyle !== "circle") {
    if (isHeatNetworkStyle(style.pointStyle)) {
      const iconUrl = getHeatNetworkIconUrl(style.pointStyle as HeatNetworkPointStyle, color);
      return <img src={iconUrl} alt="" className="w-3 h-3 flex-shrink-0" />;
    }
    const shapeMap: Record<string, string> = {
      square: `<rect x="1" y="1" width="10" height="10" fill="${color}" stroke="white" stroke-width="0.5"/>`,
      triangle: `<polygon points="6,1 11,11 1,11" fill="${color}" stroke="white" stroke-width="0.5"/>`,
      diamond: `<polygon points="6,1 11,6 6,11 1,6" fill="${color}" stroke="white" stroke-width="0.5"/>`,
      star: `<polygon points="6,1 7.5,4.5 11,5 8.5,7.5 9,11 6,9 3,11 3.5,7.5 1,5 4.5,4.5" fill="${color}" stroke="white" stroke-width="0.3"/>`,
      cross: `<path d="M5,1 L7,1 L7,5 L11,5 L11,7 L7,7 L7,11 L5,11 L5,7 L1,7 L1,5 L5,5 Z" fill="${color}" stroke="white" stroke-width="0.3"/>`,
      hexagon: `<polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill="${color}" stroke="white" stroke-width="0.5"/>`,
      pentagon: `<polygon points="6,1 11,4.5 9,11 3,11 1,4.5" fill="${color}" stroke="white" stroke-width="0.5"/>`,
      cloud: `<polygon points="6,1 8,4 11,5 9,8 10,11 6,10 2,11 3,8 1,5 4,4" fill="${color}" stroke="white" stroke-width="0.3"/>`,
    };
    const svg = shapeMap[style.pointStyle];
    if (svg) {
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12">${svg}</svg>`)}`;
      return <img src={dataUrl} alt="" className="w-3 h-3 flex-shrink-0" />;
    }
  }

  if (style.lineStyle && style.lineStyle !== "solid") {
    if (isHeatNetworkLineStyle(style.lineStyle)) {
      return <img src={getLinePreviewDataUrl(style.lineStyle as HeatNetworkLineStyle, color)} alt="" className="w-6 h-3 flex-shrink-0" />;
    }
    let dashArray = "";
    switch (style.lineStyle) {
      case "dashed": dashArray = 'stroke-dasharray="4 2"'; break;
      case "dotted": dashArray = 'stroke-dasharray="1 2"'; break;
      case "dash-dot": dashArray = 'stroke-dasharray="5 2 1 2"'; break;
      case "long-dash": dashArray = 'stroke-dasharray="8 3"'; break;
      case "dash-dot-dot": dashArray = 'stroke-dasharray="5 2 1 2 1 2"'; break;
      case "double": {
        const doubleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="24" height="12"><path d="M 1 4 L 23 4" stroke="${color}" stroke-width="1.5"/><path d="M 1 8 L 23 8" stroke="${color}" stroke-width="1.5"/></svg>`;
        return <img src={`data:image/svg+xml,${encodeURIComponent(doubleSvg)}`} alt="" className="w-6 h-3 flex-shrink-0" />;
      }
    }
    const lineSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="24" height="12"><path d="M 1 6 L 23 6" stroke="${color}" stroke-width="2" ${dashArray}/></svg>`;
    return <img src={`data:image/svg+xml,${encodeURIComponent(lineSvg)}`} alt="" className="w-6 h-3 flex-shrink-0" />;
  }

  return (
    <span
      className="w-3 h-3 rounded-sm flex-shrink-0 border border-border/50"
      style={{ backgroundColor: color }}
    />
  );
}

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
                        <LegendSymbol style={cls.style} />
                        <span className="truncate">{cls.label || String(cls.value)}</span>
                      </div>
                    ))}
                    {sc.defaultStyle && (
                      <div className="flex items-center gap-1.5">
                        <LegendSymbol style={sc.defaultStyle} />
                        <span className="truncate text-muted-foreground">Прочее</span>
                      </div>
                    )}
                  </div>
                )}
                {sc.renderer === "graduated" && sc.graduatedClasses && (
                  <div className="space-y-0.5">
                    {sc.graduatedClasses.map((cls: GraduatedClass, i: number) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <LegendSymbol style={cls.style} />
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
