import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import VectorSource from "ol/source/Vector";
import ImageWMS from "ol/source/ImageWMS";
// Cluster import removed - using server-side point sampling instead
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import WKT from "ol/format/WKT";
import Feature from "ol/Feature";
import { Style, Fill, Stroke, Circle, Icon } from "ol/style";
import { LineString, Geometry } from "ol/geom";
import { DragBox, Select, Draw, Modify, Snap } from "ol/interaction";
import { platformModifierKeyOnly, click } from "ol/events/condition";
import type { DrawEvent } from "ol/interaction/Draw";
import type { ModifyEvent } from "ol/interaction/Modify";
import "ol/ol.css";

import type { LayerConfig, FeatureInfo, ZuluConnection, Ticket, InsertTicket, PointStyle, LineStyle, EditableLayer, DrawnFeature, GeometryType, InsertDrawnFeature, Dataset, StyleConfig, StyleClassItem } from "@shared/schema";
import { useScene } from "@/contexts/scene-context";
import { useBaseLayers } from "@/contexts/base-layers-context";
import { useProjection } from "@/contexts/projection-context";
import { registerProjections, YANDEX_TILE_GRID, YANDEX_MAP_URL, YANDEX_SATELLITE_URL, type ProjectionType } from "@/lib/projections";
import { get as getProjection } from "ol/proj";
import { isHeatNetworkStyle, getHeatNetworkIconUrl, HEAT_ICON_SIZE, type HeatNetworkPointStyle } from "@/lib/heat-network-icons";
import { isHeatNetworkLineStyle, getHeatNetworkLineConfig, type HeatNetworkLineStyle } from "@/lib/heat-network-lines";
import type { DrawingMode } from "@/components/drawing-toolbar";
import RegularShape from "ol/style/RegularShape";
import GeoJSON from "ol/format/GeoJSON";
import type { LayerFilters, ActiveFilters } from "@/hooks/use-zulu-connection";
import { MapControls } from "./map-controls";
import { CoordinateDisplay } from "./coordinate-display";
import { FeatureInfoPanel } from "./feature-info";
import { LoadingOverlay } from "./loading-overlay";
import { MeasureTool } from "./measure-tool";
import { getDistance, getLength } from "ol/sphere";
import { Point as OlPoint, Polygon as OlPolygon, MultiPolygon as OlMultiPolygon } from "ol/geom";
import Text from "ol/style/Text";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

export interface SelectedFeatureData {
  layerId: number;
  layerName: string;
  featureIndex: number;
  properties: Record<string, unknown>;
}

// Candidate for feature selection when multiple features overlap
export interface SelectionCandidate {
  layerId: number;
  layerName: string;
  featureIndex: number;
  feature: Feature<Geometry>;
  geometryType: string;
}

interface SceneDatasetInfo {
  id: number;
  sceneId: number;
  datasetId: number;
  layerName: string | null;
  isVisible: number;
  opacity: number;
  color: string;
  pointStyle: string;
  lineStyle: string;
  zIndex: number;
  dataset: {
    id: number;
    name: string;
    originalFilename?: string;
    geometryType: string;
    crs?: string;
    featureCount: number;
  };
}

interface DatasetFeatureData {
  id: number;
  datasetId: number;
  geometryType: string;
  coordinates: unknown;
  properties: Record<string, unknown>;
}

