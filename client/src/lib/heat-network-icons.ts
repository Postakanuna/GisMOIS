/**
 * Heat Network Icons - ГОСТ-compliant SVG icons for heating network objects
 * Based on ГОСТ 21.705-2016, ГОСТ 21.403-80, ГОСТ 2.785-70
 */

// Icon size for map display
export const HEAT_ICON_SIZE = 24;

// Helper to create data URL from SVG string
function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml,${encoded}`;
}

// Helper to create colored SVG
function createColoredSvg(svgContent: string, color: string): string {
  return svgContent.replace(/\{color\}/g, color);
}

/**
 * Теплоисточник (Heat Source) - Boiler/furnace symbol with flame
 * Based on ГОСТ 21.403-80 - boiler representation
 */
const HEAT_SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="3" y="6" width="18" height="14" rx="2" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <path d="M12 10 Q10 12 12 14 Q14 12 12 10" fill="#fff" stroke="#fff" stroke-width="0.5"/>
  <path d="M8 11 Q7 12.5 8 14 Q9 12.5 8 11" fill="#fff" stroke="#fff" stroke-width="0.5"/>
  <path d="M16 11 Q15 12.5 16 14 Q17 12.5 16 11" fill="#fff" stroke="#fff" stroke-width="0.5"/>
  <rect x="10" y="3" width="4" height="3" fill="{color}" stroke="#fff" stroke-width="1"/>
</svg>`;

/**
 * ЦТП (Central Heating Point) - Heat exchanger symbol with "Ц" letter
 * Based on ГОСТ 21.705-2016
 */
const CTP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="2" y="4" width="20" height="16" rx="2" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <text x="12" y="16" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle">ЦТП</text>
</svg>`;

/**
 * ИТП (Individual Heating Point) - Smaller heat exchanger with "И" letter
 * Based on ГОСТ 21.705-2016
 */
const ITP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="3" y="5" width="18" height="14" rx="2" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <text x="12" y="15.5" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#fff" text-anchor="middle">ИТП</text>
</svg>`;

/**
 * Задвижка (Gate Valve) - Classic butterfly/bowtie valve symbol
 * Based on ГОСТ 2.785-70 - standard valve representation
 */
const VALVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <polygon points="4,6 12,12 4,18" fill="{color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
  <polygon points="20,6 12,12 20,18" fill="{color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
  <line x1="12" y1="3" x2="12" y2="8" stroke="{color}" stroke-width="3"/>
  <line x1="12" y1="3" x2="12" y2="8" stroke="#fff" stroke-width="1.5"/>
  <circle cx="12" cy="3" r="2" fill="{color}" stroke="#fff" stroke-width="1"/>
</svg>`;

/**
 * Тепловая камера (Heat Chamber) - Chamber/manhole symbol with cross
 * Based on ГОСТ 21.605-82
 */
const HEAT_CHAMBER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="3" y="3" width="18" height="18" rx="1" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <line x1="12" y1="6" x2="12" y2="18" stroke="#fff" stroke-width="2"/>
  <line x1="6" y1="12" x2="18" y2="12" stroke="#fff" stroke-width="2"/>
</svg>`;

/**
 * Насосная станция (Pump Station) - Pump symbol with circular element
 */
const PUMP_STATION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="9" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <polygon points="12,6 17,15 7,15" fill="#fff" stroke="#fff" stroke-width="0.5"/>
</svg>`;

/**
 * Компенсатор (Expansion Joint/Compensator) - Zigzag symbol
 */
const COMPENSATOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="2" y="8" width="20" height="8" rx="1" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <path d="M5 12 L7 9 L9 15 L11 9 L13 15 L15 9 L17 15 L19 12" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/**
 * Опора (Support/Anchor) - Support bracket symbol
 */
const SUPPORT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="8" y="4" width="8" height="4" fill="{color}" stroke="#fff" stroke-width="1.5"/>
  <polygon points="4,20 12,8 20,20" fill="{color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

// Export type for all heat network point styles
export type HeatNetworkPointStyle = 
  | "heat-source"     // Теплоисточник
  | "ctp"             // ЦТП
  | "itp"             // ИТП
  | "valve"           // Задвижка
  | "heat-chamber"    // Тепловая камера
  | "pump-station"    // Насосная станция
  | "compensator"     // Компенсатор
  | "support";        // Опора

// Map of icon names to their SVG templates
const ICON_TEMPLATES: Record<HeatNetworkPointStyle, string> = {
  "heat-source": HEAT_SOURCE_SVG,
  "ctp": CTP_SVG,
  "itp": ITP_SVG,
  "valve": VALVE_SVG,
  "heat-chamber": HEAT_CHAMBER_SVG,
  "pump-station": PUMP_STATION_SVG,
  "compensator": COMPENSATOR_SVG,
  "support": SUPPORT_SVG,
};

// Labels for UI display
export const HEAT_NETWORK_LABELS: Record<HeatNetworkPointStyle, string> = {
  "heat-source": "Теплоисточник",
  "ctp": "ЦТП",
  "itp": "ИТП",
  "valve": "Задвижка",
  "heat-chamber": "Тепловая камера",
  "pump-station": "Насосная станция",
  "compensator": "Компенсатор",
  "support": "Опора",
};

// Check if a point style is a heat network icon
export function isHeatNetworkStyle(style: string): style is HeatNetworkPointStyle {
  return style in ICON_TEMPLATES;
}

// Get SVG data URL for a heat network icon with specified color
export function getHeatNetworkIconUrl(style: HeatNetworkPointStyle, color: string): string {
  const template = ICON_TEMPLATES[style];
  if (!template) {
    throw new Error(`Unknown heat network style: ${style}`);
  }
  const coloredSvg = createColoredSvg(template, color);
  return svgToDataUrl(coloredSvg);
}

// Get all heat network styles for UI
export function getHeatNetworkStyles(): { value: HeatNetworkPointStyle; label: string }[] {
  return Object.entries(HEAT_NETWORK_LABELS).map(([value, label]) => ({
    value: value as HeatNetworkPointStyle,
    label,
  }));
}

// Create a preview SVG element for palette display (returns data URL)
export function getHeatNetworkPreviewIcon(style: HeatNetworkPointStyle, color: string = "#1976D2"): string {
  return getHeatNetworkIconUrl(style, color);
}
