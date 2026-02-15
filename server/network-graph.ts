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
  valveClosed?: boolean;
  valvePerPod?: number;
  valvePerObr?: number;
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
  switchableConsumers: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
    alternativeSource: string;
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
  switchableCTPs: Array<{
    featureId: number;
    layerId: number;
    name: string;
    address: string;
    coordinates: any;
    alternativeSource: string;
  }>;
  affectedNodes: Array<{
    featureId: number;
    layerId: number;
    name: string;
    coordinates: any;
  }>;
  closedValves: Array<{
    featureId: number;
    layerId: number;
    name: string;
    perPod: number | null;
    perObr: number | null;
    coordinates: any;
  }>;
  stats: {
    totalConsumers: number;
    totalSwitchableConsumers: number;
    totalSegments: number;
    totalCTPs: number;
    totalSwitchableCTPs: number;
    totalNodes: number;
    totalLengthM: number;
    totalClosedValves: number;
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
  nist: string | null
): Promise<NetworkGraph> {
  const graph: NetworkGraph = {
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
    forwardAdj: new Map(),
    reverseAdj: new Map(),
  };

  if (segmentLayerIds.length === 0) return graph;

  const segmentWhereConditions = nist
    ? and(
        inArray(drawnFeatures.layerId, segmentLayerIds),
        sql`${drawnFeatures.properties}->>'Nist' = ${nist}`
      )
    : inArray(drawnFeatures.layerId, segmentLayerIds);

  const segments = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(segmentWhereConditions);

  const allSegmentNodeNames = new Set<string>();
  const isMultiNist = nist === null;

  for (const seg of segments) {
    const props = seg.properties as Record<string, unknown>;
    const fromRaw = (props.Begin_uch as string) || "";
    const toRaw = (props.End_uch as string) || "";
    const segNist = isMultiNist ? String(props.Nist || "0") : "";
    let from = normalizeName(fromRaw);
    let to = normalizeName(toRaw);
    const length = parseFloat((props.L as string) || "0") || 0;

    if (!from || !to || from === to) continue;

    if (isMultiNist && segNist) {
      from = `${segNist}::${from}`;
      to = `${segNist}::${to}`;
    }

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
    const pointWhereConditions = nist
      ? and(
          inArray(drawnFeatures.layerId, allPointLayerIds),
          sql`${drawnFeatures.properties}->>'Nist' = ${nist}`
        )
      : inArray(drawnFeatures.layerId, allPointLayerIds);

    const pointFeatures = await db
      .select({
        id: drawnFeatures.id,
        layerId: drawnFeatures.layerId,
        coordinates: drawnFeatures.coordinates,
        properties: drawnFeatures.properties,
      })
      .from(drawnFeatures)
      .where(pointWhereConditions);

    let nodeType: GraphNode["type"];

    for (const feat of pointFeatures) {
      const props = feat.properties as Record<string, unknown>;
      const nameRaw = (props.Name as string) || "";
      if (!nameRaw) continue;
      let name = normalizeName(nameRaw);
      if (isMultiNist) {
        const featNist = String(props.Nist || "0");
        name = `${featNist}::${name}`;
      }

      if (sourceLayerIds.includes(feat.layerId)) nodeType = "source";
      else if (ctpLayerIds.includes(feat.layerId)) nodeType = "ctp";
      else if (consumerLayerIds.includes(feat.layerId)) nodeType = "consumer";
      else if (nodeLayerIds.includes(feat.layerId)) nodeType = "node";
      else if (valveLayerIds.includes(feat.layerId)) nodeType = "valve";
      else if (pumpLayerIds.includes(feat.layerId)) nodeType = "pump";
      else nodeType = "other";

      let valveClosed = false;
      let valvePerPod: number | undefined;
      let valvePerObr: number | undefined;
      if (nodeType === "valve") {
        const parseValvePercent = (raw: unknown): number | undefined => {
          if (raw === undefined || raw === null || raw === "") return undefined;
          const str = String(raw).replace(",", ".");
          const val = parseFloat(str);
          if (isNaN(val)) return undefined;
          return val;
        };
        valvePerPod = parseValvePercent(props.Per_pod);
        valvePerObr = parseValvePercent(props.Per_obr);
        if ((valvePerPod !== undefined && valvePerPod === 0) || (valvePerObr !== undefined && valvePerObr === 0)) {
          valveClosed = true;
        }
      }

      const nodeData: Partial<GraphNode> = {
        type: nodeType,
        featureId: feat.id,
        layerId: feat.layerId,
        coordinates: feat.coordinates,
        properties: props,
        ...(nodeType === "valve" ? { valveClosed, valvePerPod, valvePerObr } : {}),
      };

      if (graph.nodes.has(name)) {
        const existing = graph.nodes.get(name)!;
        if (existing.featureId === 0) {
          Object.assign(existing, nodeData);
        }
      } else {
        const matchedSegName = findMatchingSegmentName(name, allSegmentNodeNames);
        if (matchedSegName) {
          const existing = graph.nodes.get(matchedSegName)!;
          if (existing.featureId === 0) {
            Object.assign(existing, nodeData);
          }
        } else {
          graph.nodes.set(name, {
            name,
            ...nodeData as Omit<GraphNode, "name">,
          });
        }
      }
    }
  }

  let closedCount = 0;
  let openCount = 0;
  for (const [, node] of graph.nodes) {
    if (node.type === "valve") {
      if (node.valveClosed) closedCount++;
      else openCount++;
    }
  }
  if (closedCount > 0 || openCount > 0) {
    console.log(`[NetworkGraph] Valves: ${openCount} open, ${closedCount} closed`);
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

export function findAllSources(graph: NetworkGraph): string[] {
  const sources: string[] = [];

  for (const [name, node] of graph.nodes) {
    if (node.type === "source" && graph.adjacency.has(name)) {
      sources.push(name);
    }
  }

  if (sources.length === 0) {
    for (const [name, node] of graph.nodes) {
      if (node.type === "source") {
        const matched = findMatchingSegmentName(name, new Set(graph.adjacency.keys()));
        if (matched && !sources.includes(matched)) {
          sources.push(matched);
        }
      }
    }
  }

  if (sources.length === 0) {
    const sourcePatterns = ["кот.", "котельн", "грэс", "тэц", "бмк", "бойлерн", "мини-тэц"];
    for (const name of graph.adjacency.keys()) {
      const lower = name.toLowerCase();
      for (const pattern of sourcePatterns) {
        if (lower.includes(pattern) && !sources.includes(name)) {
          sources.push(name);
          break;
        }
      }
    }
  }

  return sources;
}

export function multiSourceBFS(
  graph: NetworkGraph,
  sourceNodes: string[],
  failedNodeName: string | null,
  failedEdge: { from: string; to: string; featureId: number } | null,
  respectClosedValves: boolean
): Map<string, string> {
  const reachedBy = new Map<string, string>();

  const isBlocked = (nodeName: string): boolean => {
    if (!respectClosedValves) return false;
    const node = graph.nodes.get(nodeName);
    return !!(node && node.type === "valve" && node.valveClosed);
  };

  const isFailedEdge = (from: string, to: string): boolean => {
    if (!failedEdge) return false;
    return (failedEdge.from === from && failedEdge.to === to) ||
           (failedEdge.from === to && failedEdge.to === from);
  };

  const queue: Array<{ node: string; source: string }> = [];

  for (const src of sourceNodes) {
    if (src === failedNodeName) continue;
    reachedBy.set(src, src);
    queue.push({ node: src, source: src });
  }

  while (queue.length > 0) {
    const { node: current, source } = queue.shift()!;

    if (current !== failedNodeName && isBlocked(current) && !sourceNodes.includes(current)) {
      continue;
    }

    const neighbors = graph.adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (reachedBy.has(neighbor)) continue;
      if (neighbor === failedNodeName) continue;
      if (isFailedEdge(current, neighbor)) continue;

      reachedBy.set(neighbor, source);
      queue.push({ node: neighbor, source });
    }
  }

  return reachedBy;
}

export function buildTreeFromSource(
  graph: NetworkGraph,
  sourceNodeName: string,
  respectClosedValves: boolean = false
): { parentMap: Map<string, string | null>; closedValveBarriers: string[] } {
  const parent = new Map<string, string | null>();
  parent.set(sourceNodeName, null);
  const closedValveBarriers: string[] = [];

  const isBlocked = (nodeName: string): boolean => {
    if (!respectClosedValves) return false;
    const node = graph.nodes.get(nodeName);
    return !!(node && node.type === "valve" && node.valveClosed);
  };

  const queue: string[] = [sourceNodeName];
  const forwardAdj = graph.forwardAdj;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current !== sourceNodeName && isBlocked(current)) {
      if (!closedValveBarriers.includes(current)) closedValveBarriers.push(current);
      continue;
    }
    const forward = forwardAdj.get(current) || [];
    for (const neighbor of forward) {
      if (!parent.has(neighbor)) {
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  if (parent.size < graph.adjacency.size) {
    const queue2: string[] = [];
    const visited = new Set<string>(parent.keys());

    for (const node of visited) {
      if (node !== sourceNodeName && isBlocked(node)) continue;
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
      if (current !== sourceNodeName && isBlocked(current)) {
        if (!closedValveBarriers.includes(current)) closedValveBarriers.push(current);
        continue;
      }
      const neighbors = graph.adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        if (!parent.has(neighbor)) {
          parent.set(neighbor, current);
          queue2.push(neighbor);
        }
      }
    }
  }

  return { parentMap: parent, closedValveBarriers };
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

function isAncestorOf(
  ancestor: string,
  descendant: string,
  parentMap: Map<string, string | null>
): boolean {
  let current: string | null = descendant;
  while (current !== null) {
    if (current === ancestor) return true;
    current = parentMap.get(current) ?? null;
  }
  return false;
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

  const { parentMap, closedValveBarriers } = buildTreeFromSource(graph, sourceNodeName, true);
  console.log(`[NetworkGraph] Tree built: ${parentMap.size} nodes reachable from source`);
  if (closedValveBarriers.length > 0) {
    console.log(`[NetworkGraph] Closed valve barriers: ${closedValveBarriers.join(", ")}`);
  }

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
    downstreamNodes = new Set(parentMap.keys());
  } else {
    downstreamNodes = getDownstreamNodes(graph, failureNodeName, parentMap, sourceNodeName);
  }

  console.log(`[NetworkGraph] Downstream nodes from primary source: ${downstreamNodes.size}`);

  const relevantClosedValves = new Set<string>();

  for (const valveName of closedValveBarriers) {
    if (isAncestorOf(valveName, failureNodeName, parentMap)) {
      relevantClosedValves.add(valveName);
    }
  }

  const closedValvesInDownstream: string[] = [];
  for (const nodeName of downstreamNodes) {
    const node = graph.nodes.get(nodeName);
    if (node && node.type === "valve" && node.valveClosed && nodeName !== failureNodeName) {
      closedValvesInDownstream.push(nodeName);
      relevantClosedValves.add(nodeName);
    }
  }

  if (closedValvesInDownstream.length > 0) {
    for (const valveName of closedValvesInDownstream) {
      const valveDescendants = getDownstreamNodes(graph, valveName, parentMap, sourceNodeName);
      for (const desc of valveDescendants) {
        if (desc !== valveName) {
          downstreamNodes.delete(desc);
        }
      }
    }
    console.log(`[NetworkGraph] Downstream nodes (after valve pruning): ${downstreamNodes.size}`);
  }

  const closedValves: SimulationResult["closedValves"] = [];
  for (const valveName of relevantClosedValves) {
    const node = graph.nodes.get(valveName);
    if (node) {
      closedValves.push({
        featureId: node.featureId,
        layerId: node.layerId,
        name: node.name,
        perPod: node.valvePerPod ?? null,
        perObr: node.valvePerObr ?? null,
        coordinates: node.coordinates,
      });
    }
  }

  let fullGraph: NetworkGraph | null = null;
  let reachabilityMap: Map<string, string> | null = null;

  const hasMultipleSources = layerConfig.sourceLayerIds.length > 0;
  if (hasMultipleSources && downstreamNodes.size > 0) {
    console.log(`[NetworkGraph] Building full multi-source graph for alternative source check...`);
    fullGraph = await buildNetworkGraph(
      layerConfig.segmentLayerIds,
      layerConfig.nodeLayerIds,
      layerConfig.consumerLayerIds,
      layerConfig.ctpLayerIds,
      layerConfig.sourceLayerIds,
      layerConfig.valveLayerIds,
      layerConfig.pumpLayerIds,
      null
    );
    console.log(`[NetworkGraph] Full graph: ${fullGraph.nodes.size} nodes, ${fullGraph.edges.length} edges`);

    const allSources = findAllSources(fullGraph);
    console.log(`[NetworkGraph] All sources in full graph: ${allSources.join(", ")}`);

    let failedEdgeForBFS: { from: string; to: string; featureId: number } | null = null;
    let failedNodeForBFS: string | null = null;

    if (isSegment && found.edgeFrom && found.edgeTo) {
      failedEdgeForBFS = { from: `${nist}::${found.edgeFrom}`, to: `${nist}::${found.edgeTo}`, featureId };
    } else {
      failedNodeForBFS = `${nist}::${failureNodeName}`;
    }

    reachabilityMap = multiSourceBFS(
      fullGraph,
      allSources,
      failedNodeForBFS,
      failedEdgeForBFS,
      true
    );
    console.log(`[NetworkGraph] Multi-source BFS: ${reachabilityMap.size} nodes reachable from any source`);
  }

  const affectedConsumers: SimulationResult["affectedConsumers"] = [];
  const switchableConsumers: SimulationResult["switchableConsumers"] = [];
  const affectedCTPs: SimulationResult["affectedCTPs"] = [];
  const switchableCTPs: SimulationResult["switchableCTPs"] = [];
  const affectedNodes: SimulationResult["affectedNodes"] = [];

  const nistPrefix = nist ? `${nist}::` : "";
  const fullGraphSourceName = nistPrefix + sourceNodeName;

  const resilientNodes = new Set<string>();

  for (const nodeName of downstreamNodes) {
    const node = graph.nodes.get(nodeName);
    if (!node || node.featureId === 0) continue;

    const fullGraphNodeName = nistPrefix + nodeName;
    const reachedFrom = reachabilityMap?.get(fullGraphNodeName);

    if (reachedFrom && reachedFrom === fullGraphSourceName) {
      resilientNodes.add(nodeName);
      continue;
    }

    const hasAlternativeSource = !!reachedFrom && reachedFrom !== fullGraphSourceName;
    const altSourceNode = hasAlternativeSource ? fullGraph?.nodes.get(reachedFrom!) : null;
    const altSourceName = altSourceNode ? altSourceNode.name : (hasAlternativeSource ? reachedFrom!.replace(/^\d+::/, "") : "");

    switch (node.type) {
      case "consumer":
        if (hasAlternativeSource) {
          switchableConsumers.push({
            featureId: node.featureId,
            layerId: node.layerId,
            name: node.name,
            address: (node.properties.Adres as string) || node.name,
            coordinates: node.coordinates,
            alternativeSource: altSourceName,
          });
        } else {
          affectedConsumers.push({
            featureId: node.featureId,
            layerId: node.layerId,
            name: node.name,
            address: (node.properties.Adres as string) || node.name,
            coordinates: node.coordinates,
          });
        }
        break;
      case "ctp":
        if (hasAlternativeSource) {
          switchableCTPs.push({
            featureId: node.featureId,
            layerId: node.layerId,
            name: node.name,
            address: (node.properties.Adres as string) || "",
            coordinates: node.coordinates,
            alternativeSource: altSourceName,
          });
        } else {
          affectedCTPs.push({
            featureId: node.featureId,
            layerId: node.layerId,
            name: node.name,
            address: (node.properties.Adres as string) || "",
            coordinates: node.coordinates,
          });
        }
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

  if (resilientNodes.size > 0) {
    console.log(`[NetworkGraph] Ring-resilient nodes (still reachable from primary source): ${resilientNodes.size}`);
  }

  const affectedSegments: SimulationResult["affectedSegments"] = [];
  let totalLengthM = 0;

  for (const edge of graph.edges) {
    const fromDownstream = downstreamNodes.has(edge.from) && !resilientNodes.has(edge.from);
    const toDownstream = downstreamNodes.has(edge.to) && !resilientNodes.has(edge.to);

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

  console.log(`[NetworkGraph] Results: ${affectedConsumers.length} consumers (${switchableConsumers.length} switchable), ${affectedSegments.length} segments, ${affectedCTPs.length} CTPs (${switchableCTPs.length} switchable), ${affectedNodes.length} nodes, ${closedValves.length} closed valves`);
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
    switchableConsumers,
    affectedSegments,
    affectedCTPs,
    switchableCTPs,
    affectedNodes,
    closedValves,
    stats: {
      totalConsumers: affectedConsumers.length,
      totalSwitchableConsumers: switchableConsumers.length,
      totalSegments: affectedSegments.length,
      totalCTPs: affectedCTPs.length,
      totalSwitchableCTPs: switchableCTPs.length,
      totalNodes: affectedNodes.length,
      totalLengthM: Math.round(totalLengthM),
      totalClosedValves: closedValves.length,
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
        currentValue: beginRaw, suggestedValue: loopSuggested, suggestedFeatureId: loopSuggestedId, distance: loopDist, nist,
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
