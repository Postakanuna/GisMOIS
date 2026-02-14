import { db } from "./db";
import { drawnFeatures, editableLayers } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  normalizeName,
  NetworkGraph,
  GraphNode,
  getSceneNetworkLayers,
  buildNetworkGraph,
  findSourceNode,
  buildTreeFromSource,
} from "./network-graph";

function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/[«»""''`]/g, "")
    .replace(/\bулица\b/gi, "ул")
    .replace(/\bул\.\s*/gi, "ул.")
    .replace(/\bпроспект\b/gi, "пр-т")
    .replace(/\bпр-кт\b/gi, "пр-т")
    .replace(/\bпереулок\b/gi, "пер")
    .replace(/\bпер\.\s*/gi, "пер.")
    .replace(/\bдом\b/gi, "д")
    .replace(/\bд\.\s*/gi, "д.")
    .replace(/\bкорпус\b/gi, "корп")
    .replace(/\bкорп\.\s*/gi, "корп.")
    .replace(/\bстроение\b/gi, "стр")
    .replace(/\bстр\.\s*/gi, "стр.")
    .replace(/\bкв\.\s*/gi, "кв.")
    .replace(/\bквартира\b/gi, "кв")
    .replace(/\bгород\b/gi, "г")
    .replace(/\bг\.\s*/gi, "г.")
    .replace(/\bпоселок\b/gi, "пос")
    .replace(/\bпос\.\s*/gi, "пос.")
    .replace(/\bдеревня\b/gi, "дер")
    .replace(/\bдер\.\s*/gi, "дер.")
    .replace(/\bсело\b/gi, "с")
    .replace(/\bс\.\s*/gi, "с.")
    .replace(/\bплощадь\b/gi, "пл")
    .replace(/\bпл\.\s*/gi, "пл.")
    .replace(/\bбульвар\b/gi, "б-р")
    .replace(/\bшоссе\b/gi, "ш")
    .replace(/\bш\.\s*/gi, "ш.")
    .replace(/\bпроезд\b/gi, "пр-д")
    .trim();
}

function extractAddressTokens(addr: string): string[] {
  const normalized = normalizeAddress(addr);
  return normalized
    .split(/[,\s]+/)
    .filter(t => t.length > 0)
    .sort();
}

function addressMatch(addr1: string, addr2: string): boolean {
  if (!addr1 || !addr2) return false;

  const norm1 = normalizeAddress(addr1);
  const norm2 = normalizeAddress(addr2);
  if (norm1 === norm2) return true;

  const tokens1 = extractAddressTokens(addr1);
  const tokens2 = extractAddressTokens(addr2);

  if (tokens1.length === 0 || tokens2.length === 0) return false;

  const shorter = tokens1.length <= tokens2.length ? tokens1 : tokens2;
  const longer = tokens1.length <= tokens2.length ? tokens2 : tokens1;

  let matchCount = 0;
  for (const token of shorter) {
    if (longer.some(t => t === token || t.includes(token) || token.includes(t))) {
      matchCount++;
    }
  }

  return matchCount >= Math.max(2, Math.ceil(shorter.length * 0.6));
}

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getPointCoords(coordinates: any): [number, number] | null {
  if (Array.isArray(coordinates) && coordinates.length >= 2 &&
      typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates[0], coordinates[1]];
  }
  if (Array.isArray(coordinates) && coordinates.length > 0 && Array.isArray(coordinates[0])) {
    return getPointCoords(coordinates[0]);
  }
  return null;
}

interface ComplaintFeature {
  id: number;
  coordinates: any;
  properties: Record<string, unknown>;
  date: string;
  address: string;
}

interface ConsumerFeature {
  id: number;
  layerId: number;
  coordinates: any;
  properties: Record<string, unknown>;
  name: string;
  address: string;
  nist: string;
  lon: number;
  lat: number;
}

interface ComplaintMatch {
  complaintId: number;
  complaintAddress: string;
  complaintDate: string;
  consumerId: number;
  consumerName: string;
  consumerAddress: string;
  consumerNist: string;
  distance: number;
  matchType: "address+proximity" | "proximity_only";
}

interface DateGroup {
  date: string;
  nist: string;
  complaints: ComplaintMatch[];
  consumerNodeNames: string[];
}

interface LCAResult {
  lcaNodeName: string;
  lcaNode: GraphNode | null;
  incomingSegment: { featureId: number; from: string; to: string; length: number } | null;
  downstreamConsumerCount: number;
  complaintCoverage: number;
  confidence: "high" | "medium" | "low";
}

export interface ComplaintAnalysisResult {
  totalComplaints: number;
  totalMatched: number;
  totalUnmatched: number;
  dateGroups: Array<{
    date: string;
    nist: string;
    sourceName: string;
    complaintCount: number;
    consumers: Array<{
      name: string;
      address: string;
      complaintCount: number;
      distance: number;
    }>;
    probableFailure: {
      nodeName: string;
      nodeType: string;
      nodeCoordinates: any;
      segmentFrom: string;
      segmentTo: string;
      segmentLength: number;
      segmentFeatureId: number;
      confidence: string;
      downstreamConsumerCount: number;
      complaintCoverage: number;
    } | null;
    affectedSegments: Array<{
      featureId: number;
      from: string;
      to: string;
      length: number;
      coordinates: any;
    }>;
    affectedConsumers: Array<{
      featureId: number;
      name: string;
      address: string;
      coordinates: any;
    }>;
  }>;
  unmatchedComplaints: Array<{
    complaintId: number;
    address: string;
    date: string;
    reason: string;
  }>;
}

export async function analyzeComplaints(
  complaintLayerId: number,
  sceneId: number,
  dateFieldName: string,
  addressFieldName: string,
  matchRadius: number = 100
): Promise<ComplaintAnalysisResult> {
  console.log(`[ComplaintAnalysis] === Start ===`);
  console.log(`[ComplaintAnalysis] complaintLayer=${complaintLayerId}, scene=${sceneId}, dateField="${dateFieldName}", addressField="${addressFieldName}", radius=${matchRadius}m`);

  const complaints = await db
    .select({
      id: drawnFeatures.id,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(eq(drawnFeatures.layerId, complaintLayerId));

  console.log(`[ComplaintAnalysis] Loaded ${complaints.length} complaints`);

  const parsedComplaints: ComplaintFeature[] = [];
  for (const c of complaints) {
    const props = c.properties as Record<string, unknown>;
    const dateVal = props[dateFieldName];
    let dateStr = "";
    if (dateVal) {
      const rawDate = String(dateVal).trim();
      if (!rawDate) continue;
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().split("T")[0];
      } else {
        dateStr = rawDate;
      }
    }

    if (!dateStr) continue;

    const effectiveAddressField = addressFieldName && addressFieldName !== "_none_" ? addressFieldName : "";
    const addrCandidates = effectiveAddressField
      ? [effectiveAddressField, "Adres", "adres", "Address", "address", "Адрес", "адрес"]
      : ["Adres", "adres", "Address", "address", "Адрес", "адрес"];
    let address = "";
    for (const field of addrCandidates) {
      if (props[field] && String(props[field]).trim()) {
        address = String(props[field]).trim();
        break;
      }
    }

    parsedComplaints.push({
      id: c.id,
      coordinates: c.coordinates,
      properties: props,
      date: dateStr,
      address,
    });
  }

  console.log(`[ComplaintAnalysis] Parsed ${parsedComplaints.length} complaints with valid dates`);

  const layerConfig = await getSceneNetworkLayers(sceneId);
  const consumerLayerIds = [...layerConfig.consumerLayerIds, ...layerConfig.ctpLayerIds];

  if (consumerLayerIds.length === 0) {
    throw new Error("В сцене не найдены слои потребителей или ЦТП");
  }

  const consumerRows = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(inArray(drawnFeatures.layerId, consumerLayerIds));

  const consumers: ConsumerFeature[] = [];
  for (const row of consumerRows) {
    const props = row.properties as Record<string, unknown>;
    const coords = getPointCoords(row.coordinates);
    if (!coords) continue;

    const name = normalizeName((props.Name as string) || "");
    const nist = props.Nist !== undefined && props.Nist !== null ? String(props.Nist) : "";

    const addrCandidates = ["Adres", "adres", "Address", "address", "Адрес", "адрес"];
    let address = "";
    for (const field of addrCandidates) {
      if (props[field] && String(props[field]).trim()) {
        address = String(props[field]).trim();
        break;
      }
    }
    if (!address) {
      const parts: string[] = [];
      if (props.Ylitsa) parts.push(String(props.Ylitsa));
      if (props.Dom) parts.push(`д.${props.Dom}`);
      if (parts.length > 0) address = parts.join(", ");
    }

    consumers.push({
      id: row.id,
      layerId: row.layerId,
      coordinates: row.coordinates,
      properties: props,
      name,
      address,
      nist,
      lon: coords[0],
      lat: coords[1],
    });
  }

  console.log(`[ComplaintAnalysis] Loaded ${consumers.length} consumers from ${consumerLayerIds.length} layers`);

  const matches: ComplaintMatch[] = [];
  const unmatched: ComplaintAnalysisResult["unmatchedComplaints"] = [];

  for (const complaint of parsedComplaints) {
    const complaintCoords = getPointCoords(complaint.coordinates);
    if (!complaintCoords) {
      unmatched.push({ complaintId: complaint.id, address: complaint.address, date: complaint.date, reason: "Нет координат" });
      continue;
    }

    const [cLon, cLat] = complaintCoords;

    let bestMatch: { consumer: ConsumerFeature; distance: number; matchType: ComplaintMatch["matchType"] } | null = null;

    for (const consumer of consumers) {
      const dist = haversineDistance(cLat, cLon, consumer.lat, consumer.lon);
      if (dist > matchRadius) continue;

      const addrMatches = complaint.address && consumer.address && addressMatch(complaint.address, consumer.address);

      if (addrMatches) {
        if (!bestMatch || bestMatch.matchType !== "address+proximity" || dist < bestMatch.distance) {
          bestMatch = { consumer, distance: dist, matchType: "address+proximity" };
        }
      } else if (!bestMatch || (bestMatch.matchType !== "address+proximity" && dist < bestMatch.distance)) {
        bestMatch = { consumer, distance: dist, matchType: "proximity_only" };
      }
    }

    if (bestMatch) {
      matches.push({
        complaintId: complaint.id,
        complaintAddress: complaint.address,
        complaintDate: complaint.date,
        consumerId: bestMatch.consumer.id,
        consumerName: bestMatch.consumer.name,
        consumerAddress: bestMatch.consumer.address,
        consumerNist: bestMatch.consumer.nist,
        distance: Math.round(bestMatch.distance),
        matchType: bestMatch.matchType,
      });
    } else {
      unmatched.push({
        complaintId: complaint.id,
        address: complaint.address,
        date: complaint.date,
        reason: `Нет потребителя в радиусе ${matchRadius}м`,
      });
    }
  }

  console.log(`[ComplaintAnalysis] Matched: ${matches.length}, Unmatched: ${unmatched.length}`);
  console.log(`[ComplaintAnalysis] Address+proximity matches: ${matches.filter(m => m.matchType === "address+proximity").length}`);
  console.log(`[ComplaintAnalysis] Proximity-only matches: ${matches.filter(m => m.matchType === "proximity_only").length}`);

  const dateNistGroups = new Map<string, DateGroup>();
  for (const match of matches) {
    const key = `${match.complaintDate}|${match.consumerNist}`;
    if (!dateNistGroups.has(key)) {
      dateNistGroups.set(key, {
        date: match.complaintDate,
        nist: match.consumerNist,
        complaints: [],
        consumerNodeNames: [],
      });
    }
    const group = dateNistGroups.get(key)!;
    group.complaints.push(match);
    if (!group.consumerNodeNames.includes(match.consumerName)) {
      group.consumerNodeNames.push(match.consumerName);
    }
  }

  console.log(`[ComplaintAnalysis] Date-Nist groups: ${dateNistGroups.size}`);

  const resultGroups: ComplaintAnalysisResult["dateGroups"] = [];

  for (const [, group] of dateNistGroups) {
    if (group.complaints.length < 2) {
      const c = group.complaints[0];
      resultGroups.push({
        date: group.date,
        nist: group.nist,
        sourceName: "",
        complaintCount: 1,
        consumers: [{
          name: c.consumerName,
          address: c.consumerAddress,
          complaintCount: 1,
          distance: c.distance,
        }],
        probableFailure: null,
        affectedSegments: [],
        affectedConsumers: [],
      });
      continue;
    }

    const graph = await buildNetworkGraph(
      layerConfig.segmentLayerIds,
      layerConfig.nodeLayerIds,
      layerConfig.consumerLayerIds,
      layerConfig.ctpLayerIds,
      layerConfig.sourceLayerIds,
      layerConfig.valveLayerIds,
      layerConfig.pumpLayerIds,
      group.nist
    );

    const sourceNodeName = findSourceNode(graph);
    if (!sourceNodeName) {
      console.log(`[ComplaintAnalysis] No source found for Nist=${group.nist}, skipping LCA`);
      const consumerSummary = summarizeConsumers(group);
      resultGroups.push({
        date: group.date,
        nist: group.nist,
        sourceName: "",
        complaintCount: group.complaints.length,
        consumers: consumerSummary,
        probableFailure: null,
        affectedSegments: [],
        affectedConsumers: [],
      });
      continue;
    }

    const parentMap = buildTreeFromSource(graph, sourceNodeName);

    const complaintNodeNames: string[] = [];
    for (const nodeName of group.consumerNodeNames) {
      if (parentMap.has(nodeName)) {
        complaintNodeNames.push(nodeName);
      } else {
        const matched = findFuzzyNodeInTree(nodeName, parentMap);
        if (matched) {
          complaintNodeNames.push(matched);
        }
      }
    }

    let lcaResult: LCAResult | null = null;
    if (complaintNodeNames.length >= 2) {
      lcaResult = computeLCA(graph, parentMap, sourceNodeName, complaintNodeNames);
    }

    let affectedSegments: ComplaintAnalysisResult["dateGroups"][0]["affectedSegments"] = [];
    let affectedConsumers: ComplaintAnalysisResult["dateGroups"][0]["affectedConsumers"] = [];

    if (lcaResult) {
      const children = new Map<string, string[]>();
      for (const [node, par] of parentMap) {
        if (par !== null) {
          if (!children.has(par)) children.set(par, []);
          children.get(par)!.push(node);
        }
      }

      const downstream = new Set<string>();
      downstream.add(lcaResult.lcaNodeName);
      const collectDown = (n: string) => {
        for (const child of children.get(n) || []) {
          if (!downstream.has(child)) {
            downstream.add(child);
            collectDown(child);
          }
        }
      };
      collectDown(lcaResult.lcaNodeName);

      for (const edge of graph.edges) {
        if (downstream.has(edge.from) && downstream.has(edge.to)) {
          affectedSegments.push({
            featureId: edge.featureId,
            from: edge.from,
            to: edge.to,
            length: edge.length,
            coordinates: edge.coordinates,
          });
        }
      }

      for (const nodeName of downstream) {
        const node = graph.nodes.get(nodeName);
        if (node && (node.type === "consumer" || node.type === "ctp") && node.featureId > 0) {
          affectedConsumers.push({
            featureId: node.featureId,
            name: node.name,
            address: (node.properties.Adres as string) || "",
            coordinates: node.coordinates,
          });
        }
      }
    }

    const sourceNode = graph.nodes.get(sourceNodeName);
    const consumerSummary = summarizeConsumers(group);

    resultGroups.push({
      date: group.date,
      nist: group.nist,
      sourceName: sourceNode?.name || sourceNodeName,
      complaintCount: group.complaints.length,
      consumers: consumerSummary,
      probableFailure: lcaResult ? {
        nodeName: lcaResult.lcaNodeName,
        nodeType: lcaResult.lcaNode?.type || "unknown",
        nodeCoordinates: lcaResult.lcaNode?.coordinates || null,
        segmentFrom: lcaResult.incomingSegment?.from || "",
        segmentTo: lcaResult.incomingSegment?.to || "",
        segmentLength: lcaResult.incomingSegment?.length || 0,
        segmentFeatureId: lcaResult.incomingSegment?.featureId || 0,
        confidence: lcaResult.confidence,
        downstreamConsumerCount: lcaResult.downstreamConsumerCount,
        complaintCoverage: lcaResult.complaintCoverage,
      } : null,
      affectedSegments,
      affectedConsumers,
    });
  }

  resultGroups.sort((a, b) => {
    const dc = b.complaintCount - a.complaintCount;
    if (dc !== 0) return dc;
    return a.date.localeCompare(b.date);
  });

  console.log(`[ComplaintAnalysis] === End === Groups: ${resultGroups.length}`);

  return {
    totalComplaints: parsedComplaints.length,
    totalMatched: matches.length,
    totalUnmatched: unmatched.length,
    dateGroups: resultGroups,
    unmatchedComplaints: unmatched,
  };
}

function summarizeConsumers(group: DateGroup) {
  const consumerMap = new Map<string, { name: string; address: string; count: number; distance: number }>();
  for (const c of group.complaints) {
    const key = c.consumerName;
    if (!consumerMap.has(key)) {
      consumerMap.set(key, { name: c.consumerName, address: c.consumerAddress, count: 0, distance: c.distance });
    }
    consumerMap.get(key)!.count++;
  }
  return Array.from(consumerMap.values()).map(v => ({
    name: v.name,
    address: v.address,
    complaintCount: v.count,
    distance: v.distance,
  }));
}

function findFuzzyNodeInTree(nodeName: string, parentMap: Map<string, string | null>): string | null {
  const norm = normalizeName(nodeName).toLowerCase();
  for (const key of parentMap.keys()) {
    const keyNorm = normalizeName(key).toLowerCase();
    if (keyNorm === norm) return key;
  }
  for (const key of parentMap.keys()) {
    const keyNorm = normalizeName(key).toLowerCase();
    if (keyNorm.startsWith(norm) || norm.startsWith(keyNorm)) return key;
  }
  return null;
}

function getAncestorPath(parentMap: Map<string, string | null>, nodeName: string): string[] {
  const path: string[] = [];
  let current: string | null = nodeName;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) break;
    visited.add(current);
    path.push(current);
    current = parentMap.get(current) ?? null;
  }
  return path.reverse();
}

function computeLCA(
  graph: NetworkGraph,
  parentMap: Map<string, string | null>,
  sourceNodeName: string,
  complaintNodeNames: string[]
): LCAResult {
  const paths = complaintNodeNames.map(n => getAncestorPath(parentMap, n));

  let lca = sourceNodeName;
  const minLen = Math.min(...paths.map(p => p.length));
  for (let i = 0; i < minLen; i++) {
    const node = paths[0][i];
    if (paths.every(p => p[i] === node)) {
      lca = node;
    } else {
      break;
    }
  }

  const lcaNode = graph.nodes.get(lca) || null;

  let incomingSegment: LCAResult["incomingSegment"] = null;
  const lcaParent = parentMap.get(lca);
  if (lcaParent) {
    for (const edge of graph.edges) {
      if ((edge.from === lcaParent && edge.to === lca) ||
          (edge.from === lca && edge.to === lcaParent)) {
        incomingSegment = {
          featureId: edge.featureId,
          from: edge.from,
          to: edge.to,
          length: edge.length,
        };
        break;
      }
    }
  }

  const children = new Map<string, string[]>();
  for (const [node, par] of parentMap) {
    if (par !== null) {
      if (!children.has(par)) children.set(par, []);
      children.get(par)!.push(node);
    }
  }

  const downstream = new Set<string>();
  downstream.add(lca);
  const collectDown = (n: string) => {
    for (const child of children.get(n) || []) {
      if (!downstream.has(child)) {
        downstream.add(child);
        collectDown(child);
      }
    }
  };
  collectDown(lca);

  let downstreamConsumerCount = 0;
  for (const nodeName of downstream) {
    const node = graph.nodes.get(nodeName);
    if (node && (node.type === "consumer" || node.type === "ctp")) {
      downstreamConsumerCount++;
    }
  }

  const coveredComplaints = complaintNodeNames.filter(n => downstream.has(n)).length;
  const complaintCoverage = complaintNodeNames.length > 0
    ? Math.round((coveredComplaints / complaintNodeNames.length) * 100)
    : 0;

  let confidence: LCAResult["confidence"] = "low";
  if (complaintCoverage === 100 && complaintNodeNames.length >= 2) {
    if (lca !== sourceNodeName && downstreamConsumerCount <= complaintNodeNames.length * 3) {
      confidence = "high";
    } else {
      confidence = "medium";
    }
  } else if (complaintCoverage >= 80) {
    confidence = "medium";
  }

  console.log(`[ComplaintAnalysis] LCA: "${lca}" (type=${lcaNode?.type}), downstream=${downstreamConsumerCount} consumers, coverage=${complaintCoverage}%, confidence=${confidence}`);

  return {
    lcaNodeName: lca,
    lcaNode,
    incomingSegment,
    downstreamConsumerCount,
    complaintCoverage,
    confidence,
  };
}
