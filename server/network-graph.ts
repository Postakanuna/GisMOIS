import { db } from "./db";
import { drawnFeatures, editableLayers } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

export function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/[«»""'']/g, "")
    .trim();
}

export type SimulationMode = "spatial";

interface SimulationResult {
  mode: SimulationMode;
  failurePoint: {
    featureId: number;
    layerId: number;
    name: string;
    type: string;
    coordinates: any;
  };
  source: {
    name: string;
    nist: string;
  } | null;
  affectedConsumers: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
  }>;
  affectedSegments: Array<{
    featureId: number;
    layerId: number;
    from: string;
    to: string;
    length: number;
    coordinates: any;
  }>;
  affectedCTPs: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
  }>;
  affectedNodes: Array<{
    featureId: number;
    layerId: number;
    name: string;
    coordinates: any;
  }>;
  stats: {
    totalConsumers: number;
    totalSegments: number;
    totalCTPs: number;
    totalNodes: number;
    totalLengthM: number;
  };
}

function classifyLayerByContentSync(propKeys: string[], geometryType: string, sampleNames: string[]): string {
  if (geometryType === "LineString") {
    if (propKeys.includes("Begin_uch") && propKeys.includes("End_uch")) {
      return "segment";
    }
    return "other";
  }

  if (geometryType === "Point") {
    if (propKeys.includes("Ust_moshn") || propKeys.includes("Naim_tepl") || propKeys.includes("Nomer_tep") || propKeys.includes("Otpusk_TE") || propKeys.includes("Qist") || propKeys.includes("Gist") || propKeys.includes("Qmax") || propKeys.includes("Qsum") || propKeys.includes("Name_pred") || propKeys.includes("Gmax")) {
      return "source";
    }

    for (const n of sampleNames) {
      const lower = (n || "").toLowerCase();
      if (lower.includes("кот.") || lower.includes("котельн") || lower.includes("грэс") || lower.includes("тэц") || lower.includes("бмк")) return "source";
    }

    if (propKeys.includes("Tip_zad") || propKeys.includes("Tip_arm") || propKeys.includes("Mark_pod") || propKeys.includes("Per_pod")) {
      return "valve";
    }

    for (const n of sampleNames) {
      const lower = (n || "").toLowerCase();
      if (lower.includes("зу-") || lower.includes("задвиж")) return "valve";
    }

    for (const n of sampleNames) {
      const lower = (n || "").toLowerCase();
      if (lower.includes("цтп") || lower.includes("итп") || lower.includes("бойлер")) return "ctp";
    }

    if ((propKeys.includes("Hnz_obr") || propKeys.includes("N_schem") || propKeys.includes("Hnz_ras")) && !propKeys.includes("Hzdan") && !propKeys.includes("Njil")) {
      return "ctp";
    }

    if (propKeys.includes("Qo_t") && propKeys.includes("Qgv_t") && propKeys.includes("Gsum_pod")) {
      return "ctp";
    }

    if (propKeys.includes("Qo_r") || propKeys.includes("Nagr_otop") || propKeys.includes("Rashod_go") || propKeys.includes("Qgv_sred") || propKeys.includes("Qsv_r")) {
      if (propKeys.includes("Dom") || propKeys.includes("Adres") || propKeys.includes("Ylitsa") || propKeys.includes("Hzdan") || propKeys.includes("N_schem")) {
        return "consumer";
      }
    }

    if (propKeys.includes("Adres") || propKeys.includes("Dom") || propKeys.includes("Ylitsa") || propKeys.includes("Hzdan")) {
      return "consumer";
    }

    if (propKeys.includes("Gpod") || propKeys.includes("Gobr") || propKeys.includes("H_geo")) {
      if (propKeys.includes("H_obr") || propKeys.includes("H_pod") || propKeys.includes("H_ras")) {
        for (const n of sampleNames) {
          const lower = (n || "").toLowerCase();
          if (lower.includes("тк-") || lower.includes("уз-") || lower.includes("ут-") || lower.includes("узел") || lower.includes("ду-")) return "node";
        }
        return "node";
      }
    }

    if (propKeys.includes("Type_pod") || propKeys.includes("Mark_pod") || propKeys.includes("Npod") || propKeys.includes("Hpod")) {
      for (const n of sampleNames) {
        const lower = (n || "").toLowerCase();
        if (lower.includes("насос") || lower.includes("нс-") || lower.includes("нс ")) return "pump";
      }
    }

    if (propKeys.includes("Lper") || propKeys.includes("Dper") || propKeys.includes("Gperem")) {
      return "node";
    }

    if (propKeys.includes("N_schem") && propKeys.includes("Gpod") && propKeys.includes("Sr")) {
      return "consumer";
    }
  }

  return "other";
}

export async function getSceneNetworkLayers(sceneId: number) {
  const layers = await db
    .select({
      id: editableLayers.id,
      name: editableLayers.name,
      geometryType: editableLayers.geometryType,
      sceneId: editableLayers.sceneId,
      networkType: editableLayers.networkType,
    })
    .from(editableLayers)
    .where(eq(editableLayers.sceneId, sceneId));

  const result: {
    segmentLayerIds: number[];
    nodeLayerIds: number[];
    consumerLayerIds: number[];
    ctpLayerIds: number[];
    sourceLayerIds: number[];
    valveLayerIds: number[];
    pumpLayerIds: number[];
  } = {
    segmentLayerIds: [],
    nodeLayerIds: [],
    consumerLayerIds: [],
    ctpLayerIds: [],
    sourceLayerIds: [],
    valveLayerIds: [],
    pumpLayerIds: [],
  };

  for (const layer of layers) {
    let layerType: string;

    if (layer.networkType) {
      layerType = layer.networkType;
      if (process.env.NODE_ENV !== "production") console.log(`[NetworkGraph] Layer "${layer.name}" (id=${layer.id}) => manual type: ${layerType}`);
    } else {
      const sampleFeatures = await db
        .select({ properties: drawnFeatures.properties })
        .from(drawnFeatures)
        .where(eq(drawnFeatures.layerId, layer.id))
        .limit(10);

      if (sampleFeatures.length === 0) continue;

      const props = sampleFeatures[0].properties as Record<string, unknown>;
      const propKeys = Object.keys(props);
      const sampleNames = sampleFeatures.map(f => {
        const p = f.properties as Record<string, unknown>;
        return (p.Name as string) || "";
      });

      layerType = classifyLayerByContentSync(propKeys, layer.geometryType, sampleNames);
      if (process.env.NODE_ENV !== "production") console.log(`[NetworkGraph] Layer "${layer.name}" (id=${layer.id}, geom=${layer.geometryType}) => auto type: ${layerType}`);
    }

    switch (layerType) {
      case "segment":
        result.segmentLayerIds.push(layer.id);
        break;
      case "node":
        result.nodeLayerIds.push(layer.id);
        break;
      case "consumer":
        result.consumerLayerIds.push(layer.id);
        break;
      case "ctp":
        result.ctpLayerIds.push(layer.id);
        break;
      case "source":
        result.sourceLayerIds.push(layer.id);
        break;
      case "valve":
        result.valveLayerIds.push(layer.id);
        break;
      case "pump":
        result.pumpLayerIds.push(layer.id);
        break;
    }
  }

  if (process.env.NODE_ENV !== "production") console.log(`[NetworkGraph] Classification: segments=${result.segmentLayerIds.length}, nodes=${result.nodeLayerIds.length}, consumers=${result.consumerLayerIds.length}, ctps=${result.ctpLayerIds.length}, sources=${result.sourceLayerIds.length}, valves=${result.valveLayerIds.length}, pumps=${result.pumpLayerIds.length}`);

  return result;
}

function isPrefixMatchSafe(a: string, b: string): boolean {
  if (a === b) return true;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.startsWith(shorter)) return false;
  const remainder = longer.slice(shorter.length);
  if (/^\d/.test(remainder)) return false;
  if (/^[а-яёa-z]/i.test(remainder)) return false;
  return true;
}

export interface TopologyError {
  featureId: number;
  layerId: number;
  segmentName: string;
  errorType: "orphan_begin" | "orphan_end" | "orphan_both" | "duplicate" | "empty_name" | "self_loop" | "geom_mismatch_begin" | "geom_mismatch_end" | "spatial_mismatch_begin" | "spatial_mismatch_end";
  field: string;
  currentValue: string;
  suggestedValue: string | null;
  suggestedFeatureId: number | null;
  distance: number | null;
  currentDistance: number | null;
  nist: string;
}

export interface TopologyValidationResult {
  totalSegments: number;
  totalPointNodes: number;
  totalErrors: number;
  errors: TopologyError[];
  stats: {
    orphanBegin: number;
    orphanEnd: number;
    orphanBoth: number;
    duplicates: number;
    emptyNames: number;
    selfLoops: number;
    geomMismatchBegin: number;
    geomMismatchEnd: number;
    spatialMismatchBegin: number;
    spatialMismatchEnd: number;
  };
}

function getLineEndpoints(coordinates: any): { start: [number, number]; end: [number, number] } | null {
  if (!coordinates) return null;
  let coords: number[][] = [];
  if (Array.isArray(coordinates) && coordinates.length > 0) {
    if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
      coords = coordinates;
    } else if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0])) {
      coords = coordinates[0];
    }
  }
  if (coords.length < 2) return null;
  return {
    start: [coords[0][0], coords[0][1]],
    end: [coords[coords.length - 1][0], coords[coords.length - 1][1]],
  };
}

function isGeographicCRS(crs: string): boolean {
  const geo = ["EPSG:4326", "EPSG:4269", "EPSG:4267", "CRS:84", "WGS84", "WGS 84"];
  return geo.some(g => crs.toUpperCase().includes(g.toUpperCase()));
}

