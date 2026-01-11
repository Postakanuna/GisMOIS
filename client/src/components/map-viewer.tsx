import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import ImageWMS from "ol/source/ImageWMS";
import Cluster from "ol/source/Cluster";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import WKT from "ol/format/WKT";
import Feature from "ol/Feature";
import { Style, Fill, Stroke, Circle } from "ol/style";
import { LineString, Geometry } from "ol/geom";
import { DragBox, Select, Draw, Modify, Snap } from "ol/interaction";
import { platformModifierKeyOnly, click } from "ol/events/condition";
import type { DrawEvent } from "ol/interaction/Draw";
import type { ModifyEvent } from "ol/interaction/Modify";
import "ol/ol.css";

import type { LayerConfig, FeatureInfo, ZuluConnection, Ticket, InsertTicket, PointStyle, LineStyle, EditableLayer, DrawnFeature, GeometryType, InsertDrawnFeature, Dataset } from "@shared/schema";
import { useScene } from "@/contexts/scene-context";
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
  // Scene dataset editing props
  activeSceneDataset?: SceneDatasetInfo | null;
  onDatasetFeatureCreated?: (datasetId: number, geometryType: string, coordinates: unknown, properties?: Record<string, unknown>) => void;
  onDatasetFeatureUpdated?: (datasetId: number, featureId: number, geometry: { type: string; coordinates: unknown }) => void;
  // Trace route visualization
  traceRouteCoordinates?: [number, number][] | null;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;

type LayerType = TileLayer<OSM> | VectorLayer<VectorSource> | ImageLayer<ImageWMS>;

const LAYER_COLORS: Record<string, string> = {
  "ZR_VS_MO": "#2196F3",
  "ZR_VO_MO": "#4CAF50",
  "ZR_TS_MO": "#FF5722",
};

// Helper function to create point image style based on pointStyle
function createPointImageStyle(color: string, pointStyle: PointStyle = "circle"): Circle | RegularShape {
  const fill = new Fill({ color });
  const stroke = new Stroke({ color: "#fff", width: 1 });
  
  switch (pointStyle) {
    case "square":
      return new RegularShape({
        fill,
        stroke,
        points: 4,
        radius: 6,
        angle: Math.PI / 4,
      });
    case "triangle":
      return new RegularShape({
        fill,
        stroke,
        points: 3,
        radius: 7,
        angle: 0,
      });
    case "cloud":
      return new RegularShape({
        fill,
        stroke,
        points: 5,
        radius: 7,
        radius2: 4,
        angle: 0,
      });
    case "circle":
    default:
      return new Circle({
        radius: 6,
        fill,
        stroke,
      });
  }
}

// Helper function to create stroke style based on lineStyle
function createLineStroke(color: string, lineStyle: LineStyle = "solid"): Stroke | Stroke[] {
  switch (lineStyle) {
    case "dashed":
      return new Stroke({ color, width: 2, lineDash: [8, 4] });
    case "double":
      // For double lines, we return a single stroke since OpenLayers 
      // will be using style function for double line effect
      return new Stroke({ color, width: 4 });
    case "solid":
    default:
      return new Stroke({ color, width: 2 });
  }
}

// Create complete layer style based on layer properties
function createEditableLayerStyle(layer: EditableLayer): Style | Style[] {
  const color = layer.color || "#1976D2";
  const pointStyle = layer.pointStyle || "circle";
  const lineStyle = layer.lineStyle || "solid";
  
  // For double lines, return array of styles
  if (lineStyle === "double") {
    return [
      new Style({
        stroke: new Stroke({ color, width: 4 }),
        fill: new Fill({ color: color + "40" }),
        image: createPointImageStyle(color, pointStyle),
      }),
      new Style({
        stroke: new Stroke({ color: "#fff", width: 1.5 }),
      }),
    ];
  }
  
  return new Style({
    fill: new Fill({ color: color + "40" }),
    stroke: createLineStroke(color, lineStyle) as Stroke,
    image: createPointImageStyle(color, pointStyle),
  });
}

