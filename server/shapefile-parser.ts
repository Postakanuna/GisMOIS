import shp from "shpjs";
import simplify from "simplify-js";
import JSZip from "jszip";

interface ParsedFeature {
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
}

interface ParseResult {
  features: ParsedFeature[];
  geometryType: string;
  crs: string;
  fileList: string[];
}

function decodeCP1251(buffer: Buffer): string {
  const cp1251Map: Record<number, string> = {
    0x80: '\u0402', 0x81: '\u0403', 0x82: '\u201A', 0x83: '\u0453', 0x84: '\u201E', 0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021',
    0x88: '\u20AC', 0x89: '\u2030', 0x8A: '\u0409', 0x8B: '\u2039', 0x8C: '\u040A', 0x8D: '\u040C', 0x8E: '\u040B', 0x8F: '\u040F',
    0x90: '\u0452', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x99: '\u2122', 0x9A: '\u0459', 0x9B: '\u203A', 0x9C: '\u045A', 0x9D: '\u045C', 0x9E: '\u045B', 0x9F: '\u045F',
    0xA0: '\u00A0', 0xA1: '\u040E', 0xA2: '\u045E', 0xA3: '\u0408', 0xA4: '\u00A4', 0xA5: '\u0490', 0xA6: '\u00A6', 0xA7: '\u00A7',
    0xA8: '\u0401', 0xA9: '\u00A9', 0xAA: '\u0404', 0xAB: '\u00AB', 0xAC: '\u00AC', 0xAD: '\u00AD', 0xAE: '\u00AE', 0xAF: '\u0407',
    0xB0: '\u00B0', 0xB1: '\u00B1', 0xB2: '\u0406', 0xB3: '\u0456', 0xB4: '\u0491', 0xB5: '\u00B5', 0xB6: '\u00B6', 0xB7: '\u00B7',
    0xB8: '\u0451', 0xB9: '\u2116', 0xBA: '\u0454', 0xBB: '\u00BB', 0xBC: '\u0458', 0xBD: '\u0405', 0xBE: '\u0455', 0xBF: '\u0457',
    0xC0: '\u0410', 0xC1: '\u0411', 0xC2: '\u0412', 0xC3: '\u0413', 0xC4: '\u0414', 0xC5: '\u0415', 0xC6: '\u0416', 0xC7: '\u0417',
    0xC8: '\u0418', 0xC9: '\u0419', 0xCA: '\u041A', 0xCB: '\u041B', 0xCC: '\u041C', 0xCD: '\u041D', 0xCE: '\u041E', 0xCF: '\u041F',
    0xD0: '\u0420', 0xD1: '\u0421', 0xD2: '\u0422', 0xD3: '\u0423', 0xD4: '\u0424', 0xD5: '\u0425', 0xD6: '\u0426', 0xD7: '\u0427',
    0xD8: '\u0428', 0xD9: '\u0429', 0xDA: '\u042A', 0xDB: '\u042B', 0xDC: '\u042C', 0xDD: '\u042D', 0xDE: '\u042E', 0xDF: '\u042F',
    0xE0: '\u0430', 0xE1: '\u0431', 0xE2: '\u0432', 0xE3: '\u0433', 0xE4: '\u0434', 0xE5: '\u0435', 0xE6: '\u0436', 0xE7: '\u0437',
    0xE8: '\u0438', 0xE9: '\u0439', 0xEA: '\u043A', 0xEB: '\u043B', 0xEC: '\u043C', 0xED: '\u043D', 0xEE: '\u043E', 0xEF: '\u043F',
    0xF0: '\u0440', 0xF1: '\u0441', 0xF2: '\u0442', 0xF3: '\u0443', 0xF4: '\u0444', 0xF5: '\u0445', 0xF6: '\u0446', 0xF7: '\u0447',
    0xF8: '\u0448', 0xF9: '\u0449', 0xFA: '\u044A', 0xFB: '\u044B', 0xFC: '\u044C', 0xFD: '\u044D', 0xFE: '\u044E', 0xFF: '\u044F',
  };

  let result = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
    } else {
      result += cp1251Map[byte] || String.fromCharCode(byte);
    }
  }
  return result;
}