function distanceBetweenPoints(a: [number, number], b: [number, number], useHaversine = true): number {
  if (!useHaversine) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  const R = 6371000;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getPointCoords(coordinates: any): [number, number] | null {
  if (!coordinates) return null;
  if (Array.isArray(coordinates) && coordinates.length >= 2 && typeof coordinates[0] === "number") {
    return [coordinates[0], coordinates[1]];
  }
  if (typeof coordinates === "object" && coordinates.coordinates) {
    return getPointCoords(coordinates.coordinates);
  }
  return null;
}

function findFuzzyMatchTopo(name: string, pointMap: Map<string, any>): string | null {
  const norm = name.toLowerCase();
  for (const key of Array.from(pointMap.keys())) {
    if (key.toLowerCase() === norm) return key;
  }
  for (const key of Array.from(pointMap.keys())) {
    const keyNorm = key.toLowerCase();
    if (isPrefixMatchSafe(norm, keyNorm)) return key;
  }
  return null;
}

function findNearestPoint(
  coord: [number, number],
  points: Array<{ id: number; name: string; normName: string; coords: [number, number] }>,
  maxDistM: number,
  useHaversine = true,
  excludeNames?: Set<string>,
): { name: string; id: number; dist: number } | null {
  let best: { name: string; id: number; dist: number } | null = null;
  for (const p of points) {
    if (excludeNames && excludeNames.has(p.normName)) continue;
    const d = distanceBetweenPoints(coord, p.coords, useHaversine);
    if (d <= maxDistM && (!best || d < best.dist)) {
      best = { name: p.name, id: p.id, dist: d };
    }
  }
  return best;
}

export async function validateTopology(sceneId: number): Promise<TopologyValidationResult> {
  const layerConfig = await getSceneNetworkLayers(sceneId);

  if (layerConfig.segmentLayerIds.length === 0) {
    return {
      totalSegments: 0, totalPointNodes: 0, totalErrors: 0, errors: [],
      stats: { orphanBegin: 0, orphanEnd: 0, orphanBoth: 0, duplicates: 0, emptyNames: 0, selfLoops: 0, geomMismatchBegin: 0, geomMismatchEnd: 0, spatialMismatchBegin: 0, spatialMismatchEnd: 0 },
    };
  }

  const segments = await db
    .select({ id: drawnFeatures.id, layerId: drawnFeatures.layerId, coordinates: drawnFeatures.coordinates, properties: drawnFeatures.properties })
    .from(drawnFeatures)
    .where(inArray(drawnFeatures.layerId, layerConfig.segmentLayerIds));

  const allPointLayerIds = [
    ...layerConfig.nodeLayerIds, ...layerConfig.consumerLayerIds,
    ...layerConfig.ctpLayerIds, ...layerConfig.sourceLayerIds,
    ...layerConfig.valveLayerIds, ...layerConfig.pumpLayerIds,
  ];

  const allLayerIds = [...layerConfig.segmentLayerIds, ...allPointLayerIds];
  let useHaversine = true;
  if (allLayerIds.length > 0) {
    const layerCrsRows = await db
      .select({ crs: editableLayers.crs })
      .from(editableLayers)
      .where(inArray(editableLayers.id, allLayerIds));
    const hasProjected = layerCrsRows.some(r => !isGeographicCRS(r.crs));
    if (hasProjected) useHaversine = false;
  }

  let pointFeatures: Array<{ id: number; layerId: number; coordinates: any; properties: Record<string, unknown> }> = [];
  if (allPointLayerIds.length > 0) {
    pointFeatures = (await db
      .select({ id: drawnFeatures.id, layerId: drawnFeatures.layerId, coordinates: drawnFeatures.coordinates, properties: drawnFeatures.properties })
      .from(drawnFeatures)
      .where(inArray(drawnFeatures.layerId, allPointLayerIds))) as any;
  }

  const pointNodeMap = new Map<string, { id: number; coords: [number, number] | null; name: string }>();
  const pointsByCoords: Array<{ id: number; name: string; normName: string; coords: [number, number] }> = [];

  for (const pf of pointFeatures) {
    const props = pf.properties as Record<string, unknown>;
    const nameRaw = (props.Name as string) || "";
    if (!nameRaw) continue;
    const name = normalizeName(nameRaw);
    const coords = getPointCoords(pf.coordinates);
    pointNodeMap.set(name, { id: pf.id, coords, name });
    if (coords) {
      pointsByCoords.push({ id: pf.id, name, normName: name.toLowerCase(), coords });
    }
  }

  const errors: TopologyError[] = [];
  const segmentKeys = new Map<string, number>();

  const SPATIAL_SNAP_RADIUS = 5;

  for (const seg of segments) {
    const props = seg.properties as Record<string, unknown>;
    const beginRaw = (props.Begin_uch as string) || "";
    const endRaw = (props.End_uch as string) || "";
    const nist = (props.Nist as string) || "";
    const beginNorm = normalizeName(beginRaw);
    const endNorm = normalizeName(endRaw);
    const segLabel = `${beginRaw} → ${endRaw}`;

    if (!beginRaw && !endRaw) {
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "empty_name", field: "Begin_uch, End_uch",
        currentValue: "", suggestedValue: null, suggestedFeatureId: null, distance: null, currentDistance: null, nist,
      });
      continue;
    }

    if (beginNorm === endNorm && beginNorm) {
      const loopEndpoints = getLineEndpoints(seg.coordinates);
      let loopField: string = "Begin_uch = End_uch";
      let loopSuggested: string | null = null;
      let loopSuggestedId: number | null = null;
      let loopDist: number | null = null;

      if (loopEndpoints) {
        const matchKey = findFuzzyMatchTopo(beginNorm, pointNodeMap) || beginNorm;
        const currentNode = pointNodeMap.get(matchKey);
        const excludeCurrentName = new Set([beginNorm.toLowerCase(), matchKey.toLowerCase()]);

        const altNearStart = findNearestPoint(loopEndpoints.start, pointsByCoords, 500, useHaversine, excludeCurrentName);
        const altNearEnd = findNearestPoint(loopEndpoints.end, pointsByCoords, 500, useHaversine, excludeCurrentName);

        if (currentNode && currentNode.coords) {
          const distStartToNode = distanceBetweenPoints(loopEndpoints.start, currentNode.coords, useHaversine);
          const distEndToNode = distanceBetweenPoints(loopEndpoints.end, currentNode.coords, useHaversine);

          if (distStartToNode <= distEndToNode) {
            if (altNearEnd) {
              loopField = "End_uch";
              loopSuggested = altNearEnd.name;
              loopSuggestedId = altNearEnd.id;
              loopDist = Math.round(altNearEnd.dist);
            } else if (altNearStart) {
              loopField = "Begin_uch";
              loopSuggested = altNearStart.name;
              loopSuggestedId = altNearStart.id;
              loopDist = Math.round(altNearStart.dist);
            }
          } else {
            if (altNearStart) {
              loopField = "Begin_uch";
              loopSuggested = altNearStart.name;
              loopSuggestedId = altNearStart.id;
              loopDist = Math.round(altNearStart.dist);
            } else if (altNearEnd) {
              loopField = "End_uch";
              loopSuggested = altNearEnd.name;
              loopSuggestedId = altNearEnd.id;
              loopDist = Math.round(altNearEnd.dist);
            }
          }
        } else {
          if (altNearStart && altNearEnd) {
            if (altNearStart.dist <= altNearEnd.dist) {
              loopField = "Begin_uch";
              loopSuggested = altNearStart.name;
              loopSuggestedId = altNearStart.id;
              loopDist = Math.round(altNearStart.dist);
            } else {
              loopField = "End_uch";
              loopSuggested = altNearEnd.name;
              loopSuggestedId = altNearEnd.id;
              loopDist = Math.round(altNearEnd.dist);
            }
          } else if (altNearEnd) {
            loopField = "End_uch";
            loopSuggested = altNearEnd.name;
            loopSuggestedId = altNearEnd.id;
            loopDist = Math.round(altNearEnd.dist);
          } else if (altNearStart) {
            loopField = "Begin_uch";
            loopSuggested = altNearStart.name;
            loopSuggestedId = altNearStart.id;
            loopDist = Math.round(altNearStart.dist);
          }
        }
      }

      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "self_loop", field: loopField,
        currentValue: beginRaw, suggestedValue: loopSuggested, suggestedFeatureId: loopSuggestedId, distance: loopDist, currentDistance: null, nist,
      });
    }

    const dupKey = `${beginNorm}||${endNorm}||${nist}`;
    if (segmentKeys.has(dupKey)) {
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "duplicate", field: "Begin_uch, End_uch",
        currentValue: segLabel, suggestedValue: null,
        suggestedFeatureId: segmentKeys.get(dupKey) || null,
        distance: null, currentDistance: null, nist,
      });
    }
    segmentKeys.set(dupKey, seg.id);

    const beginFound = beginNorm ? (pointNodeMap.has(beginNorm) || findFuzzyMatchTopo(beginNorm, pointNodeMap) !== null) : true;
    const endFound = endNorm ? (pointNodeMap.has(endNorm) || findFuzzyMatchTopo(endNorm, pointNodeMap) !== null) : true;

    const endpoints = getLineEndpoints(seg.coordinates);

    if (!beginFound && !endFound && beginNorm && endNorm) {
      let sugBegin: { name: string; id: number; dist: number } | null = null;
      let sugEnd: { name: string; id: number; dist: number } | null = null;
      if (endpoints) {
        sugBegin = findNearestPoint(endpoints.start, pointsByCoords, 200, useHaversine);
        sugEnd = findNearestPoint(endpoints.end, pointsByCoords, 200, useHaversine);
      }
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "orphan_both", field: "Begin_uch",
        currentValue: beginRaw,
        suggestedValue: sugBegin?.name || null,
        suggestedFeatureId: sugBegin?.id || null,
        distance: sugBegin ? Math.round(sugBegin.dist) : null, currentDistance: null, nist,
      });
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "orphan_both", field: "End_uch",
        currentValue: endRaw,
        suggestedValue: sugEnd?.name || null,
        suggestedFeatureId: sugEnd?.id || null,
        distance: sugEnd ? Math.round(sugEnd.dist) : null, currentDistance: null, nist,
      });
    } else {
      if (!beginFound && beginNorm) {
        let suggestion: { name: string; id: number; dist: number } | null = null;
        if (endpoints) suggestion = findNearestPoint(endpoints.start, pointsByCoords, 200, useHaversine);
        errors.push({
          featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
          errorType: "orphan_begin", field: "Begin_uch",
          currentValue: beginRaw,
          suggestedValue: suggestion?.name || null,
          suggestedFeatureId: suggestion?.id || null,
          distance: suggestion ? Math.round(suggestion.dist) : null, currentDistance: null, nist,
        });
      }
      if (!endFound && endNorm) {
        let suggestion: { name: string; id: number; dist: number } | null = null;
        if (endpoints) suggestion = findNearestPoint(endpoints.end, pointsByCoords, 200, useHaversine);
        errors.push({
          featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
          errorType: "orphan_end", field: "End_uch",
          currentValue: endRaw,
          suggestedValue: suggestion?.name || null,
          suggestedFeatureId: suggestion?.id || null,
          distance: suggestion ? Math.round(suggestion.dist) : null, currentDistance: null, nist,
        });
      }
    }

    if (endpoints) {
      if (beginNorm && beginFound) {
        const matchKey = findFuzzyMatchTopo(beginNorm, pointNodeMap) || beginNorm;
        const pn = pointNodeMap.get(matchKey);
        if (pn && pn.coords) {
          const distToCurrentNode = distanceBetweenPoints(endpoints.start, pn.coords, useHaversine);

          const nearestSnap = findNearestPoint(endpoints.start, pointsByCoords, SPATIAL_SNAP_RADIUS, useHaversine);

          if (nearestSnap && normalizeName(nearestSnap.name) !== beginNorm && normalizeName(nearestSnap.name) !== matchKey) {
            errors.push({
              featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
              errorType: "spatial_mismatch_begin", field: "Begin_uch",
              currentValue: beginRaw,
              suggestedValue: nearestSnap.name,
              suggestedFeatureId: nearestSnap.id,
              distance: Math.round(nearestSnap.dist * 100) / 100,
              currentDistance: Math.round(distToCurrentNode * 100) / 100,
              nist,
            });
          } else if (distToCurrentNode > 50) {
            const nearest = findNearestPoint(endpoints.start, pointsByCoords, 200, useHaversine);
            if (nearest && normalizeName(nearest.name) !== beginNorm && normalizeName(nearest.name) !== matchKey) {
              errors.push({
                featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
                errorType: "geom_mismatch_begin", field: "Begin_uch",
                currentValue: beginRaw,
                suggestedValue: nearest.name,
                suggestedFeatureId: nearest.id,
                distance: Math.round(nearest.dist),
                currentDistance: Math.round(distToCurrentNode),
                nist,
              });
            }
          }
        }
      }
      if (endNorm && endFound) {
        const matchKey = findFuzzyMatchTopo(endNorm, pointNodeMap) || endNorm;
        const pn = pointNodeMap.get(matchKey);
        if (pn && pn.coords) {
          const distToCurrentNode = distanceBetweenPoints(endpoints.end, pn.coords, useHaversine);

          const nearestSnap = findNearestPoint(endpoints.end, pointsByCoords, SPATIAL_SNAP_RADIUS, useHaversine);

          if (nearestSnap && normalizeName(nearestSnap.name) !== endNorm && normalizeName(nearestSnap.name) !== matchKey) {
            errors.push({
              featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
              errorType: "spatial_mismatch_end", field: "End_uch",
              currentValue: endRaw,
              suggestedValue: nearestSnap.name,
              suggestedFeatureId: nearestSnap.id,
              distance: Math.round(nearestSnap.dist * 100) / 100,
              currentDistance: Math.round(distToCurrentNode * 100) / 100,
              nist,
            });
          } else if (distToCurrentNode > 50) {
            const nearest = findNearestPoint(endpoints.end, pointsByCoords, 200, useHaversine);
            if (nearest && normalizeName(nearest.name) !== endNorm && normalizeName(nearest.name) !== matchKey) {
              errors.push({
                featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
                errorType: "geom_mismatch_end", field: "End_uch",
                currentValue: endRaw,
                suggestedValue: nearest.name,
                suggestedFeatureId: nearest.id,
                distance: Math.round(nearest.dist),
                currentDistance: Math.round(distToCurrentNode),
                nist,
              });
            }
          }
        }
      }
    }
  }

  const stats = {
    orphanBegin: errors.filter(e => e.errorType === "orphan_begin").length,
    orphanEnd: errors.filter(e => e.errorType === "orphan_end").length,
    orphanBoth: errors.filter(e => e.errorType === "orphan_both" && e.field === "Begin_uch").length,
    duplicates: errors.filter(e => e.errorType === "duplicate").length,
    emptyNames: errors.filter(e => e.errorType === "empty_name").length,
    selfLoops: errors.filter(e => e.errorType === "self_loop").length,
    geomMismatchBegin: errors.filter(e => e.errorType === "geom_mismatch_begin").length,
    geomMismatchEnd: errors.filter(e => e.errorType === "geom_mismatch_end").length,
    spatialMismatchBegin: errors.filter(e => e.errorType === "spatial_mismatch_begin").length,
    spatialMismatchEnd: errors.filter(e => e.errorType === "spatial_mismatch_end").length,
  };

  return { totalSegments: segments.length, totalPointNodes: pointFeatures.length, totalErrors: errors.length, errors, stats };
}