// Create cluster style for point layers at low zoom levels
function createClusterStyle(color: string, pointStyle: PointStyle = "circle") {
  return function(feature: Feature | import("ol/render/Feature").default) {
    const clusteredFeatures = feature.get('features');
    const size = clusteredFeatures ? clusteredFeatures.length : 1;
    
    if (size === 1) {
      // Single feature - use normal point style
      return new Style({
        image: createPointImageStyle(color, pointStyle),
      });
    }
    
    // Cluster with multiple features - show count
    const radius = Math.min(8 + Math.log2(size) * 4, 24);
    return new Style({
      image: new Circle({
        radius: radius,
        fill: new Fill({ color: color + "CC" }),
        stroke: new Stroke({ color: "#fff", width: 2 }),
      }),
      text: new Text({
        text: size > 99 ? "99+" : size.toString(),
        fill: new Fill({ color: "#fff" }),
        font: `bold ${Math.min(12 + Math.log2(size), 16)}px sans-serif`,
        textAlign: 'center',
        textBaseline: 'middle',
      }),
    });
  };
}

// Cluster distance threshold in pixels
const CLUSTER_DISTANCE = 40;
// Zoom threshold below which clustering is enabled
const CLUSTER_ZOOM_THRESHOLD = 14;

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
  activeSceneDataset,
  onDatasetFeatureCreated,
  onDatasetFeatureUpdated,
  traceRouteCoordinates,
}: MapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const layersRef = useRef<Record<string, LayerType>>({});
  const allFeaturesRef = useRef<Record<string, Feature[]>>({});
  const ticketsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const allEditableLayersRef = useRef<Map<number, VectorLayer<VectorSource>>>(new Map());
  const traceRouteLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const { toast } = useToast();
  
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
  const [viewport, setViewport] = useState<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    zoom: number;
  } | null>(null);
  const viewportDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(false);
  
  
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
  const modifyInteractionRef = useRef<Modify | null>(null);
  const snapInteractionRef = useRef<Snap | null>(null);
  const drawingModeRef = useRef<DrawingMode>(drawingMode || null);
  const editModeRef = useRef(editMode);
  const onFeatureCreatedRef = useRef(onFeatureCreated);
  const activeEditableLayerRef = useRef(activeEditableLayer);
  const onSelectEditableLayerRef = useRef(onSelectEditableLayer);
  const allEditableLayersDataRef = useRef(allEditableLayers);
  const onEditableFeatureSelectRef = useRef(onEditableFeatureSelect);
  const onClearEditableSelectionRef = useRef(onClearEditableSelection);

  // Scene datasets refs
  const sceneDatasetLayersRef = useRef<Map<number, VectorLayer<VectorSource>>>(new Map());
  const { currentSceneId } = useScene();
  const activeSceneDatasetRef = useRef(activeSceneDataset);
  const onDatasetFeatureUpdatedRef = useRef(onDatasetFeatureUpdated);
  const onDatasetFeatureCreatedRef = useRef(onDatasetFeatureCreated);
  const sceneDatasetModifyRef = useRef<Modify | null>(null);

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

  // Create a stable viewport key for query caching
  const viewportKey = useMemo(() => {
    if (!viewport) return null;
    // Round to reduce cache misses from minor viewport changes
    return `${viewport.minX.toFixed(4)},${viewport.minY.toFixed(4)},${viewport.maxX.toFixed(4)},${viewport.maxY.toFixed(4)},${viewport.zoom}`;
  }, [viewport]);

  // Track if any layer has limited features
  const [hasLimitedFeatures, setHasLimitedFeatures] = useState(false);

  // Stable layer IDs for query key (prevents cache invalidation on layer reference changes)
  const layerIdsKey = useMemo(() => 
    allEditableLayers.map(l => l.id).sort((a, b) => a - b).join(","),
    [allEditableLayers]
  );

  // Fetch features for all editable layers using viewport-based loading for optimization
  const { data: allLayerFeatures = {}, isFetching: isFetchingFeatures } = useQuery<Record<number, DrawnFeature[]>>({
    queryKey: ["/api/editable-layers/viewport-features", layerIdsKey, viewportKey],
    queryFn: async () => {
      const featuresByLayer: Record<number, DrawnFeature[]> = {};
      let anyLimited = false;
      
      await Promise.all(
        allEditableLayers.map(async (layer) => {
          try {
            // Use viewport endpoint with bbox and zoom for optimized loading
            let url = `/api/editable-layers/${layer.id}/features/viewport`;
            if (viewport) {
              const params = new URLSearchParams({
                minX: viewport.minX.toString(),
                minY: viewport.minY.toString(),
                maxX: viewport.maxX.toString(),
                maxY: viewport.maxY.toString(),
                zoom: viewport.zoom.toString(),
              });
              url += `?${params.toString()}`;
            }
            
            const response = await fetch(url);
            if (response.ok) {
              const data = await response.json();
              // Handle new response format with features array and limit info
              if (data.features && Array.isArray(data.features)) {
                featuresByLayer[layer.id] = data.features;
                if (data.limited) {
                  anyLimited = true;
                }
              } else if (Array.isArray(data)) {
                // Backward compatibility with old format
                featuresByLayer[layer.id] = data;
              }
            }
          } catch (e) {
            console.warn(`Failed to fetch features for layer ${layer.id}`);
          }
        })
      );
      setHasLimitedFeatures(anyLimited);
      
      return featuresByLayer;
    },
    enabled: allEditableLayers.length > 0 && viewport !== null,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 30, // 30 seconds - shorter for viewport-based data
    gcTime: 1000 * 60 * 2, // Keep in cache for 2 minutes for panning back
    // Keep previous data while fetching new viewport data - prevents UI flicker and empty state
    placeholderData: (previousData) => previousData,
  });
  
  // Sync loading state with React Query's fetching state
  useEffect(() => {
    setIsLoadingFeatures(isFetchingFeatures);
  }, [isFetchingFeatures]);

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
    if (!mapContainerRef.current || mapRef.current) return;

    const osmLayer = new TileLayer({
      source: new OSM(),
      properties: { id: "osm-base" },
    });

    const map = new OLMap({
      target: mapContainerRef.current,
      layers: [osmLayer],
      view: new View({
        center: fromLonLat(DEFAULT_CENTER),
        zoom: DEFAULT_ZOOM,
      }),
      controls: defaultControls({ zoom: false, rotate: false }).extend([
        new ScaleLine({ units: "metric" }),
      ]),
    });

    layersRef.current["osm-base"] = osmLayer;

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
      setZoom(map.getView().getZoom() || DEFAULT_ZOOM);
    });

    map.getView().on("change:rotation", () => {
      setRotation(map.getView().getRotation());
    });

    // Debounced viewport update for optimized feature loading
    const updateViewport = () => {
      const extent = map.getView().calculateExtent(map.getSize());
      const extentWGS84 = transformExtent(extent, "EPSG:3857", "EPSG:4326");
      const currentZoom = Math.round(map.getView().getZoom() || DEFAULT_ZOOM);
      
      setViewport({
        minX: extentWGS84[0],
        minY: extentWGS84[1],
        maxX: extentWGS84[2],
        maxY: extentWGS84[3],
        zoom: currentZoom,
      });
    };

    // Update viewport on map move with debounce
    map.on("moveend", () => {
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
      }
      viewportDebounceRef.current = setTimeout(() => {
        updateViewport();
      }, 300); // 300ms debounce
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
        
        // Check if this is a Point-only layer for clustering
        const isPointLayer = layerFeatures.length > 0 && 
          layerFeatures.every(f => f.geometryType === "Point");
        const currentZoom = viewport?.zoom ?? 12;
        const shouldCluster = isPointLayer && currentZoom < CLUSTER_ZOOM_THRESHOLD && layerFeatures.length > 50;
        
        if (shouldCluster) {
          // Use Cluster source for point layers at low zoom levels
          const clusterSource = new Cluster({
            distance: CLUSTER_DISTANCE,
            source: vectorSource,
          });
          
          const styleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}`;
          vectorLayer = new VectorLayer({
            source: clusterSource,
            style: createClusterStyle(
              editableLayerItem.color || "#1976D2",
              (editableLayerItem.pointStyle as PointStyle) || "circle"
            ),
            properties: { 
              editableLayerId: editableLayerItem.id, 
              featureCount: layerFeatures.length,
              isClustered: true,
              originalSource: vectorSource,
              styleKey,
            },
          });
          console.log(`Created clustered layer for ${editableLayerItem.name}`);
        } else {
          const styleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}`;
          vectorLayer = new VectorLayer({
            source: vectorSource,
            style: createEditableLayerStyle(editableLayerItem),
            properties: { 
              editableLayerId: editableLayerItem.id, 
              featureCount: layerFeatures.length,
              isClustered: false,
              originalSource: vectorSource,
              styleKey,
            },
          });
        }
        
        map.addLayer(vectorLayer);
        allEditableLayersRef.current.set(editableLayerItem.id, vectorLayer);
      } else {
        // Check if feature count changed - need to refresh the source
        // But skip if data is still loading (layerFeatures is empty but should have data)
        const storedCount = vectorLayer.get("featureCount");
        const hasDataForLayer = allLayerFeatures[editableLayerItem.id] !== undefined;
        const isClustered = vectorLayer.get("isClustered");
        
        // Check if clustering state should change based on zoom
        const isPointLayer = layerFeatures.length > 0 && 
          layerFeatures.every(f => f.geometryType === "Point");
        const currentZoom = viewport?.zoom ?? 12;
        const shouldCluster = isPointLayer && currentZoom < CLUSTER_ZOOM_THRESHOLD && layerFeatures.length > 50;
        
        // If clustering state changed, recreate the layer
        if (isPointLayer && isClustered !== shouldCluster) {
          // Remove old layer and recreate with correct source type
          map.removeLayer(vectorLayer);
          allEditableLayersRef.current.delete(editableLayerItem.id);
          
          const originalSource = vectorLayer.get("originalSource") as VectorSource || new VectorSource();
          originalSource.clear();
          
          if (geojsonData.features.length > 0) {
            const features = geojsonFormat.readFeatures(geojsonData, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:3857",
            });
            originalSource.addFeatures(features);
          }
          
          const styleKey = `${editableLayerItem.color}|${editableLayerItem.pointStyle}|${editableLayerItem.lineStyle}`;
          if (shouldCluster) {
            const clusterSource = new Cluster({
              distance: CLUSTER_DISTANCE,
              source: originalSource,
            });
            
            vectorLayer = new VectorLayer({
              source: clusterSource,
              style: createClusterStyle(
                editableLayerItem.color || "#1976D2",
                (editableLayerItem.pointStyle as PointStyle) || "circle"
              ),
              properties: { 
                editableLayerId: editableLayerItem.id, 
                featureCount: layerFeatures.length,
                isClustered: true,
                originalSource: originalSource,
                styleKey,
              },
            });
            console.log(`Switched to clustered mode for ${editableLayerItem.name}`);
          } else {
            vectorLayer = new VectorLayer({
              source: originalSource,
              style: createEditableLayerStyle(editableLayerItem),
              properties: { 
                editableLayerId: editableLayerItem.id, 
                featureCount: layerFeatures.length,
                isClustered: false,
                originalSource: originalSource,
                styleKey,
              },
            });
            console.log(`Switched to non-clustered mode for ${editableLayerItem.name}`);
          }
          
          map.addLayer(vectorLayer);
          allEditableLayersRef.current.set(editableLayerItem.id, vectorLayer);
        } else if (storedCount !== layerFeatures.length && hasDataForLayer) {
          // Only update features if count changed
          // For clustered layers, update the original source
          const sourceToUpdate = isClustered 
            ? vectorLayer.get("originalSource") as VectorSource
            : vectorLayer.getSource() as VectorSource;
          
          if (sourceToUpdate) {
            sourceToUpdate.clear();
            try {
              if (geojsonData.features.length > 0) {
                const features = geojsonFormat.readFeatures(geojsonData, {
                  dataProjection: "EPSG:4326",
                  featureProjection: "EPSG:3857",
                });
                sourceToUpdate.addFeatures(features);
              }
              vectorLayer.set("featureCount", layerFeatures.length);
              console.log(`Refreshed layer ${editableLayerItem.name}: ${layerFeatures.length} features${isClustered ? " (clustered)" : ""}`);
            } catch (e) {
              console.error("Failed to refresh layer features:", e);
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
      
      if (storedStyleKey !== currentStyleKey) {
        const layerIsClustered = vectorLayer.get("isClustered");
        if (layerIsClustered) {
          vectorLayer.setStyle(createClusterStyle(
            editableLayerItem.color || "#1976D2",
            (editableLayerItem.pointStyle as PointStyle) || "circle"
          ));
        } else {
          vectorLayer.setStyle(createEditableLayerStyle(editableLayerItem));
        }
        vectorLayer.set("styleKey", currentStyleKey);
      }
    });
  }, [allEditableLayers, allLayerFeatures, isFetchingFeatures, viewport]);

  // Render scene datasets with viewport-based loading
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !viewport) return;

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
        minX: viewport.minX.toString(),
        minY: viewport.minY.toString(),
        maxX: viewport.maxX.toString(),
        maxY: viewport.maxY.toString(),
        zoom: viewport.zoom.toString(),
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

          const style = new Style({
            fill: new Fill({ color: sd.color + "33" }),
            stroke: new Stroke({ color: sd.color, width: 2 }),
            image: createPointImageStyle(sd.color, sd.pointStyle as PointStyle),
          });

          vectorLayer = new VectorLayer({
            source: vectorSource,
            style,
            opacity: sd.opacity,
            visible: !!sd.isVisible,
            properties: { 
              sceneDatasetId: sd.id,
              datasetId: sd.datasetId,
              color: sd.color,
              lastViewportKey: `${viewport.minX},${viewport.minY},${viewport.maxX},${viewport.maxY},${viewport.zoom}`,
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
        if (storedColor !== sd.color) {
          const style = new Style({
            fill: new Fill({ color: sd.color + "33" }),
            stroke: new Stroke({ color: sd.color, width: 2 }),
            image: createPointImageStyle(sd.color, sd.pointStyle as PointStyle),
          });
          vectorLayer.setStyle(style);
          vectorLayer.set("color", sd.color);
        }
        
        // Check if viewport changed significantly and refresh features
        const currentViewportKey = `${viewport.minX.toFixed(4)},${viewport.minY.toFixed(4)},${viewport.maxX.toFixed(4)},${viewport.maxY.toFixed(4)},${viewport.zoom}`;
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
  }, [sceneDatasets, viewport]);

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
    selectedMapFeatures.forEach(({ layerId, featureIndex }) => {
      const existing = featuresByLayer.get(layerId) || [];
      existing.push(featureIndex);
      featuresByLayer.set(layerId, existing);
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
    if (modifyInteractionRef.current) {
      map.removeInteraction(modifyInteractionRef.current);
      modifyInteractionRef.current = null;
    }
    if (snapInteractionRef.current) {
      map.removeInteraction(snapInteractionRef.current);
      snapInteractionRef.current = null;
    }

    // Show/hide editable layer based on edit mode
    editableLayerRef.current.setVisible(editMode);

    if (!editMode || !drawingMode) return;

    // Add snap interaction
    const snap = new Snap({ source: editableSource });
    map.addInteraction(snap);
    snapInteractionRef.current = snap;

    // Handle drawing modes
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
    } else if (drawingMode === "modify") {
      const modify = new Modify({ source: editableSource });
      
      modify.on("modifyend", (evt: ModifyEvent) => {
        // Handle feature modification
        const features = evt.features.getArray();
        features.forEach((feature) => {
          const featureId = feature.get("featureId");
          if (featureId && onFeatureUpdated) {
            const geom = feature.getGeometry();
            if (geom) {
              const format = new GeoJSON();
              const geoJsonGeom = JSON.parse(format.writeGeometry(geom, {
                featureProjection: "EPSG:3857",
                dataProjection: "EPSG:4326",
              }));
              onFeatureUpdated(featureId, { coordinates: geoJsonGeom.coordinates });
            }
          }
        });
      });

      map.addInteraction(modify);
      modifyInteractionRef.current = modify;
    }

    return () => {
      if (drawInteractionRef.current) {
        map.removeInteraction(drawInteractionRef.current);
        drawInteractionRef.current = null;
      }
      if (modifyInteractionRef.current) {
        map.removeInteraction(modifyInteractionRef.current);
        modifyInteractionRef.current = null;
      }
      if (snapInteractionRef.current) {
        map.removeInteraction(snapInteractionRef.current);
        snapInteractionRef.current = null;
      }
    };
  }, [editMode, drawingMode, onFeatureUpdated]);

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

      <CoordinateDisplay coordinates={mouseCoordinates} zoom={zoom} />

      <FeatureInfoPanel
        feature={selectedFeature}
        onClose={handleCloseFeatureInfo}
        coordinates={featureCoordinates}
      />

      <LoadingOverlay isLoading={isLoading} message="Получение информации..." />

      {/* Loading indicator for feature fetching */}
      {isLoadingFeatures && (
        <div 
          className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-background/90 border rounded-md px-3 py-1.5 shadow-sm flex items-center gap-2 text-sm"
          data-testid="features-loading-indicator"
        >
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Загрузка объектов...</span>
        </div>
      )}

      {/* Warning when feature limit is reached */}
      {hasLimitedFeatures && !isLoadingFeatures && (
        <div 
          className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-amber-50 dark:bg-amber-900/50 border border-amber-200 dark:border-amber-700 rounded-md px-3 py-1.5 shadow-sm flex items-center gap-2 text-sm text-amber-700 dark:text-amber-200"
          data-testid="features-limit-warning"
        >
          <span>Отображено не более 5000 объектов. Приблизьте карту для просмотра всех.</span>
        </div>
      )}

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
