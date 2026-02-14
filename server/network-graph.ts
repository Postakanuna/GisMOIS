import { db } from "./db";
import { drawnFeatures, editableLayers } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

interface GraphNode {
  name: string;
  type: "source" | "ctp" | "consumer" | "node" | "valve" | "pump" | "other";
  featureId: number;
  layerId: number;
  coordinates: any;
  properties: Record<string, unknown>;
}

interface GraphEdge {
  from: string;
  to: string;
  length: number;
  featureId: number;
  layerId: number;
  coordinates: any;
  properties: Record<string, unknown>;
}

interface NetworkGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjacency: Map<string, string[]>;
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

function detectLayerType(layerName: string): string {
  const lower = layerName.toLowerCase();
  if (lower.includes("источник") || lower.includes("source") || lower.includes("€бв®з­ЁЄ")) return "source";
  if (lower.includes("цтп") || lower.includes("–'Џ")) return "ctp";
  if (lower.includes("потреб") || lower.includes("потpеб") || lower.includes("Џ®вpҐЎЁвҐ«м")) return "consumer";
  if (lower.includes("узел") || lower.includes("узл") || lower.includes(""§Ґ«")) return "node";
  if (lower.includes("задвиж") || lower.includes("‡ ¤ўЁ¦Є")) return "valve";
  if (lower.includes("участ") || lower.includes(""з бвЄЁ")) return "segment";
  if (lower.includes("вспомог")) return "auxiliary_segment";
  if (lower.includes("насос")) return "pump";
  return "other";
}

async function getSceneNetworkLayers(sceneId: number) {
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
  } = {
    segmentLayerIds: [],
    nodeLayerIds: [],
    consumerLayerIds: [],
    ctpLayerIds: [],
    sourceLayerIds: [],
    valveLayerIds: [],
  };

  for (const layer of layers) {
    const layerType = detectLayerType(layer.name);
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
    }
  }

  return result;
}

async function buildNetworkGraph(
  segmentLayerIds: number[],
  nodeLayerIds: number[],
  consumerLayerIds: number[],
  ctpLayerIds: number[],
  sourceLayerIds: number[],
  valveLayerIds: number[],
  nist: string
): Promise<NetworkGraph> {
  const graph: NetworkGraph = {
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
  };

  const allPointLayerIds = [...nodeLayerIds, ...consumerLayerIds, ...ctpLayerIds, ...sourceLayerIds, ...valveLayerIds];

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

    for (const feat of pointFeatures) {
      const props = feat.properties as Record<string, unknown>;
      const name = (props.Name as string) || "";
      if (!name) continue;

      let type: GraphNode["type"] = "other";
      if (sourceLayerIds.includes(feat.layerId)) type = "source";
      else if (ctpLayerIds.includes(feat.layerId)) type = "ctp";
      else if (consumerLayerIds.includes(feat.layerId)) type = "consumer";
      else if (nodeLayerIds.includes(feat.layerId)) type = "node";
      else if (valveLayerIds.includes(feat.layerId)) type = "valve";

      if (!graph.nodes.has(name)) {
        graph.nodes.set(name, {
          name,
          type,
          featureId: feat.id,
          layerId: feat.layerId,
          coordinates: feat.coordinates,
          properties: props,
        });
      }
    }
  }

  if (segmentLayerIds.length > 0) {
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

    for (const seg of segments) {
      const props = seg.properties as Record<string, unknown>;
      const from = (props.Begin_uch as string) || "";
      const to = (props.End_uch as string) || "";
      const length = parseFloat((props.L as string) || "0") || 0;

      if (!from || !to || from === to) continue;

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
    }
  }

  return graph;
}

function findSourceNode(graph: NetworkGraph): string | null {
  for (const [name, node] of graph.nodes) {
    if (node.type === "source") return name;
  }
  for (const edge of graph.edges) {
    const fromLower = edge.from.toLowerCase();
    if (fromLower.includes("котельная") || fromLower.includes("грэс") || fromLower.includes("кот.")) {
      return edge.from;
    }
  }
  return null;
}

function buildTreeFromSource(graph: NetworkGraph, sourceNodeName: string): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  parent.set(sourceNodeName, null);

  const queue: string[] = [sourceNodeName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.adjacency.get(current) || [];

    for (const neighbor of neighbors) {
      if (!parent.has(neighbor)) {
        parent.set(neighbor, current);
        queue.push(neighbor);
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

  const collectDownstream = (nodeName: string) => {
    const childNodes = children.get(nodeName) || [];
    for (const child of childNodes) {
      downstream.add(child);
      collectDownstream(child);
    }
  };

  downstream.add(failureNodeName);
  collectDownstream(failureNodeName);

  return downstream;
}

function findFeatureNodeName(
  graph: NetworkGraph,
  featureId: number,
  layerId: number
): string | null {
  for (const [name, node] of graph.nodes) {
    if (node.featureId === featureId && node.layerId === layerId) {
      return name;
    }
  }
  for (const edge of graph.edges) {
    if (edge.featureId === featureId && edge.layerId === layerId) {
      return edge.to;
    }
  }
  return null;
}

function findEdgeNodeNames(
  graph: NetworkGraph,
  featureId: number,
  layerId: number
): { from: string; to: string } | null {
  for (const edge of graph.edges) {
    if (edge.featureId === featureId && edge.layerId === layerId) {
      return { from: edge.from, to: edge.to };
    }
  }
  return null;
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
  const nist = (props.Nist as string) || "";
  const featName = (props.Name as string) || (props.Begin_uch as string) || "";

  if (!nist) {
    throw new Error("Объект не имеет привязки к источнику (поле Nist отсутствует)");
  }

  const graph = await buildNetworkGraph(
    layerConfig.segmentLayerIds,
    layerConfig.nodeLayerIds,
    layerConfig.consumerLayerIds,
    layerConfig.ctpLayerIds,
    layerConfig.sourceLayerIds,
    layerConfig.valveLayerIds,
    nist
  );

  const sourceNodeName = findSourceNode(graph);
  if (!sourceNodeName) {
    throw new Error(`Источник не найден для Nist=${nist}`);
  }

  const parentMap = buildTreeFromSource(graph, sourceNodeName);

  let failureNodeName: string | null = null;
  const isSegment = feat.geometryType === "LineString";

  if (isSegment) {
    const edgeNames = findEdgeNodeNames(graph, featureId, layerId);
    if (edgeNames) {
      failureNodeName = edgeNames.to;
    }
  } else {
    failureNodeName = findFeatureNodeName(graph, featureId, layerId);
  }

  if (!failureNodeName) {
    const nodeName = featName;
    if (parentMap.has(nodeName)) {
      failureNodeName = nodeName;
    }
  }

  if (!failureNodeName) {
    throw new Error(`Объект "${featName}" не найден в графе теплосети для Nist=${nist}`);
  }

  const downstreamNodes = getDownstreamNodes(graph, failureNodeName, parentMap, sourceNodeName);

  const affectedConsumers: SimulationResult["affectedConsumers"] = [];
  const affectedCTPs: SimulationResult["affectedCTPs"] = [];
  const affectedNodes: SimulationResult["affectedNodes"] = [];

  for (const nodeName of downstreamNodes) {
    const node = graph.nodes.get(nodeName);
    if (!node) continue;

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
    if (downstreamNodes.has(edge.from) || downstreamNodes.has(edge.to)) {
      const bothInDownstream = downstreamNodes.has(edge.from) && downstreamNodes.has(edge.to);
      const oneIsParentOfFailure = edge.to === failureNodeName || edge.from === failureNodeName;

      if (bothInDownstream || oneIsParentOfFailure) {
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
  }

  const sourceNode = graph.nodes.get(sourceNodeName);

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