interface MapViewerProps {
  layers: LayerConfig[];
  connection: ZuluConnection | null;
  isConnected: boolean;
  activeFilters?: Record<string, ActiveFilters>;
  onFiltersDiscovered?: (layerId: string, filters: LayerFilters) => void;
  onLayerLoadError?: (error: string) => void;
  onLayerLoadSuccess?: () => void;
  tickets: Ticket[];
  ticketMode: boolean;
  onToggleTicketMode: () => void;
  onCreateTicket: (ticket: InsertTicket) => Promise<Ticket>;
  allEditableLayers?: EditableLayer[];
  onSelectedFeaturesChange?: (features: SelectedFeatureData[]) => void;
  onShowFeatureInfo?: () => void;
  // Drawing/editing props
  editMode?: boolean;
  drawingMode?: DrawingMode;
  activeEditableLayer?: EditableLayer | null;
  onFeatureCreated?: (geometryType: GeometryType, coordinates: unknown, properties?: Record<string, unknown>) => void;
  onFeatureUpdated?: (featureId: number, updates: Partial<InsertDrawnFeature>) => void;
  selectedEditableFeatureIds?: number[];
  onEditableFeatureSelect?: (featureId: number, multi?: boolean) => void;
  onMultiSelectFeatures?: (featureIds: number[]) => void;
  onClearEditableSelection?: () => void;
  onSelectEditableLayer?: (layer: EditableLayer) => void;
  // Selection callbacks exposed for external control
  selectionActionsRef?: React.MutableRefObject<{
    clearSelection: () => void;
    deleteSelected: () => void;
    deleteFeatures: (ids: number[]) => void;
  } | null>;
  // Drawing actions exposed for external control (undo last point during drawing)
  drawActionsRef?: React.MutableRefObject<{ removeLastPoint: () => boolean; abortDrawing: () => void } | null>;
  // Scene dataset editing props
  activeSceneDataset?: SceneDatasetInfo | null;
  onDatasetFeatureCreated?: (datasetId: number, geometryType: string, coordinates: unknown, properties?: Record<string, unknown>) => void;
  onDatasetFeatureUpdated?: (datasetId: number, featureId: number, geometry: { type: string; coordinates: unknown }) => void;
  // Trace route visualization
  traceRouteCoordinates?: [number, number][] | null;
  // Reconstruction segments highlight (pipe issues from capacity analysis)
  reconstructionHighlight?: Array<{ coordinates: any; name: string; currentDiameter: number; requiredDiameter: number }> | null;
  // Simulation highlight data
  simulationHighlightData?: {
    segments: Array<{ coordinates: any }>;
    points: Array<{ coordinates: any; type: string }>;
    polygons?: Array<{ coordinates: number[][] }>;
    failurePoint?: { coordinates: any; type: string };
  } | null;
  // Snap settings
  snapSettings?: {
    enabled: boolean;
    snapToVertices: boolean;
    snapToEdges: boolean;
    snapRadius: number;
    snapLayerIds: number[];
  };
  mapActionsRef?: React.MutableRefObject<{ zoomToFeature: (feature: DrawnFeature) => void; zoomToCoordinates: (lat: number, lon: number, zoom?: number) => void; panToFeatureIfOutsideViewport: (feature: DrawnFeature) => void } | null>;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;

type LayerType = TileLayer<OSM> | TileLayer<XYZ> | VectorLayer<VectorSource> | ImageLayer<ImageWMS>;

const LAYER_COLORS: Record<string, string> = {
  "ZR_VS_MO": "#2196F3",
  "ZR_VO_MO": "#4CAF50",
  "ZR_TS_MO": "#FF5722",
};

// Calculate point radius and stroke width based on zoom level
// Higher zoom = smaller points to avoid overlapping lines
function getPointSizeForZoom(zoom: number): { radius: number; strokeWidth: number; iconScale: number } {
  if (zoom >= 19) {
    // Ultra-high zoom (19+): 6px
    return { radius: 6, strokeWidth: 1, iconScale: 0.75 };
  } else if (zoom >= 15) {
    // High zoom (15-18): 5px
    return { radius: 5, strokeWidth: 0.75, iconScale: 0.6 };
  } else if (zoom >= 9) {
    // Medium zoom (9-14): 4px
    return { radius: 4, strokeWidth: 0.5, iconScale: 0.5 };
  } else {
    // Low zoom (<9): 8px
    return { radius: 8, strokeWidth: 1.5, iconScale: 0.9 };
  }
}

const customIconCache = new Map<number, string>();
const customIconFetchPromises = new Map<number, Promise<string | null>>();

function fetchCustomIconSvg(iconId: number): Promise<string | null> {
  if (customIconCache.has(iconId)) return Promise.resolve(customIconCache.get(iconId)!);
  if (customIconFetchPromises.has(iconId)) return customIconFetchPromises.get(iconId)!;
  const promise = fetch(`/api/custom-icons/${iconId}`)
    .then(res => { if (!res.ok) return null; return res.json(); })
    .then(data => { if (data?.svgContent) { customIconCache.set(iconId, data.svgContent); return data.svgContent; } return null; })
    .catch(() => null)
    .finally(() => { customIconFetchPromises.delete(iconId); });
  customIconFetchPromises.set(iconId, promise);
  return promise;
}

function buildIconMapFromCache(ids: number[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const id of ids) {
    const svg = customIconCache.get(id);
    if (svg) map.set(id, svg);
  }
  return map;
}

function allIconsCached(ids: number[]): boolean {
  return ids.every(id => customIconCache.has(id));
}

function normalizeSvgSize(svgContent: string, targetSize: number): string {
  let svg = svgContent;
  const svgTagMatch = svg.match(/<svg([^>]*)>/i);
  if (svgTagMatch) {
    let attrs = svgTagMatch[1];
    const hasViewBox = /viewBox/i.test(attrs);
    if (!hasViewBox) {
      const wMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
      const hMatch = attrs.match(/\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i);
      if (wMatch && hMatch) {
        attrs += ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`;
      } else {
        attrs += ` viewBox="0 0 24 24"`;
      }
    }
    attrs = attrs.replace(/\bwidth\s*=\s*["'][^"']*["']/gi, '');
    attrs = attrs.replace(/\bheight\s*=\s*["'][^"']*["']/gi, '');
    attrs += ` width="${targetSize}" height="${targetSize}"`;
    svg = svg.replace(/<svg[^>]*>/i, `<svg${attrs}>`);
  }
  return svg;
}

function replaceColorsInSvg(svgContent: string, color: string): string {
  let svg = svgContent;
  svg = svg.replace(/\{color\}/g, color);
  svg = svg.replace(/currentColor/gi, color);
  return svg;
}

function createCustomIconImage(svgContent: string, color: string, iconSize: number, zoom?: number): Icon {
  const sizes = getPointSizeForZoom(zoom ?? 10);
  const pixelSize = iconSize * sizes.iconScale;
  let svg = normalizeSvgSize(svgContent, pixelSize);
  svg = replaceColorsInSvg(svg, color);
  const encoded = encodeURIComponent(svg);
  const dataUrl = `data:image/svg+xml,${encoded}`;
  return new Icon({
    src: dataUrl,
    scale: 1,
    anchor: [0.5, 0.5],
    anchorXUnits: 'fraction',
    anchorYUnits: 'fraction',
  });
}

// Helper function to create point image style based on pointStyle and zoom
function createPointImageStyle(
  color: string, 
  pointStyle: PointStyle = "circle",
  zoom?: number,
  iconSize?: number,
  customIconSvg?: string
): Circle | RegularShape | Icon {
  const sizes = getPointSizeForZoom(zoom ?? 10);
  const sizeMultiplier = iconSize ? iconSize / 24 : 1;
  const fill = new Fill({ color });
  const stroke = new Stroke({ color: "#fff", width: sizes.strokeWidth });

  if (customIconSvg) {
    return createCustomIconImage(customIconSvg, color, iconSize || 24, zoom);
  }
  
  // Check if it's a heat network style
  if (isHeatNetworkStyle(pointStyle)) {
    const iconUrl = getHeatNetworkIconUrl(pointStyle as HeatNetworkPointStyle, color);
    return new Icon({
      src: iconUrl,
      scale: sizes.iconScale * sizeMultiplier,
      anchor: [0.5, 0.5],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    });
  }
  
  const scaledRadius = sizes.radius * sizeMultiplier;
  
  switch (pointStyle) {
    case "square":
      return new RegularShape({
        fill,
        stroke,
        points: 4,
        radius: scaledRadius,
        angle: Math.PI / 4,
      });
    case "triangle":
      return new RegularShape({
        fill,
        stroke,
        points: 3,
        radius: scaledRadius,
        angle: 0,
      });
    case "cloud":
      return new RegularShape({
        fill,
        stroke,
        points: 5,
        radius: scaledRadius,
        radius2: scaledRadius * 0.6,
        angle: 0,
      });
    case "diamond":
      return new RegularShape({
        fill,
        stroke,
        points: 4,
        radius: scaledRadius,
        angle: 0,
      });
    case "star":
      return new RegularShape({
        fill,
        stroke,
        points: 5,
        radius: scaledRadius,
        radius2: scaledRadius * 0.4,
        angle: 0,
      });
    case "cross":
      return new RegularShape({
        fill,
        stroke,
        points: 4,
        radius: scaledRadius,
        radius2: 0,
        angle: 0,
      });
    case "hexagon":
      return new RegularShape({
        fill,
        stroke,
        points: 6,
        radius: scaledRadius,
        angle: 0,
      });
    case "pentagon":
      return new RegularShape({
        fill,
        stroke,
        points: 5,
        radius: scaledRadius,
        angle: 0,
      });
    case "circle":
    default:
      return new Circle({
        radius: scaledRadius,
        fill,
        stroke,
      });
  }
}

// Helper function to create stroke style based on lineStyle
function createLineStroke(color: string, lineStyle: LineStyle = "solid"): Stroke | Stroke[] {
  // Check for heat network line styles first
  if (isHeatNetworkLineStyle(lineStyle)) {
    const config = getHeatNetworkLineConfig(lineStyle);
    return new Stroke({ 
      color, 
      width: config.width, 
      lineDash: config.lineDash 
    });
  }
  
  switch (lineStyle) {
    case "dashed":
      return new Stroke({ color, width: 2, lineDash: [8, 4] });
    case "double":
      return new Stroke({ color, width: 4 });
    case "dash-dot":
      return new Stroke({ color, width: 2, lineDash: [10, 4, 2, 4] });
    case "dotted":
      return new Stroke({ color, width: 2, lineDash: [2, 4] });
    case "long-dash":
      return new Stroke({ color, width: 2, lineDash: [16, 6] });
    case "dash-dot-dot":
      return new Stroke({ color, width: 2, lineDash: [10, 4, 2, 4, 2, 4] });
    case "solid":
    default:
      return new Stroke({ color, width: 2 });
  }
}

// Create complete layer style based on layer properties
function createEditableLayerStyle(layer: EditableLayer, zoom?: number): Style | Style[] {
  const color = layer.color || "#1976D2";
  const pointStyle = layer.pointStyle || "circle";
  const lineStyle = layer.lineStyle || "solid";
  
  // For double lines, return array of styles
  if (lineStyle === "double") {
    return [
      new Style({
        stroke: new Stroke({ color, width: 4 }),
        fill: new Fill({ color: color + "40" }),
        image: createPointImageStyle(color, pointStyle, zoom),
      }),
      new Style({
        stroke: new Stroke({ color: "#fff", width: 1.5 }),
      }),
    ];
  }
  
  // Handle heat network line styles with special effects
  if (isHeatNetworkLineStyle(lineStyle)) {
    const config = getHeatNetworkLineConfig(lineStyle);
    const styles: Style[] = [];
    
    // Add outline stroke if configured
    if (config.outline) {
      const outlineColor = config.outlineColor || "#666";
      styles.push(new Style({
        stroke: new Stroke({ 
          color: outlineColor, 
          width: config.outlineWidth || config.width + 2,
          lineDash: config.lineDash
        }),
        fill: new Fill({ color: color + "40" }),
      }));
    }
    
    // Add main stroke
    styles.push(new Style({
      stroke: new Stroke({ 
        color, 
        width: config.width, 
        lineDash: config.lineDash 
      }),
      fill: config.outline ? undefined : new Fill({ color: color + "40" }),
      image: createPointImageStyle(color, pointStyle, zoom),
    }));
    
    return styles.length === 1 ? styles[0] : styles;
  }
  
  return new Style({
    fill: new Fill({ color: color + "40" }),
    stroke: createLineStroke(color, lineStyle) as Stroke,
    image: createPointImageStyle(color, pointStyle, zoom),
  });
}

function createStyleFromClassItem(classItem: StyleClassItem, fallbackLayer: EditableLayer, zoom?: number, customIconSvgMap?: Map<number, string>): Style | Style[] {
  const color = classItem.color;
  const pointStyle = classItem.pointStyle || fallbackLayer.pointStyle || "circle";
  const lineStyle = classItem.lineStyle || fallbackLayer.lineStyle || "solid";
  const strokeWidth = classItem.strokeWidth;
  const fillOpacity = classItem.fillOpacity !== undefined ? classItem.fillOpacity : 0.25;
  const fillHex = Math.round(fillOpacity * 255).toString(16).padStart(2, "0");
  const iconSize = classItem.iconSize;
  const customIconSvg = classItem.customIconId && customIconSvgMap ? customIconSvgMap.get(classItem.customIconId) : undefined;

  if (lineStyle === "double") {
    return [
      new Style({
        stroke: new Stroke({ color, width: strokeWidth || 4 }),
        fill: new Fill({ color: color + fillHex }),
        image: createPointImageStyle(color, pointStyle, zoom, iconSize, customIconSvg),
      }),
      new Style({
        stroke: new Stroke({ color: "#fff", width: 1.5 }),
      }),
    ];
  }

  if (isHeatNetworkLineStyle(lineStyle)) {
    const config = getHeatNetworkLineConfig(lineStyle);
    const styles: Style[] = [];
    if (config.outline) {
      styles.push(new Style({
        stroke: new Stroke({ color: config.outlineColor || "#666", width: config.outlineWidth || config.width + 2, lineDash: config.lineDash }),
        fill: new Fill({ color: color + fillHex }),
      }));
    }
    styles.push(new Style({
      stroke: new Stroke({ color, width: strokeWidth || config.width, lineDash: config.lineDash }),
      fill: config.outline ? undefined : new Fill({ color: color + fillHex }),
      image: createPointImageStyle(color, pointStyle, zoom, iconSize, customIconSvg),
    }));
    return styles.length === 1 ? styles[0] : styles;
  }

  return new Style({
    fill: new Fill({ color: color + fillHex }),
    stroke: strokeWidth
      ? new Stroke({ color, width: strokeWidth })
      : createLineStroke(color, lineStyle) as Stroke,
    image: createPointImageStyle(color, pointStyle, zoom, iconSize, customIconSvg),
  });
}

function collectCustomIconIds(styleConfig?: StyleConfig): number[] {
  if (!styleConfig) return [];
  const ids: number[] = [];
  if (styleConfig.defaultStyle?.customIconId) ids.push(styleConfig.defaultStyle.customIconId);
  if (styleConfig.categorizedClasses) {
    for (const cls of styleConfig.categorizedClasses) {
      if (cls.style.customIconId) ids.push(cls.style.customIconId);
    }
  }
  if (styleConfig.graduatedClasses) {
    for (const cls of styleConfig.graduatedClasses) {
      if (cls.style.customIconId) ids.push(cls.style.customIconId);
    }
  }
  return [...new Set(ids)];
}

async function loadCustomIconSvgs(ids: number[]): Promise<Map<number, string>> {
  const uncached = ids.filter(id => !customIconCache.has(id));
  if (uncached.length > 0) {
    await Promise.all(uncached.map(id => fetchCustomIconSvg(id)));
  }
  return buildIconMapFromCache(ids);
}

function stripFillFromStyle(style: Style | Style[]): Style | Style[] {
  if (Array.isArray(style)) {
    return style.map(s => new Style({
      stroke: s.getStroke() || undefined,
      image: s.getImage() || undefined,
      text: s.getText() || undefined,
    }));
  }
  return new Style({
    stroke: style.getStroke() || undefined,
    image: style.getImage() || undefined,
    text: style.getText() || undefined,
  });
}

function isLineGeometry(feature: Feature): boolean {
  const geom = feature.getGeometry();
  if (!geom) return false;
  const type = geom.getType();
  return type === 'LineString' || type === 'MultiLineString';
}

function applyGeometryAwareFill(style: Style | Style[], feature: Feature): Style | Style[] {
  if (isLineGeometry(feature)) {
    return stripFillFromStyle(style);
  }
  return style;
}

function createEditableLayerStyleFunction(layer: EditableLayer, zoom?: number, customIconSvgMap?: Map<number, string>): (feature: Feature) => Style | Style[] {
  const styleConfig = layer.styleConfig as StyleConfig | undefined;
  const iconMap = customIconSvgMap || new Map<number, string>();

  if (!styleConfig || styleConfig.renderer === "single") {
    const baseStyle = createEditableLayerStyle(layer, zoom);
    if (styleConfig?.defaultStyle) {
      const styledDefault = createStyleFromClassItem(styleConfig.defaultStyle, layer, zoom, iconMap);
      return (feature: Feature) => applyGeometryAwareFill(styledDefault, feature);
    }
    return (feature: Feature) => applyGeometryAwareFill(baseStyle, feature);
  }

  const defaultStyle = styleConfig.defaultStyle
    ? createStyleFromClassItem(styleConfig.defaultStyle, layer, zoom, iconMap)
    : createEditableLayerStyle(layer, zoom);

  if (styleConfig.renderer === "categorized" && styleConfig.field && styleConfig.categorizedClasses) {
    const styleCache = new Map<string, Style | Style[]>();
    for (const cls of styleConfig.categorizedClasses) {
      const key = String(cls.value);
      styleCache.set(key, createStyleFromClassItem(cls.style, layer, zoom, iconMap));
    }

    return (feature: Feature) => {
      const val = feature.get(styleConfig.field!);
      if (val === undefined || val === null) return applyGeometryAwareFill(defaultStyle, feature);
      const cached = styleCache.get(String(val));
      return applyGeometryAwareFill(cached || defaultStyle, feature);
    };
  }

  if (styleConfig.renderer === "graduated" && styleConfig.field && styleConfig.graduatedClasses) {
    const classes = styleConfig.graduatedClasses;
    const classStyles = classes.map(cls => createStyleFromClassItem(cls.style, layer, zoom, iconMap));

    return (feature: Feature) => {
      const raw = feature.get(styleConfig.field!);
      if (raw === undefined || raw === null) return applyGeometryAwareFill(defaultStyle, feature);
      const val = typeof raw === "number" ? raw : Number(raw);
      if (isNaN(val)) return applyGeometryAwareFill(defaultStyle, feature);
      for (let i = 0; i < classes.length; i++) {
        if (val >= classes[i].min && val < classes[i].max) return applyGeometryAwareFill(classStyles[i], feature);
      }
      if (classes.length > 0 && val === classes[classes.length - 1].max) {
        return applyGeometryAwareFill(classStyles[classStyles.length - 1], feature);
      }
      return applyGeometryAwareFill(defaultStyle, feature);
    };
  }

  return (feature: Feature) => applyGeometryAwareFill(defaultStyle, feature);
}

// Note: Clustering removed in favor of server-side point sampling (GIS-style approach)
// Points are now filtered on the server based on zoom level for better performance

// Compute z-index: user displayOrder rank is primary, geometry type is secondary tiebreaker
// Lower displayOrder = top of list = rendered on top (higher z-index)
// displayOrder may be sparse (e.g., 0, 1000, 2000), so we use rank among all layers
function getLayerZIndex(rank: number, totalLayers: number, layerFeatures: Array<{ geometryType: string }>): number {
  const baseZ = 500;
  const orderZ = (totalLayers - rank) * 10;
  
  let geomOffset = 2;
  if (layerFeatures.length > 0) {
    const geometryTypes = new Set(layerFeatures.map(f => f.geometryType));
    if (geometryTypes.has("Polygon") || geometryTypes.has("MultiPolygon")) {
      geomOffset = 0;
    } else if (geometryTypes.has("LineString") || geometryTypes.has("MultiLineString")) {
      geomOffset = 1;
    }
  }
  
  return baseZ + orderZ + geomOffset;
}

const VIEWPORT_BUFFER_RATIO = 0.5;
const VIEWPORT_DEBOUNCE_MS = 100;
const VIEWPORT_PRECISION = 2;
const PREFETCH_BUFFER_RATIO = 1.0;
const MAX_CACHE_SIZE = 20000;
const NO_SIMPLIFICATION_ZOOM = 14;

function getSimplificationGroup(zoom: number): number {
  if (zoom >= NO_SIMPLIFICATION_ZOOM) return NO_SIMPLIFICATION_ZOOM;
  if (zoom >= 12) return 12;
  if (zoom >= 10) return 10;
  if (zoom >= 9) return 9;
  if (zoom >= 8) return 8;
  if (zoom >= 7) return 7;
  if (zoom >= 6) return 6;
  if (zoom >= 5) return 5;
  if (zoom >= 4) return 4;
  return 0;
}

// Parse hex color to RGB components
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 59, g: 130, b: 246 }; // Default to blue if parsing fails
}

// Create pulsating glow effect for selected features
// Uses the layer's actual color and pointStyle for consistency
function createSelectionGlowStyle(
  phase: number, 
  geometryType: string,
  layerColor: string = "#1976D2",
  pointStyle: PointStyle = "circle"
): Style {
  // Phase is 0-1, creates smooth pulsing effect
  const glowOpacity = 0.3 + 0.4 * Math.sin(phase * Math.PI * 2);
  const glowWidth = 4 + 2 * Math.sin(phase * Math.PI * 2);
  const rgb = hexToRgb(layerColor);
  const glowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowOpacity})`;
  
  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    const baseRadius = 12;
    const pulseRadius = baseRadius + 3 * Math.sin(phase * Math.PI * 2);
    
    // Create shape based on pointStyle - use same shape as the original feature
    let image: Circle | RegularShape;
    
    // For heat network icons, use a larger circular glow
    if (isHeatNetworkStyle(pointStyle)) {
      image = new Circle({
        radius: pulseRadius * 1.3,
        fill: new Fill({ color: 'transparent' }),
        stroke: new Stroke({ color: glowColor, width: 4 }),
      });
      return new Style({ image });
    }
    
    switch (pointStyle) {
      case "triangle":
        image = new RegularShape({
          points: 3,
          radius: pulseRadius,
          fill: new Fill({ color: 'transparent' }),
          stroke: new Stroke({ color: glowColor, width: 3 }),
        });
        break;
      case "square":
        image = new RegularShape({
          points: 4,
          radius: pulseRadius,
          angle: Math.PI / 4,
          fill: new Fill({ color: 'transparent' }),
          stroke: new Stroke({ color: glowColor, width: 3 }),
        });
        break;
      case "cloud":
        // Cloud is rendered as a larger circle with softer glow
        image = new Circle({
          radius: pulseRadius * 1.2,
          fill: new Fill({ color: 'transparent' }),
          stroke: new Stroke({ color: glowColor, width: 4 }),
        });
        break;
      case "circle":
      default:
        image = new Circle({
          radius: pulseRadius,
          fill: new Fill({ color: 'transparent' }),
          stroke: new Stroke({ color: glowColor, width: 3 }),
        });
        break;
    }
    
    return new Style({ image });
  }
  
  return new Style({
    stroke: new Stroke({ 
      color: glowColor, 
      width: glowWidth,
    }),
    fill: new Fill({ 
      color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowOpacity * 0.3})`,
    }),
  });
}

function getLayerStyle(layerId: string) {
  const color = LAYER_COLORS[layerId] || "#1976D2";
  return new Style({
    fill: new Fill({ color: color + "40" }),
    stroke: new Stroke({ color, width: 2 }),
    image: new Circle({
      radius: 6,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#fff", width: 1 }),
    }),
  });
}

function getTicketStyle(status: "bound" | "unbound") {
  const color = status === "bound" ? "#4CAF50" : "#FF9800";
  return new Style({
    image: new Circle({
      radius: 10,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#fff", width: 2 }),
    }),
    text: new Text({
      text: status === "bound" ? "P" : "?",
      fill: new Fill({ color: "#fff" }),
      font: "bold 12px sans-serif",
    }),
  });
}

function offsetLineStringConsistent(coords: number[][], offsetMeters: number): number[][] {
  if (coords.length < 2) return coords;
  
  const first = coords[0];
  const last = coords[coords.length - 1];
  const needsReverse = first[0] > last[0] || (first[0] === last[0] && first[1] > last[1]);
  const orderedCoords = needsReverse ? [...coords].reverse() : coords;
  
  const result: number[][] = [];
  
  for (let i = 0; i < orderedCoords.length; i++) {
    const current = orderedCoords[i];
    
    if (i === 0) {
      const next = orderedCoords[i + 1];
      const dx = next[0] - current[0];
      const dy = next[1] - current[1];
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) {
        result.push([...current]);
      } else {
        const perpX = -dy / length;
        const perpY = dx / length;
        result.push([current[0] + perpX * offsetMeters, current[1] + perpY * offsetMeters]);
      }
    } else if (i === orderedCoords.length - 1) {
      const prev = orderedCoords[i - 1];
      const dx = current[0] - prev[0];
      const dy = current[1] - prev[1];
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) {
        result.push([...current]);
      } else {
        const perpX = -dy / length;
        const perpY = dx / length;
        result.push([current[0] + perpX * offsetMeters, current[1] + perpY * offsetMeters]);
      }
    } else {
      const prev = orderedCoords[i - 1];
      const next = orderedCoords[i + 1];
      
      const dx1 = current[0] - prev[0];
      const dy1 = current[1] - prev[1];
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      
      const dx2 = next[0] - current[0];
      const dy2 = next[1] - current[1];
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      if (len1 === 0 || len2 === 0) {
        result.push([...current]);
        continue;
      }
      
      const perp1X = -dy1 / len1;
      const perp1Y = dx1 / len1;
      const perp2X = -dy2 / len2;
      const perp2Y = dx2 / len2;
      
      let bisectX = perp1X + perp2X;
      let bisectY = perp1Y + perp2Y;
      const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);
      
      if (bisectLen < 0.01) {
        result.push([current[0] + perp1X * offsetMeters, current[1] + perp1Y * offsetMeters]);
      } else {
        bisectX /= bisectLen;
        bisectY /= bisectLen;
        
        const dot = perp1X * bisectX + perp1Y * bisectY;
        const scale = dot > 0.1 ? offsetMeters / dot : offsetMeters;
        const limitedScale = Math.min(scale, offsetMeters * 2);
        
        result.push([current[0] + bisectX * limitedScale, current[1] + bisectY * limitedScale]);
      }
    }
  }
  
  return needsReverse ? result.reverse() : result;
}

function parseZwsResponse(xml: string, viewProjection: string = "EPSG:3857"): Feature[] {
  const features: Feature[] = [];
  const wktFormat = new WKT();
  
  const recordRegex = /<Record>([\s\S]*?)<\/Record>/gi;
  let recordMatch;
  
  while ((recordMatch = recordRegex.exec(xml)) !== null) {
    const recordContent = recordMatch[1];
    
    const geometryMatch = recordContent.match(/<Name>Geometry<\/Name><Value>([\s\S]*?)<\/Value>/i);
    if (geometryMatch) {
      const wkt = geometryMatch[1].trim();
      try {
        const geometry = wktFormat.readGeometry(wkt, {
          dataProjection: "EPSG:4326",
          featureProjection: viewProjection,
        });
        
        const feature = new Feature({ geometry });
        
        const fieldRegex = /<Field><Name>([^<]+)<\/Name><Value>([^<]*)<\/Value><\/Field>/gi;
        let fieldMatch;
        while ((fieldMatch = fieldRegex.exec(recordContent)) !== null) {
          if (fieldMatch[1] !== "Geometry") {
            feature.set(fieldMatch[1], fieldMatch[2]);
          }
        }
        
        features.push(feature);
      } catch (e) {
        console.warn("Failed to parse WKT:", wkt.substring(0, 50));
      }
    }
  }
  
  return features;
}

export function MapViewer({ 
  layers, 
  connection, 
  isConnected, 
  activeFilters, 
  onFiltersDiscovered, 
  onLayerLoadError, 
  onLayerLoadSuccess, 
  tickets = [], 
  ticketMode, 
  onToggleTicketMode, 
  onCreateTicket, 
  allEditableLayers = [], 
  onSelectedFeaturesChange, 
  onShowFeatureInfo,
  editMode = false,
  drawingMode,
  activeEditableLayer,
  onFeatureCreated,
  onFeatureUpdated,
  selectedEditableFeatureIds = [],
  onEditableFeatureSelect,
  onMultiSelectFeatures,
  onClearEditableSelection,
  onSelectEditableLayer,
  selectionActionsRef,
  drawActionsRef,
  activeSceneDataset,
  onDatasetFeatureCreated,
  onDatasetFeatureUpdated,
  traceRouteCoordinates,
  reconstructionHighlight,
  simulationHighlightData,
  snapSettings,
  mapActionsRef,
}: MapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const layersRef = useRef<Record<string, LayerType>>({});
  const allFeaturesRef = useRef<Record<string, Feature[]>>({});
  const ticketsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const allEditableLayersRef = useRef<Map<number, VectorLayer<VectorSource>>>(new Map());
  const traceRouteLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const reconstructionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const simulationHighlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const { toast } = useToast();
  const { activeBaseLayer } = useBaseLayers();
  const { currentProjection } = useProjection();
  const currentProjectionRef = useRef<ProjectionType>(currentProjection);
  
  const connectionRef = useRef<ZuluConnection | null>(connection);
  const layersStateRef = useRef<LayerConfig[]>(layers);
  const activeFiltersRef = useRef<Record<string, ActiveFilters> | undefined>(activeFilters);
  const ticketModeRef = useRef(ticketMode);

  const [mouseCoordinates, setMouseCoordinates] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [featureCoordinates, setFeatureCoordinates] = useState<[number, number] | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  
  // Viewport state for optimized feature loading
  // actualViewport: real map bounds (for UI components that need precise bounds)
  // fetchViewport: buffered bounds used for data fetching (with hysteresis)
  const [fetchViewport, setFetchViewport] = useState<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    zoom: number;
  } | null>(null);
  const viewportDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Buffered extent for hysteresis - only refetch when viewport exits this area
  const bufferedExtentRef = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    zoom: number;
  } | null>(null);
  const [selectedMapFeatures, setSelectedMapFeatures] = useState<Array<{ layerId: number; featureIndex: number; feature: Feature<Geometry> }>>([]);
  const selectedMapFeaturesRef = useRef(selectedMapFeatures);
  const [selectionCandidates, setSelectionCandidates] = useState<SelectionCandidate[]>([]);
  const [pendingClickEvent, setPendingClickEvent] = useState<{ shiftKey: boolean } | null>(null);
  const pendingClickEventRef = useRef(pendingClickEvent);
  // Selection animation refs for pulsating glow effect (using refs to avoid React re-renders)
  const selectionAnimRef = useRef<number | null>(null);
  const selectionGlowLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectionGlowFeaturesRef = useRef<Feature<Geometry>[]>([]);
  const dragBoxRef = useRef<DragBox | null>(null);
  const selectionModeRef = useRef(false);

  // Drawing refs
  const editableLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawInteractionRef = useRef<Draw | null>(null);
  const snapInteractionRef = useRef<Snap | null>(null);
  const additionalSnapsRef = useRef<Snap[]>([]);
  const drawingModeRef = useRef<DrawingMode>(drawingMode || null);
  const editModeRef = useRef(editMode);
  const onFeatureCreatedRef = useRef(onFeatureCreated);
  const onFeatureUpdatedRef = useRef(onFeatureUpdated);
  const activeEditableLayerRef = useRef(activeEditableLayer);
  const onSelectEditableLayerRef = useRef(onSelectEditableLayer);
  const allEditableLayersDataRef = useRef(allEditableLayers);
  const onEditableFeatureSelectRef = useRef(onEditableFeatureSelect);
  const onMultiSelectFeaturesRef = useRef(onMultiSelectFeatures);
  const onClearEditableSelectionRef = useRef(onClearEditableSelection);
  
  // LayerId to skip style sync for when auto-selecting layer from object selection
  // This prevents user-defined styles from being reset to DB defaults
  const skipStyleSyncForLayerRef = useRef<number | null>(null);

  // Scene datasets refs
  const sceneDatasetLayersRef = useRef<Map<number, VectorLayer<VectorSource>>>(new Map());
  // Track last zoom used for point styling to trigger updates on zoom change
  const lastStyleZoomRef = useRef<number>(DEFAULT_ZOOM);
  const { currentSceneId } = useScene();
  const activeSceneDatasetRef = useRef(activeSceneDataset);
  const onDatasetFeatureUpdatedRef = useRef(onDatasetFeatureUpdated);
  const onDatasetFeatureCreatedRef = useRef(onDatasetFeatureCreated);
  const sceneDatasetModifyRef = useRef<Modify | null>(null);
  const editableLayerModifyRef = useRef<Modify | null>(null);

  // Fetch scene datasets
  const { data: sceneDatasets = [] } = useQuery<SceneDatasetInfo[]>({
    queryKey: ["/api/scenes", currentSceneId, "datasets"],
    enabled: !!currentSceneId,
  });

  useEffect(() => {
    selectionModeRef.current = drawingMode === 'select';
  }, [drawingMode]);

  useEffect(() => {
    drawingModeRef.current = drawingMode || null;
  }, [drawingMode]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  // Clear selection when edit mode is turned off
  useEffect(() => {
    if (!editMode) {
      setSelectedMapFeatures([]);
      if (onClearEditableSelection) {
        onClearEditableSelection();
      }
    }
  }, [editMode, onClearEditableSelection]);

  useEffect(() => {
    onFeatureCreatedRef.current = onFeatureCreated;
  }, [onFeatureCreated]);

  useEffect(() => {
    onFeatureUpdatedRef.current = onFeatureUpdated;
  }, [onFeatureUpdated]);

  useEffect(() => {
    activeEditableLayerRef.current = activeEditableLayer;
  }, [activeEditableLayer]);

  useEffect(() => {
    onSelectEditableLayerRef.current = onSelectEditableLayer;
  }, [onSelectEditableLayer]);

  useEffect(() => {
    allEditableLayersDataRef.current = allEditableLayers;
  }, [allEditableLayers]);

  useEffect(() => {
    onEditableFeatureSelectRef.current = onEditableFeatureSelect;
  }, [onEditableFeatureSelect]);

  useEffect(() => {
    onMultiSelectFeaturesRef.current = onMultiSelectFeatures;
  }, [onMultiSelectFeatures]);

  useEffect(() => {
    onClearEditableSelectionRef.current = onClearEditableSelection;
  }, [onClearEditableSelection]);

  useEffect(() => {
    activeSceneDatasetRef.current = activeSceneDataset;
  }, [activeSceneDataset]);

  useEffect(() => {
    onDatasetFeatureUpdatedRef.current = onDatasetFeatureUpdated;
  }, [onDatasetFeatureUpdated]);

  useEffect(() => {
    onDatasetFeatureCreatedRef.current = onDatasetFeatureCreated;
  }, [onDatasetFeatureCreated]);

  // Derived key for visible layers (used as snap dependency to rebuild snaps when layers change)
  const visibleLayersKey = useMemo(() => {
    const visibleEditableIds = (allEditableLayers || [])
      .filter(l => l.visible)
      .map(l => l.id)
      .sort()
      .join(',');
    const visibleSceneDatasetIds = sceneDatasets
      .filter(sd => sd.isVisible === 1)
      .map(sd => sd.datasetId)
      .sort()
      .join(',');
    return `${visibleEditableIds}|${visibleSceneDatasetIds}`;
  }, [allEditableLayers, sceneDatasets]);

  // Sync refs with state to avoid stale closures in OL event handlers
  useEffect(() => {
    selectedMapFeaturesRef.current = selectedMapFeatures;
  }, [selectedMapFeatures]);

  useEffect(() => {
    pendingClickEventRef.current = pendingClickEvent;
  }, [pendingClickEvent]);

  // Clear selection dialog when exiting select mode
  useEffect(() => {
    if (drawingMode !== 'select') {
      setSelectionCandidates([]);
      setPendingClickEvent(null);
    }
  }, [drawingMode]);

  // Function to confirm feature selection (used both for single selection and after dialog choice)
  // Uses refs to avoid stale closure issues with OL event handlers
  const confirmFeatureSelectionInternal = useCallback((
    candidate: SelectionCandidate, 
    isMultiSelect: boolean
  ) => {
    const { layerId, featureIndex, feature } = candidate;
    
    // Get the actual feature ID from the feature properties
    const featureId = feature.get("featureId") as number | undefined;
    
    // Auto-switch to the layer containing the selected feature
    const currentActiveLayer = activeEditableLayerRef.current;
    if (layerId !== currentActiveLayer?.id) {
      const targetLayer = allEditableLayersDataRef.current?.find(l => l.id === layerId);
      if (targetLayer && onSelectEditableLayerRef.current) {
        // Skip style sync for this specific layer to preserve user-defined styles
        skipStyleSyncForLayerRef.current = layerId;
        onSelectEditableLayerRef.current(targetLayer);
      }
    }
    
    // Use ref to get current state and avoid stale closure
    const currentSelectedFeatures = selectedMapFeaturesRef.current;
    const isAlreadySelected = currentSelectedFeatures.some(
      sf => sf.layerId === layerId && sf.featureIndex === featureIndex
    );
    
    // Sync selection with drawing.selectedFeatureIds via callback
    // The callback's multi parameter controls toggle behavior:
    // - multi=true: toggle the selection state
    // - multi=false: select only this feature (or deselect if already selected)
    if (featureId !== undefined && onEditableFeatureSelectRef.current) {
      if (isMultiSelect) {
        // Multi-select mode: toggle this feature
        onEditableFeatureSelectRef.current(featureId, true);
      } else {
        // Single-select mode: if already selected, we want to deselect
        // if not selected, we want to select only this one
        if (!isAlreadySelected) {
          onEditableFeatureSelectRef.current(featureId, false);
        } else {
          // If isAlreadySelected in single-select mode, clear the selection
          if (onClearEditableSelectionRef.current) {
            onClearEditableSelectionRef.current();
          }
        }
      }
    }
    
    if (isMultiSelect) {
      if (isAlreadySelected) {
        setSelectedMapFeatures(prev => 
          prev.filter(sf => !(sf.layerId === layerId && sf.featureIndex === featureIndex))
        );
      } else {
        setSelectedMapFeatures(prev => [
          ...prev, 
          { layerId, featureIndex, feature }
        ]);
      }
    } else {
      if (isAlreadySelected) {
        setSelectedMapFeatures([]);
      } else {
        setSelectedMapFeatures([{ layerId, featureIndex, feature }]);
      }
    }
  }, []); // No dependencies - uses refs for current state

  // Ref for accessing confirmFeatureSelectionInternal from OL event handlers
  const confirmFeatureSelectionRef = useRef(confirmFeatureSelectionInternal);
  useEffect(() => {
    confirmFeatureSelectionRef.current = confirmFeatureSelectionInternal;
  }, [confirmFeatureSelectionInternal]);

  // Handle selection from the layer selection dialog
  const handleCandidateSelect = useCallback((candidate: SelectionCandidate) => {
    const clickEvent = pendingClickEventRef.current;
    const isMultiSelect = clickEvent?.shiftKey ?? false;
    confirmFeatureSelectionInternal(candidate, isMultiSelect);
    setSelectionCandidates([]);
    setPendingClickEvent(null);
  }, [confirmFeatureSelectionInternal]);

  // Cancel layer selection dialog
  const handleCandidateCancel = useCallback(() => {
    setSelectionCandidates([]);
    setPendingClickEvent(null);
  }, []);

  const deleteFeaturesMutation = useMutation({
    mutationFn: async (data: { featureIds: number[] }) => {
      const res = await apiRequest("POST", "/api/features/batch-delete", { ids: data.featureIds });
      return res.json();
    },
    onMutate: (data) => {
      const idSet = new Set(data.featureIds);
      // 1. Remove from viewport cache
      featureCacheRef.current.forEach((f, key) => {
        if (idSet.has(f.id)) featureCacheRef.current.delete(key);
      });
      // 2. Remove from rendered map state (covers both viewport and attribute table sources)
      setAllLayerFeatures(prev => {
        const next = { ...prev };
        for (const layerId of Object.keys(next)) {
          next[Number(layerId)] = next[Number(layerId)].filter(f => !idSet.has(f.id));
        }
        return next;
      });
      // 3. Clear map selection glow for deleted features
      setSelectedMapFeatures(prev =>
        prev.filter(({ feature }) => {
          const fid = feature.get("featureId") as number | undefined;
          return fid === undefined || !idSet.has(fid);
        })
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      setFeatureVersion(v => v + 1);
      const count = variables.featureIds.length;
      toast({
        title: count === 1 ? "Объект удалён" : `Удалено объектов: ${count}`,
      });
    },
    onError: () => {
      toast({
        title: "Ошибка удаления",
        description: "Не удалось удалить выбранные объекты",
        variant: "destructive",
      });
    },
  });

  const [pointSamplingInfo, setPointSamplingInfo] = useState<{
    totalPoints: number;
    sampledPoints: number;
    isFullData: boolean;
  } | null>(null);

  const layerIdsKey = useMemo(() => 
    allEditableLayers.map(l => l.id).sort((a, b) => a - b).join(","),
    [allEditableLayers]
  );

  const featureCacheRef = useRef<Map<string, DrawnFeature>>(new Map());
  const lastFetchZoomRef = useRef<number | null>(null);
  const [allLayerFeatures, setAllLayerFeatures] = useState<Record<number, DrawnFeature[]>>({});
  const [isFetchingFeatures, setIsFetchingFeatures] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchKeyRef = useRef<string | null>(null);
  const fetchIdRef = useRef(0);
  const [featureVersion, setFeatureVersion] = useState(0);

  const buildResultFromCache = useCallback((layerIds: number[]) => {
    const result: Record<number, DrawnFeature[]> = {};
    for (const id of layerIds) result[id] = [];
    featureCacheRef.current.forEach(f => {
      if (result[f.layerId] && f.coordinates !== undefined) {
        result[f.layerId].push(f);
      }
    });
    return result;
  }, []);

  const evictCacheIfNeeded = useCallback(() => {
    const cache = featureCacheRef.current;
    if (cache.size <= MAX_CACHE_SIZE) return;
    const excess = cache.size - MAX_CACHE_SIZE;
    const keys = cache.keys();
    for (let i = 0; i < excess; i++) {
      const next = keys.next();
      if (next.done) break;
      cache.delete(next.value);
    }
  }, []);

  const cancelPrefetch = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      featureCacheRef.current.clear();
      lastFetchKeyRef.current = null;
      cancelPrefetch();
      editableLayerRef.current?.getSource()?.clear();
      setFeatureVersion(v => v + 1);
    };
    window.addEventListener("viewport-features-invalidate", handler);
    return () => window.removeEventListener("viewport-features-invalidate", handler);
  }, [cancelPrefetch]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { feature } = (e as CustomEvent<{ feature: DrawnFeature }>).detail;
      featureCacheRef.current.set(`${feature.layerId}_${feature.id}`, feature);
      setAllLayerFeatures(prev => {
        const layerFeatures = prev[feature.layerId] || [];
        if (layerFeatures.some(f => f.id === feature.id)) return prev;
        return { ...prev, [feature.layerId]: [...layerFeatures, feature] };
      });
    };
    window.addEventListener("feature-created", handler);
    return () => window.removeEventListener("feature-created", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { feature } = (e as CustomEvent<{ feature: DrawnFeature }>).detail;
      featureCacheRef.current.set(`${feature.layerId}_${feature.id}`, feature);
      setAllLayerFeatures(prev => {
        const layerFeatures = prev[feature.layerId] || [];
        if (layerFeatures.some(f => f.id === feature.id)) return prev;
        return { ...prev, [feature.layerId]: [...layerFeatures, feature] };
      });
    };
    window.addEventListener("feature-restored", handler);
    return () => window.removeEventListener("feature-restored", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { ids } = (e as CustomEvent<{ ids: number[] }>).detail;
      const idSet = new Set(ids);
      setSelectedMapFeatures(prev =>
        prev.filter(({ feature }) => {
          const fid = feature.get("featureId") as number | undefined;
          return fid === undefined || !idSet.has(fid);
        })
      );
      featureCacheRef.current.forEach((f, key) => {
        if (idSet.has(f.id)) featureCacheRef.current.delete(key);
      });
      setAllLayerFeatures(prev => {
        const next = { ...prev };
        for (const layerId of Object.keys(next)) {
          next[Number(layerId)] = next[Number(layerId)].filter(f => !idSet.has(f.id));
        }
        return next;
      });
    };
    window.addEventListener("features-batch-deleted", handler);
    return () => window.removeEventListener("features-batch-deleted", handler);
  }, []);

  useEffect(() => {
    if (!fetchViewport || allEditableLayers.length === 0) {
      setAllLayerFeatures({});
      return;
    }

    const currentZoom = Math.round(fetchViewport.zoom);
    const currentGroup = getSimplificationGroup(currentZoom);
    const prevZoom = lastFetchZoomRef.current;
    const prevGroup = prevZoom !== null ? getSimplificationGroup(prevZoom) : null;
    if (prevGroup !== null && currentGroup !== prevGroup) {
      featureCacheRef.current.clear();
    }
    lastFetchZoomRef.current = currentZoom;

    const vp = fetchViewport;
    const fetchKey = `${layerIdsKey}_${vp.minX.toFixed(VIEWPORT_PRECISION)}_${vp.minY.toFixed(VIEWPORT_PRECISION)}_${vp.maxX.toFixed(VIEWPORT_PRECISION)}_${vp.maxY.toFixed(VIEWPORT_PRECISION)}_${currentGroup}`;

    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;

    const layerIds = allEditableLayers.map(l => l.id);

    if (featureCacheRef.current.size > 0) {
      setAllLayerFeatures(buildResultFromCache(layerIds));
    }

    cancelPrefetch();

    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const currentFetchId = ++fetchIdRef.current;

    setIsFetchingFeatures(true);

    const params = new URLSearchParams({
      layerIds: layerIds.join(","),
      minX: vp.minX.toString(),
      minY: vp.minY.toString(),
      maxX: vp.maxX.toString(),
      maxY: vp.maxY.toString(),
      zoom: currentZoom.toString(),
    });

    fetch(`/api/editable-layers/viewport-batch?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (controller.signal.aborted || fetchIdRef.current !== currentFetchId) return;

        if (data.layers) {
          for (const [, layerData] of Object.entries(data.layers) as [string, any][]) {
            const features: DrawnFeature[] = layerData.features || [];
            for (const f of features) {
              featureCacheRef.current.set(`${f.layerId}_${f.id}`, f);
            }
          }
        }

        const staleKeys: string[] = [];
        featureCacheRef.current.forEach((f, key) => {
          if (!layerIds.includes(f.layerId)) {
            staleKeys.push(key);
          }
        });
        staleKeys.forEach(k => featureCacheRef.current.delete(k));
        evictCacheIfNeeded();

        setAllLayerFeatures(buildResultFromCache(layerIds));
        setIsFetchingFeatures(false);

        doPrefetch(vp, layerIds, currentZoom, currentFetchId);
      })
      .catch(err => {
        if (err.name === "AbortError") return;
        console.warn("Viewport fetch failed:", err);
        if (fetchIdRef.current === currentFetchId) {
          setAllLayerFeatures(buildResultFromCache(layerIds));
          setIsFetchingFeatures(false);
        }
      });

    return () => {
      controller.abort();
      cancelPrefetch();
    };
  }, [fetchViewport, layerIdsKey, allEditableLayers, featureVersion, buildResultFromCache, cancelPrefetch, evictCacheIfNeeded]);

  const doPrefetch = useCallback((vp: { minX: number; minY: number; maxX: number; maxY: number }, layerIds: number[], zoom: number, originFetchId: number) => {
    cancelPrefetch();

    const prefetchController = new AbortController();
    prefetchAbortRef.current = prefetchController;

    const width = vp.maxX - vp.minX;
    const height = vp.maxY - vp.minY;
    const pfX = width * PREFETCH_BUFFER_RATIO;
    const pfY = height * PREFETCH_BUFFER_RATIO;

    const prefetchParams = new URLSearchParams({
      layerIds: layerIds.join(","),
      minX: (vp.minX - pfX).toString(),
      minY: (vp.minY - pfY).toString(),
      maxX: (vp.maxX + pfX).toString(),
      maxY: (vp.maxY + pfY).toString(),
      zoom: zoom.toString(),
    });

    prefetchTimerRef.current = setTimeout(() => {
      if (prefetchController.signal.aborted || fetchIdRef.current !== originFetchId) return;
      
      fetch(`/api/editable-layers/viewport-batch?${prefetchParams.toString()}`, {
        credentials: "include",
        signal: prefetchController.signal,
      })
        .then(res => {
          if (!res.ok) return;
          return res.json();
        })
        .then(data => {
          if (!data || prefetchController.signal.aborted || fetchIdRef.current !== originFetchId) return;
          if (data.layers) {
            for (const [, layerData] of Object.entries(data.layers) as [string, any][]) {
              const features: DrawnFeature[] = layerData.features || [];
              for (const f of features) {
                featureCacheRef.current.set(`${f.layerId}_${f.id}`, f);
              }
            }
          }
          evictCacheIfNeeded();
          if (fetchIdRef.current === originFetchId) {
            setAllLayerFeatures(buildResultFromCache(layerIds));
          }
        })
        .catch(() => {});
    }, 500);
  }, [buildResultFromCache, cancelPrefetch, evictCacheIfNeeded]);
  

  useEffect(() => {
    activeFiltersRef.current = activeFilters;
  }, [activeFilters]);

  useEffect(() => {
    ticketModeRef.current = ticketMode;
  }, [ticketMode]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    layersStateRef.current = layers;
  }, [layers]);