function simplifyCoordinates(coordinates: any, tolerance: number, isPolygonRing: boolean = false): any {
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0 || tolerance <= 0) return coordinates;

  // Skip if first element is undefined/null
  if (coordinates[0] === undefined || coordinates[0] === null) {
    return coordinates;
  }

  if (typeof coordinates[0] === 'number') {
    return coordinates;
  }

  // Check if this is a ring of coordinates (array of [x, y] pairs)
  if (Array.isArray(coordinates[0]) && coordinates[0].length >= 2 && typeof coordinates[0][0] === 'number') {
    const points = coordinates.map((c: number[]) => ({ x: c[0], y: c[1] }));
    const simplified = simplify(points, tolerance, true);
    let result = simplified.map((p: { x: number; y: number }) => [p.x, p.y]);
    
    // Ensure polygon rings remain closed
    if (isPolygonRing && result.length >= 3) {
      const first = result[0];
      const last = result[result.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        result.push([...first]);
      }
    }
    
    return result;
  }

  return coordinates.map((ring: any, index: number) => 
    simplifyCoordinates(ring, tolerance, true)
  );
}

function detectGeometryType(geojson: any): string {
  if (!geojson.features || geojson.features.length === 0) {
    return "Point";
  }
  
  const types = new Set<string>();
  for (const f of geojson.features) {
    if (f?.geometry?.type) types.add(f.geometry.type);
  }
  if (types.size === 1) return types.values().next().value;
  const firstType = geojson.features[0]?.geometry?.type;
  if (firstType?.includes("Polygon")) return firstType;
  if (firstType?.includes("Line")) return firstType;
  if (firstType?.includes("Point")) return firstType;
  return "Point";
}

function extractCRS(geojson: any): string {
  if (geojson.crs?.properties?.name) {
    const name = geojson.crs.properties.name;
    if (name.includes("4326")) return "EPSG:4326";
    if (name.includes("3857")) return "EPSG:3857";
    const match = name.match(/EPSG::?(\d+)/i);
    if (match) return `EPSG:${match[1]}`;
  }
  return "EPSG:4326";
}

function isZuluSphericalPrj(prj: string | null): boolean {
  if (!prj) return false;
  return prj.includes('Auxiliary_Sphere') || prj.includes('sradiusa=6378137');
}