export async function applyTopologyFixes(
  fixes: Array<{ featureId: number; field: string; newValue: string }>
): Promise<{ applied: number; failed: number; details: Array<{ featureId: number; success: boolean; error?: string }> }> {
  let applied = 0;
  let failed = 0;
  const details: Array<{ featureId: number; success: boolean; error?: string }> = [];

  for (const fix of fixes) {
    try {
      if (fix.field !== "Begin_uch" && fix.field !== "End_uch") {
        details.push({ featureId: fix.featureId, success: false, error: `Unknown field: ${fix.field}` });
        failed++;
        continue;
      }
      await db
        .update(drawnFeatures)
        .set({
          properties: sql`jsonb_set(${drawnFeatures.properties}, ${`{${fix.field}}`}, ${JSON.stringify(fix.newValue)}::jsonb)`,
        })
        .where(eq(drawnFeatures.id, fix.featureId));
      applied++;
      details.push({ featureId: fix.featureId, success: true });
    } catch (err: any) {
      failed++;
      details.push({ featureId: fix.featureId, success: false, error: err.message });
    }
  }

  return { applied, failed, details };
}

export interface RecalcBindingResult {
  featureId: number;
  layerId: number;
  segmentName: string;
  field: "Begin_uch" | "End_uch";
  currentValue: string;
  newValue: string;
  distance: number;
  nist: string;
}

export async function recalculateBindings(sceneId: number): Promise<{
  totalSegments: number;
  changes: RecalcBindingResult[];
  unchanged: number;
  noMatch: number;
}> {
  const layerConfig = await getSceneNetworkLayers(sceneId);

  if (layerConfig.segmentLayerIds.length === 0) {
    return { totalSegments: 0, changes: [], unchanged: 0, noMatch: 0 };
  }

  const segments = await db
    .select({ id: drawnFeatures.id, layerId: drawnFeatures.layerId, coordinates: drawnFeatures.coordinates, properties: drawnFeatures.properties })
    .from(drawnFeatures)
    .where(inArray(drawnFeatures.layerId, layerConfig.segmentLayerIds));

  const allPointLayerIds = [
    ...layerConfig.nodeLayerIds, ...layerConfig.consumerLayerIds,
    ...layerConfig.ctpLayerIds, ...layerConfig.sourceLayerIds,
    ...layerConfig.valveLayerIds, ...layerConfig.pumpLayerIds,
  ];

  const allLayerIds = [...layerConfig.segmentLayerIds, ...allPointLayerIds];
  let useHaversine = true;
  if (allLayerIds.length > 0) {
    const layerCrsRows = await db
      .select({ crs: editableLayers.crs })
      .from(editableLayers)
      .where(inArray(editableLayers.id, allLayerIds));
    const hasProjected = layerCrsRows.some(r => !isGeographicCRS(r.crs));
    if (hasProjected) useHaversine = false;
  }

  let pointFeatures: Array<{ id: number; layerId: number; coordinates: any; properties: Record<string, unknown> }> = [];
  if (allPointLayerIds.length > 0) {
    pointFeatures = (await db
      .select({ id: drawnFeatures.id, layerId: drawnFeatures.layerId, coordinates: drawnFeatures.coordinates, properties: drawnFeatures.properties })
      .from(drawnFeatures)
      .where(inArray(drawnFeatures.layerId, allPointLayerIds))) as any;
  }

  const pointsByCoords: Array<{ id: number; name: string; normName: string; coords: [number, number] }> = [];
  for (const pf of pointFeatures) {
    const props = pf.properties as Record<string, unknown>;
    const nameRaw = (props.Name as string) || "";
    if (!nameRaw) continue;
    const name = normalizeName(nameRaw);
    const coords = getPointCoords(pf.coordinates);
    if (coords) {
      pointsByCoords.push({ id: pf.id, name, normName: name.toLowerCase(), coords });
    }
  }

  const SNAP_RADIUS = 5;
  const changes: RecalcBindingResult[] = [];
  let unchanged = 0;
  let noMatch = 0;

  for (const seg of segments) {
    const props = seg.properties as Record<string, unknown>;
    const beginRaw = (props.Begin_uch as string) || "";
    const endRaw = (props.End_uch as string) || "";
    const nist = (props.Nist as string) || "";
    const beginNorm = normalizeName(beginRaw);
    const endNorm = normalizeName(endRaw);
    const segLabel = `${beginRaw} → ${endRaw}`;

    const endpoints = getLineEndpoints(seg.coordinates);
    if (!endpoints) {
      noMatch += 2;
      continue;
    }

    const nearestBegin = findNearestPoint(endpoints.start, pointsByCoords, SNAP_RADIUS, useHaversine);
    if (nearestBegin) {
      if (normalizeName(nearestBegin.name) !== beginNorm) {
        changes.push({
          featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
          field: "Begin_uch", currentValue: beginRaw, newValue: nearestBegin.name,
          distance: Math.round(nearestBegin.dist * 100) / 100, nist,
        });
      } else {
        unchanged++;
      }
    } else {
      noMatch++;
    }

    const nearestEnd = findNearestPoint(endpoints.end, pointsByCoords, SNAP_RADIUS, useHaversine);
    if (nearestEnd) {
      if (normalizeName(nearestEnd.name) !== endNorm) {
        changes.push({
          featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
          field: "End_uch", currentValue: endRaw, newValue: nearestEnd.name,
          distance: Math.round(nearestEnd.dist * 100) / 100, nist,
        });
      } else {
        unchanged++;
      }
    } else {
      noMatch++;
    }
  }

  return { totalSegments: segments.length, changes, unchanged, noMatch };
}