  useEffect(() => {
    const osmLayer = layersRef.current["osm-base"];
    const yandexMapLayer = layersRef.current["yandex-map"];
    const yandexSatelliteLayer = layersRef.current["yandex-satellite"];

    if (osmLayer) {
      osmLayer.setVisible(activeBaseLayer === "osm");
    }
    if (yandexMapLayer) {
      yandexMapLayer.setVisible(activeBaseLayer === "yandex-map");
    }
    if (yandexSatelliteLayer) {
      yandexSatelliteLayer.setVisible(activeBaseLayer === "yandex-satellite");
    }
  }, [activeBaseLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    
    if (currentProjectionRef.current === currentProjection) return;
    
    const oldProjection = currentProjectionRef.current;
    const oldView = map.getView();
    const currentCenter = oldView.getCenter();
    const currentZoom = oldView.getZoom() || DEFAULT_ZOOM;
    
    let centerLonLat: [number, number] = DEFAULT_CENTER;
    if (currentCenter) {
      const lonLat = toLonLat(currentCenter, oldProjection);
      centerLonLat = [lonLat[0], lonLat[1]];
    }
    
    currentProjectionRef.current = currentProjection;
    
    const newView = new View({
      projection: currentProjection,
      center: fromLonLat(centerLonLat, currentProjection),
      zoom: currentZoom,
    });
    
    map.setView(newView);
    
    const reprojectFeatures = (features: Feature<Geometry>[]) => {
      features.forEach((feature) => {
        const geom = feature.getGeometry();
        if (geom) {
          geom.transform(oldProjection, currentProjection);
        }
      });
    };
    
    const reprojectedSources = new Set<VectorSource>();
    
    allEditableLayersRef.current.forEach((layer) => {
      const source = layer.getSource();
      if (!source || reprojectedSources.has(source)) return;
      reprojectedSources.add(source);
      reprojectFeatures(source.getFeatures());
    });
    
    sceneDatasetLayersRef.current.forEach((layer) => {
      const source = layer.getSource();
      if (!source || reprojectedSources.has(source)) return;
      reprojectedSources.add(source);
      reprojectFeatures(source.getFeatures());
    });
    
    Object.entries(layersRef.current).forEach(([id, layer]) => {
      if (id === "osm-base" || id === "yandex-map" || id === "yandex-satellite") return;
      if (layer instanceof VectorLayer) {
        const source = (layer as VectorLayer<VectorSource>).getSource();
        if (!source || reprojectedSources.has(source)) return;
        reprojectedSources.add(source);
        reprojectFeatures(source.getFeatures());
      }
    });
    
    if (ticketsLayerRef.current) {
      const source = ticketsLayerRef.current.getSource();
      if (source && !reprojectedSources.has(source)) {
        reprojectedSources.add(source);
        reprojectFeatures(source.getFeatures());
      }
    }
    
    if (editableLayerRef.current) {
      const source = editableLayerRef.current.getSource();
      if (source && !reprojectedSources.has(source)) {
        reprojectedSources.add(source);
        reprojectFeatures(source.getFeatures());
      }
    }
    
    if (selectionGlowLayerRef.current) {
      const source = selectionGlowLayerRef.current.getSource();
      if (source && !reprojectedSources.has(source)) {
        reprojectedSources.add(source);
        reprojectFeatures(source.getFeatures());
      }
    }
    
    bufferedExtentRef.current = null;
    
    setTimeout(() => {
      const extent = map.getView().calculateExtent(map.getSize());
      const extentWGS84 = transformExtent(extent, currentProjection, "EPSG:4326");
      const zoom = Math.round(map.getView().getZoom() || DEFAULT_ZOOM);
      const width = extentWGS84[2] - extentWGS84[0];
      const height = extentWGS84[3] - extentWGS84[1];
      const bufferX = width * VIEWPORT_BUFFER_RATIO;
      const bufferY = height * VIEWPORT_BUFFER_RATIO;
      bufferedExtentRef.current = {
        minX: extentWGS84[0] - bufferX,
        minY: extentWGS84[1] - bufferY,
        maxX: extentWGS84[2] + bufferX,
        maxY: extentWGS84[3] + bufferY,
        zoom,
      };
      setFetchViewport(bufferedExtentRef.current);
    }, 100);
    
  }, [currentProjection]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    registerProjections();

    const osmLayer = new TileLayer({
      source: new OSM(),
      properties: { id: "osm-base" },
      visible: activeBaseLayer === "osm",
      zIndex: 0,
    });

    const yandexMapLayer = new TileLayer({
      source: new XYZ({
        url: YANDEX_MAP_URL,
        crossOrigin: "anonymous",
        projection: "EPSG:3395",
        tileGrid: YANDEX_TILE_GRID,
      }),
      properties: { id: "yandex-map" },
      visible: activeBaseLayer === "yandex-map",
      zIndex: 0,
    });

    const yandexSatelliteLayer = new TileLayer({
      source: new XYZ({
        url: YANDEX_SATELLITE_URL,
        crossOrigin: "anonymous",
        projection: "EPSG:3395",
        tileGrid: YANDEX_TILE_GRID,
      }),
      properties: { id: "yandex-satellite" },
      visible: activeBaseLayer === "yandex-satellite",
      zIndex: 0,
    });

    const viewProjection = currentProjection;
    currentProjectionRef.current = currentProjection;

    const map = new OLMap({
      target: mapContainerRef.current,
      layers: [osmLayer, yandexMapLayer, yandexSatelliteLayer],
      view: new View({
        projection: viewProjection,
        center: fromLonLat(DEFAULT_CENTER, viewProjection),
        zoom: DEFAULT_ZOOM,
      }),
      controls: defaultControls({ zoom: false, rotate: false }).extend([
        new ScaleLine({ units: "metric" }),
      ]),
    });

    layersRef.current["osm-base"] = osmLayer;
    layersRef.current["yandex-map"] = yandexMapLayer;
    layersRef.current["yandex-satellite"] = yandexSatelliteLayer;

    const ticketsSource = new VectorSource();
    const ticketsLayer = new VectorLayer({
      source: ticketsSource,
      properties: { id: "tickets-layer" },
      zIndex: 1000,
    });
    map.addLayer(ticketsLayer);
    ticketsLayerRef.current = ticketsLayer;

    // Editable features layer for drawing
    const editableSource = new VectorSource();
    const editableLayer = new VectorLayer({
      source: editableSource,
      properties: { id: "editable-layer" },
      zIndex: 1500,
      style: new Style({
        fill: new Fill({ color: "rgba(59, 130, 246, 0.3)" }),
        stroke: new Stroke({ color: "#3B82F6", width: 2 }),
        image: new Circle({
          radius: 7,
          fill: new Fill({ color: "#3B82F6" }),
          stroke: new Stroke({ color: "#fff", width: 2 }),
        }),
      }),
    });
    map.addLayer(editableLayer);
    editableLayerRef.current = editableLayer;

    // Selection glow layer - renders pulsating effect over selected features
    const selectionGlowSource = new VectorSource();
    const selectionGlowLayer = new VectorLayer({
      source: selectionGlowSource,
      properties: { id: "selection-glow-layer" },
      zIndex: 2000,
    });
    map.addLayer(selectionGlowLayer);
    selectionGlowLayerRef.current = selectionGlowLayer;

    const dragBox = new DragBox({
      condition: platformModifierKeyOnly,
    });
    
    dragBox.on("boxend", () => {
      if (!selectionModeRef.current) return;
      
      const extent = dragBox.getGeometry().getExtent();
      const newSelectedFeatures: Array<{ layerId: number; featureIndex: number; feature: Feature<Geometry> }> = [];
      
      // A2: Only search in the active editable layer
      const activeLayerIdForBox = activeEditableLayerRef.current?.id;
      if (activeLayerIdForBox !== undefined) {
        const activeOLLayer = allEditableLayersRef.current.get(activeLayerIdForBox);
        if (activeOLLayer && activeOLLayer.getVisible()) {
          const source = activeOLLayer.getSource();
          if (source) {
            const features = source.getFeatures();
            features.forEach((feature, index) => {
              const geom = feature.getGeometry();
              if (geom && geom.intersectsExtent(extent)) {
                newSelectedFeatures.push({ layerId: activeLayerIdForBox, featureIndex: index, feature: feature as Feature<Geometry> });
              }
            });
          }
        }
      }
      
      setSelectedMapFeatures(prev => [...prev, ...newSelectedFeatures]);

      // Sync drawing.selectedFeatureIds so the attribute table sees all box-selected features
      const boxSelectedIds = newSelectedFeatures
        .map(({ feature }) => feature.get("featureId") as number | undefined)
        .filter((id): id is number => id !== undefined);
      if (boxSelectedIds.length > 0 && onMultiSelectFeaturesRef.current) {
        onMultiSelectFeaturesRef.current(boxSelectedIds);
      }
    });
    
    map.addInteraction(dragBox);
    dragBoxRef.current = dragBox;

    map.on("pointermove", (evt) => {
      const coords = toLonLat(evt.coordinate, currentProjectionRef.current);
      setMouseCoordinates([coords[0], coords[1]]);
    });

    map.getView().on("change:resolution", () => {
      const currentZoom = map.getView().getZoom() || DEFAULT_ZOOM;
      setZoom(currentZoom);
      
      // Update point styles when zoom level changes by 1 or more (integer steps)
      const roundedZoom = Math.round(currentZoom);
      const lastRoundedZoom = Math.round(lastStyleZoomRef.current);
      
      if (roundedZoom !== lastRoundedZoom) {
        lastStyleZoomRef.current = currentZoom;
        
        allEditableLayersRef.current.forEach((layer) => {
          const editableLayerId = layer.get("editableLayerId");
          const layerData = allEditableLayersDataRef.current?.find(l => l.id === editableLayerId);
          if (layerData) {
            const iconIds = collectCustomIconIds(layerData.styleConfig as StyleConfig | undefined);
            const cachedMap = iconIds.length > 0 ? buildIconMapFromCache(iconIds) : undefined;
            layer.setStyle(createEditableLayerStyleFunction(layerData, roundedZoom, cachedMap) as any);
            layer.set("lastZoom", roundedZoom);
          }
        });
        
        // Update scene dataset layer styles
        sceneDatasetLayersRef.current.forEach((layer) => {
          const color = layer.get("color") || "#1976D2";
          const pointStyle = layer.get("pointStyle") || "circle";
          const style = new Style({
            fill: new Fill({ color: color + "33" }),
            stroke: new Stroke({ color, width: 2 }),
            image: createPointImageStyle(color, pointStyle as PointStyle, roundedZoom),
          });
          layer.setStyle(style);
          layer.set("lastZoom", roundedZoom);
        });
      }
    });

    map.getView().on("change:rotation", () => {
      setRotation(map.getView().getRotation());
    });

    const updateViewport = () => {
      const size = map.getSize();
      if (!size) return;
      const extent = map.getView().calculateExtent(size);
      const extentWGS84 = transformExtent(extent, currentProjectionRef.current, "EPSG:4326");
      const currentZoom = Math.round(map.getView().getZoom() || DEFAULT_ZOOM);
      
      const currentExtent = {
        minX: extentWGS84[0],
        minY: extentWGS84[1],
        maxX: extentWGS84[2],
        maxY: extentWGS84[3],
        zoom: currentZoom,
      };
      
      const buffered = bufferedExtentRef.current;
      
      const needsRefetch = !buffered ||
        buffered.zoom !== currentZoom ||
        currentExtent.minX < buffered.minX ||
        currentExtent.minY < buffered.minY ||
        currentExtent.maxX > buffered.maxX ||
        currentExtent.maxY > buffered.maxY;
      
      if (needsRefetch) {
        const width = currentExtent.maxX - currentExtent.minX;
        const height = currentExtent.maxY - currentExtent.minY;
        const bufferX = width * VIEWPORT_BUFFER_RATIO;
        const bufferY = height * VIEWPORT_BUFFER_RATIO;
        
        const newBufferedExtent = {
          minX: currentExtent.minX - bufferX,
          minY: currentExtent.minY - bufferY,
          maxX: currentExtent.maxX + bufferX,
          maxY: currentExtent.maxY + bufferY,
          zoom: currentZoom,
        };
        
        bufferedExtentRef.current = newBufferedExtent;
        setFetchViewport(newBufferedExtent);
      }
    };

    map.on("moveend", () => {
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
      }
      viewportDebounceRef.current = setTimeout(() => {
        updateViewport();
      }, VIEWPORT_DEBOUNCE_MS);
    });

