import { useEffect, useRef, useState, useCallback } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import ImageWMS from "ol/source/ImageWMS";
import { fromLonLat, toLonLat } from "ol/proj";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import WKT from "ol/format/WKT";
import Feature from "ol/Feature";
import { Style, Fill, Stroke, Circle, Icon } from "ol/style";
import { LineString, Geometry } from "ol/geom";
import { DragBox, Select } from "ol/interaction";
import { platformModifierKeyOnly } from "ol/events/condition";
import "ol/ol.css";

import type { LayerConfig, FeatureInfo, ZuluConnection, Ticket, InsertTicket, Facility, FacilityType, Trace, InsertFacility, InsertTrace, TraceType, UploadedLayer } from "@shared/schema";
import GeoJSON from "ol/format/GeoJSON";
import type { LayerFilters, ActiveFilters } from "@/hooks/use-zulu-connection";
import { MapControls } from "./map-controls";
import { CoordinateDisplay } from "./coordinate-display";
import { FeatureInfoPanel } from "./feature-info";
import { LoadingOverlay } from "./loading-overlay";
import { InfrastructureTools } from "./infrastructure-tools";
import { getDistance, getLength } from "ol/sphere";
import { Point as OlPoint, Polygon as OlPolygon, MultiPolygon as OlMultiPolygon } from "ol/geom";
import Text from "ol/style/Text";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { MousePointer2, Square, Trash2, X } from "lucide-react";

interface SelectionToolbarProps {
  selectionMode: "none" | "click" | "box";
  onToggleSelectionMode: (mode: "none" | "click" | "box") => void;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  isDeleting: boolean;
}

function SelectionToolbar({
  selectionMode,
  onToggleSelectionMode,
  selectedCount,
  onClearSelection,
  onDeleteSelected,
  isDeleting,
}: SelectionToolbarProps) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg p-2">
      <Button
        size="sm"
        variant={selectionMode === "click" ? "default" : "outline"}
        onClick={() => onToggleSelectionMode(selectionMode === "click" ? "none" : "click")}
        data-testid="button-selection-click"
        title="Выделение кликом"
      >
        <MousePointer2 className="h-4 w-4 mr-1" />
        Клик
      </Button>
      <Button
        size="sm"
        variant={selectionMode === "box" ? "default" : "outline"}
        onClick={() => onToggleSelectionMode(selectionMode === "box" ? "none" : "box")}
        data-testid="button-selection-box"
        title="Выделение прямоугольником (Ctrl+перетаскивание)"
      >
        <Square className="h-4 w-4 mr-1" />
        Прямоугольник
      </Button>
      
      {selectedCount > 0 && (
        <>
          <div className="h-6 w-px bg-border mx-1" />
          <span className="text-sm text-muted-foreground px-2" data-testid="text-selected-count">
            Выбрано: {selectedCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={onClearSelection}
            data-testid="button-clear-selection"
            title="Снять выделение"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onDeleteSelected}
            disabled={isDeleting}
            data-testid="button-delete-selected"
            title="Удалить выбранные объекты"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {isDeleting ? "Удаление..." : "Удалить"}
          </Button>
        </>
      )}
    </div>
  );
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
  uploadedLayers?: UploadedLayer[];
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;

type LayerType = TileLayer<OSM> | VectorLayer<VectorSource> | ImageLayer<ImageWMS>;

const LAYER_COLORS: Record<string, string> = {
  "ZR_VS_MO": "#2196F3",
  "ZR_VO_MO": "#4CAF50",
  "ZR_TS_MO": "#FF5722",
};

const FACILITY_COLORS: Record<FacilityType, string> = {
  building: "#3B82F6",
  boilerhouse: "#F97316",
  waterintake: "#06B6D4",
};

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

