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

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.startsWith(shorter)) return false;
  const remainder = longer.slice(shorter.length);
  if (remainder === ".") return true;
  if (/^\d/.test(remainder)) return false;
  if (/^[а-яёa-z]/i.test(remainder)) return false;
  return true;
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
    if (longer.some(t => tokenMatch(token, t))) {
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

interface FailureZone {
  zoneName: string;
  zoneType: string;
  zoneCoordinates: any;
  incomingSegment: { featureId: number; from: string; to: string; length: number } | null;
  complaintConsumers: string[];
  complaintCount: number;
  downstreamConsumerCount: number;
  confidence: "high" | "medium" | "low";
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
}

export interface ComplaintAnalysisResult {
  totalComplaints: number;
  totalMatched: number;
  totalUnmatched: number;
  emptyNistCount: number;
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
      matchType: "address+proximity" | "proximity_only";
    }>;
    failureZones: FailureZone[];
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
    const effectiveDateField = dateFieldName && dateFieldName !== "_none_" ? dateFieldName : "";
    let dateStr = "Без даты";
    if (effectiveDateField) {
      const dateVal = props[effectiveDateField];
      if (dateVal) {
        const rawDate = String(dateVal).trim();
        if (rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            dateStr = d.toISOString().split("T")[0];
          } else {
            dateStr = rawDate;
          }
        }
      }
    }

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
  let emptyNistCounter = 0;
  for (const match of matches) {
    let key: string;
    if (!match.consumerNist || match.consumerNist.trim() === "") {
      key = `${match.complaintDate}|__empty_nist_${emptyNistCounter++}`;
    } else {
      key = `${match.complaintDate}|${match.consumerNist}`;
    }
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

  for (const [, group] of Array.from(dateNistGroups)) {
    const consumerSummary = summarizeConsumers(group);

    if (group.complaints.length < 3) {
      resultGroups.push({
        date: group.date,
        nist: group.nist,
        sourceName: "",
        complaintCount: group.complaints.length,
        consumers: consumerSummary,
        failureZones: [],
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
      console.log(`[ComplaintAnalysis] No source found for Nist=${group.nist}, skipping analysis`);
      resultGroups.push({
        date: group.date,
        nist: group.nist,
        sourceName: "",
        complaintCount: group.complaints.length,
        consumers: consumerSummary,
        failureZones: [],
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

    const uniqueComplaintNodes = Array.from(new Set(complaintNodeNames));
    const failureZones = findFailureZones(graph, parentMap, sourceNodeName, uniqueComplaintNodes);

    const sourceNode = graph.nodes.get(sourceNodeName);

    resultGroups.push({
      date: group.date,
      nist: group.nist,
      sourceName: sourceNode?.name || sourceNodeName,
      complaintCount: group.complaints.length,
      consumers: consumerSummary,
      failureZones,
    });
  }

  resultGroups.sort((a, b) => {
    return a.date.localeCompare(b.date);
  });

  console.log(`[ComplaintAnalysis] === End === Groups: ${resultGroups.length}`);

  const emptyNistCount = matches.filter(m => !m.consumerNist || m.consumerNist.trim() === "").length;
  if (emptyNistCount > 0) {
    console.log(`[ComplaintAnalysis] WARNING: ${emptyNistCount} matches have empty Nist — treated as individual groups`);
  }

  return {
    totalComplaints: parsedComplaints.length,
    totalMatched: matches.length,
    totalUnmatched: unmatched.length,
    emptyNistCount,
    dateGroups: resultGroups,
    unmatchedComplaints: unmatched,
  };
}

function summarizeConsumers(group: DateGroup) {
  const consumerMap = new Map<string, { name: string; address: string; count: number; distance: number; matchType: ComplaintMatch["matchType"] }>();
  for (const c of group.complaints) {
    const key = c.consumerName;
    if (!consumerMap.has(key)) {
      consumerMap.set(key, { name: c.consumerName, address: c.consumerAddress, count: 0, distance: c.distance, matchType: c.matchType });
    }
    const entry = consumerMap.get(key)!;
    entry.count++;
    if (c.matchType === "address+proximity" && entry.matchType !== "address+proximity") {
      entry.matchType = "address+proximity";
    }
  }
  return Array.from(consumerMap.values()).map(v => ({
    name: v.name,
    address: v.address,
    complaintCount: v.count,
    distance: v.distance,
    matchType: v.matchType,
  }));
}

function findFuzzyNodeInTree(nodeName: string, parentMap: Map<string, string | null>): string | null {
  const norm = normalizeName(nodeName).toLowerCase();
  for (const key of Array.from(parentMap.keys())) {
    const keyNorm = normalizeName(key).toLowerCase();
    if (keyNorm === norm) return key;
  }
  for (const key of Array.from(parentMap.keys())) {
    const keyNorm = normalizeName(key).toLowerCase();
    if (isPrefixMatchSafe(norm, keyNorm)) return key;
  }
  return null;
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

function findFailureZones(
  graph: NetworkGraph,
  parentMap: Map<string, string | null>,
  sourceNodeName: string,
  complaintNodeNames: string[]
): FailureZone[] {
  if (complaintNodeNames.length === 0) return [];

  const childrenMap = new Map<string, string[]>();
  for (const [node, par] of Array.from(parentMap)) {
    if (par !== null) {
      if (!childrenMap.has(par)) childrenMap.set(par, []);
      childrenMap.get(par)!.push(node);
    }
  }

  const complaintSet = new Set(complaintNodeNames);

  const subtreeComplaints = new Map<string, Set<string>>();
  function computeSubtreeComplaints(node: string): Set<string> {
    if (subtreeComplaints.has(node)) return subtreeComplaints.get(node)!;
    const result = new Set<string>();
    if (complaintSet.has(node)) result.add(node);
    for (const child of childrenMap.get(node) || []) {
      for (const c of Array.from(computeSubtreeComplaints(child))) {
        result.add(c);
      }
    }
    subtreeComplaints.set(node, result);
    return result;
  }
  computeSubtreeComplaints(sourceNodeName);

  const zones: FailureZone[] = [];

  function findZonesRecursive(node: string, nodeComplaints: Set<string>) {
    if (nodeComplaints.size === 0) return;

    if (nodeComplaints.size < 3) {
      return;
    }

    const children = childrenMap.get(node) || [];
    const branchesWithComplaints: Array<{ child: string; complaints: Set<string> }> = [];
    for (const child of children) {
      const childComplaints = subtreeComplaints.get(child);
      if (childComplaints && childComplaints.size > 0) {
        const relevant = new Set<string>();
        for (const c of Array.from(nodeComplaints)) {
          if (childComplaints.has(c)) relevant.add(c);
        }
        if (relevant.size > 0) {
          branchesWithComplaints.push({ child, complaints: relevant });
        }
      }
    }

    if (branchesWithComplaints.length === 0) {
      buildZone(node, nodeComplaints);
      return;
    }

    if (branchesWithComplaints.length === 1) {
      findZonesRecursive(branchesWithComplaints[0].child, branchesWithComplaints[0].complaints);
      return;
    }

    const multiComplaintBranches = branchesWithComplaints.filter(b => b.complaints.size >= 3);

    if (multiComplaintBranches.length === 0) {
      buildZone(node, nodeComplaints);
      return;
    }

    for (const branch of multiComplaintBranches) {
      findZonesRecursive(branch.child, branch.complaints);
    }
  }

  function buildZone(convergenceNode: string, zoneComplaintNodes: Set<string>) {
    let targetNode = convergenceNode;
    const nodeData = graph.nodes.get(convergenceNode);
    const isSignificantNode = nodeData && (
      nodeData.type === "ctp" || nodeData.type === "consumer" ||
      nodeData.type === "node" || nodeData.type === "valve"
    );

    if (!isSignificantNode) {
      let current = convergenceNode;
      while (current) {
        const children = childrenMap.get(current) || [];
        const withComplaints = children.filter(c => {
          const sc = subtreeComplaints.get(c);
          return sc && Array.from(zoneComplaintNodes).some(cn => sc.has(cn));
        });
        if (withComplaints.length === 1) {
          const childNode = graph.nodes.get(withComplaints[0]);
          if (childNode && (childNode.type === "ctp" || childNode.type === "node" || childNode.type === "valve")) {
            targetNode = withComplaints[0];
            break;
          }
          current = withComplaints[0];
        } else {
          break;
        }
      }
    }

    const downstream = new Set<string>();
    downstream.add(targetNode);
    const collectDown = (n: string) => {
      for (const child of childrenMap.get(n) || []) {
        if (!downstream.has(child)) {
          downstream.add(child);
          collectDown(child);
        }
      }
    };
    collectDown(targetNode);

    const affectedSegments: FailureZone["affectedSegments"] = [];
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

    const affectedConsumers: FailureZone["affectedConsumers"] = [];
    let downstreamConsumerCount = 0;
    for (const nodeName of Array.from(downstream)) {
      const nd = graph.nodes.get(nodeName);
      if (nd && (nd.type === "consumer" || nd.type === "ctp")) {
        downstreamConsumerCount++;
        if (nd.featureId > 0) {
          affectedConsumers.push({
            featureId: nd.featureId,
            name: nd.name,
            address: (nd.properties.Adres as string) || "",
            coordinates: nd.coordinates,
          });
        }
      }
    }

    let incomingSegment: FailureZone["incomingSegment"] = null;
    const parent = parentMap.get(targetNode);
    if (parent) {
      for (const edge of graph.edges) {
        if ((edge.from === parent && edge.to === targetNode) ||
            (edge.from === targetNode && edge.to === parent)) {
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

    const targetNodeData = graph.nodes.get(targetNode);
    const complaintConsumers = Array.from(zoneComplaintNodes);

    let confidence: FailureZone["confidence"] = "low";
    if (complaintConsumers.length >= 3 && targetNode !== sourceNodeName) {
      if (downstreamConsumerCount <= complaintConsumers.length * 3) {
        confidence = "high";
      } else {
        confidence = "medium";
      }
    } else if (complaintConsumers.length >= 3) {
      confidence = "medium";
    }

    console.log(`[ComplaintAnalysis] Zone: "${targetNode}" (type=${targetNodeData?.type}), complaints=${complaintConsumers.length}, downstream=${downstreamConsumerCount}, confidence=${confidence}`);

    zones.push({
      zoneName: targetNodeData?.name || targetNode,
      zoneType: targetNodeData?.type || "unknown",
      zoneCoordinates: targetNodeData?.coordinates || null,
      incomingSegment,
      complaintConsumers,
      complaintCount: complaintConsumers.length,
      downstreamConsumerCount,
      confidence,
      affectedSegments,
      affectedConsumers,
    });
  }

  const rootComplaints = subtreeComplaints.get(sourceNodeName) || new Set<string>();
  const relevant = new Set<string>();
  for (const c of complaintNodeNames) {
    if (rootComplaints.has(c)) relevant.add(c);
  }

  findZonesRecursive(sourceNodeName, relevant);

  zones.sort((a, b) => b.complaintCount - a.complaintCount);

  return zones;
}