function sphericalMercatorInverse(x: number, y: number): [number, number] {
  const R = 6378137;
  const lon = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

function transformCoordsInPlace(coordinates: any): void {
  if (!coordinates || !Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number') {
    const [lon, lat] = sphericalMercatorInverse(coordinates[0], coordinates[1]);
    coordinates[0] = lon;
    coordinates[1] = lat;
    return;
  }
  for (let i = 0; i < coordinates.length; i++) {
    transformCoordsInPlace(coordinates[i]);
  }
}

function applySphericalMercatorToCollection(collection: any): any {
  if (!collection || !collection.features) return collection;
  for (const feature of collection.features) {
    if (feature.geometry?.coordinates) {
      transformCoordsInPlace(feature.geometry.coordinates);
    }
  }
  return collection;
}

export interface NamedParseResult extends ParseResult {
  name: string;
}

export async function parseAllShapefilesFromZip(
  buffer: Buffer,
  options: { simplifyTolerance?: number } = {},
  onProgress?: (index: number, total: number, name: string) => void,
  onDataset?: (result: NamedParseResult) => Promise<void>
): Promise<NamedParseResult[]> {
  const { simplifyTolerance = 0 } = options;

  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
  if (!isZip) {
    const result = await parseShapefileBuffer(buffer, options);
    const named = { ...result, name: 'shapefile' };
    if (onDataset) { await onDataset(named); return []; }
    return [named];
  }

  const zip = await JSZip.loadAsync(buffer, {
    decodeFileName: (rawBytes: Uint8Array) => new TextDecoder('ibm866').decode(rawBytes)
  } as any);

  // Phase 1: scan ZIP entries — build an index of paths only (no content loaded)
  const setExtMap = new Map<string, Map<string, string>>();
  const setFileNames = new Map<string, string[]>();

  zip.forEach((zipPath: string, entry: any) => {
    if (entry.dir) return;
    const ext = zipPath.split('.').pop()?.toLowerCase() || '';
    if (!['shp', 'shx', 'dbf', 'prj', 'cpg'].includes(ext)) return;
    const pathWithoutExt = zipPath.substring(0, zipPath.lastIndexOf('.'));
    const fileName = zipPath.split('/').pop() || zipPath;
    if (!setExtMap.has(pathWithoutExt)) {
      setExtMap.set(pathWithoutExt, new Map());
      setFileNames.set(pathWithoutExt, []);
    }
    setExtMap.get(pathWithoutExt)!.set(ext, zipPath);
    setFileNames.get(pathWithoutExt)!.push(fileName);
  });

  const validKeys = Array.from(setExtMap.entries()).filter(([, m]) => m.has('shp'));
  if (validKeys.length === 0) throw new Error("No .shp file found in archive");

  // When onDataset callback provided: stream one dataset at a time — never accumulate all in memory
  const results: NamedParseResult[] = [];

  // Phase 2: process one shapefile set at a time — load, parse, then release buffers
  for (let i = 0; i < validKeys.length; i++) {
    const [pathWithoutExt, extMap] = validKeys[i];
    const name = pathWithoutExt.split('/').pop() || pathWithoutExt;
    const fileNames = setFileNames.get(pathWithoutExt) || [];

    if (onProgress) onProgress(i + 1, validKeys.length, name);

    try {
      let shpBuf: ArrayBuffer | null = null;
      let dbfBuf: ArrayBuffer | null = null;
      let prjText: string | null = null;
      let cpgText: string | null = null;

      const shpEntry = zip.file(extMap.get('shp')!);
      if (shpEntry) shpBuf = await shpEntry.async('arraybuffer');

      if (extMap.has('dbf')) {
        const e = zip.file(extMap.get('dbf')!);
        if (e) dbfBuf = await e.async('arraybuffer');
      }
      if (extMap.has('prj')) {
        const e = zip.file(extMap.get('prj')!);
        if (e) { const b = await e.async('nodebuffer'); prjText = decodeCP1251(b); }
      }
      if (extMap.has('cpg')) {
        const e = zip.file(extMap.get('cpg')!);
        if (e) { const b = await e.async('nodebuffer'); cpgText = decodeCP1251(b); }
      }

      if (!shpBuf) continue;

      const zuluPrj = isZuluSphericalPrj(prjText);
      const cpgEncoding = cpgText?.trim() || 'CP1251';
      const cpgBuf = new TextEncoder().encode(cpgEncoding);

      const shapefileObj: any = {
        shp: shpBuf,
        dbf: dbfBuf,
        prj: zuluPrj ? null : prjText,
        cpg: cpgBuf.buffer,
      };

      console.log(`[MultiParse ${i + 1}/${validKeys.length}] ${name} (${cpgEncoding}${zuluPrj ? ', ZuluGIS' : ''})`);

      let geojson: any = await shp(shapefileObj);

      // Release raw buffers immediately — GC can reclaim before features are built
      shpBuf = null;
      dbfBuf = null;

      if (zuluPrj) {
        const raw = Array.isArray(geojson) ? geojson[0] : geojson;
        geojson = applySphericalMercatorToCollection(raw);
      }

      const collection = Array.isArray(geojson) ? geojson[0] : geojson;
      if (!collection?.features) {
        console.warn(`[MultiParse] Skipping ${name}: no features`);
        continue;
      }

      const geometryType = detectGeometryType(collection);
      const crs = extractCRS(collection);

      const features: ParsedFeature[] = collection.features.map((feature: any) => {
        let coordinates = feature.geometry?.coordinates;
        if (simplifyTolerance > 0 && geometryType !== 'Point') {
          coordinates = simplifyCoordinates(coordinates, simplifyTolerance, false);
        }
        return {
          geometry: { type: feature.geometry?.type || geometryType, coordinates },
          properties: feature.properties || {},
        };
      });

      // Release the full GeoJSON collection — features array is all we need now
      (geojson as any) = null;

      const parsed: NamedParseResult = { features, geometryType, crs, fileList: fileNames, name };

      if (onDataset) {
        // Streaming mode: hand off to caller immediately, don't keep in memory
        await onDataset(parsed);
      } else {
        results.push(parsed);
      }
    } catch (err: any) {
      console.error(`[MultiParse] Error parsing ${name}:`, err.message);
    }
  }

  return results;
}

export async function parseShapefileBuffer(
  buffer: Buffer,
  options: { simplifyTolerance?: number } = {}
): Promise<ParseResult> {
  const { simplifyTolerance = 0 } = options;
  
  const bufferSizeMB = buffer.length / (1024 * 1024);
  console.log(`Parsing shapefile buffer: ${bufferSizeMB.toFixed(2)} MB`);
  
  if (bufferSizeMB > 500) {
    console.warn(`Large file detected (${bufferSizeMB.toFixed(0)} MB). Processing may take longer and use significant memory.`);
  }
  
  let geojson: any;
  const fileList: string[] = [];
  
  try {
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
    if (!isZip) {
      const cpgBuffer = Buffer.from('CP1251');
      const shapefileObj: any = {
        shp: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        cpg: cpgBuffer.buffer.slice(cpgBuffer.byteOffset, cpgBuffer.byteOffset + cpgBuffer.byteLength),
      };
      geojson = await shp(shapefileObj);
      
      const collection = Array.isArray(geojson) ? geojson[0] : geojson;
      if (!collection || !collection.features) {
        throw new Error("Invalid shapefile: no features found");
      }
      
      const geometryType = detectGeometryType(collection);
      const crs = extractCRS(collection);
      
      const features: ParsedFeature[] = collection.features.map((feature: any) => {
        let coordinates = feature.geometry?.coordinates;
        if (simplifyTolerance > 0 && geometryType !== "Point") {
          coordinates = simplifyCoordinates(coordinates, simplifyTolerance);
        }
        return {
          geometry: { type: feature.geometry?.type || geometryType, coordinates },
          properties: feature.properties || {},
        };
      });
      
      return { features, geometryType, crs, fileList: [] };
    }
    
    const zip = await JSZip.loadAsync(buffer, {
      decodeFileName: (rawBytes: Uint8Array) => {
        const decoder = new TextDecoder('ibm866');
        return decoder.decode(rawBytes);
      }
    } as any);
    
    const shapefileSets = new Map<string, {
      shp: ArrayBuffer | null;
      shx: ArrayBuffer | null;
      dbf: ArrayBuffer | null;
      prj: string | null;
      cpg: string | null;
      fileNames: string[];
    }>();
    
    const entries: { path: string; entry: any }[] = [];
    zip.forEach((path: string, entry: any) => {
      entries.push({ path, entry });
    });
    
    for (const { path, entry } of entries) {
      if (entry.dir) continue;
      
      const pathLower = path.toLowerCase();
      const ext = pathLower.split('.').pop() || '';
      
      if (!['shp', 'shx', 'dbf', 'prj', 'cpg'].includes(ext)) continue;
      
      const pathWithoutExt = path.substring(0, path.lastIndexOf('.'));
      const fileName = path.split('/').pop() || path;
      
      if (!shapefileSets.has(pathWithoutExt)) {
        shapefileSets.set(pathWithoutExt, {
          shp: null, shx: null, dbf: null, prj: null, cpg: null, fileNames: []
        });
      }
      
      const set = shapefileSets.get(pathWithoutExt)!;
      set.fileNames.push(fileName);
      
      if (ext === 'prj' || ext === 'cpg') {
        const content = await entry.async('nodebuffer');
        const text = decodeCP1251(content);
        if (ext === 'prj') set.prj = text;
        if (ext === 'cpg') set.cpg = text;
      } else {
        const content = await entry.async('arraybuffer');
        if (ext === 'shp') set.shp = content;
        if (ext === 'shx') set.shx = content;
        if (ext === 'dbf') set.dbf = content;
      }
    }
    
    const firstSet = Array.from(shapefileSets.values()).find(s => s.shp !== null);
    if (!firstSet || !firstSet.shp) {
      throw new Error("No .shp file found in archive");
    }
    
    fileList.push(...firstSet.fileNames);
    
    const zuluPrj = isZuluSphericalPrj(firstSet.prj);

    const shapefileObj: any = {
      shp: firstSet.shp,
      dbf: firstSet.dbf,
      prj: zuluPrj ? null : firstSet.prj,
    };
    
    const cpgEncoding = firstSet.cpg?.trim() || 'CP1251';
    const cpgBuffer = new TextEncoder().encode(cpgEncoding);
    shapefileObj.cpg = cpgBuffer.buffer;
    
    console.log(`Parsing shapefile with encoding: ${cpgEncoding}, files: ${firstSet.fileNames.join(', ')}${zuluPrj ? ', ZuluGIS spherical Mercator detected' : ''}`);
    
    geojson = await shp(shapefileObj);

    if (zuluPrj) {
      const raw = Array.isArray(geojson) ? geojson[0] : geojson;
      geojson = applySphericalMercatorToCollection(raw);
      console.log('Applied spherical Mercator → WGS84 transform for ZuluGIS file');
    }
  } catch (parseError: any) {
    console.error("shpjs parse error:", parseError);
    if (parseError.message?.includes("memory") || parseError.message?.includes("heap")) {
      throw new Error(`File too large to process. The uncompressed data exceeds memory limits. Try splitting the shapefile into smaller parts.`);
    }
    throw new Error(`Failed to parse shapefile: ${parseError.message || 'Unknown parsing error'}`);
  }
  
  const collection = Array.isArray(geojson) ? geojson[0] : geojson;
  
  if (!collection || !collection.features) {
    throw new Error("Invalid shapefile: no features found");
  }
  
  const geometryType = detectGeometryType(collection);
  const crs = extractCRS(collection);
  
  const features: ParsedFeature[] = collection.features.map((feature: any) => {
    let coordinates = feature.geometry?.coordinates;
    
    if (simplifyTolerance > 0 && geometryType !== "Point") {
      coordinates = simplifyCoordinates(coordinates, simplifyTolerance);
    }
    
    return {
      geometry: {
        type: feature.geometry?.type || geometryType,
        coordinates,
      },
      properties: feature.properties || {},
    };
  });
  
  return {
    features,
    geometryType,
    crs,
    fileList,
  };
}

export function simplifyFeatureGeometry(
  coordinates: any,
  geometryType: string,
  tolerance: number
): any {
  if (geometryType === "Point" || geometryType === "MultiPoint" || tolerance <= 0) {
    return coordinates;
  }

  if (!coordinates || !Array.isArray(coordinates)) return coordinates;

  const isRingType = geometryType === "Polygon" || geometryType === "MultiPolygon";

  switch (geometryType) {
    case "LineString":
      return simplifyCoordinates(coordinates, tolerance, false);
    case "MultiLineString":
      return coordinates.map((line: any) => simplifyCoordinates(line, tolerance, false));
    case "Polygon": {
      const rings = coordinates.map((ring: any) => simplifyCoordinates(ring, tolerance, true));
      const validRings = rings.filter((r: any) => Array.isArray(r) && r.length >= 4);
      return validRings.length > 0 ? validRings : rings;
    }
    case "MultiPolygon": {
      const polys = coordinates.map((polygon: any) => {
        if (!Array.isArray(polygon)) return polygon;
        const rings = polygon.map((ring: any) => simplifyCoordinates(ring, tolerance, true));
        const validRings = rings.filter((r: any) => Array.isArray(r) && r.length >= 4);
        return validRings.length > 0 ? validRings : rings;
      });
      return polys.filter((p: any) => Array.isArray(p) && p.length > 0);
    }
    case "GeometryCollection":
      return coordinates;
    default:
      return simplifyCoordinates(coordinates, tolerance, isRingType);
  }
}

export function getSimplifyTolerance(zoom: number): number {
  if (zoom >= 14) return 0;
  if (zoom >= 12) return 0.000005;
  if (zoom >= 10) return 0.00005;
  if (zoom >= 9) return 0.0003;
  if (zoom >= 8) return 0.001;
  if (zoom >= 7) return 0.003;
  if (zoom >= 6) return 0.006;
  if (zoom >= 5) return 0.015;
  if (zoom >= 4) return 0.03;
  return 0.06;
}

// Point sampling rate based on zoom level (GIS-style approach)
// Returns the sampling divisor: 1 = all points, 5 = every 5th point, etc.
export function getPointSamplingRate(zoom: number): number {
  if (zoom >= 12) return 1;      // All points visible
  if (zoom >= 10) return 5;      // Every 5th point (20%)
  if (zoom >= 8) return 20;      // Every 20th point (5%)
  if (zoom >= 6) return 50;      // Every 50th point (2%)
  return Infinity;               // No points at very low zoom
}

// Deterministic point sampling - ensures same points are shown at same zoom
export function samplePointFeatures<T extends { geometryType: string }>(
  features: T[],
  zoom: number
): { sampled: T[]; totalPoints: number; samplingRate: number } {
  const samplingRate = getPointSamplingRate(zoom);
  
  // Separate points from other geometry types
  const pointFeatures: T[] = [];
  const otherFeatures: T[] = [];
  
  for (const feature of features) {
    if (feature.geometryType === "Point" || feature.geometryType === "MultiPoint") {
      pointFeatures.push(feature);
    } else {
      otherFeatures.push(feature);
    }
  }
  
  // If no sampling needed or no points, return all
  if (samplingRate === 1 || pointFeatures.length === 0) {
    return {
      sampled: features,
      totalPoints: pointFeatures.length,
      samplingRate: 1,
    };
  }
  
  // If zoom too low, return only non-point features
  if (samplingRate === Infinity) {
    return {
      sampled: otherFeatures,
      totalPoints: pointFeatures.length,
      samplingRate: Infinity,
    };
  }
  
  // Sample points deterministically by index
  const sampledPoints = pointFeatures.filter((_, index) => index % samplingRate === 0);
  
  return {
    sampled: [...otherFeatures, ...sampledPoints],
    totalPoints: pointFeatures.length,
    samplingRate,
  };
}