function createFacilityIcon(type: FacilityType, selected: boolean = false): string {
  const size = selected ? 32 : 28;
  const bgColor = FACILITY_COLORS[type];
  const strokeColor = selected ? "#ffffff" : "#ffffff80";
  const strokeWidth = selected ? 3 : 2;
  
  let iconPath = "";
  if (type === "building") {
    iconPath = `<path d="M5 20V9l7-5 7 5v11H5z M9 20v-5h6v5" fill="none" stroke="white" stroke-width="1.5"/>`;
  } else if (type === "boilerhouse") {
    iconPath = `<path d="M12 22c-4-3-7-6-7-10a7 7 0 0114 0c0 4-3 7-7 10z M12 14a2 2 0 100-4 2 2 0 000 4z" fill="white" fill-opacity="0.9"/>`;
  } else if (type === "waterintake") {
    iconPath = `<path d="M12 21c-4 0-7-3-7-7 0-3 7-11 7-11s7 8 7 11c0 4-3 7-7 7z" fill="white" fill-opacity="0.9"/>`;
  }
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - strokeWidth/2}" fill="${bgColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
      <g transform="translate(${(size-24)/2}, ${(size-24)/2})">
        ${iconPath}
      </g>
    </svg>
  `;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function getFacilityStyle(type: FacilityType, selected: boolean = false) {
  return new Style({
    image: new Icon({
      src: createFacilityIcon(type, selected),
      anchor: [0.5, 0.5],
    }),
  });
}

function getTraceStyle(type: TraceType, selected: boolean = false) {
  const color = type === "heating" ? "#F97316" : "#06B6D4";
  return new Style({
    stroke: new Stroke({
      color,
      width: selected ? 4 : 3,
      lineDash: [10, 6],
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

export function MapViewer({ layers, connection, isConnected, activeFilters, onFiltersDiscovered, onLayerLoadError, onLayerLoadSuccess, tickets = [], ticketMode, onToggleTicketMode, onCreateTicket, uploadedLayers = [] }: MapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const layersRef = useRef<Record<string, LayerType>>({});
  const allFeaturesRef = useRef<Record<string, Feature[]>>({});
  const ticketsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const facilitiesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const tracesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const uploadedLayersRef = useRef<Map<number, VectorLayer<VectorSource>>>(new Map());
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
  
  const [placementMode, setPlacementMode] = useState<FacilityType | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState<{ lon: number; lat: number; type: FacilityType } | null>(null);
  const [tracingError, setTracingError] = useState<string | null>(null);
  
  const [selectionMode, setSelectionMode] = useState<"none" | "click" | "box">("none");
  const [selectedMapFeatures, setSelectedMapFeatures] = useState<Array<{ layerId: number; featureIndex: number; feature: Feature<Geometry> }>>([]);
  const selectionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const dragBoxRef = useRef<DragBox | null>(null);
  const selectionModeRef = useRef<"none" | "click" | "box">("none");

  const placementModeRef = useRef<FacilityType | null>(null);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const deleteFeaturesMutation = useMutation({
    mutationFn: async (data: { layerId: number; featureIndices: number[] }) => {
      const response = await apiRequest("POST", `/api/uploaded-layers/${data.layerId}/delete-features`, {
        featureIndices: data.featureIndices,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
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

  const { data: facilities = [] } = useQuery<Facility[]>({
    queryKey: ["/api/facilities"],
  });

  const { data: traces = [] } = useQuery<Trace[]>({
    queryKey: ["/api/traces"],
  });

  const createFacilityMutation = useMutation({
    mutationFn: async (facility: InsertFacility) => {
      const response = await apiRequest("POST", "/api/facilities", facility);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
    },
  });

  const deleteFacilityMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/facilities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/traces"] });
      setSelectedFacility(null);
    },
  });

  const createTraceMutation = useMutation({
    mutationFn: async (trace: InsertTrace) => {
      const response = await apiRequest("POST", "/api/traces", trace);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/traces"] });
    },
  });

  const deleteTraceMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/traces/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/traces"] });
      setSelectedTrace(null);
    },
  });

  const updateFacilityMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<InsertFacility> }) => {
      const response = await apiRequest("PATCH", `/api/facilities/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
    },
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

    const tracesSource = new VectorSource();
    const tracesLayer = new VectorLayer({
      source: tracesSource,
      properties: { id: "traces-layer" },
      zIndex: 900,
    });
    map.addLayer(tracesLayer);
    tracesLayerRef.current = tracesLayer;

    const facilitiesSource = new VectorSource();
    const facilitiesLayer = new VectorLayer({
      source: facilitiesSource,
      properties: { id: "facilities-layer" },
      zIndex: 950,
    });
    map.addLayer(facilitiesLayer);
    facilitiesLayerRef.current = facilitiesLayer;

    const selectionSource = new VectorSource();
    const selectionLayer = new VectorLayer({
      source: selectionSource,
      properties: { id: "selection-layer" },
      zIndex: 2000,
      style: new Style({
        fill: new Fill({ color: "rgba(255, 255, 0, 0.3)" }),
        stroke: new Stroke({ color: "#FFD700", width: 3 }),
        image: new Circle({
          radius: 8,
          fill: new Fill({ color: "rgba(255, 255, 0, 0.5)" }),
          stroke: new Stroke({ color: "#FFD700", width: 3 }),
        }),
      }),
    });
    map.addLayer(selectionLayer);
    selectionLayerRef.current = selectionLayer;

    const dragBox = new DragBox({
      condition: platformModifierKeyOnly,
    });
    
    dragBox.on("boxend", () => {
      if (selectionModeRef.current !== "box") return;
      
      const extent = dragBox.getGeometry().getExtent();
      const newSelectedFeatures: Array<{ layerId: number; featureIndex: number; feature: Feature<Geometry> }> = [];
      
      uploadedLayersRef.current.forEach((layer, layerId) => {
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
      
      if (placementModeRef.current) {
        map.getTargetElement().style.cursor = "crosshair";
      } else {
        let hasFeature = false;
        map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
          if (layer === facilitiesLayerRef.current || layer === tracesLayerRef.current) {
            hasFeature = true;
          }
          return true;
        });
        map.getTargetElement().style.cursor = hasFeature ? "pointer" : "";
      }
    });

    map.getView().on("change:resolution", () => {
      setZoom(map.getView().getZoom() || DEFAULT_ZOOM);
    });

    map.getView().on("change:rotation", () => {
      setRotation(map.getView().getRotation());
    });

    map.on("singleclick", async (evt) => {
      const currentConnection = connectionRef.current;
      const currentLayers = layersStateRef.current;
      const isTicketMode = ticketModeRef.current;
      const currentPlacementMode = placementModeRef.current;
      const currentSelectionMode = selectionModeRef.current;

      const coords = toLonLat(evt.coordinate);
      setFeatureCoordinates([coords[0], coords[1]]);

      if (currentPlacementMode) {
        setPendingPlacement({
          lon: coords[0],
          lat: coords[1],
          type: currentPlacementMode,
        });
        setPlacementMode(null);
        return;
      }

      if (currentSelectionMode === "click") {
        let foundUploadedFeature: Feature<Geometry> | null = null;
        let foundLayerId: number | null = null;
        let foundFeatureIndex: number = -1;

        map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
          if (foundUploadedFeature) return true;
          
          const uploadedLayerId = layer?.get("uploadedLayerId");
          if (uploadedLayerId !== undefined) {
            const vectorLayer = uploadedLayersRef.current.get(uploadedLayerId);
            if (vectorLayer) {
              const source = vectorLayer.getSource();
              if (source) {
                const features = source.getFeatures();
                const idx = features.indexOf(feature as Feature);
                if (idx !== -1) {
                  foundUploadedFeature = feature as Feature<Geometry>;
                  foundLayerId = uploadedLayerId;
                  foundFeatureIndex = idx;
                }
              }
            }
          }
          return true;
        });

        if (foundUploadedFeature && foundLayerId !== null && foundFeatureIndex !== -1) {
          const isAlreadySelected = selectedMapFeatures.some(
            sf => sf.layerId === foundLayerId && sf.featureIndex === foundFeatureIndex
          );
          
          if (evt.originalEvent.ctrlKey || evt.originalEvent.metaKey) {
            if (isAlreadySelected) {
              setSelectedMapFeatures(prev => 
                prev.filter(sf => !(sf.layerId === foundLayerId && sf.featureIndex === foundFeatureIndex))
              );
            } else {
              setSelectedMapFeatures(prev => [
                ...prev, 
                { layerId: foundLayerId!, featureIndex: foundFeatureIndex, feature: foundUploadedFeature! }
              ]);
            }
          } else {
            if (isAlreadySelected) {
              setSelectedMapFeatures([]);
            } else {
              setSelectedMapFeatures([
                { layerId: foundLayerId, featureIndex: foundFeatureIndex, feature: foundUploadedFeature }
              ]);
            }
          }
        } else if (!evt.originalEvent.ctrlKey && !evt.originalEvent.metaKey) {
          setSelectedMapFeatures([]);
        }
        return;
      }

      let clickedFacility: Facility | null = null;
      let clickedTrace: Trace | null = null;

      map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        if (layer === facilitiesLayerRef.current && !clickedFacility) {
          const facilityId = feature.get("facilityId");
          const allFacilities = queryClient.getQueryData<Facility[]>(["/api/facilities"]) || [];
          clickedFacility = allFacilities.find(f => f.id === facilityId) || null;
        }
        if (layer === tracesLayerRef.current && !clickedTrace) {
          const traceId = feature.get("traceId");
          const allTraces = queryClient.getQueryData<Trace[]>(["/api/traces"]) || [];
          clickedTrace = allTraces.find(t => t.id === traceId) || null;
        }
        return true;
      });

      if (clickedFacility) {
        setSelectedFacility(clickedFacility);
        setSelectedTrace(null);
        setSelectedFeature(null);
        return;
      }

      if (clickedTrace) {
        setSelectedTrace(clickedTrace);
        setSelectedFacility(null);
        setSelectedFeature(null);
        return;
      }

      setSelectedFacility(null);
      setSelectedTrace(null);

      if (isTicketMode && currentConnection?.useZws) {
        handleTicketCreation(coords[0], coords[1], evt.coordinate);
        return;
      }
      
      if (!currentConnection) return;

      if (currentConnection.useZws) {
        let foundFeature: Feature | null = null;
        let foundLayerId: string | null = null;

        map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
          if (!foundFeature && layer && layer !== facilitiesLayerRef.current && layer !== tracesLayerRef.current && layer !== ticketsLayerRef.current) {
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

  useEffect(() => {
    if (!facilitiesLayerRef.current) return;
    
    const source = facilitiesLayerRef.current.getSource();
    if (!source) return;
    
    source.clear();
    
    facilities.forEach((facility) => {
      const feature = new Feature({
        geometry: new OlPoint(fromLonLat([facility.lon, facility.lat])),
        facilityId: facility.id,
        facilityType: facility.type,
      });
      feature.setStyle(getFacilityStyle(facility.type, selectedFacility?.id === facility.id));
      source.addFeature(feature);
    });
  }, [facilities, selectedFacility]);

  useEffect(() => {
    if (!tracesLayerRef.current) return;
    
    const source = tracesLayerRef.current.getSource();
    if (!source) return;
    
    source.clear();
    
    const OFFSET_METERS = 3;
    
    traces.forEach((trace) => {
      const baseCoords = trace.coordinates.map(c => fromLonLat(c));
      const isSelected = selectedTrace?.id === trace.id;
      const color = trace.type === "heating" ? "#F97316" : "#06B6D4";
      const offset = trace.type === "heating" ? -OFFSET_METERS : OFFSET_METERS;
      
      const feature = new Feature({
        geometry: new LineString(baseCoords),
        traceId: trace.id,
        traceType: trace.type,
      });
      
      feature.setStyle((feat) => {
        const geom = feat.getGeometry() as LineString;
        if (!geom) return new Style({});
        
        const coords = geom.getCoordinates();
        const offsetCoords = offsetLineStringConsistent(coords, offset);
        
        return new Style({
          geometry: new LineString(offsetCoords),
          stroke: new Stroke({
            color,
            width: isSelected ? 4 : 3,
            lineDash: [10, 6],
          }),
        });
      });
      
      source.addFeature(feature);
    });
  }, [traces, selectedTrace]);

  // Manage uploaded shapefile layers
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    const currentLayerIds = new Set(uploadedLayers.map(l => l.id));
    
    // Remove layers that no longer exist
    uploadedLayersRef.current.forEach((layer, id) => {
      if (!currentLayerIds.has(id)) {
        map.removeLayer(layer);
        uploadedLayersRef.current.delete(id);
      }
    });
    
    // Add or update layers
    uploadedLayers.forEach((uploadedLayer) => {
      let vectorLayer = uploadedLayersRef.current.get(uploadedLayer.id);
      
      if (!vectorLayer) {
        const vectorSource = new VectorSource();
        const geojsonFormat = new GeoJSON();
        
        try {
          const geojsonData = Array.isArray(uploadedLayer.geojson) 
            ? { type: "FeatureCollection", features: uploadedLayer.geojson.flatMap((g: any) => g.features || []) }
            : uploadedLayer.geojson;
          
          // Read features with standard EPSG:4326 -> EPSG:3857 transformation
          const features = geojsonFormat.readFeatures(geojsonData, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          });
          
          // DEBUG: Log transformation results
          if (features.length > 0) {
            const sampleFeature = geojsonData.features?.[0];
            if (sampleFeature?.geometry?.coordinates) {
              const coords = sampleFeature.geometry.coordinates;
              const flatCoords = Array.isArray(coords[0]) 
                ? (Array.isArray(coords[0][0]) ? coords[0][0] : coords[0])
                : coords;
              
              const firstFeature = features[0];
              const geom = firstFeature.getGeometry();
              if (geom) {
                const extent = geom.getExtent();
                const centerX = (extent[0] + extent[2]) / 2;
                const centerY = (extent[1] + extent[3]) / 2;
                const lonLatBack = toLonLat([centerX, centerY]);
                
                console.log(`=== Layer: ${uploadedLayer.name} ===`);
                console.log(`  Input (degrees): [${flatCoords[0].toFixed(6)}, ${flatCoords[1].toFixed(6)}]`);
                console.log(`  Output (EPSG:3857 meters): [${centerX.toFixed(2)}, ${centerY.toFixed(2)}]`);
                console.log(`  Back to degrees: [${lonLatBack[0].toFixed(6)}, ${lonLatBack[1].toFixed(6)}]`);
              }
            }
          }
          
          vectorSource.addFeatures(features);
          console.log(`Loaded ${features.length} features for layer: ${uploadedLayer.name}`);
        } catch (e) {
          console.error("Failed to parse uploaded layer GeoJSON:", e);
        }
        
        vectorLayer = new VectorLayer({
          source: vectorSource,
          style: new Style({
            fill: new Fill({ color: uploadedLayer.color + "40" }),
            stroke: new Stroke({ color: uploadedLayer.color, width: 2 }),
            image: new Circle({
              radius: 6,
              fill: new Fill({ color: uploadedLayer.color }),
              stroke: new Stroke({ color: "#fff", width: 1 }),
            }),
          }),
          properties: { uploadedLayerId: uploadedLayer.id },
        });
        
        map.addLayer(vectorLayer);
        uploadedLayersRef.current.set(uploadedLayer.id, vectorLayer);
      }
      
      // Update visibility and opacity
      vectorLayer.setVisible(uploadedLayer.visible);
      vectorLayer.setOpacity(uploadedLayer.opacity);
      
      // Update style if color changed
      vectorLayer.setStyle(new Style({
        fill: new Fill({ color: uploadedLayer.color + "40" }),
        stroke: new Stroke({ color: uploadedLayer.color, width: 2 }),
        image: new Circle({
          radius: 6,
          fill: new Fill({ color: uploadedLayer.color }),
          stroke: new Stroke({ color: "#fff", width: 1 }),
        }),
      }));
    });
  }, [uploadedLayers]);

  useEffect(() => {
    if (!selectionLayerRef.current) return;
    
    const source = selectionLayerRef.current.getSource();
    if (!source) return;
    
    source.clear();
    
    selectedMapFeatures.forEach(({ feature }) => {
      const clonedFeature = feature.clone();
      source.addFeature(clonedFeature);
    });
  }, [selectedMapFeatures]);

  const handleDeleteSelectedFeatures = useCallback(() => {
    if (selectedMapFeatures.length === 0) return;
    
    const featuresByLayer = new Map<number, number[]>();
    selectedMapFeatures.forEach(({ layerId, featureIndex }) => {
      const existing = featuresByLayer.get(layerId) || [];
      existing.push(featureIndex);
      featuresByLayer.set(layerId, existing);
    });
    
    featuresByLayer.forEach((featureIndices, layerId) => {
      deleteFeaturesMutation.mutate({ layerId, featureIndices });
    });
  }, [selectedMapFeatures, deleteFeaturesMutation]);

  const clearSelection = useCallback(() => {
    setSelectedMapFeatures([]);
  }, []);

  const toggleSelectionMode = useCallback((mode: "none" | "click" | "box") => {
    setSelectionMode(mode);
    if (mode === "none") {
      setSelectedMapFeatures([]);
    }
  }, []);

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

  const calculateDistance = useCallback((f1: Facility, f2: Facility): number => {
    const dx = f1.lon - f2.lon;
    const dy = f1.lat - f2.lat;
    return Math.sqrt(dx * dx + dy * dy) * 111000;
  }, []);

  const handleStartTracing = useCallback(async () => {
    if (!selectedFacility || selectedFacility.type !== "building") return;

    setTracingError(null);

    const requiredHeat = selectedFacility.requiredHeatLoad || 0;
    const requiredWater = selectedFacility.requiredWaterSupply || 0;

    const freshFacilities = await queryClient.fetchQuery({
      queryKey: ["/api/facilities"],
      staleTime: 0,
    }) as Facility[];

    const boilerhouses = freshFacilities.filter(f => f.type === "boilerhouse");
    const waterintakes = freshFacilities.filter(f => f.type === "waterintake");

    if (boilerhouses.length === 0 && waterintakes.length === 0) {
      setTracingError("Добавьте котельную и/или водозабор на карту");
      return;
    }

    const qualifiedBoilerhouses = boilerhouses.filter(b => 
      (b.freeHeatCapacity || 0) >= requiredHeat
    );
    const qualifiedWaterintakes = waterintakes.filter(w => 
      (w.freeWaterCapacity || 0) >= requiredWater
    );

    const errors: string[] = [];

    if (requiredHeat > 0 && qualifiedBoilerhouses.length === 0 && boilerhouses.length > 0) {
      const maxCapacity = Math.max(...boilerhouses.map(b => b.freeHeatCapacity || 0));
      errors.push(`Нет котельной с достаточной мощностью (нужно ${requiredHeat} Гкал/ч, макс. доступно ${maxCapacity} Гкал/ч)`);
    }

    if (requiredWater > 0 && qualifiedWaterintakes.length === 0 && waterintakes.length > 0) {
      const maxCapacity = Math.max(...waterintakes.map(w => w.freeWaterCapacity || 0));
      errors.push(`Нет водозабора с достаточной мощностью (нужно ${requiredWater} м³/ч, макс. доступно ${maxCapacity} м³/ч)`);
    }

    if (errors.length > 0) {
      setTracingError(errors.join(". "));
    }

    let nearestBoilerhouse: Facility | null = null;
    if (qualifiedBoilerhouses.length > 0) {
      nearestBoilerhouse = qualifiedBoilerhouses.reduce((nearest, current) => {
        const nearestDist = calculateDistance(selectedFacility, nearest);
        const currentDist = calculateDistance(selectedFacility, current);
        return currentDist < nearestDist ? current : nearest;
      });
    }

    let nearestWaterintake: Facility | null = null;
    if (qualifiedWaterintakes.length > 0) {
      nearestWaterintake = qualifiedWaterintakes.reduce((nearest, current) => {
        const nearestDist = calculateDistance(selectedFacility, nearest);
        const currentDist = calculateDistance(selectedFacility, current);
        return currentDist < nearestDist ? current : nearest;
      });
    }

    if (!nearestBoilerhouse && !nearestWaterintake) {
      return;
    }

    setIsTracing(true);

    const routingTasks: { target: Facility; type: TraceType; requiredCapacity: number }[] = [];
    if (nearestBoilerhouse && requiredHeat > 0) {
      routingTasks.push({ target: nearestBoilerhouse, type: "heating", requiredCapacity: requiredHeat });
    }
    if (nearestWaterintake && requiredWater > 0) {
      routingTasks.push({ target: nearestWaterintake, type: "water", requiredCapacity: requiredWater });
    }

    try {
      for (const task of routingTasks) {
        const currentFacilities = await queryClient.fetchQuery({
          queryKey: ["/api/facilities"],
          staleTime: 0,
        }) as Facility[];
        const currentTarget = currentFacilities.find(f => f.id === task.target.id);
        
        if (!currentTarget) {
          throw new Error("Источник не найден");
        }

        const currentCapacity = task.type === "heating" 
          ? (currentTarget.freeHeatCapacity || 0)
          : (currentTarget.freeWaterCapacity || 0);

        if (currentCapacity < task.requiredCapacity) {
          throw new Error(`Недостаточно мощности у источника ${currentTarget.name}`);
        }

        const response = await fetch("/api/routing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start: [selectedFacility.lon, selectedFacility.lat],
            end: [currentTarget.lon, currentTarget.lat],
          }),
        });

        const data = await response.json();
        
        const coords = data.coordinates as [number, number][];
        const lineString = new LineString(coords.map(c => fromLonLat(c)));
        const lengthMeters = getLength(lineString);

        const trace: InsertTrace = {
          type: task.type,
          buildingId: selectedFacility.id,
          targetId: currentTarget.id,
          coordinates: coords,
          length: lengthMeters,
        };

        await createTraceMutation.mutateAsync(trace);

        const newCapacity = Math.max(0, currentCapacity - task.requiredCapacity);
        if (task.type === "heating") {
          await updateFacilityMutation.mutateAsync({
            id: currentTarget.id,
            updates: { freeHeatCapacity: newCapacity },
          });
        } else {
          await updateFacilityMutation.mutateAsync({
            id: currentTarget.id,
            updates: { freeWaterCapacity: newCapacity },
          });
        }

        await queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });

        if (data.fallback) {
          toast({
            title: task.type === "heating" ? "Теплотрасса построена" : "Водопровод построен",
            description: "Использована прямая линия (сервис маршрутизации недоступен)",
          });
        }
      }

      toast({
        title: "Трассировка завершена",
        description: `Построено ${routingTasks.length} трассировок`,
      });
      setTracingError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Не удалось построить трассировки";
      toast({
        title: "Ошибка трассировки",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsTracing(false);
    }
  }, [selectedFacility, createTraceMutation, updateFacilityMutation, calculateDistance, toast]);

  const handleConfirmPlacement = useCallback(async (facility: InsertFacility) => {
    try {
      await createFacilityMutation.mutateAsync(facility);
      toast({
        title: "Объект добавлен",
        description: `${facility.name} размещён на карте`,
      });
      setPendingPlacement(null);
    } catch {
      toast({
        title: "Ошибка",
        description: "Не удалось добавить объект",
        variant: "destructive",
      });
    }
  }, [createFacilityMutation, toast]);

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

      <InfrastructureTools
        placementMode={placementMode}
        onSetPlacementMode={setPlacementMode}
        selectedFacility={selectedFacility}
        onCloseSelection={() => setSelectedFacility(null)}
        onStartTracing={handleStartTracing}
        onDeleteFacility={(id) => deleteFacilityMutation.mutate(id)}
        isTracing={isTracing}
        selectedTrace={selectedTrace}
        onCloseTraceInfo={() => setSelectedTrace(null)}
        onDeleteTrace={(id) => deleteTraceMutation.mutate(id)}
        pendingPlacement={pendingPlacement}
        onConfirmPlacement={handleConfirmPlacement}
        onCancelPendingPlacement={() => setPendingPlacement(null)}
        facilities={facilities}
        tracingError={tracingError}
      />

      <SelectionToolbar
        selectionMode={selectionMode}
        onToggleSelectionMode={toggleSelectionMode}
        selectedCount={selectedMapFeatures.length}
        onClearSelection={clearSelection}
        onDeleteSelected={handleDeleteSelectedFeatures}
        isDeleting={deleteFeaturesMutation.isPending}
      />

      <LoadingOverlay isLoading={isLoading} message="Получение информации..." />
    </div>
  );
}