interface SpatialGraphNode {
  coordKey: string;
  coordinates: [number, number];
  type: "source" | "ctp" | "consumer" | "node" | "valve" | "pump" | "other";
  featureId: number;
  layerId: number;
  name: string;
  properties: Record<string, unknown>;
}

interface SpatialGraphEdge {
  fromKey: string;
  toKey: string;
  featureId: number;
  layerId: number;
  length: number;
  coordinates: any;
  properties: Record<string, unknown>;
  name: string;
}

interface SpatialGraph {
  nodes: Map<string, SpatialGraphNode>;
  edges: SpatialGraphEdge[];
  adjacency: Map<string, Set<string>>;
  edgesByNode: Map<string, SpatialGraphEdge[]>;
}

function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

function extractEndpoints(coordinates: any): { start: [number, number]; end: [number, number] } | null {
  if (!coordinates) return null;
  let coords: number[][] = [];
  if (Array.isArray(coordinates) && coordinates.length > 0) {
    if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
      coords = coordinates;
    } else if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0])) {
      coords = coordinates[0];
    }
  }
  if (coords.length < 2) return null;
  return {
    start: [coords[0][0], coords[0][1]],
    end: [coords[coords.length - 1][0], coords[coords.length - 1][1]],
  };
}

function extractPointCoord(coordinates: any): [number, number] | null {
  if (!coordinates) return null;
  if (Array.isArray(coordinates) && coordinates.length >= 2 && typeof coordinates[0] === "number") {
    return [coordinates[0], coordinates[1]];
  }
  if (typeof coordinates === "object" && coordinates.coordinates) {
    return extractPointCoord(coordinates.coordinates);
  }
  return null;
}

