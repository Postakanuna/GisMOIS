import { db } from "./db";
import { drawnFeatures, editableLayers } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  getSceneNetworkLayers,
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

    resultGroups.push({
      date: group.date,
      nist: group.nist,
      sourceName: "",
      complaintCount: group.complaints.length,
      consumers: consumerSummary,
      failureZones: [],
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

export interface NoTopologyCluster {
  id: number;
  date: string;
  complaintCount: number;
  complaints: Array<{
    featureId: number;
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
  complaintLayerId: number,
  dateFieldName: string,
  addressFieldName: string,
  clusterRadiusM: number = 350
): Promise<NoTopologyAnalysisResult> {
  console.log(`[ComplaintAnalysis:NoTopology] === Start ===`);
  console.log(`[ComplaintAnalysis:NoTopology] complaintLayer=${complaintLayerId}, dateField="${dateFieldName}", addressField="${addressFieldName}", radius=${clusterRadiusM}m`);

  const complaints = await db
    .select({
      id: drawnFeatures.id,
      coordinates: drawnFeatures.coordinates,
      properties: drawnFeatures.properties,
    })
    .from(drawnFeatures)
    .where(eq(drawnFeatures.layerId, complaintLayerId));

  console.log(`[ComplaintAnalysis:NoTopology] Loaded ${complaints.length} complaints`);

  interface ParsedComplaint {
    featureId: number;
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

      clusters.push({
        id: clusterId,
        date,
        complaintCount: clusterMembers.length,
        complaints: clusterMembers.map(m => ({
          featureId: m.featureId,
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
    clusters,
    unclustered: noPosComplaints,
  };
}
