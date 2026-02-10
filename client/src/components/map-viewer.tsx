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

import type { LayerConfig, FeatureInfo, ZuluConnection, Ticket, InsertTicket, PointStyle, LineStyle, EditableLayer, DrawnFeature, GeometryType, InsertDrawnFeature, Dataset } from "@shared/schema";
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
  editableFeatures?: DrawnFeature[];
  onFeatureCreated?: (geometryType: GeometryType, coordinates: unknown, properties?: Record<string, unknown>) => void;
  onFeatureUpdated?: (featureId: number, updates: Partial<InsertDrawnFeature>) => void;
  selectedEditableFeatureIds?: number[];
  onEditableFeatureSelect?: (featureId: number, multi?: boolean) => void;
  onClearEditableSelection?: () => void;
  onSelectEditableLayer?: (layer: EditableLayer) => void;
  // Selection callbacks exposed for external control
  selectionActionsRef?: React.MutableRefObject<{ clearSelection: () => void; deleteSelected: () => void } | null>;
  // Drawing actions exposed for external control (undo last point during drawing)
  drawActionsRef?: React.MutableRefObject<{ removeLastPoint: () => boolean; abortDrawing: () => void } | null>;
  // Scene dataset editing props
  activeSceneDataset?: SceneDatasetInfo | null;
  onDatasetFeatureCreated?: (datasetId: number, geometryType: string, coordinates: unknown, properties?: Record<string, unknown>) => void;
  onDatasetFeatureUpdated?: (datasetId: number, featureId: number, geometry: { type: string; coordinates: unknown }) => void;
  // Trace route visualization
  traceRouteCoordinates?: [number, number][] | null;
  // Snap settings
  snapSettings?: {
    enabled: boolean;
    snapToVertices: boolean;
    snapToEdges: boolean;
    snapRadius: number;
    snapLayerIds: number[];
  };
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

