import { useEffect, useRef, useState, useCallback } from "react";
import OLMap from "ol/Map";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Draw } from "ol/interaction";
import { Style, Fill, Stroke, Circle as CircleStyle } from "ol/style";
import { LineString, Polygon } from "ol/geom";
import { getLength, getArea } from "ol/sphere";
import { unByKey } from "ol/Observable";
import Overlay from "ol/Overlay";
import Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import type { DrawEvent } from "ol/interaction/Draw";
import type { EventsKey } from "ol/events";
import { Ruler, Trash2, X, Triangle, Route, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MeasureToolProps {
  map: OLMap | null;
  active: boolean;
  onClose: () => void;
}

interface MeasureResult {
  id: string;
  type: "line" | "polygon";
  totalLength: number;
  segments: { length: number; azimuth: number }[];
  area?: number;
  perimeter?: number;
}

type MeasureMode = "line" | "polygon";

function formatLength(lengthMeters: number): string {
  if (lengthMeters >= 1000) {
    return `${(lengthMeters / 1000).toFixed(3)} км`;
  }
  return `${lengthMeters.toFixed(1)} м`;
}

function formatArea(areaM2: number): string {
  if (areaM2 >= 1_000_000) {
    return `${(areaM2 / 1_000_000).toFixed(3)} км²`;
  }
  return `${areaM2.toFixed(1)} м²`;
}

function calcAzimuth(coord1: number[], coord2: number[]): number {
  const dx = coord2[0] - coord1[0];
  const dy = coord2[1] - coord1[1];
  let angle = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return angle;
}

const measureStyle = new Style({
  fill: new Fill({ color: "rgba(59, 130, 246, 0.15)" }),
  stroke: new Stroke({ color: "#3b82f6", width: 2.5, lineDash: [8, 5] }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#3b82f6" }),
    stroke: new Stroke({ color: "#fff", width: 1.5 }),
  }),
});

const completedStyle = new Style({
  fill: new Fill({ color: "rgba(34, 197, 94, 0.15)" }),
  stroke: new Stroke({ color: "#22c55e", width: 2.5 }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#22c55e" }),
    stroke: new Stroke({ color: "#fff", width: 1.5 }),
  }),
});

