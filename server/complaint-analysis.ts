import { db } from "./db";
import { drawnFeatures, editableLayers } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  getSceneNetworkLayers,
  buildSpatialNetworkGraph,
  findFailureZonesForConsumers,
  coordKey,
  getConnectedComponent,
  findSourceInComponent,
  spatialBfsFromSource,
  normalizeName,
} from "./network-graph";
import type { SpatialGraph } from "./network-graph";

const ADDRESS_PREFIXES_TO_STRIP = [
  "россия",
  "российская федерация",
  "рф",
  "московская область",
  "московская обл",
  "москвоская область",
  "мо",
  "ленинградская область",
  "ленинградская обл",
  "свердловская область",
  "свердловская обл",
  "нижегородская область",
  "нижегородская обл",
  "самарская область",
  "самарская обл",
  "челябинская область",
  "челябинская обл",
  "ростовская область",
  "ростовская обл",
  "краснодарский край",
  "красноярский край",
  "пермский край",
  "республика татарстан",
  "республика башкортостан",
  "муниципальный район",
  "муниципальный округ",
  "городской округ",
  "г.о.",
  "г.о",
  "м.р.",
  "м.р",
];

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

function stripAddressPrefixes(addr: string): string {
  let result = addr.toLowerCase().trim();
  for (const prefix of ADDRESS_PREFIXES_TO_STRIP) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`^${escaped}[,\\s]*`, "i"), "");
    result = result.replace(new RegExp(`[,\\s]+${escaped}[,\\s]*`, "gi"), " ");
  }
  return result.replace(/^[,\s]+/, "").replace(/[,\s]+$/, "").trim();
}

function extractStreetAndHouse(addr: string): { street: string; house: string } | null {
  const normalized = normalizeAddress(addr);
  const stripped = stripAddressPrefixes(normalized);

  const streetPatterns = [
    /(?:ул\.?|улица)\s*([^,\d]+)/i,
    /(?:пр-т\.?|проспект)\s*([^,\d]+)/i,
    /(?:пер\.?|переулок)\s*([^,\d]+)/i,
    /(?:б-р\.?|бульвар)\s*([^,\d]+)/i,
    /(?:ш\.?|шоссе)\s*([^,\d]+)/i,
    /(?:пр-д\.?|проезд)\s*([^,\d]+)/i,
    /(?:пл\.?|площадь)\s*([^,\d]+)/i,
    /(?:наб\.?|набережная)\s*([^,\d]+)/i,
  ];

  let street = "";
  for (const pattern of streetPatterns) {
    const match = stripped.match(pattern);
    if (match) {
      street = match[1].trim().replace(/[,\s]+$/, "");
      break;
    }
  }

  const housePatterns = [
    /(?:д\.?|дом)\s*(\d+[\w\/]*)/i,
    /(?:,\s*)(\d+[\w\/]*)\s*$/,
  ];

  let house = "";
  for (const pattern of housePatterns) {
    const match = stripped.match(pattern);
    if (match) {
      house = match[1].trim();
      break;
    }
  }

  if (!street && !house) return null;
  return { street: street.toLowerCase(), house: house.toLowerCase() };
}

