import shp from "shpjs";
import simplify from "simplify-js";

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
  if (!coordinates || tolerance <= 0) return coordinates;

  if (typeof coordinates[0] === 'number') {
    return coordinates;
  }

  if (typeof coordinates[0][0] === 'number') {
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
  
  const firstType = geojson.features[0]?.geometry?.type;
  if (firstType?.includes("Polygon")) return "Polygon";
  if (firstType?.includes("Line")) return "LineString";
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

export async function parseShapefileBuffer(
  buffer: Buffer,
  options: { simplifyTolerance?: number } = {}
): Promise<ParseResult> {
  const { simplifyTolerance = 0 } = options;
  
  const geojson = await shp(buffer);
  
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
    fileList: [],
  };
}

export function simplifyFeatureGeometry(
  coordinates: any,
  geometryType: string,
  tolerance: number
): any {
  if (geometryType === "Point" || tolerance <= 0) {
    return coordinates;
  }
  return simplifyCoordinates(coordinates, tolerance);
}

export function getSimplifyTolerance(zoom: number): number {
  if (zoom >= 15) return 0;
  if (zoom >= 12) return 0.00001;
  if (zoom >= 10) return 0.0001;
  if (zoom >= 8) return 0.0005;
  if (zoom >= 6) return 0.001;
  if (zoom >= 4) return 0.005;
  return 0.01;
}