export function MeasureTool({ map, active, onClose }: MeasureToolProps) {
  const [measureMode, setMeasureMode] = useState<MeasureMode>("line");
  const [results, setResults] = useState<MeasureResult[]>([]);
  const [currentLength, setCurrentLength] = useState<number>(0);
  const [currentSegments, setCurrentSegments] = useState<{ length: number; azimuth: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const sourceRef = useRef<VectorSource>(new VectorSource());
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const overlaysRef = useRef<Map<string, Overlay[]>>(new Map());
  const pendingOverlaysRef = useRef<Overlay[]>([]);
  const listenerKeysRef = useRef<EventsKey[]>([]);
  const sketchRef = useRef<Feature<Geometry> | null>(null);
  const resultCounterRef = useRef(0);

  const clearOverlays = useCallback(() => {
    if (!map) return;
    overlaysRef.current.forEach((overlays) => {
      overlays.forEach((o) => map.removeOverlay(o));
    });
    overlaysRef.current.clear();
    pendingOverlaysRef.current.forEach((o) => map.removeOverlay(o));
    pendingOverlaysRef.current = [];
  }, [map]);

  const clearAll = useCallback(() => {
    sourceRef.current.clear();
    clearOverlays();
    setResults([]);
    setCurrentLength(0);
    setCurrentSegments([]);
    resultCounterRef.current = 0;
  }, [clearOverlays]);

  const addSegmentLabel = useCallback(
    (coord: number[], text: string) => {
      if (!map) return;
      const el = document.createElement("div");
      el.className = "measure-segment-label";
      el.innerHTML = text;
      el.style.cssText =
        "background: rgba(255,255,255,0.92); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #1e293b; border: 1px solid #cbd5e1; pointer-events: none; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1);";
      const overlay = new Overlay({
        element: el,
        position: coord,
        positioning: "bottom-center",
        offset: [0, -10],
        stopEvent: false,
      });
      map.addOverlay(overlay);
      pendingOverlaysRef.current.push(overlay);
    },
    [map]
  );

  const addTotalLabel = useCallback(
    (coord: number[], text: string) => {
      if (!map) return;
      const el = document.createElement("div");
      el.className = "measure-total-label";
      el.innerHTML = text;
      el.style.cssText =
        "background: rgba(34,197,94,0.95); padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; color: #fff; pointer-events: none; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.15);";
      const overlay = new Overlay({
        element: el,
        position: coord,
        positioning: "top-center",
        offset: [0, 10],
        stopEvent: false,
      });
      map.addOverlay(overlay);
      pendingOverlaysRef.current.push(overlay);
    },
    [map]
  );

  const removeDrawInteraction = useCallback(() => {
    if (drawRef.current && map) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    listenerKeysRef.current.forEach((k) => unByKey(k));
    listenerKeysRef.current = [];
    sketchRef.current = null;
    if (map) {
      pendingOverlaysRef.current.forEach((o) => map.removeOverlay(o));
    }
    pendingOverlaysRef.current = [];
    setIsDrawing(false);
  }, [map]);

  const addDrawInteraction = useCallback(() => {
    if (!map) return;
    removeDrawInteraction();

    const geomType = measureMode === "polygon" ? "Polygon" : "LineString";

    const draw = new Draw({
      source: sourceRef.current,
      type: geomType,
      style: measureStyle,
    });

    draw.on("drawstart", (evt: DrawEvent) => {
      sketchRef.current = evt.feature;
      setIsDrawing(true);
      setCurrentLength(0);
      setCurrentSegments([]);

      const geomChangeKey = evt.feature.getGeometry()!.on("change", (e) => {
        const geom = e.target;
        if (geom instanceof LineString) {
          const coords = geom.getCoordinates();
          const length = getLength(geom, { projection: map.getView().getProjection() });
          setCurrentLength(length);

          const segs: { length: number; azimuth: number }[] = [];
          for (let i = 1; i < coords.length; i++) {
            const segLine = new LineString([coords[i - 1], coords[i]]);
            const segLen = getLength(segLine, { projection: map.getView().getProjection() });
            const az = calcAzimuth(coords[i - 1], coords[i]);
            segs.push({ length: segLen, azimuth: az });
          }
          setCurrentSegments(segs);
        } else if (geom instanceof Polygon) {
          const ring = geom.getLinearRing(0);
          if (ring) {
            const coords = ring.getCoordinates();
            const perimLine = new LineString(coords);
            const length = getLength(perimLine, { projection: map.getView().getProjection() });
            setCurrentLength(length);

            const segs: { length: number; azimuth: number }[] = [];
            for (let i = 1; i < coords.length; i++) {
              const segLine = new LineString([coords[i - 1], coords[i]]);
              const segLen = getLength(segLine, { projection: map.getView().getProjection() });
              const az = calcAzimuth(coords[i - 1], coords[i]);
              segs.push({ length: segLen, azimuth: az });
            }
            setCurrentSegments(segs);
          }
        }
      });
      listenerKeysRef.current.push(geomChangeKey);
    });

    draw.on("drawend", (evt: DrawEvent) => {
      const geom = evt.feature.getGeometry()!;
      const id = `measure-${++resultCounterRef.current}`;
      evt.feature.setId(id);
      evt.feature.setStyle(completedStyle);

      if (geom instanceof LineString) {
        const coords = geom.getCoordinates();
        const totalLen = getLength(geom, { projection: map.getView().getProjection() });

        const segs: { length: number; azimuth: number }[] = [];
        for (let i = 1; i < coords.length; i++) {
          const segLine = new LineString([coords[i - 1], coords[i]]);
          const segLen = getLength(segLine, { projection: map.getView().getProjection() });
          const az = calcAzimuth(coords[i - 1], coords[i]);
          segs.push({ length: segLen, azimuth: az });

          const midpoint = [
            (coords[i - 1][0] + coords[i][0]) / 2,
            (coords[i - 1][1] + coords[i][1]) / 2,
          ];
          addSegmentLabel(midpoint, formatLength(segLen));
        }

        const lastCoord = coords[coords.length - 1];
        addTotalLabel(lastCoord, `Итого: ${formatLength(totalLen)}`);

        setResults((prev) => [
          ...prev,
          { id, type: "line", totalLength: totalLen, segments: segs },
        ]);
      } else if (geom instanceof Polygon) {
        const ring = geom.getLinearRing(0);
        if (ring) {
          const coords = ring.getCoordinates();
          const perimLine = new LineString(coords);
          const perimeter = getLength(perimLine, { projection: map.getView().getProjection() });
          const area = getArea(geom, { projection: map.getView().getProjection() });

          const segs: { length: number; azimuth: number }[] = [];
          for (let i = 1; i < coords.length; i++) {
            const segLine = new LineString([coords[i - 1], coords[i]]);
            const segLen = getLength(segLine, { projection: map.getView().getProjection() });
            const az = calcAzimuth(coords[i - 1], coords[i]);
            segs.push({ length: segLen, azimuth: az });

            const midpoint = [
              (coords[i - 1][0] + coords[i][0]) / 2,
              (coords[i - 1][1] + coords[i][1]) / 2,
            ];
            addSegmentLabel(midpoint, formatLength(segLen));
          }

          const interior = geom.getInteriorPoint();
          const labelCoord = interior.getCoordinates();
          addTotalLabel(
            labelCoord,
            `S: ${formatArea(area)}<br/>P: ${formatLength(perimeter)}`
          );

          setResults((prev) => [
            ...prev,
            { id, type: "polygon", totalLength: perimeter, segments: segs, area, perimeter },
          ]);
        }
      }

      overlaysRef.current.set(id, [...pendingOverlaysRef.current]);
      pendingOverlaysRef.current = [];

      setIsDrawing(false);
      setCurrentLength(0);
      setCurrentSegments([]);
      listenerKeysRef.current.forEach((k) => unByKey(k));
      listenerKeysRef.current = [];
      sketchRef.current = null;
    });

    map.addInteraction(draw);
    drawRef.current = draw;
  }, [map, measureMode, removeDrawInteraction, addSegmentLabel, addTotalLabel]);

  useEffect(() => {
    if (!map) return;

    if (!layerRef.current) {
      const layer = new VectorLayer({
        source: sourceRef.current,
        style: measureStyle,
        zIndex: 999,
      });
      layer.set("name", "measure-layer");
      map.addLayer(layer);
      layerRef.current = layer;
    }

    return () => {
      if (map) {
        if (layerRef.current) {
          map.removeLayer(layerRef.current);
          layerRef.current = null;
        }
        overlaysRef.current.forEach((overlays) => {
          overlays.forEach((o) => map.removeOverlay(o));
        });
        overlaysRef.current.clear();
        pendingOverlaysRef.current.forEach((o) => map.removeOverlay(o));
        pendingOverlaysRef.current = [];
        sourceRef.current.clear();
      }
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    if (active) {
      addDrawInteraction();
    } else {
      removeDrawInteraction();
      clearAll();
    }

    return () => {
      removeDrawInteraction();
    };
  }, [map, active, addDrawInteraction, removeDrawInteraction, clearAll]);

  useEffect(() => {
    if (active && map) {
      addDrawInteraction();
    }
  }, [measureMode]);

  const handleUndo = useCallback(() => {
    if (drawRef.current) {
      drawRef.current.removeLastPoint();
    }
  }, []);

  const handleClose = useCallback(() => {
    removeDrawInteraction();
    clearAll();
    onClose();
  }, [removeDrawInteraction, clearAll, onClose]);

  const handleDeleteResult = useCallback(
    (id: string) => {
      const feature = sourceRef.current.getFeatureById(id);
      if (feature) {
        sourceRef.current.removeFeature(feature as Feature<Geometry>);
      }
      const resultOverlays = overlaysRef.current.get(id);
      if (resultOverlays && map) {
        resultOverlays.forEach((o) => map.removeOverlay(o));
        overlaysRef.current.delete(id);
      }
      setResults((prev) => prev.filter((r) => r.id !== id));
    },
    [map]
  );

  if (!active) return null;

  return (
    <div
      className="absolute bottom-16 right-4 z-20 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg border border-card-border p-3 w-72"
      data-testid="measure-tool-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Измерения</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={handleClose}
          data-testid="button-measure-close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex gap-1 mb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={measureMode === "line" ? "default" : "outline"}
              className="flex-1 h-7 text-xs"
              onClick={() => setMeasureMode("line")}
              data-testid="button-measure-line"
            >
              <Route className="h-3.5 w-3.5 mr-1" />
              Расстояние
            </Button>
          </TooltipTrigger>
          <TooltipContent>Измерение расстояния (полилиния)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={measureMode === "polygon" ? "default" : "outline"}
              className="flex-1 h-7 text-xs"
              onClick={() => setMeasureMode("polygon")}
              data-testid="button-measure-polygon"
            >
              <Triangle className="h-3.5 w-3.5 mr-1" />
              Площадь
            </Button>
          </TooltipTrigger>
          <TooltipContent>Измерение площади (полигон)</TooltipContent>
        </Tooltip>
      </div>

      {isDrawing && (
        <div className="bg-muted/50 rounded-md p-2 mb-2 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {measureMode === "line" ? "Длина:" : "Периметр:"}
            </span>
            <span className="font-semibold">{formatLength(currentLength)}</span>
          </div>
          {currentSegments.length > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Последний сегмент:</span>
              <span className="font-medium">
                {formatLength(currentSegments[currentSegments.length - 1].length)}
              </span>
            </div>
          )}
          {currentSegments.length > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Азимут:</span>
              <span className="font-medium">
                {currentSegments[currentSegments.length - 1].azimuth.toFixed(1)}°
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Точек:</span>
            <span className="font-medium">{currentSegments.length + 1}</span>
          </div>
          <div className="flex gap-1 mt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-6 text-xs"
              onClick={handleUndo}
              data-testid="button-measure-undo"
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Отменить точку
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Двойной клик — завершить. ESC — отмена.
          </p>
        </div>
      )}

      {!isDrawing && results.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Кликните по карте для начала измерения.
          {measureMode === "line"
            ? " Двойной клик — завершить."
            : " Двойной клик — замкнуть полигон."}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {results.map((r, i) => (
            <div
              key={r.id}
              className="bg-muted/50 rounded-md p-2 text-xs flex items-start justify-between gap-1"
              data-testid={`measure-result-${i}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  {r.type === "line" ? (
                    <Route className="h-3 w-3 text-green-600 shrink-0" />
                  ) : (
                    <Triangle className="h-3 w-3 text-green-600 shrink-0" />
                  )}
                  <span className="font-semibold truncate">
                    {r.type === "line" ? "Линия" : "Полигон"} #{i + 1}
                  </span>
                </div>
                {r.type === "line" && (
                  <div className="text-muted-foreground">
                    Длина: <span className="text-foreground font-medium">{formatLength(r.totalLength)}</span>
                    {" · "}
                    {r.segments.length} сегм.
                  </div>
                )}
                {r.type === "polygon" && (
                  <div className="text-muted-foreground space-y-0.5">
                    <div>
                      Площадь: <span className="text-foreground font-medium">{formatArea(r.area!)}</span>
                    </div>
                    <div>
                      Периметр: <span className="text-foreground font-medium">{formatLength(r.perimeter!)}</span>
                    </div>
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0"
                onClick={() => handleDeleteResult(r.id)}
                data-testid={`button-delete-measure-${i}`}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs mt-2"
          onClick={clearAll}
          data-testid="button-measure-clear-all"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Очистить все
        </Button>
      )}
    </div>
  );
}
