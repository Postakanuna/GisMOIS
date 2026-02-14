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

export interface GraphNode {
  name: string;
  type: "source" | "ctp" | "consumer" | "node" | "valve" | "pump" | "other";
  featureId: number;
  layerId: number;
  coordinates: any;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  length: number;
  featureId: number;
  layerId: number;
  coordinates: any;
  properties: Record<string, unknown>;
}

export interface NetworkGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjacency: Map<string, string[]>;
  forwardAdj: Map<string, string[]>;
  reverseAdj: Map<string, string[]>;
}

interface SimulationResult {
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
    if (propKeys.includes("Ust_moshn") || propKeys.includes("Naim_tepl") || propKeys.includes("Nomer_tep") || propKeys.includes("Otpusk_TE") || propKeys.includes("Qist") || propKeys.includes("Gist")) {
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

    if (propKeys.includes("Hnz_obr") && !propKeys.includes("Hzdan") && !propKeys.includes("Njil")) {
      return "ctp";
    }

    if (propKeys.includes("Qo_r") || propKeys.includes("Nagr_otop") || propKeys.includes("Rashod_go") || propKeys.includes("Qgv_sred")) {
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

    const layerType = classifyLayerByContentSync(propKeys, layer.geometryType, sampleNames);

    console.log(`[NetworkGraph] Layer "${layer.name}" (id=${layer.id}, geom=${layer.geometryType}) => type: ${layerType}`);

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

  console.log(`[NetworkGraph] Classification:`, JSON.stringify({
    segments: result.segmentLayerIds,
    nodes: result.nodeLayerIds,
    consumers: result.consumerLayerIds,
    ctps: result.ctpLayerIds,
    sources: result.sourceLayerIds,
    valves: result.valveLayerIds,
    pumps: result.pumpLayerIds,
  }));

  return result;
}

export async function buildNetworkGraph(
  segmentLayerIds: number[],
  nodeLayerIds: number[],
  consumerLayerIds: number[],
  ctpLayerIds: number[],
  sourceLayerIds: number[],
  valveLayerIds: number[],
  pumpLayerIds: number[],
  nist: string
): Promise<NetworkGraph> {
  const graph: NetworkGraph = {
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
    forwardAdj: new Map(),
    reverseAdj: new Map(),
  };

  if (segmentLayerIds.length === 0) return graph;

  const segments = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(
      and(
        inArray(drawnFeatures.layerId, segmentLayerIds),
        sql`${drawnFeatures.properties}->>'Nist' = ${nist}`
      )
    );

  const allSegmentNodeNames = new Set<string>();

  for (const seg of segments) {
    const props = seg.properties as Record<string, unknown>;
    const fromRaw = (props.Begin_uch as string) || "";
    const toRaw = (props.End_uch as string) || "";
    const from = normalizeName(fromRaw);
    const to = normalizeName(toRaw);
    const length = parseFloat((props.L as string) || "0") || 0;

    if (!from || !to || from === to) continue;

    allSegmentNodeNames.add(from);
    allSegmentNodeNames.add(to);

    graph.edges.push({
      from,
      to,
      length,
      featureId: seg.id,
      layerId: seg.layerId,
      coordinates: seg.coordinates,
      properties: props,
    });

    if (!graph.adjacency.has(from)) graph.adjacency.set(from, []);
    if (!graph.adjacency.has(to)) graph.adjacency.set(to, []);
    graph.adjacency.get(from)!.push(to);
    graph.adjacency.get(to)!.push(from);

    if (!graph.forwardAdj.has(from)) graph.forwardAdj.set(from, []);
    graph.forwardAdj.get(from)!.push(to);

    if (!graph.reverseAdj.has(to)) graph.reverseAdj.set(to, []);
    graph.reverseAdj.get(to)!.push(from);
  }

  for (const name of allSegmentNodeNames) {
    if (!graph.nodes.has(name)) {
      graph.nodes.set(name, {
        name,
        type: "other",
        featureId: 0,
        layerId: 0,
        coordinates: null,
        properties: {},
      });
    }
  }

  const allPointLayerIds = [...nodeLayerIds, ...consumerLayerIds, ...ctpLayerIds, ...sourceLayerIds, ...valveLayerIds, ...pumpLayerIds];

  if (allPointLayerIds.length > 0) {
    const pointFeatures = await db
      .select({
        id: drawnFeatures.id,
        layerId: drawnFeatures.layerId,
        coordinates: drawnFeatures.coordinates,
        properties: drawnFeatures.properties,
      })
      .from(drawnFeatures)
      .where(
        and(
          inArray(drawnFeatures.layerId, allPointLayerIds),
          sql`${drawnFeatures.properties}->>'Nist' = ${nist}`
        )
      );

    let nodeType: GraphNode["type"];

    for (const feat of pointFeatures) {
      const props = feat.properties as Record<string, unknown>;
      const nameRaw = (props.Name as string) || "";
      if (!nameRaw) continue;
      const name = normalizeName(nameRaw);

      if (sourceLayerIds.includes(feat.layerId)) nodeType = "source";
      else if (ctpLayerIds.includes(feat.layerId)) nodeType = "ctp";
      else if (consumerLayerIds.includes(feat.layerId)) nodeType = "consumer";
      else if (nodeLayerIds.includes(feat.layerId)) nodeType = "node";
      else if (valveLayerIds.includes(feat.layerId)) nodeType = "valve";
      else if (pumpLayerIds.includes(feat.layerId)) nodeType = "pump";
      else nodeType = "other";

      if (graph.nodes.has(name)) {
        const existing = graph.nodes.get(name)!;
        if (existing.featureId === 0) {
          existing.type = nodeType;
          existing.featureId = feat.id;
          existing.layerId = feat.layerId;
          existing.coordinates = feat.coordinates;
          existing.properties = props;
        }
      } else {
        const matchedSegName = findMatchingSegmentName(name, allSegmentNodeNames);
        if (matchedSegName) {
          const existing = graph.nodes.get(matchedSegName)!;
          if (existing.featureId === 0) {
            existing.type = nodeType;
            existing.featureId = feat.id;
            existing.layerId = feat.layerId;
            existing.coordinates = feat.coordinates;
            existing.properties = props;
          }
        } else {
          graph.nodes.set(name, {
            name,
            type: nodeType,
            featureId: feat.id,
            layerId: feat.layerId,
            coordinates: feat.coordinates,
            properties: props,
          });
        }
      }
    }
  }

  return graph;
}

function findMatchingSegmentName(pointName: string, segmentNames: Set<string>): string | null {
  const pointNorm = normalizeName(pointName);
  for (const segName of segmentNames) {
    const segNorm = normalizeName(segName);
    if (pointNorm === segNorm) {
      return segName;
    }
  }

  for (const segName of segmentNames) {
    const segNorm = normalizeName(segName);
    if (pointNorm.startsWith(segNorm) || segNorm.startsWith(pointNorm)) {
      return segName;
    }
  }

  const pointLower = pointNorm.toLowerCase();
  for (const segName of segmentNames) {
    const segLower = normalizeName(segName).toLowerCase();
    if (pointLower.startsWith(segLower) || segLower.startsWith(pointLower)) {
      return segName;
    }
  }

  return null;
}

export function findSourceNode(graph: NetworkGraph): string | null {
  for (const [name, node] of graph.nodes) {
    if (node.type === "source" && graph.adjacency.has(name)) {
      return name;
    }
  }

  for (const [name, node] of graph.nodes) {
    if (node.type === "source") {
      const matched = findMatchingSegmentName(name, new Set(graph.adjacency.keys()));
      if (matched) {
        console.log(`[NetworkGraph] Source "${name}" matched to segment node "${matched}"`);
        return matched;
      }
    }
  }

  const rootCandidates: string[] = [];
  for (const name of graph.forwardAdj.keys()) {
    if (!graph.reverseAdj.has(name)) {
      rootCandidates.push(name);
    }
  }

  const sourcePatterns = ["кот.", "котельн", "грэс", "тэц", "бмк", "бойлерн", "мини-тэц"];
  for (const candidate of rootCandidates) {
    const lower = candidate.toLowerCase();
    for (const pattern of sourcePatterns) {
      if (lower.includes(pattern)) {
        console.log(`[NetworkGraph] Source found by pattern+root: "${candidate}"`);
        return candidate;
      }
    }
  }

  for (const name of graph.adjacency.keys()) {
    const lower = name.toLowerCase();
    for (const pattern of sourcePatterns) {
      if (lower.includes(pattern)) {
        console.log(`[NetworkGraph] Source found by pattern in adjacency: "${name}"`);
        return name;
      }
    }
  }

  if (rootCandidates.length === 1) {
    console.log(`[NetworkGraph] Source found as single root: "${rootCandidates[0]}"`);
    return rootCandidates[0];
  }

  if (rootCandidates.length > 1) {
    let best = rootCandidates[0];
    let bestCount = graph.forwardAdj.get(best)?.length || 0;
    for (const c of rootCandidates) {
      const count = graph.forwardAdj.get(c)?.length || 0;
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    console.log(`[NetworkGraph] Source found as best root candidate: "${best}" (${bestCount} outgoing edges)`);
    return best;
  }

  let maxDegree = 0;
  let maxNode: string | null = null;
  for (const [name, neighbors] of graph.adjacency) {
    if (neighbors.length > maxDegree) {
      maxDegree = neighbors.length;
      maxNode = name;
    }
  }
  return maxNode;
}

export function buildTreeFromSource(graph: NetworkGraph, sourceNodeName: string): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  parent.set(sourceNodeName, null);

  const queue: string[] = [sourceNodeName];
  const forwardAdj = graph.forwardAdj;
  const reverseAdj = graph.reverseAdj;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const forward = forwardAdj.get(current) || [];
    for (const neighbor of forward) {
      if (!parent.has(neighbor)) {
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  if (parent.size < graph.adjacency.size) {
    const queue2: string[] = [sourceNodeName];
    const visited = new Set<string>(parent.keys());
    const fullQueue = [...parent.keys()];

    for (const node of fullQueue) {
      const neighbors = graph.adjacency.get(node) || [];
      for (const neighbor of neighbors) {
        if (!parent.has(neighbor)) {
          parent.set(neighbor, node);
          queue2.push(neighbor);
        }
      }
    }

    while (queue2.length > 0) {
      const current = queue2.shift()!;
      const neighbors = graph.adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        if (!parent.has(neighbor)) {
          parent.set(neighbor, current);
          queue2.push(neighbor);
        }
      }
    }
  }

  return parent;
}

function getDownstreamNodes(
  graph: NetworkGraph,
  failureNodeName: string,
  parentMap: Map<string, string | null>,
  sourceNodeName: string
): Set<string> {
  const children = new Map<string, string[]>();
  for (const [node, par] of parentMap) {
    if (par !== null) {
      if (!children.has(par)) children.set(par, []);
      children.get(par)!.push(node);
    }
  }

  const downstream = new Set<string>();
  downstream.add(failureNodeName);

  const collectDownstream = (nodeName: string) => {
    const childNodes = children.get(nodeName) || [];
    for (const child of childNodes) {
      if (!downstream.has(child)) {
        downstream.add(child);
        collectDownstream(child);
      }
    }
  };

  collectDownstream(failureNodeName);

  return downstream;
}

function findFeatureInGraph(
  graph: NetworkGraph,
  featureId: number,
  layerId: number
): { nodeName: string | null; edgeFrom: string | null; edgeTo: string | null } {
  for (const [name, node] of graph.nodes) {
    if (node.featureId === featureId && node.layerId === layerId) {
      return { nodeName: name, edgeFrom: null, edgeTo: null };
    }
  }

  for (const edge of graph.edges) {
    if (edge.featureId === featureId && edge.layerId === layerId) {
      return { nodeName: null, edgeFrom: edge.from, edgeTo: edge.to };
    }
  }

  return { nodeName: null, edgeFrom: null, edgeTo: null };
}

export async function simulateDisconnection(
  featureId: number,
  layerId: number,
  sceneId: number
): Promise<SimulationResult> {
  const layerConfig = await getSceneNetworkLayers(sceneId);

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
  const nist = props.Nist !== undefined && props.Nist !== null ? String(props.Nist) : "";
  const featNameRaw = (props.Name as string) || (props.Begin_uch as string) || "";
  const featName = normalizeName(featNameRaw);

  if (!nist) {
    throw new Error("Объект не имеет привязки к источнику (поле Nist отсутствует)");
  }

  console.log(`[NetworkGraph] === Simulation Start ===`);
  console.log(`[NetworkGraph] Feature: id=${featureId}, layer=${layerId}, name="${featName}", nist=${nist}, geom=${feat.geometryType}`);

  const graph = await buildNetworkGraph(
    layerConfig.segmentLayerIds,
    layerConfig.nodeLayerIds,
    layerConfig.consumerLayerIds,
    layerConfig.ctpLayerIds,
    layerConfig.sourceLayerIds,
    layerConfig.valveLayerIds,
    layerConfig.pumpLayerIds,
    nist
  );

  console.log(`[NetworkGraph] Graph: ${graph.nodes.size} nodes, ${graph.edges.length} edges`);
  const nodeTypes = new Map<string, number>();
  for (const [, node] of graph.nodes) {
    nodeTypes.set(node.type, (nodeTypes.get(node.type) || 0) + 1);
  }
  console.log(`[NetworkGraph] Node types:`, Object.fromEntries(nodeTypes));

  const sourceNodeName = findSourceNode(graph);
  console.log(`[NetworkGraph] Source node: "${sourceNodeName}"`);
  if (!sourceNodeName) {
    throw new Error(`Источник не найден для Nist=${nist}`);
  }

  const parentMap = buildTreeFromSource(graph, sourceNodeName);
  console.log(`[NetworkGraph] Tree built: ${parentMap.size} nodes reachable from source`);

  const isSegment = feat.geometryType === "LineString";
  let failureNodeName: string | null = null;

  const found = findFeatureInGraph(graph, featureId, layerId);

  if (isSegment) {
    if (found.edgeTo) {
      failureNodeName = found.edgeTo;
      console.log(`[NetworkGraph] Segment failure: "${found.edgeFrom}" -> "${found.edgeTo}", using "${found.edgeTo}" as failure point`);
    }
  } else {
    if (found.nodeName) {
      failureNodeName = found.nodeName;
      console.log(`[NetworkGraph] Node failure: "${found.nodeName}"`);
    }
  }

  if (!failureNodeName && featName) {
    if (parentMap.has(featName)) {
      failureNodeName = featName;
      console.log(`[NetworkGraph] Fallback: found "${featName}" in tree by name`);
    } else {
      const matched = findMatchingSegmentName(featName, new Set(graph.adjacency.keys()));
      if (matched && parentMap.has(matched)) {
        failureNodeName = matched;
        console.log(`[NetworkGraph] Fallback: fuzzy matched "${featName}" to "${matched}"`);
      }
    }
  }

  if (!failureNodeName) {
    throw new Error(`Объект "${featName}" (id=${featureId}) не найден в графе теплосети для Nist=${nist}. Граф содержит ${graph.nodes.size} узлов и ${graph.edges.length} рёбер.`);
  }

  let downstreamNodes: Set<string>;
  if (failureNodeName === sourceNodeName) {
    downstreamNodes = new Set(graph.nodes.keys());
  } else {
    downstreamNodes = getDownstreamNodes(graph, failureNodeName, parentMap, sourceNodeName);
  }
  console.log(`[NetworkGraph] Downstream nodes: ${downstreamNodes.size}`);

  const affectedConsumers: SimulationResult["affectedConsumers"] = [];
  const affectedCTPs: SimulationResult["affectedCTPs"] = [];
  const affectedNodes: SimulationResult["affectedNodes"] = [];

  for (const nodeName of downstreamNodes) {
    const node = graph.nodes.get(nodeName);
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
    const fromDownstream = downstreamNodes.has(edge.from);
    const toDownstream = downstreamNodes.has(edge.to);

    if (fromDownstream && toDownstream) {
      affectedSegments.push({
        featureId: edge.featureId,
        layerId: edge.layerId,
        from: edge.from,
        to: edge.to,
        length: edge.length,
        coordinates: edge.coordinates,
      });
      totalLengthM += edge.length;
    } else if (toDownstream && edge.to === failureNodeName) {
      affectedSegments.push({
        featureId: edge.featureId,
        layerId: edge.layerId,
        from: edge.from,
        to: edge.to,
        length: edge.length,
        coordinates: edge.coordinates,
      });
      totalLengthM += edge.length;
    }
  }

  const sourceNode = graph.nodes.get(sourceNodeName);

  console.log(`[NetworkGraph] Results: ${affectedConsumers.length} consumers, ${affectedSegments.length} segments, ${affectedCTPs.length} CTPs, ${affectedNodes.length} nodes`);
  console.log(`[NetworkGraph] === Simulation End ===`);

  return {
    failurePoint: {
      featureId,
      layerId,
      name: failureNodeName,
      type: isSegment ? "segment" : (graph.nodes.get(failureNodeName)?.type || "unknown"),
      coordinates: feat.coordinates,
    },
    source: {
      name: sourceNode?.name || sourceNodeName,
      nist,
    },
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

export interface TopologyError {
  featureId: number;
  layerId: number;
  segmentName: string;
  errorType: "orphan_begin" | "orphan_end" | "orphan_both" | "duplicate" | "empty_name" | "self_loop" | "geom_mismatch_begin" | "geom_mismatch_end";
  field: string;
  currentValue: string;
  suggestedValue: string | null;
  suggestedFeatureId: number | null;
  distance: number | null;
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
    if (keyNorm.startsWith(norm) || norm.startsWith(keyNorm)) return key;
  }
  return null;
}

function findNearestPoint(
  coord: [number, number],
  points: Array<{ id: number; name: string; normName: string; coords: [number, number] }>,
  maxDistM: number,
  useHaversine = true,
): { name: string; id: number; dist: number } | null {
  let best: { name: string; id: number; dist: number } | null = null;
  for (const p of points) {
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
      stats: { orphanBegin: 0, orphanEnd: 0, orphanBoth: 0, duplicates: 0, emptyNames: 0, selfLoops: 0, geomMismatchBegin: 0, geomMismatchEnd: 0 },
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
        currentValue: "", suggestedValue: null, suggestedFeatureId: null, distance: null, nist,
      });
      continue;
    }

    if (beginNorm === endNorm && beginNorm) {
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "self_loop", field: "Begin_uch = End_uch",
        currentValue: beginRaw, suggestedValue: null, suggestedFeatureId: null, distance: null, nist,
      });
    }

