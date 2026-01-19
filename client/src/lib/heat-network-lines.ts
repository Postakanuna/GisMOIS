/**
 * Heat Network Line Styles - ГОСТ-compliant line styles for heating network pipelines
 * Различные типы линий для отображения тепловых сетей на карте
 */

export type HeatNetworkLineStyle = 
  | "relaying"           // Под перекладку
  | "bypass"             // Байпас (временная схема)
  | "demolition"         // Под демонтаж
  | "above-ground"       // Наземная
  | "underground-channel"      // Подземная канальная
  | "underground-channelless"  // Подземная бесканальная
  | "state-program";     // Под перекладку в рамках госпрограммы

export const HEAT_NETWORK_LINE_LABELS: Record<HeatNetworkLineStyle, string> = {
  "relaying": "Под перекладку",
  "bypass": "Байпас (временная схема)",
  "demolition": "Под демонтаж",
  "above-ground": "Наземная",
  "underground-channel": "Подземная канальная",
  "underground-channelless": "Подземная бесканальная",
  "state-program": "Госпрограмма перекладки",
};

export function isHeatNetworkLineStyle(style: string): style is HeatNetworkLineStyle {
  return style in HEAT_NETWORK_LINE_LABELS;
}

export function getHeatNetworkLineStyles(): { value: HeatNetworkLineStyle; label: string }[] {
  return Object.entries(HEAT_NETWORK_LINE_LABELS).map(([value, label]) => ({
    value: value as HeatNetworkLineStyle,
    label,
  }));
}

export interface LineStyleConfig {
  lineDash?: number[];
  width: number;
  secondaryWidth?: number;
  secondaryColor?: string;
  pattern?: "dots" | "crosses" | "triangles" | "stars";
  outline?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
}

export function getHeatNetworkLineConfig(style: HeatNetworkLineStyle): LineStyleConfig {
  switch (style) {
    case "relaying":
      return {
        width: 3,
        lineDash: [12, 6],
      };
    case "bypass":
      return {
        width: 2,
        lineDash: [4, 4, 12, 4],
      };
    case "demolition":
      return {
        width: 2,
        lineDash: [2, 6],
      };
    case "above-ground":
      return {
        width: 3,
        outline: true,
        outlineWidth: 5,
        outlineColor: "#333",
      };
    case "underground-channel":
      return {
        width: 3,
        lineDash: [16, 4],
        outline: true,
        outlineWidth: 5,
      };
    case "underground-channelless":
      return {
        width: 2,
      };
    case "state-program":
      return {
        width: 4,
        lineDash: [8, 4, 2, 4],
        outline: true,
        outlineWidth: 6,
        outlineColor: "#FFD700",
      };
    default:
      return { width: 2 };
  }
}

export function createLinePreviewSvg(style: HeatNetworkLineStyle, color: string): string {
  const width = 48;
  const height = 16;
  const y = height / 2;
  const config = getHeatNetworkLineConfig(style);
  
  let strokeDasharray = "";
  if (config.lineDash) {
    strokeDasharray = `stroke-dasharray="${config.lineDash.join(" ")}"`;
  }
  
  let outlinePath = "";
  if (config.outline) {
    const outlineColor = config.outlineColor || "#666";
    outlinePath = `<path d="M 2 ${y} L ${width - 2} ${y}" stroke="${outlineColor}" stroke-width="${config.outlineWidth}" stroke-linecap="round"/>`;
  }
  
  const mainPath = `<path d="M 2 ${y} L ${width - 2} ${y}" stroke="${color}" stroke-width="${config.width}" stroke-linecap="round" ${strokeDasharray}/>`;
  
  let decorations = "";
  if (style === "state-program") {
    decorations = `
      <polygon points="12,${y-4} 14,${y+4} 10,${y+4}" fill="#FFD700" stroke="${color}" stroke-width="0.5"/>
      <polygon points="36,${y-4} 38,${y+4} 34,${y+4}" fill="#FFD700" stroke="${color}" stroke-width="0.5"/>
    `;
  }
  
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    ${outlinePath}
    ${mainPath}
    ${decorations}
  </svg>`;
}

export function getLinePreviewDataUrl(style: HeatNetworkLineStyle, color: string): string {
  const svg = createLinePreviewSvg(style, color);
  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml,${encoded}`;
}
