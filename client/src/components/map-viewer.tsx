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
import { LineString } from "ol/geom";
import "ol/ol.css";

import type { LayerConfig, FeatureInfo, ZuluConnection, Ticket, InsertTicket, Facility, FacilityType, Trace, InsertFacility, InsertTrace, TraceType } from "@shared/schema";
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

function getFacilityStyle(type: FacilityType, selected: boolean = false) {
  const color = FACILITY_COLORS[type];
  const icons: Record<FacilityType, string> = {
    building: "B",
    boilerhouse: "K",
    waterintake: "B",
  };
  return new Style({
    image: new Circle({
      radius: selected ? 14 : 12,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: selected ? "#fff" : "#ffffff80", width: selected ? 3 : 2 }),
    }),
    text: new Text({
      text: icons[type],
      fill: new Fill({ color: "#fff" }),
      font: "bold 12px sans-serif",
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
    let dx = 0, dy = 0;
    
    if (i === 0) {
      const next = orderedCoords[i + 1];
      dx = next[0] - current[0];
      dy = next[1] - current[1];
    } else if (i === orderedCoords.length - 1) {
      const prev = orderedCoords[i - 1];
      dx = current[0] - prev[0];
      dy = current[1] - prev[1];
    } else {
      const prev = orderedCoords[i - 1];
      const next = orderedCoords[i + 1];
      dx = next[0] - prev[0];
      dy = next[1] - prev[1];
    }
    
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      result.push([...current]);
      continue;
    }
    
    const perpX = -dy / length;
    const perpY = dx / length;
    
    result.push([
      current[0] + perpX * offsetMeters,
      current[1] + perpY * offsetMeters,
    ]);
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

export function MapViewer({ layers, connection, isConnected, activeFilters, onFiltersDiscovered, onLayerLoadError, onLayerLoadSuccess, tickets = [], ticketMode, onToggleTicketMode, onCreateTicket }: MapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const layersRef = useRef<Record<string, LayerType>>({});
  const allFeaturesRef = useRef<Record<string, Feature[]>>({});
  const ticketsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const facilitiesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const tracesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
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

  const placementModeRef = useRef<FacilityType | null>(null);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

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

      const coords = toLonLat(evt.coordinate);
      setFeatureCoordinates([coords[0], coords[1]]);

      if (currentPlacementMode) {
        const facilityNames: Record<FacilityType, string> = {
          building: "Здание",
          boilerhouse: "Котельная",
          waterintake: "Водозабор",
        };
        
        const existingFacilities = await queryClient.getQueryData<Facility[]>(["/api/facilities"]) || [];
        const count = existingFacilities.filter(f => f.type === currentPlacementMode).length + 1;
        
        const newFacility: InsertFacility = {
          type: currentPlacementMode,
          name: `${facilityNames[currentPlacementMode]} ${count}`,
          lon: coords[0],
          lat: coords[1],
        };

        try {
          await createFacilityMutation.mutateAsync(newFacility);
          toast({
            title: "Объект добавлен",
            description: `${facilityNames[currentPlacementMode]} размещён на карте`,
          });
        } catch {
          toast({
            title: "Ошибка",
            description: "Не удалось добавить объект",
            variant: "destructive",
          });
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
    
    const OFFSET_METERS = 5;
    
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

  useEffect(() => {
    if (!mapRef.current || !connection) return;

    const map = mapRef.current;

    layers.forEach((layerConfig) => {
      const existingLayer = layersRef.current[layerConfig.id];

      if (layerConfig.type === "base") {
        if (existingLayer) {
          existingLayer.setVisible(layerConfig.visible);
          existingLayer.setOpacity(layerConfig.opacity);
        }
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

  const handleStartTracing = useCallback(async () => {
    if (!selectedFacility || selectedFacility.type !== "building") return;

    const boilerhouse = facilities.find(f => f.type === "boilerhouse");
    const waterintake = facilities.find(f => f.type === "waterintake");

    if (!boilerhouse && !waterintake) {
      toast({
        title: "Нет целей для трассировки",
        description: "Добавьте котельную и/или водозабор на карту",
        variant: "destructive",
      });
      return;
    }

    setIsTracing(true);

    const routingTasks: { target: Facility; type: TraceType }[] = [];
    if (boilerhouse) routingTasks.push({ target: boilerhouse, type: "heating" });
    if (waterintake) routingTasks.push({ target: waterintake, type: "water" });

    try {
      for (const task of routingTasks) {
        const response = await fetch("/api/routing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start: [selectedFacility.lon, selectedFacility.lat],
            end: [task.target.lon, task.target.lat],
          }),
        });

        const data = await response.json();
        
        const coords = data.coordinates as [number, number][];
        const lineString = new LineString(coords.map(c => fromLonLat(c)));
        const lengthMeters = getLength(lineString);

        const trace: InsertTrace = {
          type: task.type,
          buildingId: selectedFacility.id,
          targetId: task.target.id,
          coordinates: coords,
          length: lengthMeters,
        };

        await createTraceMutation.mutateAsync(trace);

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
    } catch (err) {
      toast({
        title: "Ошибка трассировки",
        description: "Не удалось построить трассировки",
        variant: "destructive",
      });
    } finally {
      setIsTracing(false);
    }
  }, [selectedFacility, facilities, createTraceMutation, toast]);

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
      />

      <LoadingOverlay isLoading={isLoading} message="Получение информации..." />
    </div>
  );
}