// Helper function to create point image style based on pointStyle and zoom
function createPointImageStyle(
  color: string, 
  pointStyle: PointStyle = "circle",
  zoom?: number
): Circle | RegularShape | Icon {
  const sizes = getPointSizeForZoom(zoom ?? 10);
  const fill = new Fill({ color });
  const stroke = new Stroke({ color: "#fff", width: sizes.strokeWidth });
  
  // Check if it's a heat network style
  if (isHeatNetworkStyle(pointStyle)) {
    const iconUrl = getHeatNetworkIconUrl(pointStyle as HeatNetworkPointStyle, color);
    return new Icon({
      src: iconUrl,
      scale: sizes.iconScale,
      anchor: [0.5, 0.5],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    });
  }
  
  switch (pointStyle) {
    case "square":
      return new RegularShape({
        fill,
        stroke,
        points: 4,
        radius: sizes.radius,
        angle: Math.PI / 4,
      });
    case "triangle":
      return new RegularShape({
        fill,
        stroke,
        points: 3,
        radius: sizes.radius,
        angle: 0,
      });
    case "cloud":
      return new RegularShape({
        fill,
        stroke,
        points: 5,
        radius: sizes.radius,
        radius2: sizes.radius * 0.6,
        angle: 0,
      });
    case "circle":
    default:
      return new Circle({
        radius: sizes.radius,
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

// Note: Clustering removed in favor of server-side point sampling (GIS-style approach)
// Points are now filtered on the server based on zoom level for better performance

// Z-index constants for proper layer stacking
// Polygons should render below lines, lines below points
const EDITABLE_LAYER_Z_INDEX = {
  Polygon: 500,      // Base layer - renders first (bottom)
  LineString: 600,   // Middle layer
  Point: 700,        // Top layer - renders last (on top)
};

// Helper to determine z-index based on layer's geometry type
function getLayerZIndex(layerFeatures: Array<{ geometryType: string }>): number {
  if (layerFeatures.length === 0) return EDITABLE_LAYER_Z_INDEX.Point;
  
  // Determine primary geometry type from features
  const geometryTypes = new Set(layerFeatures.map(f => f.geometryType));
  
  if (geometryTypes.has("Polygon") || geometryTypes.has("MultiPolygon")) {
    return EDITABLE_LAYER_Z_INDEX.Polygon;
  }
  if (geometryTypes.has("LineString") || geometryTypes.has("MultiLineString")) {
    return EDITABLE_LAYER_Z_INDEX.LineString;
  }
  return EDITABLE_LAYER_Z_INDEX.Point;
}

// Viewport buffer ratio for hysteresis (50% buffer = request 1.5x visible area)
const VIEWPORT_BUFFER_RATIO = 0.5;
// Viewport debounce time in ms (increased for less frequent updates)
const VIEWPORT_DEBOUNCE_MS = 500;
// Viewport coordinate precision (3 decimals = ~111m at equator)
const VIEWPORT_PRECISION = 3;

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

function parseZwsResponse(xml: string): Feature[] {
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
          featureProjection: "EPSG:3857",
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
  editableFeatures = [],
  onFeatureCreated,
  onFeatureUpdated,
  selectedEditableFeatureIds = [],
  onEditableFeatureSelect,
  onClearEditableSelection,
  onSelectEditableLayer,
  selectionActionsRef,
  drawActionsRef,
  activeSceneDataset,
  onDatasetFeatureCreated,
  onDatasetFeatureUpdated,
  traceRouteCoordinates,
  snapSettings,
}: MapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const layersRef = useRef<Record<string, LayerType>>({});
  const allFeaturesRef = useRef<Record<string, Feature[]>>({});
  const ticketsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const allEditableLayersRef = useRef<Map<number, VectorLayer<VectorSource>>>(new Map());
  const traceRouteLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
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
  const [pendingClickEvent, setPendingClickEvent] = useState<{ ctrlKey: boolean; metaKey: boolean } | null>(null);
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
    const isMultiSelect = clickEvent?.ctrlKey || clickEvent?.metaKey || false;
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
    mutationFn: async (data: { layerId: number; featureIds: number[] }) => {
      // Delete features one by one (could be optimized with a batch endpoint)
      for (const featureId of data.featureIds) {
        await apiRequest("DELETE", `/api/editable-layers/${data.layerId}/features/${featureId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers/viewport-features"] });
      setSelectedMapFeatures([]);
      toast({
        title: "Объекты удалены",
        description: "Выбранные объекты успешно удалены из слоя",
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

  // Create a stable viewport key for query caching (coarser rounding for less cache misses)
  const viewportKey = useMemo(() => {
    if (!fetchViewport) return null;
    // Use coarser rounding (3 decimals = ~111m) to reduce cache invalidation
    return `${fetchViewport.minX.toFixed(VIEWPORT_PRECISION)},${fetchViewport.minY.toFixed(VIEWPORT_PRECISION)},${fetchViewport.maxX.toFixed(VIEWPORT_PRECISION)},${fetchViewport.maxY.toFixed(VIEWPORT_PRECISION)},${fetchViewport.zoom}`;
  }, [fetchViewport]);

  // Track point sampling info for the sampling indicator
  const [pointSamplingInfo, setPointSamplingInfo] = useState<{
    totalPoints: number;
    sampledPoints: number;
    isFullData: boolean;
  } | null>(null);

  // Stable layer IDs for query key (prevents cache invalidation on layer reference changes)
  const layerIdsKey = useMemo(() => 
    allEditableLayers.map(l => l.id).sort((a, b) => a - b).join(","),
    [allEditableLayers]
  );

  const { data: allLayerFeatures = {}, isFetching: isFetchingFeatures } = useQuery<Record<number, DrawnFeature[]>>({
    queryKey: ["/api/editable-layers/viewport-features", layerIdsKey, viewportKey],
    queryFn: async () => {
      if (!fetchViewport || allEditableLayers.length === 0) return {};

      const layerIds = allEditableLayers.map(l => l.id).join(",");
      const params = new URLSearchParams({
        layerIds,
        minX: fetchViewport.minX.toString(),
        minY: fetchViewport.minY.toString(),
        maxX: fetchViewport.maxX.toString(),
        maxY: fetchViewport.maxY.toString(),
        zoom: fetchViewport.zoom.toString(),
      });

      const response = await fetch(`/api/editable-layers/viewport-batch?${params.toString()}`);
      if (!response.ok) {
        console.warn("Batch viewport fetch failed:", response.status);
        return {};
      }

      const data = await response.json();
      const featuresByLayer: Record<number, DrawnFeature[]> = {};

      if (data.layers) {
        for (const [idStr, layerData] of Object.entries(data.layers) as [string, any][]) {
          const id = parseInt(idStr);
          featuresByLayer[id] = layerData.features || [];
        }
      }

      return featuresByLayer;
    },
    enabled: allEditableLayers.length > 0 && fetchViewport !== null,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 2,
    placeholderData: (previousData) => previousData,
  });
  

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
    
    const oldView = map.getView();
    const currentCenter = oldView.getCenter();
    const currentZoom = oldView.getZoom() || DEFAULT_ZOOM;
    
    let centerLonLat: [number, number] = DEFAULT_CENTER;
    if (currentCenter) {
      const lonLat = toLonLat(currentCenter, currentProjectionRef.current);
      centerLonLat = [lonLat[0], lonLat[1]];
    }
    
    currentProjectionRef.current = currentProjection;
    
    const newView = new View({
      projection: currentProjection,
      center: fromLonLat(centerLonLat, currentProjection),
      zoom: currentZoom,
    });
    
    map.setView(newView);
    
    console.log(`Projection changed to ${currentProjection}, center: ${centerLonLat}`);
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
      // Selection only works in edit mode
      if (!editModeRef.current || !selectionModeRef.current) return;
      
      const extent = dragBox.getGeometry().getExtent();
      const newSelectedFeatures: Array<{ layerId: number; featureIndex: number; feature: Feature<Geometry> }> = [];
      
      allEditableLayersRef.current.forEach((layer, layerId) => {
        const source = layer.getSource();
        if (!source || !layer.getVisible()) return;
        
        const features = source.getFeatures();
        features.forEach((feature, index) => {
          const geom = feature.getGeometry();
          if (geom && geom.intersectsExtent(extent)) {
            newSelectedFeatures.push({ layerId, featureIndex: index, feature: feature as Feature<Geometry> });
          }
        });
      });
      
      setSelectedMapFeatures(prev => [...prev, ...newSelectedFeatures]);
    });
    
    map.addInteraction(dragBox);
    dragBoxRef.current = dragBox;

    map.on("pointermove", (evt) => {
      const coords = toLonLat(evt.coordinate);
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
        
        // Update editable layer styles
        allEditableLayersRef.current.forEach((layer) => {
          const editableLayerId = layer.get("editableLayerId");
          const layerData = allEditableLayersDataRef.current?.find(l => l.id === editableLayerId);
          if (layerData) {
            layer.setStyle(createEditableLayerStyle(layerData, roundedZoom));
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

    // Debounced viewport update with hysteresis for optimized feature loading
    const updateViewport = () => {
      const extent = map.getView().calculateExtent(map.getSize());
      const extentWGS84 = transformExtent(extent, "EPSG:3857", "EPSG:4326");
      const currentZoom = Math.round(map.getView().getZoom() || DEFAULT_ZOOM);
      
      const currentExtent = {
        minX: extentWGS84[0],
        minY: extentWGS84[1],
        maxX: extentWGS84[2],
        maxY: extentWGS84[3],
        zoom: currentZoom,
      };
      
      const buffered = bufferedExtentRef.current;
      
      // Check if we need to refetch (viewport exited buffered area or zoom changed)
      const needsRefetch = !buffered ||
        buffered.zoom !== currentZoom ||
        currentExtent.minX < buffered.minX ||
        currentExtent.minY < buffered.minY ||
        currentExtent.maxX > buffered.maxX ||
        currentExtent.maxY > buffered.maxY;
      
      if (needsRefetch) {
        // Calculate buffered extent (expand by VIEWPORT_BUFFER_RATIO)
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
        
        // Set fetch viewport to the buffered extent for fetching
        setFetchViewport(newBufferedExtent);
      }
    };

    // Update viewport on map move with increased debounce
    map.on("moveend", () => {
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
      }
      viewportDebounceRef.current = setTimeout(() => {
        updateViewport();
      }, VIEWPORT_DEBOUNCE_MS);
    });

    // Initial viewport update
    setTimeout(() => updateViewport(), 100);

    map.on("singleclick", async (evt) => {
      const currentConnection = connectionRef.current;
      const currentLayers = layersStateRef.current;
      const isTicketMode = ticketModeRef.current;
      const currentSelectionMode = selectionModeRef.current;
      const currentEditMode = editModeRef.current;

      const coords = toLonLat(evt.coordinate);
      setFeatureCoordinates([coords[0], coords[1]]);

      // Selection only works in edit mode
      if (currentEditMode && currentSelectionMode) {
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

        if (candidates.length === 0) {
          // No features found - clear selection if not multi-select
          if (!evt.originalEvent.ctrlKey && !evt.originalEvent.metaKey) {
            setSelectedMapFeatures([]);
            // Also clear drawing.selectedFeatureIds
            if (onClearEditableSelectionRef.current) {
              onClearEditableSelectionRef.current();
            }
          }
        } else if (candidates.length === 1) {
          // Single candidate - select directly
          const candidate = candidates[0];
          confirmFeatureSelectionRef.current(candidate, evt.originalEvent.ctrlKey || evt.originalEvent.metaKey);
        } else {
          // Multiple candidates from different layers - check if they're from the same layer
          const uniqueLayerIds = new Set(candidates.map(c => c.layerId));
          if (uniqueLayerIds.size === 1) {
            // All from same layer - select the first (topmost by geometry priority)
            confirmFeatureSelectionRef.current(candidates[0], evt.originalEvent.ctrlKey || evt.originalEvent.metaKey);
          } else {
            // Multiple layers - show selection dialog
            setSelectionCandidates(candidates);
            setPendingClickEvent({ 
              ctrlKey: evt.originalEvent.ctrlKey, 
              metaKey: evt.originalEvent.metaKey 
            });
          }
        }
        return;
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
          const properties: Record<string, unknown> = {};
          const keys = (foundFeature as Feature).getKeys();
          
          keys.forEach((key) => {
            if (key !== "geometry") {
              properties[key] = (foundFeature as Feature).get(key);
            }
          });

          const layerConfig = currentLayers.find((l) => l.id === foundLayerId);
          const featureId = (foundFeature as Feature).getId?.() || 
            (foundFeature as Feature).get("id") || 
            `feature-${Date.now()}`;
          
          setSelectedFeature({
            id: String(featureId),
            layerName: layerConfig?.name || foundLayerId || "Объект",
            properties,
            geometry: undefined,
          });
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

  // Manage uploaded shapefile layers
  useEffect(() => {
    console.log("=== Layer sync effect ===");
    console.log("allEditableLayers count:", allEditableLayers.length);
    console.log("allLayerFeatures keys:", Object.keys(allLayerFeatures));
    console.log("isFetchingFeatures:", isFetchingFeatures);
    
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    // Don't process layers while features are still loading
    if (isFetchingFeatures && Object.keys(allLayerFeatures).length === 0) {
      console.log("Skipping layer sync - features still loading");
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
      
      // Convert drawn features to GeoJSON format
      const geojsonData = {
        type: "FeatureCollection" as const,
        features: layerFeatures.map(f => ({
          type: "Feature" as const,
          geometry: {
            type: f.geometryType,
            coordinates: f.coordinates,
          },
          properties: {
            featureId: f.id, // Include database ID for selection sync
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
              featureProjection: "EPSG:3857",
            });
            
            vectorSource.addFeatures(features);
            console.log(`Loaded ${features.length} features for layer: ${editableLayerItem.name}`);
          }
        } catch (e) {
          console.error("Failed to parse layer GeoJSON:", e);
        }
        
        // Server-side point sampling is used instead of client-side clustering
        // Points are filtered on the server based on zoom level for better performance
        const currentZoom = fetchViewport?.zoom || 10;
        const styleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}|${currentZoom}`;
        vectorLayer = new VectorLayer({
          source: vectorSource,
          style: createEditableLayerStyle(editableLayerItem, currentZoom),
          properties: { 
            editableLayerId: editableLayerItem.id, 
            featureCount: layerFeatures.length,
            originalSource: vectorSource,
            styleKey,
            lastZoom: currentZoom,
          },
        });
        
        // Set z-index based on geometry type: Polygons bottom, Lines middle, Points top
        const layerZIndex = getLayerZIndex(layerFeatures);
        vectorLayer.setZIndex(layerZIndex);
        
        map.addLayer(vectorLayer);
        allEditableLayersRef.current.set(editableLayerItem.id, vectorLayer);
      } else {
        const hasDataForLayer = allLayerFeatures[editableLayerItem.id] !== undefined;
        if (hasDataForLayer) {
          const sourceToUpdate = vectorLayer.getSource() as VectorSource;
          if (sourceToUpdate) {
            try {
              const newFeatureIds = new Set(layerFeatures.map(f => f.id));
              const existingFeatures = sourceToUpdate.getFeatures();
              const existingIds = new Set<number>();

              for (const olFeature of existingFeatures) {
                const fId = olFeature.get("featureId") as number;
                if (fId !== undefined && !newFeatureIds.has(fId)) {
                  sourceToUpdate.removeFeature(olFeature);
                } else if (fId !== undefined) {
                  existingIds.add(fId);
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
                  featureProjection: "EPSG:3857",
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
      
      // Update visibility and opacity
      vectorLayer.setVisible(editableLayerItem.visible);
      vectorLayer.setOpacity(editableLayerItem.opacity);
      
      // Only update style when style properties actually changed
      // Use a style key to detect changes without storing duplicate values
      const currentStyleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}`;
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
        vectorLayer.setStyle(createEditableLayerStyle(editableLayerItem, newZoom));
        vectorLayer.set("styleKey", `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}|${newZoom}`);
        vectorLayer.set("lastZoom", newZoom);
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
                ...f.properties,
                featureId: f.id,
                datasetId: f.datasetId,
              },
            })),
          };

          const vectorSource = new VectorSource();
          
          try {
            const olFeatures = geojsonFormat.readFeatures(geojsonData, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:3857",
            });
            vectorSource.addFeatures(olFeatures);
          } catch (e) {
            console.warn("Failed to parse GeoJSON for dataset:", sd.datasetId, e);
          }

          // Use style function for zoom-adaptive point sizing
          const createZoomAdaptiveStyle = (layerColor: string, layerPointStyle: PointStyle, currentZoom: number) => {
            return new Style({
              fill: new Fill({ color: layerColor + "33" }),
              stroke: new Stroke({ color: layerColor, width: 2 }),
              image: createPointImageStyle(layerColor, layerPointStyle, currentZoom),
            });
          };

          vectorLayer = new VectorLayer({
            source: vectorSource,
            style: createZoomAdaptiveStyle(sd.color, sd.pointStyle as PointStyle, fetchViewport.zoom),
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
          console.log(`Added scene dataset layer: ${sd.layerName || sd.dataset.name} with ${features.length} features (viewport optimized)`);
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
          const style = new Style({
            fill: new Fill({ color: sd.color + "33" }),
            stroke: new Stroke({ color: sd.color, width: 2 }),
            image: createPointImageStyle(sd.color, sd.pointStyle as PointStyle, fetchViewport.zoom),
          });
          vectorLayer.setStyle(style);
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
                    ...f.properties,
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
                  featureProjection: "EPSG:3857",
                });
                source.addFeatures(olFeatures);
                vectorLayer.set("lastViewportKey", currentViewportKey);
                console.log(`Refreshed dataset ${sd.layerName || sd.dataset.name}: ${features.length} features for viewport`);
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
    
    const featuresByLayer = new Map<number, number[]>();
    selectedMapFeatures.forEach(({ layerId, feature }) => {
      const realId = feature.get("featureId") as number | undefined;
      if (realId) {
        const existing = featuresByLayer.get(layerId) || [];
        existing.push(realId);
        featuresByLayer.set(layerId, existing);
      }
    });
    
    featuresByLayer.forEach((featureIds, layerId) => {
      deleteFeaturesMutation.mutate({ layerId, featureIds });
    });
  }, [selectedMapFeatures, deleteFeaturesMutation]);

  const clearSelection = useCallback(() => {
    setSelectedMapFeatures([]);
  }, []);

  // Expose selection actions via ref for external control
  useEffect(() => {
    if (selectionActionsRef) {
      selectionActionsRef.current = {
        clearSelection,
        deleteSelected: handleDeleteSelectedFeatures,
      };
    }
    return () => {
      if (selectionActionsRef) {
        selectionActionsRef.current = null;
      }
    };
  }, [selectionActionsRef, clearSelection, handleDeleteSelectedFeatures]);

  // Expose drawing actions via ref for external control (undo last point during drawing)
  useEffect(() => {
    if (drawActionsRef) {
      drawActionsRef.current = {
        removeLastPoint: () => {
          const draw = drawInteractionRef.current;
          if (!draw) {
            console.log("[DRAW UNDO] No draw interaction");
            return false;
          }
          
          // Check if there's a sketch feature being drawn
          // The draw interaction exposes the internal sketch via private property
          // We need to check if we're actively drawing with at least one point
          try {
            // Get sketch coordinates to check if there are points
            const sketchFeature = (draw as any).sketchFeature_;
            if (!sketchFeature) {
              console.log("[DRAW UNDO] No sketch feature - not currently drawing");
              return false;
            }
            
            const geom = sketchFeature.getGeometry();
            if (!geom) {
              console.log("[DRAW UNDO] No geometry in sketch");
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
            
            console.log("[DRAW UNDO] Sketch coordinate count:", coordCount);
            
            // Need at least 2 coordinates (current mouse + at least 1 placed point)
            if (coordCount >= 2) {
              draw.removeLastPoint();
              console.log("[DRAW UNDO] Removed last point");
              return true;
            }
            
            console.log("[DRAW UNDO] Not enough points to remove");
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
    console.log("[SNAP DEBUG] Effect triggered", {
      hasMap: !!mapRef.current,
      hasEditableLayer: !!editableLayerRef.current,
      editMode,
      drawingMode,
      snapEnabled: snapSettings?.enabled,
      snapSettings,
    });
    
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
          featureProjection: "EPSG:3857",
          dataProjection: "EPSG:4326",
        }));

        // Get geometry type as our schema type
        let geoType: GeometryType = "Point";
        if (drawingMode === "line") geoType = "LineString";
        else if (drawingMode === "polygon") geoType = "Polygon";

        // Call the callback to create the feature in the database
        if (onFeatureCreatedRef.current && activeEditableLayerRef.current) {
          onFeatureCreatedRef.current(geoType, geoJsonGeom.coordinates, {});
        }

        // Remove the feature from the source (it will be re-added from the database)
        setTimeout(() => {
          editableSource.removeFeature(feature);
        }, 100);
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
      
      console.log("[SNAP] Setting up snap interactions", {
        enabled: snapSettings.enabled,
        drawingMode,
        useAllLayers,
        snapLayerIds: snapSettings.snapLayerIds,
        allEditableLayersCount: allEditableLayersRef.current.size,
        sceneDatasetLayersCount: sceneDatasetLayersRef.current.size,
      });
      
      // Add sources from all editable layers (from allEditableLayersRef)
      allEditableLayersRef.current.forEach((layerRef, layerId) => {
        const layer = layerRef as VectorLayer<VectorSource>;
        const source = layer.getSource();
        const featureCount = source?.getFeatures().length || 0;
        const isVisible = layer.getVisible();
        console.log(`[SNAP] Layer ${layerId}: visible=${isVisible}, features=${featureCount}`);
        
        if (source && isVisible) {
          // Check if layer should be included based on snapLayerIds
          if (useAllLayers || snapSettings.snapLayerIds.includes(layerId)) {
            snapSources.push(source);
            console.log(`[SNAP] Added layer ${layerId} to snap sources`);
          }
        }
      });
      
      // Add sources from scene datasets
      sceneDatasetLayersRef.current.forEach((layer, datasetId) => {
        const source = layer.getSource();
        const featureCount = source?.getFeatures().length || 0;
        const isVisible = layer.getVisible();
        console.log(`[SNAP] Dataset ${datasetId}: visible=${isVisible}, features=${featureCount}`);
        
        if (source && isVisible) {
          // Check if layer should be included based on snapLayerIds
          if (useAllLayers || snapSettings.snapLayerIds.includes(datasetId)) {
            snapSources.push(source);
            console.log(`[SNAP] Added dataset ${datasetId} to snap sources`);
          }
        }
      });
      
      console.log(`[SNAP] Total snap sources: ${snapSources.length}`);
      
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
        console.log(`[SNAP] Created snap interaction ${idx + 1} with tolerance ${snapSettings.snapRadius}px, vertex=${snapSettings.snapToVertices}, edge=${snapSettings.snapToEdges}`);
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

  // Sync editable features to the map layer
  useEffect(() => {
    if (!editableLayerRef.current) return;
    const source = editableLayerRef.current.getSource();
    if (!source) return;

    source.clear();
    
    const format = new GeoJSON();
    
    editableFeatures.forEach((drawnFeature) => {
      try {
        const geoJsonFeature = {
          type: "Feature" as const,
          geometry: {
            type: drawnFeature.geometryType,
            coordinates: drawnFeature.coordinates,
          },
          properties: {
            featureId: drawnFeature.id,
            ...drawnFeature.properties,
          },
        };
        
        const olFeatures = format.readFeatures(geoJsonFeature, {
          featureProjection: "EPSG:3857",
          dataProjection: "EPSG:4326",
        });
        
        olFeatures.forEach((f) => {
          f.set("featureId", drawnFeature.id);
          // Selection is now visualized via pulsating glow layer, no need to change feature style
          source.addFeature(f);
        });
      } catch (err) {
        console.error("Error adding editable feature to map:", err);
      }
    });
  }, [editableFeatures]);

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
                    featureProjection: "EPSG:3857",
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
                    featureProjection: "EPSG:3857",
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
                    const features = parseZwsResponse(data.raw);
                    console.log(`Loaded ${features.length} features for ${layerConfig.id}`);
                    
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
        geometry: new OlPoint(fromLonLat([ticket.lon, ticket.lat])),
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
      
      console.log(`Filtered ${layerId}: ${filteredFeatures.length}/${allFeatures.length} features`);
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
      center: fromLonLat(DEFAULT_CENTER),
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

        const clickPoint = toLonLat(clickCoord);
        
        if (geom instanceof OlPolygon || geom instanceof OlMultiPolygon) {
          const closestPoint = geom.getClosestPoint(clickCoord);
          const closestPointLonLat = toLonLat(closestPoint);
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
          geometry: new OlPoint(fromLonLat([lon, lat])),
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
      const lineCoords = traceRouteCoordinates.map(coord => fromLonLat(coord));
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