    setTimeout(() => updateViewport(), 100);

    map.on("singleclick", async (evt) => {
      const currentConnection = connectionRef.current;
      const currentLayers = layersStateRef.current;
      const isTicketMode = ticketModeRef.current;
      const currentSelectionMode = selectionModeRef.current;
      const currentEditMode = editModeRef.current;

      const coords = toLonLat(evt.coordinate, currentProjectionRef.current);
      setFeatureCoordinates([coords[0], coords[1]]);

      // Editable feature selection works in both view mode and edit mode
      if (currentSelectionMode) {
        // Collect ALL candidates from all editable layers (don't stop on first match)
        const candidates: SelectionCandidate[] = [];
        const seenFeatures = new Set<string>(); // Prevent duplicates

        map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
          const editableLayerId = layer?.get("editableLayerId");
          if (editableLayerId !== undefined) {
            const vectorLayer = allEditableLayersRef.current.get(editableLayerId);
            if (vectorLayer) {
              const source = vectorLayer.getSource();
              if (source) {
                const features = source.getFeatures();
                const idx = features.indexOf(feature as Feature);
                if (idx !== -1) {
                  const key = `${editableLayerId}-${idx}`;
                  if (!seenFeatures.has(key)) {
                    seenFeatures.add(key);
                    const layerData = allEditableLayersDataRef.current?.find(l => l.id === editableLayerId);
                    const geom = (feature as Feature<Geometry>).getGeometry();
                    candidates.push({
                      layerId: editableLayerId,
                      layerName: layerData?.name || `Layer ${editableLayerId}`,
                      featureIndex: idx,
                      feature: feature as Feature<Geometry>,
                      geometryType: geom?.getType() || 'unknown',
                    });
                  }
                }
              }
            }
          }
          return false; // Continue iterating through all features
        }, { hitTolerance: 10 });

        // Sort candidates: Points > Lines > Polygons (smaller geometries first)
        const geometryPriority: Record<string, number> = {
          'Point': 1,
          'MultiPoint': 2,
          'LineString': 3,
          'MultiLineString': 4,
          'Polygon': 5,
          'MultiPolygon': 6,
        };
        candidates.sort((a, b) => 
          (geometryPriority[a.geometryType] || 99) - (geometryPriority[b.geometryType] || 99)
        );

        if (candidates.length > 0) {
          // Found editable features — select and stop here (don't fall through to WMS identify)
          if (candidates.length === 1) {
            // Single candidate - select directly (A1: Shift for multi-select)
            confirmFeatureSelectionRef.current(candidates[0], evt.originalEvent.shiftKey);
          } else {
            // Multiple candidates from different layers - check if they're from the same layer
            const uniqueLayerIds = new Set(candidates.map(c => c.layerId));
            if (uniqueLayerIds.size === 1) {
              // All from same layer - select the first (topmost by geometry priority)
              confirmFeatureSelectionRef.current(candidates[0], evt.originalEvent.shiftKey);
            } else {
              // Multiple layers - show selection dialog
              setSelectionCandidates(candidates);
              setPendingClickEvent({ shiftKey: evt.originalEvent.shiftKey });
            }
          }
          return;
        }
        // A3: Click on empty space does NOT clear selection.
        // Selection is cleared only via Escape key or the "×" button in the toolbar.
        // Fall through to WMS identify below.
      }