function extractAddressTokens(addr: string): string[] {
  const normalized = normalizeAddress(addr);
  const stripped = stripAddressPrefixes(normalized);
  return stripped
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

  const sh1 = extractStreetAndHouse(addr1);
  const sh2 = extractStreetAndHouse(addr2);
  if (sh1 && sh2 && sh1.house && sh2.house) {
    if (sh1.house === sh2.house) {
      if (sh1.street && sh2.street) {
        const streetTokens1 = sh1.street.split(/[\s.]+/).filter(t => t.length > 1);
        const streetTokens2 = sh2.street.split(/[\s.]+/).filter(t => t.length > 1);
        const hasCommonStreetToken = streetTokens1.some(t1 =>
          streetTokens2.some(t2 => tokenMatch(t1, t2))
        );
        if (hasCommonStreetToken) return true;
      }
    }
  }

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

  return matchCount >= Math.max(2, Math.ceil(shorter.length * 0.5));
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

export interface ComplaintLayerInput {
  layerId: number;
  dateField: string;
  addressField: string;
}

interface ComplaintFeature {
  id: number;
  layerId: number;
  layerName: string;
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
  complaintLayerId: number;
  complaintLayerName: string;
  consumerId: number;
  consumerName: string;
  consumerAddress: string;
  consumerNist: string;
  consumerLon: number;
  consumerLat: number;
  distance: number;
  matchType: "address+proximity" | "proximity_only";
}

interface SpatialCluster {
  matches: ComplaintMatch[];
  uniqueConsumerIds: Set<number>;
}

interface FailureZone {
  zoneName: string;
  zoneType: string;
  zoneCoordinates: any;
  incomingSegment: { featureId: number; from: string; to: string; length: number } | null;
  complaintConsumers: string[];
  complaintCount: number;
  uniqueComplaintConsumerCount: number;
  downstreamConsumerCount: number;
  probability: number;
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
  layerNames: Record<number, string>;
  dateGroups: Array<{
    date: string;
    clusterId: number;
    sourceName: string;
    complaintCount: number;
    uniqueConsumerCount: number;
    clusterCenter: [number, number];
    layerBreakdown: Record<string, number>;
    consumers: Array<{
      name: string;
      address: string;
      complaintCount: number;
      distance: number;
      matchType: "address+proximity" | "proximity_only";
    }>;
    failureZones: FailureZone[];
  }>;
  unclustered: Array<{
    complaintId: number;
    address: string;
    date: string;
    consumerName: string;
    reason: string;
  }>;
  unmatchedComplaints: Array<{
    complaintId: number;
    address: string;
    date: string;
    reason: string;
  }>;
}

export async function analyzeComplaints(
  complaintLayers: ComplaintLayerInput[],
  sceneId: number,
  matchRadius: number = 100
): Promise<ComplaintAnalysisResult> {
  console.log(`[ComplaintAnalysis] === Start ===`);
  console.log(`[ComplaintAnalysis] complaintLayers=${JSON.stringify(complaintLayers)}, scene=${sceneId}, radius=${matchRadius}m`);

  const layerIds = complaintLayers.map(l => l.layerId);
  const layerFieldMap = new Map<number, { dateField: string; addressField: string }>();
  for (const l of complaintLayers) {
    layerFieldMap.set(l.layerId, { dateField: l.dateField, addressField: l.addressField });
  }

  const layerRows = await db
    .select({ id: editableLayers.id, name: editableLayers.name })
    .from(editableLayers)
    .where(inArray(editableLayers.id, layerIds));
  const layerNameMap: Record<number, string> = {};
  for (const r of layerRows) layerNameMap[r.id] = r.name;

  const complaints = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(inArray(drawnFeatures.layerId, layerIds));

  console.log(`[ComplaintAnalysis] Loaded ${complaints.length} complaints from ${layerIds.length} layers`);

  const parsedComplaints: ComplaintFeature[] = [];
  for (const c of complaints) {
    const props = c.properties as Record<string, unknown>;
    const fields = layerFieldMap.get(c.layerId) || { dateField: "", addressField: "" };

    const effectiveDateField = fields.dateField && fields.dateField !== "_none_" ? fields.dateField : "";
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

    const effectiveAddressField = fields.addressField && fields.addressField !== "_none_" ? fields.addressField : "";
    const addrCandidates = effectiveAddressField
      ? [effectiveAddressField, "Adres", "adres", "Address", "address", "Адрес", "адрес", "addr_point"]
      : ["Adres", "adres", "Address", "address", "Адрес", "адрес", "addr_point"];
    let address = "";
    for (const field of addrCandidates) {
      if (props[field] && String(props[field]).trim()) {
        address = String(props[field]).trim();
        break;
      }
    }

    parsedComplaints.push({
      id: c.id,
      layerId: c.layerId,
      layerName: layerNameMap[c.layerId] || `Слой ${c.layerId}`,
      coordinates: c.coordinates,
      properties: props,
      date: dateStr,
      address,
    });
  }

  console.log(`[ComplaintAnalysis] Parsed ${parsedComplaints.length} complaints`);

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

    const addrCandidates = ["addr_point", "Adres", "adres", "Address", "address", "Адрес", "адрес"];
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
        complaintLayerId: complaint.layerId,
        complaintLayerName: complaint.layerName,
        consumerId: bestMatch.consumer.id,
        consumerName: bestMatch.consumer.name,
        consumerAddress: bestMatch.consumer.address,
        consumerNist: bestMatch.consumer.nist,
        consumerLon: bestMatch.consumer.lon,
        consumerLat: bestMatch.consumer.lat,
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

  const byDate = new Map<string, ComplaintMatch[]>();
  for (const match of matches) {
    if (!byDate.has(match.complaintDate)) byDate.set(match.complaintDate, []);
    byDate.get(match.complaintDate)!.push(match);
  }

  const spatialClusters: Array<{ date: string; cluster: SpatialCluster }> = [];
  const unclusteredMatches: ComplaintAnalysisResult["unclustered"] = [];

  for (const [date, dateMatches] of byDate) {
    const consumerPositions = new Map<number, { lon: number; lat: number; matches: ComplaintMatch[] }>();
    for (const m of dateMatches) {
      if (!consumerPositions.has(m.consumerId)) {
        consumerPositions.set(m.consumerId, { lon: m.consumerLon, lat: m.consumerLat, matches: [] });
      }
      consumerPositions.get(m.consumerId)!.matches.push(m);
    }

    const consumerEntries = Array.from(consumerPositions.entries());
    const visited = new Set<number>();

    for (let i = 0; i < consumerEntries.length; i++) {
      if (visited.has(i)) continue;

      const queue = [i];
      visited.add(i);
      const clusterMembers: number[] = [i];

      let head = 0;
      while (head < queue.length) {
        const currentEntry = consumerEntries[queue[head]];
        head++;

        for (let j = 0; j < consumerEntries.length; j++) {
          if (visited.has(j)) continue;
          const candidateEntry = consumerEntries[j];
          const dist = haversineDistance(
            currentEntry[1].lat, currentEntry[1].lon,
            candidateEntry[1].lat, candidateEntry[1].lon
          );
          if (dist <= matchRadius * 5) {
            visited.add(j);
            queue.push(j);
            clusterMembers.push(j);
          }
        }
      }

      const uniqueConsumerIds = new Set<number>();
      const allMatches: ComplaintMatch[] = [];
      for (const idx of clusterMembers) {
        const [consumerId, data] = consumerEntries[idx];
        uniqueConsumerIds.add(consumerId);
        allMatches.push(...data.matches);
      }

      if (uniqueConsumerIds.size < 2) {
        for (const m of allMatches) {
          unclusteredMatches.push({
            complaintId: m.complaintId,
            address: m.complaintAddress,
            date: m.complaintDate,
            consumerName: m.consumerName,
            reason: "Единичная жалоба (менее 2 МКД/потребителей в радиусе)",
          });
        }
        continue;
      }

      spatialClusters.push({
        date,
        cluster: { matches: allMatches, uniqueConsumerIds },
      });
    }
  }

  console.log(`[ComplaintAnalysis] Spatial clusters (>=2 consumers): ${spatialClusters.length}, Unclustered: ${unclusteredMatches.length}`);

  let graph: SpatialGraph | null = null;
  try {
    graph = await buildSpatialNetworkGraph(sceneId);
    console.log(`[ComplaintAnalysis] Graph built: ${graph.nodes.size} nodes, ${graph.edges.length} edges`);
  } catch (graphErr: any) {
    console.warn(`[ComplaintAnalysis] Failed to build graph, failureZones will be empty:`, graphErr.message);
  }

  const consumerKeyMap = new Map<number, string>();
  if (graph) {
    for (const consumer of consumers) {
      const key = coordKey(consumer.lon, consumer.lat);
      if (graph.nodes.has(key)) {
        consumerKeyMap.set(consumer.id, key);
      }
    }
    console.log(`[ComplaintAnalysis] Consumers found in graph: ${consumerKeyMap.size} / ${consumers.length}`);
  }

  const resultGroups: ComplaintAnalysisResult["dateGroups"] = [];
  let clusterIdCounter = 0;

  for (const { date, cluster } of spatialClusters) {
    clusterIdCounter++;

    const consumerSummary = summarizeClusterConsumers(cluster.matches);

    const layerBreakdown: Record<string, number> = {};
    for (const m of cluster.matches) {
      layerBreakdown[m.complaintLayerName] = (layerBreakdown[m.complaintLayerName] || 0) + 1;
    }

    let centerLon = 0, centerLat = 0;
    for (const cid of cluster.uniqueConsumerIds) {
      const consumer = consumers.find(c => c.id === cid);
      if (consumer) {
        centerLon += consumer.lon;
        centerLat += consumer.lat;
      }
    }
    centerLon /= cluster.uniqueConsumerIds.size;
    centerLat /= cluster.uniqueConsumerIds.size;

    let failureZones: FailureZone[] = [];
    let sourceName = "";

    if (graph) {
      try {
        const consumerKeys: string[] = [];
        for (const cid of cluster.uniqueConsumerIds) {
          const key = consumerKeyMap.get(cid);
          if (key) consumerKeys.push(key);
        }

        if (consumerKeys.length >= 2) {
          const firstKey = consumerKeys[0];
          const component = getConnectedComponent(graph, firstKey);
          const sourceKey = findSourceInComponent(graph, component);

          if (sourceKey) {
            const sourceNode = graph.nodes.get(sourceKey);
            if (sourceNode) {
              sourceName = sourceNode.name || "";
            }

            const parentMap = spatialBfsFromSource(graph, sourceKey, component);

            const keysInTree = consumerKeys.filter(k => parentMap.has(k));
            if (keysInTree.length >= 2) {
              const candidates = findFailureZonesForConsumers(
                graph, parentMap, sourceKey, keysInTree
              );

              for (const candidate of candidates) {
                const node = graph.nodes.get(candidate.nodeKey);

                let incomingSegment: FailureZone["incomingSegment"] = null;
                if (candidate.incomingEdge) {
                  const e = candidate.incomingEdge;
                  const eProps = e.properties || {};
                  incomingSegment = {
                    featureId: e.featureId,
                    from: String(eProps.Begin_uch || eProps.Name || ""),
                    to: String(eProps.End_uch || ""),
                    length: Math.round(e.length || 0),
                  };
                }

                const complaintConsumerNames: string[] = [];
                for (const m of cluster.matches) {
                  if (!complaintConsumerNames.includes(m.consumerName)) {
                    complaintConsumerNames.push(m.consumerName);
                  }
                }

                const affectedSegments: FailureZone["affectedSegments"] = candidate.downstreamSegmentEdges.map(e => {
                  const eProps = e.properties || {};
                  return {
                    featureId: e.featureId,
                    from: String(eProps.Begin_uch || eProps.Name || ""),
                    to: String(eProps.End_uch || ""),
                    length: Math.round(e.length || 0),
                    coordinates: e.coordinates,
                  };
                });

                const affectedConsumers: FailureZone["affectedConsumers"] = [];
                for (const dk of candidate.downstreamConsumerKeys) {
                  const dn = graph.nodes.get(dk);
                  if (dn && (dn.type === "consumer" || dn.type === "ctp")) {
                    const addrVal = dn.properties?.addr_point || dn.properties?.Adres || dn.properties?.Address || "";
                    affectedConsumers.push({
                      featureId: dn.featureId,
                      name: dn.name || "",
                      address: String(addrVal),
                      coordinates: dn.coordinates,
                    });
                  }
                }

                const probability = candidate.probability;
                let confidence: FailureZone["confidence"] = "low";
                if (probability >= 70) confidence = "high";
                else if (probability >= 30) confidence = "medium";

                const nodeTypeMap: Record<string, string> = {
                  source: "source", ctp: "ctp", consumer: "consumer",
                  node: "node", valve: "valve", pump: "pump", other: "node",
                };

                failureZones.push({
                  zoneName: candidate.nodeName || node?.name || `Узел (${candidate.nodeType})`,
                  zoneType: nodeTypeMap[candidate.nodeType] || candidate.nodeType,
                  zoneCoordinates: candidate.nodeCoordinates,
                  incomingSegment,
                  complaintConsumers: complaintConsumerNames,
                  complaintCount: cluster.matches.length,
                  uniqueComplaintConsumerCount: cluster.uniqueConsumerIds.size,
                  downstreamConsumerCount: candidate.downstreamConsumerCount,
                  probability,
                  confidence,
                  affectedSegments,
                  affectedConsumers,
                });
              }

              console.log(`[ComplaintAnalysis] Cluster ${clusterIdCounter} (${date}): ${failureZones.length} failure zones, ${cluster.uniqueConsumerIds.size} consumers, ${cluster.matches.length} complaints`);
            } else {
              console.log(`[ComplaintAnalysis] Cluster ${clusterIdCounter} (${date}): fewer than 2 consumers in BFS tree`);
            }
          } else {
            console.log(`[ComplaintAnalysis] Cluster ${clusterIdCounter} (${date}): no source found in component`);
          }
        } else {
          console.log(`[ComplaintAnalysis] Cluster ${clusterIdCounter} (${date}): fewer than 2 consumers found in graph`);
        }
      } catch (zoneErr: any) {
        console.warn(`[ComplaintAnalysis] Error finding failure zones for cluster ${clusterIdCounter}:`, zoneErr.message);
      }
    }

    resultGroups.push({
      date,
      clusterId: clusterIdCounter,
      sourceName,
      complaintCount: cluster.matches.length,
      uniqueConsumerCount: cluster.uniqueConsumerIds.size,
      clusterCenter: [centerLon, centerLat],
      layerBreakdown,
      consumers: consumerSummary,
      failureZones,
    });
  }

  resultGroups.sort((a, b) => b.complaintCount - a.complaintCount);

  console.log(`[ComplaintAnalysis] === End === Groups: ${resultGroups.length}, Zones: ${resultGroups.reduce((s, g) => s + g.failureZones.length, 0)}, Unclustered: ${unclusteredMatches.length}`);

  return {
    totalComplaints: parsedComplaints.length,
    totalMatched: matches.length,
    totalUnmatched: unmatched.length,
    layerNames: layerNameMap,
    dateGroups: resultGroups,
    unclustered: unclusteredMatches,
    unmatchedComplaints: unmatched,
  };
}

function summarizeClusterConsumers(matches: ComplaintMatch[]) {
  const consumerMap = new Map<number, { name: string; address: string; count: number; distance: number; matchType: ComplaintMatch["matchType"] }>();
  for (const m of matches) {
    if (!consumerMap.has(m.consumerId)) {
      consumerMap.set(m.consumerId, { name: m.consumerName, address: m.consumerAddress, count: 0, distance: m.distance, matchType: m.matchType });
    }
    const entry = consumerMap.get(m.consumerId)!;
    entry.count++;
    if (m.matchType === "address+proximity" && entry.matchType !== "address+proximity") {
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

export interface NoTopologyCluster {
  id: number;
  date: string;
  complaintCount: number;
  layerBreakdown: Record<string, number>;
  complaints: Array<{
    featureId: number;
    layerId: number;
    layerName: string;
    address: string;
    lon: number;
    lat: number;
    properties: Record<string, unknown>;
  }>;
  centroid: [number, number];
  polygon: number[][] | null;
  radiusM: number;
}

export interface NoTopologyAnalysisResult {
  mode: "no_topology";
  totalComplaints: number;
  totalClustered: number;
  totalUnclustered: number;
  layerNames: Record<number, string>;
  clusters: NoTopologyCluster[];
  unclustered: Array<{
    featureId: number;
    address: string;
    date: string;
    reason: string;
  }>;
}

function convexHull(points: [number, number][]): number[][] {
  if (points.length < 3) {
    if (points.length === 0) return [];
    if (points.length === 1) return [points[0]];
    return [points[0], points[1]];
  }

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: number[][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: number[][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  hull.push(hull[0]);
  return hull;
}

function bufferPoint(lon: number, lat: number, radiusM: number, sides: number = 32): number[][] {
  const coords: number[][] = [];
  const latRad = lat * Math.PI / 180;
  const dLon = radiusM / (111320 * Math.cos(latRad));
  const dLat = radiusM / 110540;
  for (let i = 0; i <= sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    coords.push([
      lon + dLon * Math.cos(angle),
      lat + dLat * Math.sin(angle),
    ]);
  }
  return coords;
}

function bufferPolygon(hullPoints: number[][], radiusM: number): number[][] {
  if (hullPoints.length <= 1) {
    const pt = hullPoints[0] || [0, 0];
    return bufferPoint(pt[0], pt[1], radiusM);
  }
  if (hullPoints.length === 2) {
    const [a, b] = hullPoints;
    const midLon = (a[0] + b[0]) / 2;
    const midLat = (a[1] + b[1]) / 2;
    const dist = haversineDistance(a[1], a[0], b[1], b[0]);
    return bufferPoint(midLon, midLat, dist / 2 + radiusM);
  }

  const allBuffered: [number, number][] = [];
  for (const pt of hullPoints) {
    const circle = bufferPoint(pt[0], pt[1], radiusM, 16);
    for (const c of circle) {
      allBuffered.push([c[0], c[1]]);
    }
  }
  return convexHull(allBuffered);
}

export async function analyzeComplaintsNoTopology(
  complaintLayers: ComplaintLayerInput[],
  clusterRadiusM: number = 350
): Promise<NoTopologyAnalysisResult> {
  console.log(`[ComplaintAnalysis:NoTopology] === Start ===`);
  console.log(`[ComplaintAnalysis:NoTopology] complaintLayers=${JSON.stringify(complaintLayers)}, radius=${clusterRadiusM}m`);

  const layerIds = complaintLayers.map(l => l.layerId);
  const layerFieldMap = new Map<number, { dateField: string; addressField: string }>();
  for (const l of complaintLayers) {
    layerFieldMap.set(l.layerId, { dateField: l.dateField, addressField: l.addressField });
  }

  const layerRows = await db
    .select({ id: editableLayers.id, name: editableLayers.name })
    .from(editableLayers)
    .where(inArray(editableLayers.id, layerIds));
  const layerNameMap: Record<number, string> = {};
  for (const r of layerRows) layerNameMap[r.id] = r.name;

  const complaints = await db
    .select({
      id: drawnFeatures.id,
      layerId: drawnFeatures.layerId,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(inArray(drawnFeatures.layerId, layerIds));

  console.log(`[ComplaintAnalysis:NoTopology] Loaded ${complaints.length} complaints from ${layerIds.length} layers`);

  interface ParsedComplaint {
    featureId: number;
    layerId: number;
    layerName: string;
    date: string;
    address: string;
    lon: number;
    lat: number;
    properties: Record<string, unknown>;
  }

  const parsed: ParsedComplaint[] = [];
  const noPosComplaints: NoTopologyAnalysisResult["unclustered"] = [];

  for (const c of complaints) {
    const props = c.properties as Record<string, unknown>;
    const fields = layerFieldMap.get(c.layerId) || { dateField: "", addressField: "" };

    const effectiveDateField = fields.dateField && fields.dateField !== "_none_" ? fields.dateField : "";
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

    const effectiveAddressField = fields.addressField && fields.addressField !== "_none_" ? fields.addressField : "";
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

    const coords = getPointCoords(c.coordinates);
    if (!coords) {
      noPosComplaints.push({
        featureId: c.id,
        address,
        date: dateStr,
        reason: "Нет координат",
      });
      continue;
    }

    parsed.push({
      featureId: c.id,
      layerId: c.layerId,
      layerName: layerNameMap[c.layerId] || `Слой ${c.layerId}`,
      date: dateStr,
      address,
      lon: coords[0],
      lat: coords[1],
      properties: props,
    });
  }

  const byDate = new Map<string, ParsedComplaint[]>();
  for (const p of parsed) {
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date)!.push(p);
  }

  const clusters: NoTopologyCluster[] = [];
  let clusterId = 0;

  for (const [date, dateComplaints] of Array.from(byDate)) {
    const visited = new Set<number>();

    for (let i = 0; i < dateComplaints.length; i++) {
      if (visited.has(i)) continue;

      const queue = [i];
      visited.add(i);
      const clusterMembers: ParsedComplaint[] = [dateComplaints[i]];

      let head = 0;
      while (head < queue.length) {
        const current = dateComplaints[queue[head]];
        head++;

        for (let j = 0; j < dateComplaints.length; j++) {
          if (visited.has(j)) continue;
          const candidate = dateComplaints[j];
          const dist = haversineDistance(current.lat, current.lon, candidate.lat, candidate.lon);
          if (dist <= clusterRadiusM) {
            visited.add(j);
            queue.push(j);
            clusterMembers.push(candidate);
          }
        }
      }

      if (clusterMembers.length < 2) {
        noPosComplaints.push({
          featureId: clusterMembers[0].featureId,
          address: clusterMembers[0].address,
          date: clusterMembers[0].date,
          reason: "Нет соседних жалоб в радиусе",
        });
        continue;
      }

      clusterId++;

      const centroidLon = clusterMembers.reduce((s, m) => s + m.lon, 0) / clusterMembers.length;
      const centroidLat = clusterMembers.reduce((s, m) => s + m.lat, 0) / clusterMembers.length;

      const points: [number, number][] = clusterMembers.map(m => [m.lon, m.lat]);
      const hull = convexHull(points);
      const buffered = bufferPolygon(hull, 50);

      const layerBreakdown: Record<string, number> = {};
      for (const m of clusterMembers) {
        layerBreakdown[m.layerName] = (layerBreakdown[m.layerName] || 0) + 1;
      }

      clusters.push({
        id: clusterId,
        date,
        complaintCount: clusterMembers.length,
        layerBreakdown,
        complaints: clusterMembers.map(m => ({
          featureId: m.featureId,
          layerId: m.layerId,
          layerName: m.layerName,
          address: m.address,
          lon: m.lon,
          lat: m.lat,
          properties: m.properties,
        })),
        centroid: [centroidLon, centroidLat],
        polygon: buffered.length >= 3 ? buffered : null,
        radiusM: clusterRadiusM,
      });
    }
  }

  clusters.sort((a, b) => b.complaintCount - a.complaintCount);

  const totalClustered = clusters.reduce((s, c) => s + c.complaintCount, 0);

  console.log(`[ComplaintAnalysis:NoTopology] === End === Clusters: ${clusters.length}, Clustered: ${totalClustered}, Unclustered: ${noPosComplaints.length}`);

  return {
    mode: "no_topology",
    totalComplaints: parsed.length + noPosComplaints.length,
    totalClustered,
    totalUnclustered: noPosComplaints.length,
    layerNames: layerNameMap,
    clusters,
    unclustered: noPosComplaints,
  };
}