    const dupKey = `${beginNorm}||${endNorm}||${nist}`;
    if (segmentKeys.has(dupKey)) {
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "duplicate", field: "Begin_uch, End_uch",
        currentValue: segLabel, suggestedValue: null,
        suggestedFeatureId: segmentKeys.get(dupKey) || null,
        distance: null, nist,
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
        distance: sugBegin ? Math.round(sugBegin.dist) : null, nist,
      });
      errors.push({
        featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
        errorType: "orphan_both", field: "End_uch",
        currentValue: endRaw,
        suggestedValue: sugEnd?.name || null,
        suggestedFeatureId: sugEnd?.id || null,
        distance: sugEnd ? Math.round(sugEnd.dist) : null, nist,
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
          distance: suggestion ? Math.round(suggestion.dist) : null, nist,
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
          distance: suggestion ? Math.round(suggestion.dist) : null, nist,
        });
      }
    }

    if (beginFound && endFound && endpoints) {
      if (beginNorm) {
        const matchKey = findFuzzyMatchTopo(beginNorm, pointNodeMap) || beginNorm;
        const pn = pointNodeMap.get(matchKey);
        if (pn && pn.coords) {
          const dist = distanceBetweenPoints(endpoints.start, pn.coords, useHaversine);
          if (dist > 50) {
            const nearest = findNearestPoint(endpoints.start, pointsByCoords, 200, useHaversine);
            if (nearest && nearest.name !== beginNorm && nearest.name !== matchKey) {
              errors.push({
                featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
                errorType: "geom_mismatch_begin", field: "Begin_uch",
                currentValue: beginRaw,
                suggestedValue: nearest.name,
                suggestedFeatureId: nearest.id,
                distance: Math.round(nearest.dist), nist,
              });
            }
          }
        }
      }
      if (endNorm) {
        const matchKey = findFuzzyMatchTopo(endNorm, pointNodeMap) || endNorm;
        const pn = pointNodeMap.get(matchKey);
        if (pn && pn.coords) {
          const dist = distanceBetweenPoints(endpoints.end, pn.coords, useHaversine);
          if (dist > 50) {
            const nearest = findNearestPoint(endpoints.end, pointsByCoords, 200, useHaversine);
            if (nearest && nearest.name !== endNorm && nearest.name !== matchKey) {
              errors.push({
                featureId: seg.id, layerId: seg.layerId, segmentName: segLabel,
                errorType: "geom_mismatch_end", field: "End_uch",
                currentValue: endRaw,
                suggestedValue: nearest.name,
                suggestedFeatureId: nearest.id,
                distance: Math.round(nearest.dist), nist,
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