export async function buildSpatialNetworkGraph(sceneId: number): Promise<SpatialGraph> {
  const graph: SpatialGraph = {
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
    edgesByNode: new Map(),
  };

  const layerConfig = await getSceneNetworkLayers(sceneId);

  if (layerConfig.segmentLayerIds.length === 0) return graph;

  const segments = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(inArray(drawnFeatures.layerId, layerConfig.segmentLayerIds));

  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Total segments loaded: ${segments.length}`);

  let skippedDisabled = 0;

  for (const seg of segments) {
    const props = seg.properties as Record<string, unknown>;

    const zMode = props.ZMode !== undefined && props.ZMode !== null ? Number(props.ZMode) : null;
    if (zMode === 2) {
      skippedDisabled++;
      continue;
    }

    const endpoints = extractEndpoints(seg.coordinates);
    if (!endpoints) continue;

    const fromKey = coordKey(endpoints.start[0], endpoints.start[1]);
    const toKey = coordKey(endpoints.end[0], endpoints.end[1]);

    if (fromKey === toKey) continue;

    const beginName = (props.Begin_uch as string) || "";
    const endName = (props.End_uch as string) || "";
    const length = parseFloat((props.L as string) || "0") || 0;

    if (!graph.nodes.has(fromKey)) {
      graph.nodes.set(fromKey, {
        coordKey: fromKey,
        coordinates: endpoints.start,
        type: "other",
        featureId: 0,
        layerId: 0,
        name: beginName,
        properties: {},
      });
    }
    if (!graph.nodes.has(toKey)) {
      graph.nodes.set(toKey, {
        coordKey: toKey,
        coordinates: endpoints.end,
        type: "other",
        featureId: 0,
        layerId: 0,
        name: endName,
        properties: {},
      });
    }

    const edge: SpatialGraphEdge = {
      fromKey,
      toKey,
      featureId: seg.id,
      layerId: seg.layerId,
      length,
      coordinates: seg.coordinates,
      properties: props,
      name: `${beginName} → ${endName}`,
    };
    graph.edges.push(edge);

    if (!graph.adjacency.has(fromKey)) graph.adjacency.set(fromKey, new Set());
    if (!graph.adjacency.has(toKey)) graph.adjacency.set(toKey, new Set());
    graph.adjacency.get(fromKey)!.add(toKey);
    graph.adjacency.get(toKey)!.add(fromKey);

    if (!graph.edgesByNode.has(fromKey)) graph.edgesByNode.set(fromKey, []);
    if (!graph.edgesByNode.has(toKey)) graph.edgesByNode.set(toKey, []);
    graph.edgesByNode.get(fromKey)!.push(edge);
    graph.edgesByNode.get(toKey)!.push(edge);
  }

  const allPointLayerIds = [
    ...layerConfig.nodeLayerIds, ...layerConfig.consumerLayerIds,
    ...layerConfig.ctpLayerIds, ...layerConfig.sourceLayerIds,
    ...layerConfig.valveLayerIds, ...layerConfig.pumpLayerIds,
  ];

  if (allPointLayerIds.length > 0) {
    const pointFeatures = await db
      .select({
        id: drawnFeatures.id,
        layerId: drawnFeatures.layerId,
        coordinates: drawnFeatures.coordinates,
        properties: drawnFeatures.properties,
      })
      .from(drawnFeatures)
      .where(inArray(drawnFeatures.layerId, allPointLayerIds));

    for (const feat of pointFeatures) {
      const coord = extractPointCoord(feat.coordinates);
      if (!coord) continue;

      const key = coordKey(coord[0], coord[1]);
      const props = feat.properties as Record<string, unknown>;
      const nameRaw = (props.Name as string) || "";

      let nodeType: SpatialGraphNode["type"];
      if (layerConfig.sourceLayerIds.includes(feat.layerId)) nodeType = "source";
      else if (layerConfig.ctpLayerIds.includes(feat.layerId)) nodeType = "ctp";
      else if (layerConfig.consumerLayerIds.includes(feat.layerId)) nodeType = "consumer";
      else if (layerConfig.nodeLayerIds.includes(feat.layerId)) nodeType = "node";
      else if (layerConfig.valveLayerIds.includes(feat.layerId)) nodeType = "valve";
      else if (layerConfig.pumpLayerIds.includes(feat.layerId)) nodeType = "pump";
      else nodeType = "other";

      const existing = graph.nodes.get(key);
      if (existing) {
        if (existing.featureId === 0 || (nodeType !== "other" && nodeType !== "node")) {
          existing.type = nodeType;
          existing.featureId = feat.id;
          existing.layerId = feat.layerId;
          existing.name = nameRaw || existing.name;
          existing.properties = props;
        }
      }
    }
  }

  let closedValves = 0;
  for (const [key, node] of graph.nodes) {
    if (node.type === "valve") {
      const valveZMode = node.properties.ZMode !== undefined && node.properties.ZMode !== null ? Number(node.properties.ZMode) : null;
      if (valveZMode === 2) {
        closedValves++;
        const neighbors = graph.adjacency.get(key);
        if (neighbors) {
          for (const neighbor of neighbors) {
            const neighborSet = graph.adjacency.get(neighbor);
            if (neighborSet) {
              neighborSet.delete(key);
            }
          }
          graph.adjacency.set(key, new Set());
        }

        graph.edges = graph.edges.filter(e => e.fromKey !== key && e.toKey !== key);

        graph.edgesByNode.set(key, []);
        for (const [nk, edges] of graph.edgesByNode) {
          if (nk !== key) {
            graph.edgesByNode.set(nk, edges.filter(e => e.fromKey !== key && e.toKey !== key));
          }
        }
      }
    }
  }

  const nodeTypes = new Map<string, number>();
  for (const [, node] of graph.nodes) {
    nodeTypes.set(node.type, (nodeTypes.get(node.type) || 0) + 1);
  }
  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Graph built: ${graph.nodes.size} nodes, ${graph.edges.length} edges`);
  if (skippedDisabled > 0) {
    if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Skipped ${skippedDisabled} disabled segments (ZMode=2)`);
  }
  if (closedValves > 0) {
    if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Disconnected ${closedValves} closed valves (ZMode=2)`);
  }
  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Node types:`, Object.fromEntries(nodeTypes));

  return graph;
}

function findFeatureInSpatialGraph(
  graph: SpatialGraph,
  featureId: number,
  layerId: number,
  featureCoordinates: any,
  geometryType: string
): { nodeKeys: string[]; isEdge: boolean } {
  if (geometryType === "LineString") {
    for (const edge of graph.edges) {
      if (edge.featureId === featureId && edge.layerId === layerId) {
        return { nodeKeys: [edge.fromKey, edge.toKey], isEdge: true };
      }
    }
    const endpoints = extractEndpoints(featureCoordinates);
    if (endpoints) {
      const fromKey = coordKey(endpoints.start[0], endpoints.start[1]);
      const toKey = coordKey(endpoints.end[0], endpoints.end[1]);
      const keys: string[] = [];
      if (graph.nodes.has(fromKey)) keys.push(fromKey);
      if (graph.nodes.has(toKey)) keys.push(toKey);
      if (keys.length > 0) return { nodeKeys: keys, isEdge: true };
    }
  } else {
    for (const [key, node] of graph.nodes) {
      if (node.featureId === featureId && node.layerId === layerId) {
        return { nodeKeys: [key], isEdge: false };
      }
    }
    const coord = extractPointCoord(featureCoordinates);
    if (coord) {
      const key = coordKey(coord[0], coord[1]);
      if (graph.nodes.has(key)) return { nodeKeys: [key], isEdge: false };
    }
  }
  return { nodeKeys: [], isEdge: false };
}

function findSourceInComponent(
  graph: SpatialGraph,
  componentNodes: Set<string>
): string | null {
  for (const key of componentNodes) {
    const node = graph.nodes.get(key);
    if (node && node.type === "source") return key;
  }

  const sourcePatterns = ["кот.", "котельн", "грэс", "тэц", "бмк", "бойлерн", "мини-тэц"];
  for (const key of componentNodes) {
    const node = graph.nodes.get(key);
    if (!node) continue;
    const lower = node.name.toLowerCase();
    for (const pattern of sourcePatterns) {
      if (lower.includes(pattern)) return key;
    }
  }

  return null;
}

function getConnectedComponent(
  graph: SpatialGraph,
  startKey: string
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startKey];
  visited.add(startKey);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.adjacency.get(current);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

function spatialBfsFromSource(
  graph: SpatialGraph,
  sourceKey: string,
  componentNodes: Set<string>
): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  parent.set(sourceKey, null);
  const queue: string[] = [sourceKey];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.adjacency.get(current);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!parent.has(neighbor) && componentNodes.has(neighbor)) {
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return parent;
}

function getSpatialDownstream(
  parentMap: Map<string, string | null>,
  failureKeys: string[],
  sourceKey: string
): Set<string> {
  const children = new Map<string, string[]>();
  for (const [node, par] of parentMap) {
    if (par !== null) {
      if (!children.has(par)) children.set(par, []);
      children.get(par)!.push(node);
    }
  }

  const downstream = new Set<string>();
  for (const key of failureKeys) {
    if (key === sourceKey) continue;
    downstream.add(key);
  }

  const collectDownstream = (nodeKey: string) => {
    const childNodes = children.get(nodeKey) || [];
    for (const child of childNodes) {
      if (!downstream.has(child)) {
        downstream.add(child);
        collectDownstream(child);
      }
    }
  };

  for (const key of failureKeys) {
    collectDownstream(key);
  }

  return downstream;
}

function getDepth(parentMap: Map<string, string | null>, key: string): number {
  let depth = 0;
  let current = key;
  while (true) {
    const p = parentMap.get(current);
    if (p === null || p === undefined) break;
    depth++;
    current = p;
  }
  return depth;
}

export async function simulateSpatialDisconnection(
  featureId: number,
  layerId: number,
  sceneId: number
): Promise<SimulationResult> {
  const feature = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      geometryType: drawnFeatures.geometryType,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(eq(drawnFeatures.id, featureId))
    .limit(1);

  if (feature.length === 0) {
    throw new Error("Feature not found");
  }

  const feat = feature[0];
  const props = feat.properties as Record<string, unknown>;
  const featName = (props.Name as string) || (props.Begin_uch as string) || "";

  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] === Spatial Simulation Start ===`);
  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Feature: id=${featureId}, layer=${layerId}, name="${featName}", geom=${feat.geometryType}`);

  const graph = await buildSpatialNetworkGraph(sceneId);

  const found = findFeatureInSpatialGraph(graph, featureId, layerId, feat.coordinates, feat.geometryType);

  if (found.nodeKeys.length === 0) {
    throw new Error(`Объект "${featName}" (id=${featureId}) не найден в пространственном графе. Граф содержит ${graph.nodes.size} узлов и ${graph.edges.length} рёбер.`);
  }

  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Found ${found.nodeKeys.length} node keys, isEdge=${found.isEdge}`);

  const startKey = found.nodeKeys[0];
  const componentNodes = getConnectedComponent(graph, startKey);
  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Connected component: ${componentNodes.size} nodes`);

  const sourceKey = findSourceInComponent(graph, componentNodes);
  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Source in component: ${sourceKey ? graph.nodes.get(sourceKey)?.name : "NOT FOUND"}`);

  let targetNodes: Set<string>;

  if (!sourceKey) {
    targetNodes = componentNodes;
    if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] No source found, using entire component as affected zone`);
  } else {
    const parentMap = spatialBfsFromSource(graph, sourceKey, componentNodes);
    if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] BFS tree: ${parentMap.size} nodes reachable from source`);

    if (found.nodeKeys.includes(sourceKey)) {
      targetNodes = componentNodes;
      if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Failure at source, entire component affected`);
    } else if (found.isEdge && found.nodeKeys.length === 2) {
      const [keyA, keyB] = found.nodeKeys;
      const parentA = parentMap.get(keyA);
      const parentB = parentMap.get(keyB);

      let downstreamKey: string | null = null;
      if (parentB === keyA) {
        downstreamKey = keyB;
      } else if (parentA === keyB) {
        downstreamKey = keyA;
      } else {
        const depthA = getDepth(parentMap, keyA);
        const depthB = getDepth(parentMap, keyB);
        downstreamKey = depthA > depthB ? keyA : keyB;
      }

      if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Edge failure: downstream endpoint = ${downstreamKey}`);

      if (downstreamKey && parentMap.has(downstreamKey)) {
        targetNodes = getSpatialDownstream(parentMap, [downstreamKey], sourceKey);
      } else {
        targetNodes = new Set(found.nodeKeys);
      }
      if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Downstream nodes: ${targetNodes.size}`);
    } else {
      const failureKeys = found.nodeKeys.filter(k => k !== sourceKey);
      const downstreamKeys = failureKeys.filter(k => parentMap.has(k));
      if (downstreamKeys.length === 0) {
        targetNodes = new Set(found.nodeKeys);
      } else {
        targetNodes = getSpatialDownstream(parentMap, downstreamKeys, sourceKey);
      }
      if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Downstream nodes: ${targetNodes.size}`);
    }
  }

  const affectedConsumers: SimulationResult["affectedConsumers"] = [];
  const affectedCTPs: SimulationResult["affectedCTPs"] = [];
  const affectedNodes: SimulationResult["affectedNodes"] = [];

  for (const nodeKey of targetNodes) {
    const node = graph.nodes.get(nodeKey);
    if (!node || node.featureId === 0) continue;

    switch (node.type) {
      case "consumer":
        affectedConsumers.push({
          featureId: node.featureId,
          layerId: node.layerId,
          name: node.name,
          address: (node.properties.Adres as string) || node.name,
          coordinates: node.coordinates,
        });
        break;
      case "ctp":
        affectedCTPs.push({
          featureId: node.featureId,
          layerId: node.layerId,
          name: node.name,
          address: (node.properties.Adres as string) || "",
          coordinates: node.coordinates,
        });
        break;
      case "source":
        break;
      default:
        affectedNodes.push({
          featureId: node.featureId,
          layerId: node.layerId,
          name: node.name,
          coordinates: node.coordinates,
        });
        break;
    }
  }

  const affectedSegments: SimulationResult["affectedSegments"] = [];
  let totalLengthM = 0;

  for (const edge of graph.edges) {
    const fromInSet = targetNodes.has(edge.fromKey);
    const toInSet = targetNodes.has(edge.toKey);

    if (fromInSet && toInSet) {
      const edgeProps = edge.properties;
      affectedSegments.push({
        featureId: edge.featureId,
        layerId: edge.layerId,
        from: (edgeProps.Begin_uch as string) || edge.fromKey,
        to: (edgeProps.End_uch as string) || edge.toKey,
        length: edge.length,
        coordinates: edge.coordinates,
      });
      totalLengthM += edge.length;
    } else if (toInSet && found.nodeKeys.includes(edge.toKey)) {
      const edgeProps = edge.properties;
      affectedSegments.push({
        featureId: edge.featureId,
        layerId: edge.layerId,
        from: (edgeProps.Begin_uch as string) || edge.fromKey,
        to: (edgeProps.End_uch as string) || edge.toKey,
        length: edge.length,
        coordinates: edge.coordinates,
      });
      totalLengthM += edge.length;
    }
  }

  const sourceNode = sourceKey ? graph.nodes.get(sourceKey) : null;
  const nist = props.Nist !== undefined && props.Nist !== null ? String(props.Nist) : "";

  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] Results: ${affectedConsumers.length} consumers, ${affectedSegments.length} segments, ${affectedCTPs.length} CTPs, ${affectedNodes.length} nodes`);
  if (process.env.NODE_ENV !== "production") console.log(`[SpatialGraph] === Spatial Simulation End ===`);

  return {
    mode: "spatial" as SimulationMode,
    failurePoint: {
      featureId,
      layerId,
      name: featName || found.nodeKeys[0],
      type: feat.geometryType === "LineString" ? "segment" : (graph.nodes.get(found.nodeKeys[0])?.type || "unknown"),
      coordinates: feat.coordinates,
    },
    source: sourceNode ? {
      name: sourceNode.name,
      nist: (sourceNode.properties.Nist as string) || nist,
    } : null,
    affectedConsumers,
    affectedSegments,
    affectedCTPs,
    affectedNodes,
    stats: {
      totalConsumers: affectedConsumers.length,
      totalSegments: affectedSegments.length,
      totalCTPs: affectedCTPs.length,
      totalNodes: affectedNodes.length,
      totalLengthM: Math.round(totalLengthM),
    },
  };
}

export interface ConnectionPointResult {
  name: string;
  type: string;
  coordinates: [number, number];
  distance: number;
  featureId: number;
  layerId: number;
  nodeKey: string;
}

export interface AutoTraceRoute {
  coordinates: [number, number][];
  totalLength: number;
  turningAngles: Array<{
    angle: number;
    coordinates: [number, number];
  }>;
  segments: Array<{
    from: [number, number];
    to: [number, number];
    length: number;
    name: string;
  }>;
}

export interface HeatChamberPlacement {
  coordinates: [number, number];
  name: string;
  reason: string;
}

export async function findNearestConnectionPoint(
  consumerCoords: [number, number],
  sceneId: number
): Promise<{ connectionPoint: ConnectionPointResult | null; graph: SpatialGraph }> {
  const graph = await buildSpatialNetworkGraph(sceneId);

  if (graph.nodes.size === 0) {
    return { connectionPoint: null, graph };
  }

  const allLayerIds = Array.from(new Set(
    Array.from(graph.nodes.values())
      .filter(n => n.featureId > 0)
      .map(n => n.layerId)
  ));

  let useHaversine = true;
  if (allLayerIds.length > 0) {
    const layerCrsRows = await db
      .select({ crs: editableLayers.crs })
      .from(editableLayers)
      .where(inArray(editableLayers.id, allLayerIds));
    const hasProjected = layerCrsRows.some(r => !isGeographicCRS(r.crs));
    if (hasProjected) useHaversine = false;
  }

  let bestNode: ConnectionPointResult | null = null;
  let bestDist = Infinity;

  const preferredTypes = new Set(["node", "ctp", "valve", "source"]);

  for (const [key, node] of graph.nodes) {
    if (node.featureId === 0) continue;

    const neighbors = graph.adjacency.get(key);
    if (!neighbors || neighbors.size === 0) continue;

    const dist = distanceBetweenPoints(consumerCoords, node.coordinates, useHaversine);

    let priority = 1;
    if (preferredTypes.has(node.type)) priority = 0.8;
    if (node.type === "node") priority = 0.7;

    const weightedDist = dist * priority;

    if (weightedDist < bestDist) {
      bestDist = weightedDist;
      bestNode = {
        name: node.name || key,
        type: node.type,
        coordinates: node.coordinates,
        distance: dist,
        featureId: node.featureId,
        layerId: node.layerId,
        nodeKey: key,
      };
    }
  }

  let bestEdgePoint: ConnectionPointResult | null = null;
  let bestEdgeDist = Infinity;

  for (const edge of graph.edges) {
    const endpoints = extractEndpoints(edge.coordinates);
    if (!endpoints) continue;

    const projResult = projectPointOnSegment(
      consumerCoords,
      endpoints.start,
      endpoints.end,
      useHaversine
    );

    if (projResult.distance < bestEdgeDist) {
      bestEdgeDist = projResult.distance;
      bestEdgePoint = {
        name: edge.name || `Участок`,
        type: "segment_projection",
        coordinates: projResult.point,
        distance: projResult.distance,
        featureId: edge.featureId,
        layerId: edge.layerId,
        nodeKey: projResult.nearerKey === "from" ? edge.fromKey : edge.toKey,
      };
    }
  }

  if (bestEdgePoint && bestEdgeDist < (bestDist * 0.7)) {
    const nearerNode = graph.nodes.get(bestEdgePoint.nodeKey);
    if (nearerNode && nearerNode.featureId > 0) {
      bestEdgePoint.name = nearerNode.name || bestEdgePoint.name;
      bestEdgePoint.type = nearerNode.type;
      bestEdgePoint.featureId = nearerNode.featureId;
      bestEdgePoint.layerId = nearerNode.layerId;
      bestEdgePoint.coordinates = nearerNode.coordinates;
    }
    return { connectionPoint: bestEdgePoint, graph };
  }

  return { connectionPoint: bestNode, graph };
}

function projectPointOnSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
  useHaversine: boolean
): { point: [number, number]; distance: number; nearerKey: "from" | "to" } {
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return {
      point: segStart,
      distance: distanceBetweenPoints(point, segStart, useHaversine),
      nearerKey: "from",
    };
  }

  let t = ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projected: [number, number] = [
    segStart[0] + t * dx,
    segStart[1] + t * dy,
  ];

  return {
    point: projected,
    distance: distanceBetweenPoints(point, projected, useHaversine),
    nearerKey: t < 0.5 ? "from" : "to",
  };
}

export function analyzeRouteGeometry(
  routeCoords: [number, number][],
  totalDistance: number,
  useHaversine = true
): AutoTraceRoute {
  if (routeCoords.length < 2) {
    return { coordinates: routeCoords, totalLength: 0, turningAngles: [], segments: [] };
  }

  const simplifiedCoords = simplifyRoute(routeCoords, 5);

  const segments: AutoTraceRoute["segments"] = [];
  let computedLength = 0;

  for (let i = 0; i < simplifiedCoords.length - 1; i++) {
    const segLen = distanceBetweenPoints(simplifiedCoords[i], simplifiedCoords[i + 1], useHaversine);
    computedLength += segLen;
    segments.push({
      from: simplifiedCoords[i],
      to: simplifiedCoords[i + 1],
      length: segLen,
      name: i === 0 ? "Отвод от потребителя" : `Участок ${i + 1}`,
    });
  }

  const finalLength = totalDistance > 0 ? totalDistance : computedLength;

  const turningAngles: AutoTraceRoute["turningAngles"] = [];
  for (let i = 1; i < simplifiedCoords.length - 1; i++) {
    const angle = calculateTurningAngle(
      simplifiedCoords[i - 1],
      simplifiedCoords[i],
      simplifiedCoords[i + 1]
    );
    if (Math.abs(angle) > 15) {
      turningAngles.push({
        angle: Math.round(angle * 10) / 10,
        coordinates: simplifiedCoords[i],
      });
    }
  }

  return {
    coordinates: simplifiedCoords,
    totalLength: finalLength,
    turningAngles,
    segments,
  };
}

function simplifyRoute(
  coords: [number, number][],
  toleranceMeters: number
): [number, number][] {
  if (coords.length <= 3) return coords;

  const result: [number, number][] = [coords[0]];
  let lastKept = coords[0];

  for (let i = 1; i < coords.length - 1; i++) {
    const dist = distanceBetweenPoints(lastKept, coords[i], true);
    if (dist >= toleranceMeters) {
      const prevIdx = result.length - 1;
      const angle = calculateTurningAngle(
        result[prevIdx],
        coords[i],
        coords[Math.min(i + 1, coords.length - 1)]
      );
      if (Math.abs(angle) > 8 || dist > 50) {
        result.push(coords[i]);
        lastKept = coords[i];
      }
    }
  }

  result.push(coords[coords.length - 1]);
  return result;
}

function calculateTurningAngle(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number]
): number {
  const dx1 = p2[0] - p1[0];
  const dy1 = p2[1] - p1[1];
  const dx2 = p3[0] - p2[0];
  const dy2 = p3[1] - p2[1];

  const angle1 = Math.atan2(dy1, dx1);
  const angle2 = Math.atan2(dy2, dx2);

  let diff = (angle2 - angle1) * 180 / Math.PI;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

export function placeHeatChambers(
  route: AutoTraceRoute,
  useHaversine = true
): HeatChamberPlacement[] {
  const chambers: HeatChamberPlacement[] = [];
  const CHAMBER_INTERVAL = 120;
  let chamberIndex = 1;

  let accumulatedLength = 0;

  for (let i = 0; i < route.coordinates.length - 1; i++) {
    const segLen = distanceBetweenPoints(
      route.coordinates[i],
      route.coordinates[i + 1],
      useHaversine
    );

    accumulatedLength += segLen;

    while (accumulatedLength >= CHAMBER_INTERVAL) {
      const overshoot = accumulatedLength - CHAMBER_INTERVAL;
      const ratio = overshoot / segLen;
      const chamberCoords: [number, number] = [
        route.coordinates[i + 1][0] - ratio * (route.coordinates[i + 1][0] - route.coordinates[i][0]),
        route.coordinates[i + 1][1] - ratio * (route.coordinates[i + 1][1] - route.coordinates[i][1]),
      ];
      chambers.push({
        coordinates: chamberCoords,
        name: `ТК-Н${chamberIndex}`,
        reason: `Через ${CHAMBER_INTERVAL} м`,
      });
      chamberIndex++;
      accumulatedLength = overshoot;
    }
  }

  for (const turn of route.turningAngles) {
    if (Math.abs(turn.angle) >= 30) {
      const alreadyPlaced = chambers.some(
        (c) =>
          distanceBetweenPoints(c.coordinates, turn.coordinates, useHaversine) < 15
      );
      if (!alreadyPlaced) {
        chambers.push({
          coordinates: turn.coordinates,
          name: `ТК-Н${chamberIndex}`,
          reason: `Поворот ${Math.abs(Math.round(turn.angle))}°`,
        });
        chamberIndex++;
      }
    }
  }

  chambers.push({
    coordinates: route.coordinates[route.coordinates.length - 1],
    name: `ТК-Н${chamberIndex}`,
    reason: "Точка подключения",
  });

  return chambers;
}

export interface CapacityAnalysisResult {
  ctp: {
    name: string;
    type: string;
    coordinates: [number, number];
    featureId: number;
    layerId: number;
    installedCapacity: number | null;
    connectedLoadFromAttributes: number | null;
    pathFromConnection: string[];
  } | null;
  currentLoad: number;
  currentLoadFromConsumers: number;
  requestedLoad: number;
  surplus: number;
  capacityUnknown: boolean;
  consumers: Array<{
    name: string;
    load: number;
    featureId: number;
    layerId: number;
  }>;
  pipeIssues: Array<{
    featureId: number;
    layerId: number;
    name: string;
    coordinates: any;
    currentDpod: number;
    currentDobr: number;
    requiredDiameter: number;
    length: number;
  }>;
  hasSufficientCapacity: boolean;
  hasAdequatePipes: boolean;
}

const STANDARD_DIAMETERS = [32, 40, 50, 57, 76, 89, 108, 133, 159, 194, 219, 273, 325, 377, 426, 530, 630, 720, 820, 1020];

function requiredDiameterForLoad(loadGcal: number): number {
  if (loadGcal <= 0.02) return 32;
  if (loadGcal <= 0.05) return 40;
  if (loadGcal <= 0.1) return 50;
  if (loadGcal <= 0.2) return 57;
  if (loadGcal <= 0.5) return 76;
  if (loadGcal <= 1.0) return 89;
  if (loadGcal <= 2.0) return 108;
  if (loadGcal <= 3.5) return 133;
  if (loadGcal <= 5.0) return 159;
  if (loadGcal <= 8.0) return 194;
  if (loadGcal <= 12.0) return 219;
  if (loadGcal <= 20.0) return 273;
  if (loadGcal <= 35.0) return 325;
  if (loadGcal <= 50.0) return 377;
  if (loadGcal <= 80.0) return 426;
  if (loadGcal <= 120.0) return 530;
  return 630;
}

function nextStandardDiameter(current: number): number {
  for (const d of STANDARD_DIAMETERS) {
    if (d > current) return d;
  }
  return STANDARD_DIAMETERS[STANDARD_DIAMETERS.length - 1];
}

function toMmAndSnapDN(rawValue: number): number {
  if (rawValue <= 0) return 0;
  const mm = rawValue < 2 ? rawValue * 1000 : rawValue;
  let closest = STANDARD_DIAMETERS[0];
  let minDiff = Math.abs(mm - closest);
  for (const d of STANDARD_DIAMETERS) {
    const diff = Math.abs(mm - d);
    if (diff < minDiff) {
      minDiff = diff;
      closest = d;
    }
  }
  return closest;
}

function extractNumericProp(props: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = props[key];
    if (val !== undefined && val !== null && val !== "") {
      const num = parseFloat(String(val));
      if (!isNaN(num)) return num;
    }
  }
  return null;
}

function findUpstreamCTP(
  graph: SpatialGraph,
  startNodeKey: string,
): { ctpNode: SpatialGraphNode | null; path: string[] } {
  const visited = new Set<string>();
  const queue: Array<{ key: string; path: string[] }> = [{ key: startNodeKey, path: [startNodeKey] }];
  visited.add(startNodeKey);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.get(current.key);

    if (node && (node.type === "ctp" || node.type === "source")) {
      return { ctpNode: node, path: current.path };
    }

    const neighbors = graph.adjacency.get(current.key);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ key: neighbor, path: [...current.path, neighbor] });
        }
      }
    }
  }

  return { ctpNode: null, path: [] };
}

function calculateDownstreamLoad(
  graph: SpatialGraph,
  ctpNodeKey: string,
): { totalLoad: number; consumers: Array<{ name: string; load: number; featureId: number; layerId: number }> } {
  const visited = new Set<string>();
  const queue: string[] = [ctpNodeKey];
  visited.add(ctpNodeKey);
  const consumers: Array<{ name: string; load: number; featureId: number; layerId: number }> = [];
  let totalLoad = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.get(current);

    if (node && node.type !== "ctp" && node.type !== "source") {
      const qo = extractNumericProp(node.properties, "Qo_r", "Nagr_otop", "qo", "Qo", "Q_otop") || 0;
      const qgv = extractNumericProp(node.properties, "Qgv_sred", "Rashod_go", "qgv", "Qgv", "Q_gvs", "Qgv_r") || 0;
      const qsv = extractNumericProp(node.properties, "Qsv_r", "Qsv", "qsv", "Q_vent") || 0;
      const load = qo + qgv + qsv;
      if (load > 0) {
        totalLoad += load;
        consumers.push({
          name: node.name || `Потребитель #${node.featureId}`,
          load,
          featureId: node.featureId,
          layerId: node.layerId,
        });
      }
    }

    const neighbors = graph.adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          const neighborNode = graph.nodes.get(neighbor);
          if (neighborNode && (neighborNode.type === "ctp" || neighborNode.type === "source") && neighbor !== ctpNodeKey) {
            continue;
          }
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return { totalLoad, consumers };
}

