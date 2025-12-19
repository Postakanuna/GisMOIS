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
import { Style, Fill, Stroke, Circle } from "ol/style";
import "ol/ol.css";

import type { LayerConfig, FeatureInfo, ZuluConnection } from "@shared/schema";
import { MapControls } from "./map-controls";
import { CoordinateDisplay } from "./coordinate-display";
import { FeatureInfoPanel } from "./feature-info";
import { LoadingOverlay } from "./loading-overlay";

interface MapViewerProps {
  layers: LayerConfig[];
  connection: ZuluConnection | null;
  isConnected: boolean;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;

type LayerType = TileLayer<OSM> | VectorLayer<VectorSource> | ImageLayer<ImageWMS>;

const LAYER_COLORS: Record<string, string> = {
  "ZR_VS_MO": "#2196F3",
  "ZR_VO_MO": "#4CAF50",
  "ZR_TS_MO": "#FF5722",
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

export function MapViewer({ layers, connection, isConnected }: MapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const layersRef = useRef<Record<string, LayerType>>({});
  
  const connectionRef = useRef<ZuluConnection | null>(connection);
  const layersStateRef = useRef<LayerConfig[]>(layers);

  const [mouseCoordinates, setMouseCoordinates] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [featureCoordinates, setFeatureCoordinates] = useState<[number, number] | undefined>();
  const [isLoading, setIsLoading] = useState(false);

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

    map.on("singleclick", async (evt) => {
      const currentConnection = connectionRef.current;
      const currentLayers = layersStateRef.current;
      
      if (!currentConnection) return;

      const viewResolution = map.getView().getResolution();
      if (!viewResolution) return;

      const wmsLayers = currentLayers.filter((l) => l.type === "wms" && l.visible);
      if (wmsLayers.length === 0) return;

      const coords = toLonLat(evt.coordinate);
      setFeatureCoordinates([coords[0], coords[1]]);

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
                .then((res) => res.json())
                .then((data) => {
                  if (data.raw) {
                    const features = parseZwsResponse(data.raw);
                    console.log(`Loaded ${features.length} features for ${layerConfig.id}`);
                    vectorSource.addFeatures(features);
                    
                    if (features.length > 0) {
                      const extent = vectorSource.getExtent();
                      map.getView().fit(extent, { padding: [50, 50, 50, 50], maxZoom: 14 });
                    }
                  }
                })
                .catch((err) => console.error("Failed to load layer:", err));
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
  }, [layers, connection]);

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
      />

      <CoordinateDisplay coordinates={mouseCoordinates} zoom={zoom} />

      <FeatureInfoPanel
        feature={selectedFeature}
        onClose={handleCloseFeatureInfo}
        coordinates={featureCoordinates}
      />

      <LoadingOverlay isLoading={isLoading} message="Получение информации..." />

      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
          <div className="text-center space-y-2 p-6 rounded-lg bg-card shadow-lg border border-card-border max-w-sm">
            <h3 className="text-lg font-medium">Карта готова к работе</h3>
            <p className="text-sm text-muted-foreground">
              Подключитесь к ZuluServer, чтобы загрузить слои карты.
              Базовая карта OpenStreetMap доступна для навигации.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