      if (isTicketMode && currentConnection?.useZws) {
        handleTicketCreation(coords[0], coords[1], evt.coordinate);
        return;
      }
      
      if (!currentConnection) return;

      if (currentConnection.useZws) {
        let foundFeature: Feature | null = null;
        let foundLayerId: string | null = null;

        map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
          if (!foundFeature && layer && layer !== ticketsLayerRef.current) {
            foundFeature = feature as Feature;
            foundLayerId = layer.get("id") as string;
          }
          return true;
        });

        if (foundFeature && foundLayerId) {
          const layerConfig = currentLayers.find((l) => l.id === foundLayerId);
          const dbFeatureId = (foundFeature as Feature).get("featureId");
          
          if (dbFeatureId) {
            const isDataset = !!(foundFeature as Feature).get("datasetId");
            const sourceParam = isDataset ? "?source=dataset" : "";
            setSelectedFeature({
              id: String(dbFeatureId),
              layerName: layerConfig?.name || foundLayerId || "Объект",
              properties: { _loading: true },
              geometry: undefined,
            });
            fetch(`/api/features/${dbFeatureId}${sourceParam}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (data && data.properties) {
                  setSelectedFeature(prev => prev && prev.id === String(dbFeatureId) ? {
                    ...prev,
                    properties: data.properties,
                  } : prev);
                } else {
                  setSelectedFeature(prev => prev && prev.id === String(dbFeatureId) ? {
                    ...prev,
                    properties: {},
                  } : prev);
                }
              })
              .catch(err => {
                console.error("Failed to load feature properties:", err);
                setSelectedFeature(prev => prev && prev.id === String(dbFeatureId) ? {
                  ...prev,
                  properties: {},
                } : prev);
              });
          } else {
            const properties: Record<string, unknown> = {};
            const keys = (foundFeature as Feature).getKeys();
            keys.forEach((key) => {
              if (key !== "geometry") {
                properties[key] = (foundFeature as Feature).get(key);
              }
            });
            const featureId = (foundFeature as Feature).getId?.() || 
              (foundFeature as Feature).get("id") || 
              `feature-${Date.now()}`;
            setSelectedFeature({
              id: String(featureId),
              layerName: layerConfig?.name || foundLayerId || "Объект",
              properties,
              geometry: undefined,
            });
          }
        } else {
          setSelectedFeature(null);
          setFeatureCoordinates(undefined);
        }
        return;
      }

      const viewResolution = map.getView().getResolution();
      if (!viewResolution) return;

      const wmsLayers = currentLayers.filter((l) => l.type === "wms" && l.visible);
      if (wmsLayers.length === 0) return;

      try {
        setIsLoading(true);
        const response = await fetch("/api/zulu/feature-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connection: currentConnection,
            coordinate: evt.coordinate,
            resolution: viewResolution,
            projection: map.getView().getProjection().getCode(),
            layers: wmsLayers.map((l) => l.id),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.features && data.features.length > 0) {
            setSelectedFeature({
              id: data.features[0].id || "unknown",
              layerName: data.features[0].layerName || wmsLayers[0].name,
              properties: data.features[0].properties || {},
              geometry: data.features[0].geometry,
            });
          }
        }
      } catch (err) {
        console.error("Failed to get feature info:", err);
      } finally {
        setIsLoading(false);
      }
    });

    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !currentSceneId) return;
    const map = mapRef.current;

    fetch(`/api/scenes/${currentSceneId}/extent`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: { extent: [number, number, number, number] | null; featureCount: number }) => {
        if (data.extent && data.featureCount > 0) {
          const [minX, minY, maxX, maxY] = data.extent;
          const proj = map.getView().getProjection();
          const bottomLeft = fromLonLat([minX, minY], proj);
          const topRight = fromLonLat([maxX, maxY], proj);
          const extent = [bottomLeft[0], bottomLeft[1], topRight[0], topRight[1]] as [number, number, number, number];
          map.getView().fit(extent, {
            padding: [50, 50, 50, 50],
            maxZoom: 18,
            duration: 500,
          });
        } else {
          const proj = map.getView().getProjection();
          map.getView().animate({
            center: fromLonLat(DEFAULT_CENTER, proj),
            zoom: DEFAULT_ZOOM,
            duration: 500,
          });
        }
      })
      .catch(() => {});
  }, [currentSceneId]);

  // Manage uploaded shapefile layers
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    // Don't process layers while features are still loading
    if (isFetchingFeatures && Object.keys(allLayerFeatures).length === 0) {
      return;
    }
    
    const currentLayerIds = new Set(allEditableLayers.map(l => l.id));
    
    // Remove layers that no longer exist
    allEditableLayersRef.current.forEach((layer, id) => {
      if (!currentLayerIds.has(id)) {
        map.removeLayer(layer);
        allEditableLayersRef.current.delete(id);
      }
    });
    
    // Add or update layers
    allEditableLayers.forEach((editableLayerItem) => {
      let vectorLayer = allEditableLayersRef.current.get(editableLayerItem.id);
      
      const geojsonFormat = new GeoJSON();
      const layerFeatures = allLayerFeatures[editableLayerItem.id] || [];
      
      const geojsonData = {
        type: "FeatureCollection" as const,
        features: layerFeatures.map(f => ({
          type: "Feature" as const,
          geometry: {
            type: f.geometryType,
            coordinates: f.coordinates,
          },
          properties: {
            featureId: f.id,
            ...f.properties,
          },
        })),
      };
      
      if (!vectorLayer) {
        const vectorSource = new VectorSource();
        
        try {
          if (geojsonData.features.length > 0) {
            const features = geojsonFormat.readFeatures(geojsonData, {
              dataProjection: "EPSG:4326",
              featureProjection: currentProjectionRef.current,
            });
            
            vectorSource.addFeatures(features);
          }
        } catch (e) {
          console.error("Failed to parse layer GeoJSON:", e);
        }
        
        // Server-side point sampling is used instead of client-side clustering
        // Points are filtered on the server based on zoom level for better performance
        const currentZoom = fetchViewport?.zoom || 10;
        const styleConfigStr = editableLayerItem.styleConfig ? JSON.stringify(editableLayerItem.styleConfig) : "";
        const styleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}|${styleConfigStr}|${currentZoom}`;

        const iconIds = collectCustomIconIds(editableLayerItem.styleConfig as StyleConfig | undefined);
        const cachedIconMap = iconIds.length > 0 ? buildIconMapFromCache(iconIds) : undefined;

        vectorLayer = new VectorLayer({
          source: vectorSource,
          style: createEditableLayerStyleFunction(editableLayerItem, currentZoom, cachedIconMap) as any,
          updateWhileAnimating: true,
          updateWhileInteracting: true,
          properties: { 
            editableLayerId: editableLayerItem.id, 
            featureCount: layerFeatures.length,
            originalSource: vectorSource,
            styleKey,
            lastZoom: currentZoom,
          },
        });
        
        const sortedByOrder = [...allEditableLayers].sort((a, b) => a.displayOrder - b.displayOrder);
        const layerRank = sortedByOrder.findIndex(l => l.id === editableLayerItem.id);
        const layerZIndex = getLayerZIndex(layerRank >= 0 ? layerRank : 0, allEditableLayers.length, layerFeatures);
        vectorLayer.setZIndex(layerZIndex);
        
        map.addLayer(vectorLayer);
        allEditableLayersRef.current.set(editableLayerItem.id, vectorLayer);

        if (iconIds.length > 0 && !allIconsCached(iconIds)) {
          const layerRef = vectorLayer;
          const layerStyleKey = styleKey;
          loadCustomIconSvgs(iconIds).then(iconMap => {
            if (layerRef.get("styleKey") === layerStyleKey) {
              layerRef.setStyle(createEditableLayerStyleFunction(editableLayerItem, currentZoom, iconMap) as any);
            }
          });
        }
      } else {
        const hasDataForLayer = allLayerFeatures[editableLayerItem.id] !== undefined;
        if (hasDataForLayer) {
          const sourceToUpdate = vectorLayer.getSource() as VectorSource;
          if (sourceToUpdate) {
            try {
              const newFeatureIds = new Set(layerFeatures.map(f => f.id));
              const existingFeatures = sourceToUpdate.getFeatures();
              const existingIds = new Set<number>();

              const featurePropsMap = new Map<number, Record<string, any>>();
              for (const f of layerFeatures) {
                if (f.properties) featurePropsMap.set(f.id, f.properties);
              }

              for (const olFeature of existingFeatures) {
                const fId = olFeature.get("featureId") as number;
                if (fId !== undefined && !newFeatureIds.has(fId)) {
                  sourceToUpdate.removeFeature(olFeature);
                } else if (fId !== undefined) {
                  existingIds.add(fId);
                  const newProps = featurePropsMap.get(fId);
                  if (newProps) {
                    for (const [key, value] of Object.entries(newProps)) {
                      olFeature.set(key, value, true);
                    }
                  }
                }
              }

              const toAdd = layerFeatures.filter(f => !existingIds.has(f.id));
              if (toAdd.length > 0) {
                const addGeoJson = {
                  type: "FeatureCollection" as const,
                  features: toAdd.map(f => ({
                    type: "Feature" as const,
                    geometry: { type: f.geometryType, coordinates: f.coordinates },
                    properties: { featureId: f.id, ...f.properties },
                  })),
                };
                const newOlFeatures = geojsonFormat.readFeatures(addGeoJson, {
                  dataProjection: "EPSG:4326",
                  featureProjection: currentProjectionRef.current,
                });
                sourceToUpdate.addFeatures(newOlFeatures);
              }
              vectorLayer.set("featureCount", layerFeatures.length);
            } catch (e) {
              console.error("Failed to incrementally update layer features:", e);
            }
          }
        }
      }
      
      vectorLayer.setVisible(editableLayerItem.visible);
      vectorLayer.setOpacity(editableLayerItem.opacity);
      const sortedForRank = [...allEditableLayers].sort((a, b) => a.displayOrder - b.displayOrder);
      const updatedRank = sortedForRank.findIndex(l => l.id === editableLayerItem.id);
      const updatedZIndex = getLayerZIndex(updatedRank >= 0 ? updatedRank : 0, allEditableLayers.length, layerFeatures);
      vectorLayer.setZIndex(updatedZIndex);
      
      // Only update style when style properties actually changed
      // Use a style key to detect changes without storing duplicate values
      const currentStyleConfigStr = editableLayerItem.styleConfig ? JSON.stringify(editableLayerItem.styleConfig) : "";
      const currentStyleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}|${currentStyleConfigStr}`;
      const storedStyleKey = vectorLayer.get("styleKey");
      
      // Skip style sync for the specific layer being auto-selected from object click
      // This preserves user-defined styles during edit mode operations
      if (skipStyleSyncForLayerRef.current === editableLayerItem.id) {
        skipStyleSyncForLayerRef.current = null;
        return; // Skip style update for this layer only
      }
      
      // Check if zoom changed significantly (by 1 or more) for point size updates
      const storedZoom = vectorLayer.get("lastZoom") || 10;
      const zoomChanged = Math.abs(storedZoom - (fetchViewport?.zoom || 10)) >= 1;
      
      if (storedStyleKey !== currentStyleKey || zoomChanged) {
        const newZoom = fetchViewport?.zoom || 10;
        const newStyleConfigStr = editableLayerItem.styleConfig ? JSON.stringify(editableLayerItem.styleConfig) : "";
        const newFullStyleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}|${newStyleConfigStr}|${newZoom}`;
        const iconIds = collectCustomIconIds(editableLayerItem.styleConfig as StyleConfig | undefined);
        const cachedMap = iconIds.length > 0 ? buildIconMapFromCache(iconIds) : undefined;
        vectorLayer.setStyle(createEditableLayerStyleFunction(editableLayerItem, newZoom, cachedMap) as any);
        vectorLayer.set("styleKey", newFullStyleKey);
        vectorLayer.set("lastZoom", newZoom);

        if (iconIds.length > 0 && !allIconsCached(iconIds)) {
          const layerRef = vectorLayer;
          loadCustomIconSvgs(iconIds).then(iconMap => {
            if (layerRef.get("styleKey") === newFullStyleKey) {
              layerRef.setStyle(createEditableLayerStyleFunction(editableLayerItem, newZoom, iconMap) as any);
            }
          });
        }
      }
    });
  }, [allEditableLayers, allLayerFeatures, isFetchingFeatures, fetchViewport]);

  // Render scene datasets with viewport-based loading
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fetchViewport) return;

    const geojsonFormat = new GeoJSON();

    // Remove layers for datasets that are no longer in sceneDatasets
    const currentDatasetIds = new Set(sceneDatasets.map(sd => sd.id));
    sceneDatasetLayersRef.current.forEach((layer, id) => {
      if (!currentDatasetIds.has(id)) {
        map.removeLayer(layer);
        sceneDatasetLayersRef.current.delete(id);
      }
    });

    // Add or update layers for each visible scene dataset with viewport-based loading
    sceneDatasets.forEach(async (sd) => {
      let vectorLayer = sceneDatasetLayersRef.current.get(sd.id);
      
      // Build viewport URL params
      const params = new URLSearchParams({
        minX: fetchViewport.minX.toString(),
        minY: fetchViewport.minY.toString(),
        maxX: fetchViewport.maxX.toString(),
        maxY: fetchViewport.maxY.toString(),
        zoom: fetchViewport.zoom.toString(),
      });

      if (!vectorLayer) {
        // Fetch features for this dataset with viewport filtering
        try {
          const res = await fetch(`/api/datasets/${sd.datasetId}/features/viewport?${params.toString()}`);
          if (!res.ok) {
            console.warn(`Failed to fetch features for dataset ${sd.datasetId}`);
            return;
          }
          const data = await res.json();
          // Handle new response format with features array and limit info
          const features: DatasetFeatureData[] = data.features && Array.isArray(data.features) 
            ? data.features 
            : (Array.isArray(data) ? data : []);

          // Convert to GeoJSON FeatureCollection
          const geojsonData = {
            type: "FeatureCollection" as const,
            features: features.map((f) => ({
              type: "Feature" as const,
              geometry: {
                type: f.geometryType,
                coordinates: f.coordinates,
              },
              properties: {
                featureId: f.id,
                datasetId: f.datasetId,
              },
            })),
          };

          const vectorSource = new VectorSource();
          
          try {
            const olFeatures = geojsonFormat.readFeatures(geojsonData, {
              dataProjection: "EPSG:4326",
              featureProjection: currentProjectionRef.current,
            });
            vectorSource.addFeatures(olFeatures);
          } catch (e) {
            console.warn("Failed to parse GeoJSON for dataset:", sd.datasetId, e);
          }

          const createZoomAdaptiveStyleFn = (layerColor: string, layerPointStyle: PointStyle, currentZoom: number) => {
            const baseStyle = new Style({
              fill: new Fill({ color: layerColor + "33" }),
              stroke: new Stroke({ color: layerColor, width: 2 }),
              image: createPointImageStyle(layerColor, layerPointStyle, currentZoom),
            });
            const lineStyle = new Style({
              stroke: new Stroke({ color: layerColor, width: 2 }),
              image: createPointImageStyle(layerColor, layerPointStyle, currentZoom),
            });
            return (feature: Feature) => isLineGeometry(feature) ? lineStyle : baseStyle;
          };

          vectorLayer = new VectorLayer({
            source: vectorSource,
            style: createZoomAdaptiveStyleFn(sd.color, sd.pointStyle as PointStyle, fetchViewport.zoom) as any,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            opacity: sd.opacity,
            visible: !!sd.isVisible,
            properties: { 
              sceneDatasetId: sd.id,
              datasetId: sd.datasetId,
              color: sd.color,
              pointStyle: sd.pointStyle,
              lastViewportKey: `${fetchViewport.minX.toFixed(VIEWPORT_PRECISION)},${fetchViewport.minY.toFixed(VIEWPORT_PRECISION)},${fetchViewport.maxX.toFixed(VIEWPORT_PRECISION)},${fetchViewport.maxY.toFixed(VIEWPORT_PRECISION)},${fetchViewport.zoom}`,
              lastZoom: fetchViewport.zoom,
            },
            zIndex: sd.zIndex + 100,
          });

          map.addLayer(vectorLayer);
          sceneDatasetLayersRef.current.set(sd.id, vectorLayer);
        } catch (e) {
          console.error("Error loading scene dataset:", e);
        }
      } else {
        // Update existing layer visibility, opacity, and style
        vectorLayer.setVisible(!!sd.isVisible);
        vectorLayer.setOpacity(sd.opacity);
        
        const storedColor = vectorLayer.get("color");
        const storedZoom = vectorLayer.get("lastZoom") || 10;
        const zoomChanged = Math.abs(storedZoom - fetchViewport.zoom) >= 1;
        
        if (storedColor !== sd.color || zoomChanged) {
          const baseStyle = new Style({
            fill: new Fill({ color: sd.color + "33" }),
            stroke: new Stroke({ color: sd.color, width: 2 }),
            image: createPointImageStyle(sd.color, sd.pointStyle as PointStyle, fetchViewport.zoom),
          });
          const lineOnlyStyle = new Style({
            stroke: new Stroke({ color: sd.color, width: 2 }),
            image: createPointImageStyle(sd.color, sd.pointStyle as PointStyle, fetchViewport.zoom),
          });
          vectorLayer.setStyle(((feature: Feature) => isLineGeometry(feature) ? lineOnlyStyle : baseStyle) as any);
          vectorLayer.set("color", sd.color);
          vectorLayer.set("lastZoom", fetchViewport.zoom);
        }
        
        // Check if viewport changed significantly and refresh features (use same precision as main viewportKey)
        const currentViewportKey = `${fetchViewport.minX.toFixed(VIEWPORT_PRECISION)},${fetchViewport.minY.toFixed(VIEWPORT_PRECISION)},${fetchViewport.maxX.toFixed(VIEWPORT_PRECISION)},${fetchViewport.maxY.toFixed(VIEWPORT_PRECISION)},${fetchViewport.zoom}`;
        const lastViewportKey = vectorLayer.get("lastViewportKey");
        
        if (lastViewportKey !== currentViewportKey && sd.isVisible) {
          // Refetch features for new viewport
          try {
            const res = await fetch(`/api/datasets/${sd.datasetId}/features/viewport?${params.toString()}`);
            if (res.ok) {
              const data = await res.json();
              // Handle new response format with features array and limit info
              const features: DatasetFeatureData[] = data.features && Array.isArray(data.features) 
                ? data.features 
                : (Array.isArray(data) ? data : []);
              
              const geojsonData = {
                type: "FeatureCollection" as const,
                features: features.map((f) => ({
                  type: "Feature" as const,
                  geometry: {
                    type: f.geometryType,
                    coordinates: f.coordinates,
                  },
                  properties: {
                    featureId: f.id,
                    datasetId: f.datasetId,
                  },
                })),
              };
              
              const source = vectorLayer.getSource();
              if (source) {
                source.clear();
                const olFeatures = geojsonFormat.readFeatures(geojsonData, {
                  dataProjection: "EPSG:4326",
                  featureProjection: currentProjectionRef.current,
                });
                source.addFeatures(olFeatures);
                vectorLayer.set("lastViewportKey", currentViewportKey);
              }
            }
          } catch (e) {
            console.warn("Failed to refresh dataset features:", e);
          }
        }
      }
    });
  }, [sceneDatasets, fetchViewport]);

  // Selection animation loop - optimized to avoid React re-renders
  // Updates glow layer directly via refs instead of state
  useEffect(() => {
    if (selectedMapFeatures.length === 0) {
      // No selection - stop animation and clear glow layer
      if (selectionAnimRef.current) {
        cancelAnimationFrame(selectionAnimRef.current);
        selectionAnimRef.current = null;
      }
      if (selectionGlowLayerRef.current) {
        const source = selectionGlowLayerRef.current.getSource();
        if (source) source.clear();
      }
      selectionGlowFeaturesRef.current = [];
      return;
    }

    // Prepare glow features (clone once, update style each frame)
    // Store layerId on cloned features to look up live style info during animation
    const glowFeatures: Feature<Geometry>[] = [];
    selectedMapFeatures.forEach(({ feature, layerId }) => {
      const clonedFeature = feature.clone();
      // Store layerId for live lookup during animation (not cached style values)
      clonedFeature.set("_sourceLayerId", layerId);
      glowFeatures.push(clonedFeature);
    });
    selectionGlowFeaturesRef.current = glowFeatures;

    // Add features to glow layer
    if (selectionGlowLayerRef.current) {
      const source = selectionGlowLayerRef.current.getSource();
      if (source) {
        source.clear();
        glowFeatures.forEach(f => source.addFeature(f));
      }
    }

    // Start animation loop - updates styles directly without React re-renders
    let startTime: number | null = null;
    const animationDuration = 1500; // 1.5 seconds per cycle

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const phase = (elapsed % animationDuration) / animationDuration;
      
      // Update styles directly on features (no React state)
      // Look up live layer style info from allEditableLayersDataRef for each frame
      // This ensures glow always matches current layer style even after edits
      selectionGlowFeaturesRef.current.forEach(f => {
        const geom = f.getGeometry();
        const geometryType = geom?.getType() || 'Polygon';
        const sourceLayerId = f.get("_sourceLayerId");
        
        // Look up current style from live data ref
        const layerInfo = allEditableLayersDataRef.current?.find(l => l.id === sourceLayerId);
        const layerColor = layerInfo?.color || "#1976D2";
        const pointStyle = (layerInfo?.pointStyle || "circle") as PointStyle;
        
        f.setStyle(createSelectionGlowStyle(phase, geometryType, layerColor, pointStyle));
      });
      
      selectionAnimRef.current = requestAnimationFrame(animate);
    };

    selectionAnimRef.current = requestAnimationFrame(animate);

    return () => {
      if (selectionAnimRef.current) {
        cancelAnimationFrame(selectionAnimRef.current);
        selectionAnimRef.current = null;
      }
    };
    // Using allEditableLayersDataRef for live lookup, so no need for allEditableLayers dependency
  }, [selectedMapFeatures]);

  useEffect(() => {
    if (!onSelectedFeaturesChange) return;
    
    const featureData: SelectedFeatureData[] = selectedMapFeatures.map(({ layerId, featureIndex, feature }) => {
      const layer = allEditableLayers.find(l => l.id === layerId);
      return {
        layerId,
        layerName: layer?.name || `Layer ${layerId}`,
        featureIndex,
        properties: feature.getProperties() || {},
      };
    });
    
    onSelectedFeaturesChange(featureData);
  }, [selectedMapFeatures, allEditableLayers, onSelectedFeaturesChange]);

  const handleDeleteSelectedFeatures = useCallback(() => {
    if (selectedMapFeatures.length === 0) return;
    const featureIds: number[] = [];
    selectedMapFeatures.forEach(({ feature }) => {
      const realId = feature.get("featureId") as number | undefined;
      if (realId) featureIds.push(realId);
    });
    if (featureIds.length === 0) return;
    deleteFeaturesMutation.mutate({ featureIds });
  }, [selectedMapFeatures, deleteFeaturesMutation]);

  const clearSelection = useCallback(() => {
    setSelectedMapFeatures([]);
  }, []);

  // Unified deletion by feature IDs — works regardless of how features were selected.
  // Optimistic update (cache + glow) and API call are handled inside deleteFeaturesMutation.
  const deleteFeatures = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    deleteFeaturesMutation.mutate({ featureIds: ids });
  }, [deleteFeaturesMutation]);

  // Expose selection actions via ref for external control
  useEffect(() => {
    if (selectionActionsRef) {
      selectionActionsRef.current = {
        clearSelection,
        deleteSelected: handleDeleteSelectedFeatures,
        deleteFeatures,
      };
    }
    return () => {
      if (selectionActionsRef) {
        selectionActionsRef.current = null;
      }
    };
  }, [selectionActionsRef, clearSelection, handleDeleteSelectedFeatures, deleteFeatures]);

  // Expose drawing actions via ref for external control (undo last point during drawing)
  useEffect(() => {
    if (drawActionsRef) {
      drawActionsRef.current = {
        removeLastPoint: () => {
          const draw = drawInteractionRef.current;
          if (!draw) {
            return false;
          }
          
          // Check if there's a sketch feature being drawn
          // The draw interaction exposes the internal sketch via private property
          // We need to check if we're actively drawing with at least one point
          try {
            // Get sketch coordinates to check if there are points
            const sketchFeature = (draw as any).sketchFeature_;
            if (!sketchFeature) {
              return false;
            }
            
            const geom = sketchFeature.getGeometry();
            if (!geom) {
              return false;
            }
            
            // For LineString/Polygon, check coordinate count
            let coordCount = 0;
            if (geom.getType() === 'LineString') {
              coordCount = (geom as any).getCoordinates().length;
            } else if (geom.getType() === 'Polygon') {
              const coords = (geom as any).getCoordinates();
              coordCount = coords[0]?.length || 0;
            }
            
            // Need at least 2 coordinates (current mouse + at least 1 placed point)
            if (coordCount >= 2) {
              draw.removeLastPoint();
              return true;
            }
            
            return false;
          } catch (e) {
            console.error("[DRAW UNDO] Error:", e);
            return false;
          }
        },
        abortDrawing: () => {
          if (drawInteractionRef.current) {
            drawInteractionRef.current.abortDrawing();
          }
        },
      };
    }
    return () => {
      if (drawActionsRef) {
        drawActionsRef.current = null;
      }
    };
  }, [drawActionsRef]);

  useEffect(() => {
    if (mapActionsRef) {
      mapActionsRef.current = {
        zoomToFeature: (feature: DrawnFeature) => {
          const map = mapRef.current;
          if (!map) return;

          const geojsonFormat = new GeoJSON();
          const geojsonObj = {
            type: "Feature" as const,
            geometry: {
              type: feature.geometryType,
              coordinates: feature.coordinates,
            },
            properties: {},
          };

          try {
            const olFeature = geojsonFormat.readFeature(geojsonObj, {
              dataProjection: "EPSG:4326",
              featureProjection: map.getView().getProjection(),
            });
            const geom = olFeature.getGeometry();
            if (!geom) return;

            const extent = geom.getExtent();
            if (feature.geometryType === "Point") {
              map.getView().animate({
                center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2],
                zoom: 18,
                duration: 500,
              });
            } else {
              map.getView().fit(extent, {
                padding: [80, 80, 80, 80],
                maxZoom: 19,
                duration: 500,
              });
            }
          } catch (e) {
            console.error("[ZOOM TO FEATURE] Error:", e);
          }
        },
        zoomToCoordinates: (lat: number, lon: number, zoom?: number) => {
          const map = mapRef.current;
          if (!map) return;
          const center = fromLonLat([lon, lat], map.getView().getProjection());
          map.getView().animate({
            center,
            zoom: zoom ?? 16,
            duration: 500,
          });
        },
        panToFeatureIfOutsideViewport: (feature: DrawnFeature) => {
          const map = mapRef.current;
          if (!map) return;
          const geojsonFormat = new GeoJSON();
          const geojsonObj = {
            type: "Feature" as const,
            geometry: { type: feature.geometryType, coordinates: feature.coordinates },
            properties: {},
          };
          try {
            const olFeature = geojsonFormat.readFeature(geojsonObj, {
              dataProjection: "EPSG:4326",
              featureProjection: map.getView().getProjection(),
            });
            const geom = olFeature.getGeometry();
            if (!geom) return;
            const extent = geom.getExtent();
            const featureCenter = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
            const viewExtent = map.getView().calculateExtent(map.getSize());
            const isInView =
              featureCenter[0] >= viewExtent[0] && featureCenter[0] <= viewExtent[2] &&
              featureCenter[1] >= viewExtent[1] && featureCenter[1] <= viewExtent[3];
            if (!isInView) {
              map.getView().animate({ center: featureCenter, duration: 400 });
            }
          } catch (e) {
            console.error("[PAN TO FEATURE] Error:", e);
          }
        },
      };
    }
    return () => {
      if (mapActionsRef) {
        mapActionsRef.current = null;
      }
    };
  }, [mapActionsRef]);

  // Handle OSM base layer visibility and opacity (works without connection)
  useEffect(() => {
    if (!mapRef.current) return;
    
    const osmLayerConfig = layers.find(l => l.id === "osm-base" && l.type === "base");
    const osmLayer = layersRef.current["osm-base"];
    
    if (osmLayerConfig && osmLayer) {
      osmLayer.setVisible(osmLayerConfig.visible);
      osmLayer.setOpacity(osmLayerConfig.opacity);
    }
  }, [layers]);

  // Manage drawing interactions
  useEffect(() => {
    if (!mapRef.current || !editableLayerRef.current) return;
    const map = mapRef.current;
    const editableSource = editableLayerRef.current.getSource();
    if (!editableSource) return;

    // Clean up previous interactions
    if (drawInteractionRef.current) {
      map.removeInteraction(drawInteractionRef.current);
      drawInteractionRef.current = null;
    }
    if (snapInteractionRef.current) {
      map.removeInteraction(snapInteractionRef.current);
      snapInteractionRef.current = null;
    }
    // Clean up additional snaps
    additionalSnapsRef.current.forEach((snap) => {
      map.removeInteraction(snap);
    });
    additionalSnapsRef.current = [];

    // Only show editable layer when actively drawing (not during selection or modify)
    // This layer has hardcoded blue style and should not overlay user-styled layers
    const isActivelyDrawing = editMode && (drawingMode === "point" || drawingMode === "line" || drawingMode === "polygon");
    editableLayerRef.current.setVisible(isActivelyDrawing);

    if (!editMode) return;

    // Handle drawing modes FIRST (snap must be added AFTER draw interaction)
    if (drawingMode === "point" || drawingMode === "line" || drawingMode === "polygon") {
      const olDrawType = drawingMode === "point" ? "Point" : drawingMode === "line" ? "LineString" : "Polygon";
      
      const draw = new Draw({
        source: editableSource,
        type: olDrawType,
      });

      draw.on("drawend", (evt: DrawEvent) => {
        const feature = evt.feature;
        const geom = feature.getGeometry();
        if (!geom) return;

        // Convert geometry to coordinates
        const format = new GeoJSON();
        const geoJsonGeom = JSON.parse(format.writeGeometry(geom, {
          featureProjection: currentProjectionRef.current,
          dataProjection: "EPSG:4326",
        }));

        // Get geometry type as our schema type
        let geoType: GeometryType = "Point";
        if (drawingMode === "line") geoType = "LineString";
        else if (drawingMode === "polygon") geoType = "Polygon";

        // Call the callback to create the feature in the database
        // The feature stays in editableSource until viewport-features-invalidate fires
        // (which happens in createFeatureMutation.onSuccess) to avoid any visual gap
        if (onFeatureCreatedRef.current && activeEditableLayerRef.current) {
          onFeatureCreatedRef.current(geoType, geoJsonGeom.coordinates, {});
        }
      });

      map.addInteraction(draw);
      drawInteractionRef.current = draw;
    }
    // Note: "modify" mode is handled in a separate useEffect with editableLayerModifyRef
    // that works with the actual layer from allEditableLayersRef

    // Add snap interaction AFTER draw interaction (important for OpenLayers!)
    // Snapping should work for: drawing (point/line/polygon), modify, and select modes
    if (snapSettings?.enabled && drawingMode) {
      // Collect sources from all visible editable layers, respecting snapLayerIds filter
      const snapSources: VectorSource[] = [];
      const useAllLayers = !snapSettings.snapLayerIds || snapSettings.snapLayerIds.length === 0;
      
      // Add sources from all editable layers (from allEditableLayersRef)
      allEditableLayersRef.current.forEach((layerRef, layerId) => {
        const layer = layerRef as VectorLayer<VectorSource>;
        const source = layer.getSource();
        const featureCount = source?.getFeatures().length || 0;
        const isVisible = layer.getVisible();
        
        if (source && isVisible) {
          if (useAllLayers || snapSettings.snapLayerIds.includes(layerId)) {
            snapSources.push(source);
          }
        }
      });
      
      // Add sources from scene datasets
      sceneDatasetLayersRef.current.forEach((layer, datasetId) => {
        const source = layer.getSource();
        const featureCount = source?.getFeatures().length || 0;
        const isVisible = layer.getVisible();
        
        if (source && isVisible) {
          if (useAllLayers || snapSettings.snapLayerIds.includes(datasetId)) {
            snapSources.push(source);
          }
        }
      });
      
      // Create snap interactions for all collected sources
      const allSnaps: Snap[] = [];
      snapSources.forEach((source, idx) => {
        const snap = new Snap({
          source,
          pixelTolerance: snapSettings.snapRadius,
          vertex: snapSettings.snapToVertices,
          edge: snapSettings.snapToEdges,
        });
        map.addInteraction(snap);
        allSnaps.push(snap);
      });
      
      // Store first snap in primary ref, rest in additional
      if (allSnaps.length > 0) {
        snapInteractionRef.current = allSnaps[0];
        additionalSnapsRef.current = allSnaps.slice(1);
      }
    }

    return () => {
      if (drawInteractionRef.current) {
        map.removeInteraction(drawInteractionRef.current);
        drawInteractionRef.current = null;
      }
      if (snapInteractionRef.current) {
        map.removeInteraction(snapInteractionRef.current);
        snapInteractionRef.current = null;
      }
      // Clean up additional snaps on unmount
      additionalSnapsRef.current.forEach((snap) => {
        map.removeInteraction(snap);
      });
      additionalSnapsRef.current = [];
    };
  }, [editMode, drawingMode, snapSettings?.enabled, snapSettings?.snapRadius, snapSettings?.snapToVertices, snapSettings?.snapToEdges, snapSettings?.snapLayerIds, visibleLayersKey]);


  // Scene dataset modify interaction
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing scene dataset modify interaction
    if (sceneDatasetModifyRef.current) {
      map.removeInteraction(sceneDatasetModifyRef.current);
      sceneDatasetModifyRef.current = null;
    }

    // If there's an active scene dataset and edit mode is on, add modify interaction
    if (activeSceneDataset && editMode) {
      const layer = sceneDatasetLayersRef.current.get(activeSceneDataset.id);
      if (layer) {
        const source = layer.getSource();
        if (source) {
          const modify = new Modify({ source });

          modify.on("modifyend", (evt: ModifyEvent) => {
            const features = evt.features.getArray();
            const currentDataset = activeSceneDatasetRef.current;
            if (!currentDataset) return;

            features.forEach((feature) => {
              const featureId = feature.get("featureId");
              if (featureId && onDatasetFeatureUpdatedRef.current) {
                const geom = feature.getGeometry();
                if (geom) {
                  const format = new GeoJSON();
                  const geoJsonGeom = JSON.parse(format.writeGeometry(geom, {
                    featureProjection: currentProjectionRef.current,
                    dataProjection: "EPSG:4326",
                  }));
                  onDatasetFeatureUpdatedRef.current(currentDataset.datasetId, featureId, {
                    type: geoJsonGeom.type,
                    coordinates: geoJsonGeom.coordinates,
                  });
                  
                  // Update selection glow feature geometry to follow the modified feature
                  const glowFeatures = selectionGlowFeaturesRef.current;
                  const matchingGlow = glowFeatures.find(gf => gf.get("featureId") === featureId);
                  if (matchingGlow) {
                    matchingGlow.setGeometry(geom.clone());
                  }
                }
              }
            });
          });

          map.addInteraction(modify);
          sceneDatasetModifyRef.current = modify;
        }
      }
    }

    return () => {
      if (sceneDatasetModifyRef.current) {
        map.removeInteraction(sceneDatasetModifyRef.current);
        sceneDatasetModifyRef.current = null;
      }
    };
  }, [activeSceneDataset, editMode]);

  // Editable layer modify interaction - handles object movement for user-created layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing editable layer modify interaction
    if (editableLayerModifyRef.current) {
      map.removeInteraction(editableLayerModifyRef.current);
      editableLayerModifyRef.current = null;
    }

    // Only add modify interaction when in edit mode with "modify" drawing mode and an active layer
    if (activeEditableLayer && editMode && drawingMode === "modify") {
      const layer = allEditableLayersRef.current.get(activeEditableLayer.id);
      if (layer) {
        const source = layer.getSource();
        
        if (source) {
          const modify = new Modify({ source });

          modify.on("modifyend", (evt: ModifyEvent) => {
            const features = evt.features.getArray();
            features.forEach((feature) => {
              const featureId = feature.get("featureId");
              if (featureId && onFeatureUpdatedRef.current) {
                const geom = feature.getGeometry();
                if (geom) {
                  const format = new GeoJSON();
                  const geoJsonGeom = JSON.parse(format.writeGeometry(geom, {
                    featureProjection: currentProjectionRef.current,
                    dataProjection: "EPSG:4326",
                  }));
                  onFeatureUpdatedRef.current(featureId, { coordinates: geoJsonGeom.coordinates });
                  
                  // Update selection glow feature geometry to follow the modified feature
                  // Glow features are clones that need their geometry synced
                  const glowFeatures = selectionGlowFeaturesRef.current;
                  const matchingGlow = glowFeatures.find(gf => gf.get("featureId") === featureId);
                  if (matchingGlow) {
                    matchingGlow.setGeometry(geom.clone());
                  }
                }
              }
            });
          });

          map.addInteraction(modify);
          editableLayerModifyRef.current = modify;
        }
      }
    }

    return () => {
      if (editableLayerModifyRef.current) {
        map.removeInteraction(editableLayerModifyRef.current);
        editableLayerModifyRef.current = null;
      }
    };
  }, [activeEditableLayer, editMode, drawingMode]);

  useEffect(() => {
    if (!mapRef.current || !connection) return;

    const map = mapRef.current;

    layers.forEach((layerConfig) => {
      const existingLayer = layersRef.current[layerConfig.id];

      // Skip base layer - handled in separate effect above
      if (layerConfig.type === "base") {
        return;
      }

      if (layerConfig.type === "wms") {
        if (!existingLayer) {
          let newLayer: LayerType;

          if (connection.useZws) {
            const vectorSource = new VectorSource();
            
            newLayer = new VectorLayer({
              source: vectorSource,
              style: getLayerStyle(layerConfig.id),
              properties: { id: layerConfig.id },
              visible: layerConfig.visible,
              opacity: layerConfig.opacity,
            });
            
            map.addLayer(newLayer);
            layersRef.current[layerConfig.id] = newLayer;
            
            if (layerConfig.visible) {
              fetch("/api/zulu/zws/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ layer: layerConfig.id }),
              })
                .then((res) => {
                  if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: Ошибка загрузки слоя`);
                  }
                  return res.json();
                })
                .then((data) => {
                  if (data.message && !data.raw) {
                    throw new Error(data.message);
                  }
                  if (data.raw) {
                    const features = parseZwsResponse(data.raw, currentProjectionRef.current);
                    
                    allFeaturesRef.current[layerConfig.id] = features;
                    
                    const rsoValues = new Set<string>();
                    const munizValues = new Set<string>();
                    
                    features.forEach((f) => {
                      const rso = f.get("name_rso");
                      const muniz = f.get("muniz_obr");
                      if (rso) rsoValues.add(String(rso));
                      if (muniz) munizValues.add(String(muniz));
                    });
                    
                    if (onFiltersDiscovered && (rsoValues.size > 0 || munizValues.size > 0)) {
                      onFiltersDiscovered(layerConfig.id, {
                        name_rso: rsoValues,
                        muniz_obr: munizValues,
                      });
                    }
                    
                    vectorSource.addFeatures(features);
                    
                    if (features.length > 0) {
                      const extent = vectorSource.getExtent();
                      map.getView().fit(extent, { padding: [50, 50, 50, 50], maxZoom: 14 });
                    }
                    
                    if (onLayerLoadSuccess) {
                      onLayerLoadSuccess();
                    }
                  }
                })
                .catch((err) => {
                  console.error("Failed to load layer:", err);
                  if (onLayerLoadError) {
                    onLayerLoadError(err.message || "Не удалось загрузить данные слоя");
                  }
                });
            }
          } else {
            const wmsUrl = `/api/zulu/wms?host=${connection.host}&port=${connection.port}`;

            newLayer = new ImageLayer({
              source: new ImageWMS({
                url: wmsUrl,
                params: {
                  LAYERS: layerConfig.id,
                  FORMAT: "image/png",
                  TRANSPARENT: true,
                },
                ratio: 1,
                serverType: "geoserver",
              }),
              properties: { id: layerConfig.id },
              visible: layerConfig.visible,
              opacity: layerConfig.opacity,
            });
            
            map.addLayer(newLayer);
            layersRef.current[layerConfig.id] = newLayer;
          }
        } else {
          existingLayer.setVisible(layerConfig.visible);
          existingLayer.setOpacity(layerConfig.opacity);
        }
      }
    });

    const currentLayerIds = new Set(layers.map((l) => l.id));
    Object.entries(layersRef.current).forEach(([id, layer]) => {
      if (!currentLayerIds.has(id) && id !== "osm-base") {
        map.removeLayer(layer);
        delete layersRef.current[id];
      }
    });
  }, [layers, connection, onFiltersDiscovered]);

  useEffect(() => {
    if (!ticketsLayerRef.current || !tickets) return;
    
    const source = ticketsLayerRef.current.getSource();
    if (!source) return;
    
    source.clear();
    
    tickets.forEach((ticket) => {
      const ticketFeature = new Feature({
        geometry: new OlPoint(fromLonLat([ticket.lon, ticket.lat], currentProjectionRef.current)),
        ticketId: ticket.id,
        status: ticket.status,
        nameIst: ticket.nameIst,
      });
      ticketFeature.setStyle(getTicketStyle(ticket.status));
      source.addFeature(ticketFeature);
    });
  }, [tickets]);

  useEffect(() => {
    if (!activeFilters || !mapRef.current) return;

    Object.entries(activeFilters).forEach(([layerId, filters]) => {
      const layer = layersRef.current[layerId];
      const allFeatures = allFeaturesRef.current[layerId];
      
      if (!layer || !allFeatures || !(layer instanceof VectorLayer)) return;
      
      const vectorSource = layer.getSource();
      if (!vectorSource) return;

      const filteredFeatures = allFeatures.filter((feature) => {
        const rso = feature.get("name_rso") || "";
        const muniz = feature.get("muniz_obr") || "";
        
        const rsoMatch = filters.name_rso.includes(String(rso));
        const munizMatch = filters.muniz_obr.includes(String(muniz));
        
        return rsoMatch && munizMatch;
      });

      vectorSource.clear();
      vectorSource.addFeatures(filteredFeatures);
    });
  }, [activeFilters]);

  const handleZoomIn = useCallback(() => {
    if (!mapRef.current) return;
    const view = mapRef.current.getView();
    view.animate({ zoom: (view.getZoom() || DEFAULT_ZOOM) + 1, duration: 250 });
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!mapRef.current) return;
    const view = mapRef.current.getView();
    view.animate({ zoom: (view.getZoom() || DEFAULT_ZOOM) - 1, duration: 250 });
  }, []);

  const handleResetRotation = useCallback(() => {
    if (!mapRef.current) return;
    mapRef.current.getView().animate({ rotation: 0, duration: 250 });
  }, []);

  const handleResetView = useCallback(() => {
    if (!mapRef.current) return;
    mapRef.current.getView().animate({
      center: fromLonLat(DEFAULT_CENTER, currentProjectionRef.current),
      zoom: DEFAULT_ZOOM,
      rotation: 0,
      duration: 500,
    });
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!mapContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      mapContainerRef.current.requestFullscreen();
    }
  }, []);

  const handleForceReload = useCallback(async () => {
    setIsReloading(true);
    try {
      await fetch("/api/editable-layers/clear-viewport-cache", { method: "POST" });
    } catch {
    }
    window.dispatchEvent(new CustomEvent("viewport-features-invalidate"));
    setTimeout(() => setIsReloading(false), 1500);
  }, []);

  const handleCloseFeatureInfo = useCallback(() => {
    setSelectedFeature(null);
    setFeatureCoordinates(undefined);
  }, []);

  const findNearestPolygon = useCallback((clickCoord: number[], maxDistanceMeters: number = 10) => {
    let nearestFeature: Feature | null = null;
    let nearestLayerId: string | null = null;
    let minDistance = Infinity;
    let nearestNameIst: string | null = null;

    Object.entries(allFeaturesRef.current).forEach(([layerId, features]) => {
      features.forEach((feature) => {
        const geom = feature.getGeometry();
        if (!geom) return;

        const clickPoint = toLonLat(clickCoord, currentProjectionRef.current);
        
        if (geom instanceof OlPolygon || geom instanceof OlMultiPolygon) {
          const closestPoint = geom.getClosestPoint(clickCoord);
          const closestPointLonLat = toLonLat(closestPoint, currentProjectionRef.current);
          const distance = getDistance(clickPoint, closestPointLonLat);
          
          if (distance < minDistance && distance <= maxDistanceMeters) {
            minDistance = distance;
            nearestFeature = feature;
            nearestLayerId = layerId;
            nearestNameIst = feature.get("name_ist") || null;
          }
        }
      });
    });

    return { nearestFeature, nearestLayerId, nearestNameIst, distance: minDistance };
  }, []);

  const handleTicketCreation = useCallback(async (lon: number, lat: number, mapCoord: number[]) => {
    const { nearestNameIst, nearestLayerId, distance } = findNearestPolygon(mapCoord, 10);
    
    const ticketData: InsertTicket = {
      lon,
      lat,
      boundLayerId: nearestLayerId || undefined,
      nameIst: nearestNameIst || undefined,
      notes: undefined,
    };

    try {
      const newTicket = await onCreateTicket(ticketData);
      
      if (nearestNameIst) {
        toast({
          title: "Метка создана",
          description: `Привязана к полигону: ${nearestNameIst} (${distance.toFixed(1)}м)`,
        });
      } else {
        toast({
          title: "Метка создана",
          description: "Полигон в радиусе 10м не найден",
          variant: "destructive",
        });
      }
      
      if (ticketsLayerRef.current) {
        const ticketFeature = new Feature({
          geometry: new OlPoint(fromLonLat([lon, lat], currentProjectionRef.current)),
          ticketId: newTicket.id,
          status: newTicket.status,
        });
        ticketFeature.setStyle(getTicketStyle(newTicket.status));
        ticketsLayerRef.current.getSource()?.addFeature(ticketFeature);
      }
    } catch (err) {
      toast({
        title: "Ошибка",
        description: "Не удалось создать метку",
        variant: "destructive",
      });
    }
  }, [findNearestPolygon, onCreateTicket, toast]);

  // Effect for trace route visualization
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing route layer
    if (traceRouteLayerRef.current) {
      map.removeLayer(traceRouteLayerRef.current);
      traceRouteLayerRef.current = null;
    }

    // Add new route if coordinates exist
    if (traceRouteCoordinates && traceRouteCoordinates.length >= 2) {
      const routeSource = new VectorSource();
      
      // Create line feature
      const lineCoords = traceRouteCoordinates.map(coord => fromLonLat(coord, currentProjectionRef.current));
      const lineFeature = new Feature({
        geometry: new LineString(lineCoords),
      });
      
      // Style: dashed blue line
      lineFeature.setStyle(new Style({
        stroke: new Stroke({
          color: "#2563eb",
          width: 4,
          lineDash: [10, 10],
        }),
      }));
      routeSource.addFeature(lineFeature);
      
      // Add start point marker
      const startFeature = new Feature({
        geometry: new OlPoint(lineCoords[0]),
      });
      startFeature.setStyle(new Style({
        image: new Circle({
          radius: 8,
          fill: new Fill({ color: "#22c55e" }),
          stroke: new Stroke({ color: "#fff", width: 2 }),
        }),
      }));
      routeSource.addFeature(startFeature);
      
      // Add end point marker
      const endFeature = new Feature({
        geometry: new OlPoint(lineCoords[lineCoords.length - 1]),
      });
      endFeature.setStyle(new Style({
        image: new Circle({
          radius: 8,
          fill: new Fill({ color: "#ef4444" }),
          stroke: new Stroke({ color: "#fff", width: 2 }),
        }),
      }));
      routeSource.addFeature(endFeature);
      
      const routeLayer = new VectorLayer({
        source: routeSource,
        zIndex: 9999,
      });
      
      map.addLayer(routeLayer);
      traceRouteLayerRef.current = routeLayer;
      
      // Fit map to route extent
      const extent = routeSource.getExtent();
      map.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 500 });
    }
  }, [traceRouteCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (reconstructionLayerRef.current) {
      map.removeLayer(reconstructionLayerRef.current);
      reconstructionLayerRef.current = null;
    }

    if (reconstructionHighlight && reconstructionHighlight.length > 0) {
      const reconSource = new VectorSource();

      for (const issue of reconstructionHighlight) {
        if (!issue.coordinates || !Array.isArray(issue.coordinates)) continue;

        let lineCoords: any[];
        if (Array.isArray(issue.coordinates[0]) && typeof issue.coordinates[0][0] === "number") {
          lineCoords = issue.coordinates.map((c: [number, number]) => fromLonLat(c, currentProjectionRef.current));
        } else if (typeof issue.coordinates[0] === "number") {
          continue;
        } else {
          continue;
        }

        if (lineCoords.length < 2) continue;

        const lineFeature = new Feature({
          geometry: new LineString(lineCoords),
          name: issue.name,
        });
        lineFeature.setStyle([
          new Style({
            stroke: new Stroke({
              color: "rgba(239, 68, 68, 0.3)",
              width: 12,
            }),
          }),
          new Style({
            stroke: new Stroke({
              color: "#ef4444",
              width: 5,
              lineDash: [12, 8],
            }),
          }),
        ]);
        reconSource.addFeature(lineFeature);
      }

      if (reconSource.getFeatures().length > 0) {
        const reconLayer = new VectorLayer({
          source: reconSource,
          zIndex: 9998,
        });
        map.addLayer(reconLayer);
        reconstructionLayerRef.current = reconLayer;
      }
    }
  }, [reconstructionHighlight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (simulationHighlightLayerRef.current) {
      map.removeLayer(simulationHighlightLayerRef.current);
      simulationHighlightLayerRef.current = null;
    }

    if (simulationHighlightData) {
      const highlightSource = new VectorSource();

      for (const seg of simulationHighlightData.segments) {
        const coords = seg.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const lineCoords = coords.map((c: [number, number]) => fromLonLat(c, currentProjectionRef.current));
          const lineFeature = new Feature({
            geometry: new LineString(lineCoords),
          });
          lineFeature.setStyle(new Style({
            stroke: new Stroke({
              color: "rgba(239, 68, 68, 0.8)",
              width: 5,
            }),
          }));
          highlightSource.addFeature(lineFeature);
        }
      }

      for (const pt of simulationHighlightData.points) {
        const coords = pt.coordinates;
        if (coords) {
          const pointCoords = Array.isArray(coords[0])
            ? fromLonLat(coords[0], currentProjectionRef.current)
            : fromLonLat(coords as [number, number], currentProjectionRef.current);
          const pointFeature = new Feature({
            geometry: new OlPoint(pointCoords),
          });
          const color = pt.type === "consumer" ? "rgba(239, 68, 68, 0.9)" :
                        pt.type === "ctp" ? "rgba(249, 115, 22, 0.9)" :
                        "rgba(234, 179, 8, 0.9)";
          pointFeature.setStyle(new Style({
            image: new Circle({
              radius: 7,
              fill: new Fill({ color }),
              stroke: new Stroke({ color: "#fff", width: 2 }),
            }),
          }));
          highlightSource.addFeature(pointFeature);
        }
      }

      if (simulationHighlightData.polygons) {
        for (const poly of simulationHighlightData.polygons) {
          if (Array.isArray(poly.coordinates) && poly.coordinates.length >= 3) {
            const ring = poly.coordinates.map((c: number[]) => fromLonLat([c[0], c[1]], currentProjectionRef.current));
            const polyFeature = new Feature({
              geometry: new OlPolygon([ring]),
            });
            polyFeature.setStyle(new Style({
              fill: new Fill({ color: "rgba(249, 115, 22, 0.2)" }),
              stroke: new Stroke({
                color: "rgba(249, 115, 22, 0.8)",
                width: 2,
                lineDash: [6, 4],
              }),
            }));
            highlightSource.addFeature(polyFeature);
          }
        }
      }

      if (simulationHighlightData.failurePoint) {
        const fp = simulationHighlightData.failurePoint;
        const coords = fp.coordinates;
        if (coords) {
          let pointCoords;
          if (fp.type === "segment" && Array.isArray(coords) && Array.isArray(coords[0])) {
            const midIdx = Math.floor(coords.length / 2);
            pointCoords = fromLonLat(coords[midIdx], currentProjectionRef.current);
          } else if (Array.isArray(coords) && !Array.isArray(coords[0])) {
            pointCoords = fromLonLat(coords as [number, number], currentProjectionRef.current);
          } else if (Array.isArray(coords) && Array.isArray(coords[0])) {
            pointCoords = fromLonLat(coords[0] as [number, number], currentProjectionRef.current);
          }
          if (pointCoords) {
            const failFeature = new Feature({
              geometry: new OlPoint(pointCoords),
            });
            failFeature.setStyle(new Style({
              image: new Circle({
                radius: 12,
                fill: new Fill({ color: "rgba(220, 38, 38, 0.9)" }),
                stroke: new Stroke({ color: "#fff", width: 3 }),
              }),
            }));
            highlightSource.addFeature(failFeature);
          }
        }
      }

      if (highlightSource.getFeatures().length > 0) {
        const highlightLayer = new VectorLayer({
          source: highlightSource,
          zIndex: 9998,
        });
        map.addLayer(highlightLayer);
        simulationHighlightLayerRef.current = highlightLayer;

        const extent = highlightSource.getExtent();
        map.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 500 });
      }
    }
  }, [simulationHighlightData]);

  return (
    <div className="relative flex-1 h-full" data-testid="map-container">
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        data-testid="map-viewer"
      />

      <MapControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetRotation={handleResetRotation}
        onResetView={handleResetView}
        onFullscreen={handleFullscreen}
        rotation={rotation}
        ticketMode={ticketMode}
        onToggleTicketMode={isConnected ? onToggleTicketMode : undefined}
        measureActive={measureActive}
        onToggleMeasure={() => setMeasureActive((prev) => !prev)}
        onForceReload={handleForceReload}
        isReloading={isReloading}
      />

      <CoordinateDisplay 
        coordinates={mouseCoordinates} 
        zoom={zoom} 
        snapEnabled={editMode && snapSettings?.enabled}
        pointSampling={pointSamplingInfo}
      />

      <FeatureInfoPanel
        feature={selectedFeature}
        onClose={handleCloseFeatureInfo}
        coordinates={featureCoordinates}
      />

      <LoadingOverlay isLoading={isLoading} message="Получение информации..." />

      <MeasureTool
        map={mapRef.current}
        active={measureActive}
        onClose={() => setMeasureActive(false)}
      />

      {/* Layer Selection Dialog for overlapping features */}
      {selectionCandidates.length > 0 && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCandidateCancel();
          }}
          data-testid="layer-selection-overlay"
        >
          <div 
            className="bg-background border rounded-md shadow-lg p-4 min-w-[280px] max-w-[400px]"
            data-testid="layer-selection-dialog"
          >
            <h3 className="text-sm font-medium mb-3">Выберите объект для выделения</h3>
            <p className="text-xs text-muted-foreground mb-3">
              В этой точке найдено несколько объектов из разных слоёв
            </p>
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {selectionCandidates.map((candidate, index) => (
                <button
                  key={`${candidate.layerId}-${candidate.featureIndex}`}
                  onClick={() => handleCandidateSelect(candidate)}
                  className="w-full text-left px-3 py-2 rounded-md hover-elevate flex items-center justify-between gap-2 text-sm"
                  data-testid={`layer-selection-option-${index}`}
                >
                  <span className="font-medium truncate">{candidate.layerName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {candidate.geometryType === 'Point' && 'Точка'}
                    {candidate.geometryType === 'LineString' && 'Линия'}
                    {candidate.geometryType === 'Polygon' && 'Полигон'}
                    {candidate.geometryType === 'MultiPoint' && 'Мультиточка'}
                    {candidate.geometryType === 'MultiLineString' && 'Мультилиния'}
                    {candidate.geometryType === 'MultiPolygon' && 'Мультиполигон'}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t">
              <button
                onClick={handleCandidateCancel}
                className="w-full text-center px-3 py-2 rounded-md text-sm text-muted-foreground hover-elevate"
                data-testid="layer-selection-cancel"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