function getEdgeBetween(graph: SpatialGraph, fromKey: string, toKey: string): SpatialGraphEdge | null {
  const edges = graph.edgesByNode.get(fromKey);
  if (!edges) return null;
  return edges.find(e =>
    (e.fromKey === fromKey && e.toKey === toKey) ||
    (e.fromKey === toKey && e.toKey === fromKey)
  ) || null;
}

function checkPipeCapacity(
  graph: SpatialGraph,
  pathKeys: string[],
  totalLoadAtPoint: number,
): Array<{
  featureId: number;
  layerId: number;
  name: string;
  coordinates: any;
  currentDpod: number;
  currentDobr: number;
  requiredDiameter: number;
  length: number;
}> {
  const issues: Array<{
    featureId: number;
    layerId: number;
    name: string;
    coordinates: any;
    currentDpod: number;
    currentDobr: number;
    requiredDiameter: number;
    length: number;
  }> = [];

  const reqDiam = requiredDiameterForLoad(totalLoadAtPoint);

  for (let i = 0; i < pathKeys.length - 1; i++) {
    const edge = getEdgeBetween(graph, pathKeys[i], pathKeys[i + 1]);
    if (!edge) continue;

    const props = edge.properties;
    const rawDpod = extractNumericProp(props, "Dpod", "dpod", "Dnar", "dnar") || 0;
    const rawDobr = extractNumericProp(props, "Dobr", "dobr") || rawDpod;
    const length = edge.length || 0;

    const dpodMm = toMmAndSnapDN(rawDpod);
    const dobrMm = toMmAndSnapDN(rawDobr);

    const minDiam = Math.min(dpodMm || Infinity, dobrMm || Infinity);

    if (minDiam > 0 && minDiam < reqDiam) {
      const beginName = (props.Begin_uch as string) || "";
      const endName = (props.End_uch as string) || "";
      const edgeName = beginName && endName ? `${beginName} → ${endName}` : edge.name || `Участок #${edge.featureId}`;

      issues.push({
        featureId: edge.featureId,
        layerId: edge.layerId,
        name: edgeName,
        coordinates: edge.coordinates,
        currentDpod: dpodMm,
        currentDobr: dobrMm,
        requiredDiameter: reqDiam,
        length,
      });
    }
  }

  return issues;
}

function extractInstalledCapacity(props: Record<string, unknown>, nodeType: string): number | null {
  if (nodeType === "source") {
    const qmax = extractNumericProp(props, "Qmax", "Ust_moshn", "Qist", "Q_ust", "Moshn", "capacity");
    if (qmax !== null) return qmax;
    const qsum = extractNumericProp(props, "Qsum");
    if (qsum !== null) return qsum;
    return null;
  }
  if (nodeType === "ctp") {
    const qo = extractNumericProp(props, "Qo_t", "Qo_r") || 0;
    const qsv = extractNumericProp(props, "Qsv_t", "Qsv_r") || 0;
    const qgv = extractNumericProp(props, "Qgv_t", "Qgv_r", "Qgv_sred") || 0;
    const sum = qo + qsv + qgv;
    return sum > 0 ? sum : null;
  }
  return null;
}

function extractConnectedLoadFromAttributes(props: Record<string, unknown>, nodeType: string): number | null {
  if (nodeType === "source") {
    const qsum = extractNumericProp(props, "Qsum");
    if (qsum !== null) return qsum;
    const qo = extractNumericProp(props, "Qo_r", "Qo_t") || 0;
    const qsv = extractNumericProp(props, "Qsv_r", "Qsv_t") || 0;
    const qgv = extractNumericProp(props, "Qgv_r", "Qgv_t") || 0;
    const sum = qo + qsv + qgv;
    return sum > 0 ? sum : null;
  }
  if (nodeType === "ctp") {
    const qo = extractNumericProp(props, "Qo_t", "Qo_r") || 0;
    const qsv = extractNumericProp(props, "Qsv_t", "Qsv_r") || 0;
    const qgv = extractNumericProp(props, "Qgv_t", "Qgv_r", "Qgv_sred") || 0;
    const sum = qo + qsv + qgv;
    return sum > 0 ? sum : null;
  }
  return null;
}

export async function analyzeCapacity(
  graph: SpatialGraph,
  connectionNodeKey: string,
  requestedLoad: number,
): Promise<CapacityAnalysisResult> {
  const { ctpNode, path } = findUpstreamCTP(graph, connectionNodeKey);

  let installedCapacity: number | null = null;
  let connectedLoadFromAttributes: number | null = null;
  let currentLoadFromConsumers = 0;
  let consumers: Array<{ name: string; load: number; featureId: number; layerId: number }> = [];

  if (ctpNode) {
    if (process.env.NODE_ENV !== "production") console.log(`[CapacityAnalysis] Found ${ctpNode.type}: "${ctpNode.name}", featureId=${ctpNode.featureId}, layerId=${ctpNode.layerId}`);
    const propKeys = Object.keys(ctpNode.properties);
    if (process.env.NODE_ENV !== "production") console.log(`[CapacityAnalysis] Properties keys: ${propKeys.join(", ")}`);
    const relevantProps: Record<string, unknown> = {};
    for (const k of propKeys) {
      const v = ctpNode.properties[k];
      if (v !== null && v !== undefined && v !== "" && String(k).match(/^(Q|G|Ust|Moshn|capacity|Nagr|Rashod)/i)) {
        relevantProps[k] = v;
      }
    }
    if (process.env.NODE_ENV !== "production") console.log(`[CapacityAnalysis] Relevant properties: ${Object.keys(relevantProps).join(", ")}`);

    installedCapacity = extractInstalledCapacity(ctpNode.properties, ctpNode.type);
    connectedLoadFromAttributes = extractConnectedLoadFromAttributes(ctpNode.properties, ctpNode.type);

    const downstream = calculateDownstreamLoad(graph, ctpNode.coordKey);
    currentLoadFromConsumers = downstream.totalLoad;
    consumers = downstream.consumers;

    if (process.env.NODE_ENV !== "production") console.log(`[CapacityAnalysis] CTP: "${ctpNode.name}" (${ctpNode.type}), installed: ${installedCapacity ?? "NOT FOUND"} Гкал/ч, loadFromAttributes: ${connectedLoadFromAttributes ?? "NOT FOUND"} Гкал/ч, loadFromConsumers: ${currentLoadFromConsumers.toFixed(3)} Гкал/ч, consumers: ${consumers.length}`);
  } else {
    if (process.env.NODE_ENV !== "production") console.log(`[CapacityAnalysis] No CTP/source found upstream from connection point`);
  }

  const currentLoad = connectedLoadFromAttributes !== null
    ? Math.max(connectedLoadFromAttributes, currentLoadFromConsumers)
    : currentLoadFromConsumers;

  const capacityUnknown = installedCapacity === null && connectedLoadFromAttributes === null;

  let surplus: number;
  let hasSufficientCapacity: boolean;

  if (installedCapacity !== null) {
    surplus = installedCapacity - currentLoad - requestedLoad;
    hasSufficientCapacity = surplus >= 0;
  } else if (connectedLoadFromAttributes !== null) {
    surplus = connectedLoadFromAttributes - currentLoad - requestedLoad;
    hasSufficientCapacity = surplus >= 0;
  } else {
    surplus = 0;
    hasSufficientCapacity = false;
  }

  const totalLoadAfterConnection = currentLoad + requestedLoad;
  const pipeIssues = checkPipeCapacity(graph, path, totalLoadAfterConnection);

  if (process.env.NODE_ENV !== "production") console.log(`[CapacityAnalysis] Requested: ${requestedLoad.toFixed(3)} Гкал/ч, currentLoad: ${currentLoad.toFixed(3)}, surplus: ${surplus.toFixed(3)} Гкал/ч, capacityUnknown: ${capacityUnknown}, pipe issues: ${pipeIssues.length}`);

  return {
    ctp: ctpNode ? {
      name: ctpNode.name,
      type: ctpNode.type,
      coordinates: ctpNode.coordinates,
      featureId: ctpNode.featureId,
      layerId: ctpNode.layerId,
      installedCapacity,
      connectedLoadFromAttributes,
      pathFromConnection: path,
    } : null,
    currentLoad,
    currentLoadFromConsumers,
    requestedLoad,
    surplus,
    capacityUnknown,
    consumers,
    pipeIssues,
    hasSufficientCapacity,
    hasAdequatePipes: pipeIssues.length === 0,
  };
}

export { coordKey };

export interface FailureZoneCandidate {
  nodeKey: string;
  nodeName: string;
  nodeType: string;
  nodeCoordinates: [number, number];
  incomingEdge: SpatialGraphEdge | null;
  downstreamConsumerCount: number;
  complaintConsumerCount: number;
  probability: number;
  downstreamConsumerKeys: string[];
  downstreamSegmentEdges: SpatialGraphEdge[];
}

function getPathToRoot(parentMap: Map<string, string | null>, key: string): string[] {
  const path: string[] = [];
  let current: string | null | undefined = key;
  const visited = new Set<string>();
  while (current !== null && current !== undefined) {
    if (visited.has(current)) break;
    visited.add(current);
    path.push(current);
    current = parentMap.get(current) ?? null;
  }
  return path;
}

function findLCA(parentMap: Map<string, string | null>, keys: string[]): string | null {
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0];

  const firstPath = getPathToRoot(parentMap, keys[0]);
  const firstPathSet = new Set(firstPath);

  let commonAncestors = firstPathSet;
  for (let i = 1; i < keys.length; i++) {
    const path = getPathToRoot(parentMap, keys[i]);
    const pathSet = new Set(path);
    const intersection = new Set<string>();
    for (const node of commonAncestors) {
      if (pathSet.has(node)) intersection.add(node);
    }
    commonAncestors = intersection;
    if (commonAncestors.size === 0) return null;
  }

  let deepest: string | null = null;
  let maxDepth = -1;
  for (const ancestor of commonAncestors) {
    const d = getDepth(parentMap, ancestor);
    if (d > maxDepth) {
      maxDepth = d;
      deepest = ancestor;
    }
  }
  return deepest;
}

function getDownstreamConsumerKeys(
  graph: SpatialGraph,
  parentMap: Map<string, string | null>,
  failureKey: string,
  sourceKey: string
): string[] {
  const downstream = getSpatialDownstream(parentMap, [failureKey], sourceKey);
  downstream.add(failureKey);
  const consumerKeys: string[] = [];
  for (const key of downstream) {
    const node = graph.nodes.get(key);
    if (node && (node.type === "consumer" || node.type === "ctp")) {
      consumerKeys.push(key);
    }
  }
  return consumerKeys;
}

function getDownstreamEdges(
  graph: SpatialGraph,
  downstreamKeys: Set<string>
): SpatialGraphEdge[] {
  const edgeSet = new Set<number>();
  const edges: SpatialGraphEdge[] = [];
  for (const key of downstreamKeys) {
    const nodeEdges = graph.edgesByNode.get(key) || [];
    for (const edge of nodeEdges) {
      if (edgeSet.has(edge.featureId)) continue;
      if (downstreamKeys.has(edge.fromKey) && downstreamKeys.has(edge.toKey)) {
        edgeSet.add(edge.featureId);
        edges.push(edge);
      }
    }
  }
  return edges;
}

export function findFailureZonesForConsumers(
  graph: SpatialGraph,
  parentMap: Map<string, string | null>,
  sourceKey: string,
  complaintConsumerKeys: string[]
): FailureZoneCandidate[] {
  if (complaintConsumerKeys.length === 0) return [];

  const validKeys = complaintConsumerKeys.filter(k => parentMap.has(k));
  if (validKeys.length === 0) return [];

  const candidates: FailureZoneCandidate[] = [];
  const processedNodes = new Set<string>();

  function findCandidatesForGroup(keys: string[]) {
    if (keys.length === 0) return;

    const lca = findLCA(parentMap, keys);
    if (!lca || lca === sourceKey) {
      if (keys.length >= 2) {
        splitIntoBranches(keys, sourceKey);
      }
      return;
    }

    if (processedNodes.has(lca)) return;
    processedNodes.add(lca);

    const node = graph.nodes.get(lca);
    if (!node) return;

    const downstream = getSpatialDownstream(parentMap, [lca], sourceKey);
    downstream.add(lca);

    const allDownstreamConsumers: string[] = [];
    for (const dk of downstream) {
      const dn = graph.nodes.get(dk);
      if (dn && (dn.type === "consumer" || dn.type === "ctp")) {
        allDownstreamConsumers.push(dk);
      }
    }

    const complaintSet = new Set(keys);
    let complaintInDownstream = 0;
    for (const ck of allDownstreamConsumers) {
      if (complaintSet.has(ck)) complaintInDownstream++;
    }

    const totalDownstream = allDownstreamConsumers.length;
    const probability = totalDownstream > 0
      ? Math.round((complaintInDownstream / totalDownstream) * 100)
      : 0;

    let incomingEdge: SpatialGraphEdge | null = null;
    const parentKey = parentMap.get(lca);
    if (parentKey) {
      const nodeEdges = graph.edgesByNode.get(lca) || [];
      for (const edge of nodeEdges) {
        if (
          (edge.fromKey === parentKey && edge.toKey === lca) ||
          (edge.toKey === parentKey && edge.fromKey === lca)
        ) {
          incomingEdge = edge;
          break;
        }
      }
    }

    const downstreamEdges = getDownstreamEdges(graph, downstream);

    candidates.push({
      nodeKey: lca,
      nodeName: node.name || "",
      nodeType: node.type,
      nodeCoordinates: node.coordinates,
      incomingEdge,
      downstreamConsumerCount: totalDownstream,
      complaintConsumerCount: complaintInDownstream,
      probability,
      downstreamConsumerKeys: allDownstreamConsumers,
      downstreamSegmentEdges: downstreamEdges,
    });

    const uncovered = keys.filter(k => !downstream.has(k));
    if (uncovered.length >= 2) {
      splitIntoBranches(uncovered, lca);
    }
  }

  function splitIntoBranches(keys: string[], fromNode: string) {
    const children = new Map<string, string[]>();
    for (const [node, par] of parentMap) {
      if (par !== null) {
        if (!children.has(par)) children.set(par, []);
        children.get(par)!.push(node);
      }
    }

    const branchRoots = children.get(fromNode) || [];
    const branches = new Map<string, string[]>();

    for (const key of keys) {
      const path = getPathToRoot(parentMap, key);
      let branch = "unknown";
      for (const p of path) {
        if (branchRoots.includes(p)) {
          branch = p;
          break;
        }
      }
      if (!branches.has(branch)) branches.set(branch, []);
      branches.get(branch)!.push(key);
    }

    for (const [, branchKeys] of branches) {
      if (branchKeys.length >= 2) {
        findCandidatesForGroup(branchKeys);
      }
    }
  }

  findCandidatesForGroup(validKeys);

  candidates.sort((a, b) => b.probability - a.probability);

  return candidates;
}

export {
  getConnectedComponent,
  findSourceInComponent,
  spatialBfsFromSource,
  getSpatialDownstream,
  getDepth,
};
export type { SpatialGraph, SpatialGraphNode, SpatialGraphEdge };
