import proj4 from 'proj4';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';

interface ParsedShapefile {
  name: string;
  geojson: FeatureCollection;
  sourceCrs: string | null;
  reprojectionFailed?: boolean;
  sourceFiles?: string[]; // list of files found in the shapefile set (e.g., ["layer.shp", "layer.dbf", "layer.prj"])
}

interface ShapefileSet {
  baseName: string;
  shp: ArrayBuffer | null;
  shx: ArrayBuffer | null;
  dbf: ArrayBuffer | null;
  prj: string | null;
  cpg: string | null;
  fileNames: string[]; // list of actual file names found (e.g., ["roads.shp", "roads.dbf"])
}

const CP1251_DECODER = new TextDecoder('windows-1251');
const CP866_DECODER = new TextDecoder('ibm866');

function decodeCP1251(buffer: ArrayBuffer): string {
  return CP1251_DECODER.decode(buffer);
}

function decodeCP866(buffer: ArrayBuffer): string {
  return CP866_DECODER.decode(buffer);
}

// WGS84 ellipsoid parameters
const WGS84_A = 6378137.0; // semi-major axis (meters)
const WGS84_F = 1 / 298.257223563; // flattening
const WGS84_E = Math.sqrt(2 * WGS84_F - WGS84_F * WGS84_F); // eccentricity = 0.0818191908426

/**
 * Correct latitude from ZULU's spherical Mercator to WGS84 ellipsoidal coordinates.
 * 
 * ZULU uses a perfect sphere (R=6378137m) for Mercator projection,
 * then exports coordinates as degrees using spherical formulas.
 * OpenLayers/OSM uses WGS84 ellipsoid for EPSG:4326.
 * 
 * This function converts "spherical degrees" to "ellipsoidal degrees".
 * 
 * Math:
 * 1. Calculate y in spherical Mercator meters: y = R * ln(tan(π/4 + φ_sphere/2))
 * 2. Solve for φ_ellipse using iterative inverse Mercator with ellipsoid
 */
function correctSphericalLatitude(latDeg: number): number {
  const R = WGS84_A; // sphere radius used by ZULU
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  
  // Convert spherical latitude to radians
  const latRad = latDeg * DEG2RAD;
  
  // Calculate y in spherical Mercator (meters)
  // y = R * ln(tan(π/4 + φ/2))
  const y = R * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  
  // Now inverse: find ellipsoidal latitude from y
  // This requires iteration because the ellipsoidal formula is implicit
  // φ = 2 * atan(exp(y/R) * ((1-e*sin(φ))/(1+e*sin(φ)))^(e/2)) - π/2
  
  // Initial guess from spherical formula
  let phi = 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2;
  
  // Iterative refinement (typically converges in 3-4 iterations)
  for (let i = 0; i < 10; i++) {
    const sinPhi = Math.sin(phi);
    const eSinPhi = WGS84_E * sinPhi;
    const conformalFactor = Math.pow((1 - eSinPhi) / (1 + eSinPhi), WGS84_E / 2);
    const phiNew = 2 * Math.atan(Math.exp(y / R) * conformalFactor) - Math.PI / 2;
    
    if (Math.abs(phiNew - phi) < 1e-12) break;
    phi = phiNew;
  }
  
  return phi * RAD2DEG;
}

/**
 * Apply spherical-to-ellipsoidal latitude correction to a coordinate pair.
 * Only corrects latitude (Y); longitude (X) is unchanged.
 */
function correctZuluCoordinates(coords: Position): Position {
  const correctedLat = correctSphericalLatitude(coords[1]);
  return coords.length > 2 
    ? [coords[0], correctedLat, coords[2]] 
    : [coords[0], correctedLat];
}

/**
 * Get the first coordinate from any geometry type (for debugging/logging)
 */
function getFirstCoordinate(geometry: Geometry | null | undefined): Position | null {
  if (!geometry) return null;
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates[0] || null;
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates[0]?.[0] || null;
    case 'MultiPolygon':
      return geometry.coordinates[0]?.[0]?.[0] || null;
    case 'GeometryCollection':
      return geometry.geometries[0] ? getFirstCoordinate(geometry.geometries[0]) : null;
    default:
      return null;
  }
}

/**
 * Recursively correct all coordinates in a geometry
 */
function correctGeometryCoordinates(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Point':
      return {
        type: 'Point',
        coordinates: correctZuluCoordinates(geometry.coordinates)
      };
    case 'MultiPoint':
      return {
        type: 'MultiPoint',
        coordinates: geometry.coordinates.map(c => correctZuluCoordinates(c))
      };
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: geometry.coordinates.map(c => correctZuluCoordinates(c))
      };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map(line => 
          line.map(c => correctZuluCoordinates(c))
        )
      };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(ring => 
          ring.map(c => correctZuluCoordinates(c))
        )
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon => 
          polygon.map(ring => ring.map(c => correctZuluCoordinates(c)))
        )
      };
    case 'GeometryCollection':
      return {
        type: 'GeometryCollection',
        geometries: geometry.geometries.map(g => correctGeometryCoordinates(g))
      };
    default:
      return geometry;
  }
}

function transformCoordinates(coords: Position, transform: proj4.Converter): Position {
  const [x, y] = transform.forward([coords[0], coords[1]]);
  return coords.length > 2 ? [x, y, coords[2]] : [x, y];
}

function transformGeometry(geometry: Geometry, transform: proj4.Converter): Geometry {
  switch (geometry.type) {
    case 'Point':
      return {
        type: 'Point',
        coordinates: transformCoordinates(geometry.coordinates, transform)
      };
    case 'MultiPoint':
      return {
        type: 'MultiPoint',
        coordinates: geometry.coordinates.map(c => transformCoordinates(c, transform))
      };
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: geometry.coordinates.map(c => transformCoordinates(c, transform))
      };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map(line => 
          line.map(c => transformCoordinates(c, transform))
        )
      };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(ring => 
          ring.map(c => transformCoordinates(c, transform))
        )
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon => 
          polygon.map(ring => ring.map(c => transformCoordinates(c, transform)))
        )
      };
    case 'GeometryCollection':
      return {
        type: 'GeometryCollection',
        geometries: geometry.geometries.map(g => transformGeometry(g, transform))
      };
    default:
      return geometry;
  }
}

proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Web Mercator (Google Maps, OSM tile projection) - coordinates in meters
proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs');
proj4.defs('EPSG:102100', proj4.defs('EPSG:3857')); // Esri alias for Web Mercator

// Pulkovo 1942 Gauss-Kruger zones
proj4.defs('EPSG:28406', '+proj=tmerc +lat_0=0 +lon_0=33 +k=1 +x_0=6500000 +y_0=0 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');
proj4.defs('EPSG:28407', '+proj=tmerc +lat_0=0 +lon_0=39 +k=1 +x_0=7500000 +y_0=0 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');
proj4.defs('EPSG:28408', '+proj=tmerc +lat_0=0 +lon_0=45 +k=1 +x_0=8500000 +y_0=0 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');

proj4.defs('Pulkovo_1942_GK_Zone_6', proj4.defs('EPSG:28406'));
proj4.defs('Pulkovo_1942_GK_Zone_7', proj4.defs('EPSG:28407'));
proj4.defs('Pulkovo_1942_GK_Zone_8', proj4.defs('EPSG:28408'));

// Moscow Oblast local CRS
proj4.defs('MSK_50_Zone_1', '+proj=tmerc +lat_0=0 +lon_0=38.48333333333333 +k=1 +x_0=1300000 +y_0=-4511057.628 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');
proj4.defs('MSK_50_Zone_2', '+proj=tmerc +lat_0=0 +lon_0=41.48333333333333 +k=1 +x_0=2300000 +y_0=-4511057.628 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');

function detectProjection(prjContent: string): string | null {
  const prjLower = prjContent.toLowerCase();
  
  
  // CRITICAL: Check if the UNIT is Degree - if so, coordinates are already in lat/lon
  // This handles ZULU exports that use PROJCS with Mercator but store coords in degrees
  // Look for UNIT["Degree" in PROJCS context (not in GEOGCS which always has degrees)
  const projcsMatch = prjContent.match(/PROJCS\[[\s\S]*$/i);
  if (projcsMatch) {
    // Check the UNIT after PROJECTION (the linear/coordinate unit, not the angular unit in GEOGCS)
    // In WKT, the UNIT after PROJECTION applies to coordinates
    const afterProjection = prjContent.match(/PROJECTION\[[\s\S]*/i);
    if (afterProjection) {
      const unitMatch = afterProjection[0].match(/UNIT\s*\[\s*"([^"]+)"/i);
      if (unitMatch) {
        const unit = unitMatch[1].toLowerCase();
        if (unit === 'degree' || unit === 'degrees') {
          return 'EPSG:4326';
        }
      }
    }
  }
  
  // Check for Web Mercator with METER units
  // Web Mercator identifiers: Pseudo_Mercator, Web_Mercator, Auxiliary_Sphere, EPSG:3857, EPSG:102100
  if (prjLower.includes('pseudo_mercator') || 
      prjLower.includes('web_mercator') ||
      prjLower.includes('popular visualisation')) {
    return 'EPSG:3857';
  }
  
  // Check for EPSG codes - find ALL AUTHORITY blocks
  const epsgRegex = /AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi;
  const epsgCodes: string[] = [];
  let epsgMatch;
  while ((epsgMatch = epsgRegex.exec(prjContent)) !== null) {
    epsgCodes.push(epsgMatch[1]);
  }
  
  // Check for Web Mercator EPSG codes
  if (epsgCodes.includes('3857') || epsgCodes.includes('102100') || epsgCodes.includes('900913')) {
    return 'EPSG:3857';
  }
  
  // Check for Pulkovo codes
  for (const code of epsgCodes) {
    if (['28406', '28407', '28408'].includes(code)) {
      return `EPSG:${code}`;
    }
  }
  
  // If it's a projected CRS with Mercator projection and METER units
  if (prjLower.includes('projcs') && prjLower.includes('mercator') && prjLower.includes('meter')) {
    return 'EPSG:3857';
  }
  
  // Only now check for pure WGS84 (geographic, not projected)
  // WGS84 geographic should have GEOGCS but NOT PROJCS
  if (!prjLower.includes('projcs') && prjLower.includes('wgs') && prjLower.includes('84')) {
    return 'EPSG:4326';
  }
  
  // Pulkovo 1942 detection
  if (prjLower.includes('pulkovo') || prjLower.includes('krassowsky') || prjLower.includes('krass')) {
    const zoneMatch = prjContent.match(/zone[_\s]*(\d+)/i);
    if (zoneMatch) {
      const zone = parseInt(zoneMatch[1]);
      if (zone >= 6 && zone <= 8) {
        return `EPSG:2840${zone}`;
      }
    }
    
    const cmMatch = prjContent.match(/central_meridian["\s,]+(\d+)/i);
    if (cmMatch) {
      const cm = parseInt(cmMatch[1]);
      if (cm === 33) return 'EPSG:28406';
      if (cm === 39) return 'EPSG:28407';
      if (cm === 45) return 'EPSG:28408';
    }
  }
  
  // MSK-50 (Moscow Oblast) detection
  if (prjLower.includes('msk') || prjLower.includes('moskovsk') || prjLower.includes('moscow_oblast')) {
    const cmMatch = prjContent.match(/central_meridian["\s,]+(\d+\.?\d*)/i);
    if (cmMatch) {
      const cm = parseFloat(cmMatch[1]);
      if (cm >= 37 && cm < 40) return 'MSK_50_Zone_1';
      if (cm >= 40 && cm < 43) return 'MSK_50_Zone_2';
    }
    return 'MSK_50_Zone_1';
  }
  
  return null;
}

interface TransformResult {
  featureCollection: FeatureCollection;
  failed: boolean;
}

// Analyze actual coordinate values to determine if they're degrees or meters
function analyzeCoordinates(fc: FeatureCollection): 'degrees' | 'meters' | 'unknown' {
  // Sample first few features to analyze coordinate ranges
  const sampleCoords: number[][] = [];
  
  for (let i = 0; i < Math.min(fc.features?.length || 0, 10); i++) {
    const feature = fc.features[i];
    if (!feature?.geometry) continue;
    
    const coord = getFirstCoordinate(feature.geometry);
    if (coord) {
      sampleCoords.push(coord);
    }
  }
  
  if (sampleCoords.length === 0) return 'unknown';
  
  // Calculate coordinate ranges
  const xValues = sampleCoords.map(c => Math.abs(c[0]));
  const yValues = sampleCoords.map(c => Math.abs(c[1]));
  const avgX = xValues.reduce((a, b) => a + b, 0) / xValues.length;
  const avgY = yValues.reduce((a, b) => a + b, 0) / yValues.length;
  
  
  // Degrees: typically -180 to 180 for lon, -90 to 90 for lat
  // For Russia/Moscow region: lon ~30-45, lat ~50-60
  // Web Mercator meters: X ~2,000,000 to 20,000,000, Y ~2,000,000 to 20,000,000
  
  // If both X and Y are less than 200, they're almost certainly degrees
  if (avgX < 200 && avgY < 200) {
    return 'degrees';
  }
  
  // If values are in millions, they're meters
  if (avgX > 100000 || avgY > 100000) {
    return 'meters';
  }
  
  return 'unknown';
}

function transformFeatureCollection(fc: FeatureCollection, prjContent: string | null): TransformResult {
  // FIRST: Analyze actual coordinate values - this is the most reliable method
  const coordType = analyzeCoordinates(fc);
  
  if (coordType === 'degrees') {
    
    // Check if this is a ZULU export with spherical Mercator
    // ZULU uses a perfect sphere (sradiusa=sradiusb=6378137) for its Mercator projection
    // When exporting to degrees, it uses spherical formulas which produce incorrect
    // latitude values when rendered on an ellipsoidal basemap (OpenStreetMap)
    //
    // IMPORTANT: Only apply correction for confirmed ZULU spherical exports.
    // Generic "Mercator" in .prj does NOT mean spherical distortion — many tools
    // (QGIS, ArcGIS) export proper WGS84 degrees with Mercator in their .prj metadata.
    // Applying correction to non-ZULU data introduces a ~20-50m latitude shift.
    const isZuluSpherical = prjContent && (
      prjContent.includes('Auxiliary_Sphere') ||
      prjContent.includes('sradiusa=6378137') ||
      (prjContent.includes('SPHEROID["WGS_84"') && prjContent.includes('sradiusb=6378137'))
    );
    
    if (isZuluSpherical) {
      
      // Apply spherical-to-ellipsoidal latitude correction
      const correctedFeatures: Feature[] = fc.features.map(feature => ({
        ...feature,
        geometry: feature.geometry ? correctGeometryCoordinates(feature.geometry) : feature.geometry
      }));
      
      // Log sample correction for debugging
      if (fc.features.length > 0 && fc.features[0].geometry) {
        const origCoord = getFirstCoordinate(fc.features[0].geometry);
        const corrCoord = getFirstCoordinate(correctedFeatures[0].geometry!);
        if (origCoord && corrCoord) {
          const latDiff = (origCoord[1] - corrCoord[1]) * 111; // km
        }
      }
      
      return { 
        featureCollection: {
          type: 'FeatureCollection',
          features: correctedFeatures
        }, 
        failed: false 
      };
    }
    
    return { featureCollection: fc, failed: false };
  }
  
  if (!prjContent) {
    return { featureCollection: fc, failed: false };
  }

  // Only transform if coordinates appear to be in meters
  if (coordType === 'meters') {
    try {
      
      const knownProj = detectProjection(prjContent);
      let sourceProj: string;
      
      if (knownProj) {
        sourceProj = knownProj;
      } else {
        sourceProj = prjContent;
      }
      
      if (sourceProj === 'EPSG:4326') {
        return { featureCollection: fc, failed: false };
      }
      
      const transform = proj4(sourceProj, 'EPSG:4326');
      
      const transformedFeatures: Feature[] = fc.features.map(feature => ({
        ...feature,
        geometry: feature.geometry ? transformGeometry(feature.geometry, transform) : feature.geometry
      }));

      
      return {
        featureCollection: {
          type: 'FeatureCollection',
          features: transformedFeatures
        },
        failed: false
      };
    } catch (error: any) {
      console.error('Coordinate reprojection FAILED:', error?.message || error);
      console.warn('Layer coordinates may be incorrect - could not transform from source CRS to WGS84');
      return { featureCollection: fc, failed: true };
    }
  }
  
  // Unknown coordinate type - don't transform
  return { featureCollection: fc, failed: false };
}

function decodeZipFilename(rawBytes: Uint8Array | string[] | ArrayBuffer): string {
  if (rawBytes instanceof Uint8Array) {
    return CP866_DECODER.decode(rawBytes);
  }
  if (rawBytes instanceof ArrayBuffer) {
    return CP866_DECODER.decode(new Uint8Array(rawBytes));
  }
  if (Array.isArray(rawBytes)) {
    return rawBytes.join('');
  }
  return String(rawBytes);
}

export async function parseShapefileZip(arrayBuffer: ArrayBuffer): Promise<ParsedShapefile[]> {
  const JSZip = (await import('jszip')).default;
  const shpjs = await import('shpjs');
  
  const zip = await JSZip.loadAsync(arrayBuffer, {
    decodeFileName: decodeZipFilename as any
  });
  
  const shapefileSets = new Map<string, ShapefileSet>();
  
  const entries: { path: string; entry: any }[] = [];
  zip.forEach((path, entry) => {
    entries.push({ path, entry });
  });
  
  
  for (const { path, entry } of entries) {
    if (entry.dir) continue;
    
    const pathLower = path.toLowerCase();
    const ext = pathLower.split('.').pop() || '';
    
    if (!['shp', 'shx', 'dbf', 'prj', 'cpg'].includes(ext)) continue;
    
    const pathWithoutExt = path.substring(0, path.lastIndexOf('.'));
    const baseName = pathWithoutExt.split('/').pop() || pathWithoutExt;
    
    if (!shapefileSets.has(pathWithoutExt)) {
      shapefileSets.set(pathWithoutExt, {
        baseName: baseName,
        shp: null,
        shx: null,
        dbf: null,
        prj: null,
        cpg: null,
        fileNames: []
      });
    }
    
    const set = shapefileSets.get(pathWithoutExt)!;
    const fileName = path.split('/').pop() || path;
    set.fileNames.push(fileName);
    
    if (ext === 'prj' || ext === 'cpg') {
      const content = await entry.async('arraybuffer');
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
  
  const results: ParsedShapefile[] = [];
  
  for (const [path, set] of Array.from(shapefileSets.entries())) {
    if (!set.shp) {
      console.warn(`Skipping ${path}: no .shp file`);
      continue;
    }
    
    
    try {
      const shapefileObj: any = {
        shp: set.shp,
        dbf: set.dbf,
        prj: set.prj
      };
      
      if (set.cpg) {
        const cpgBuffer = new TextEncoder().encode(set.cpg);
        shapefileObj.cpg = cpgBuffer.buffer;
      } else {
        const cpgBuffer = new TextEncoder().encode('CP1251');
        shapefileObj.cpg = cpgBuffer.buffer;
      }
      
      const rawGeojson = await shpjs.default(shapefileObj) as FeatureCollection;
      
      
      if (rawGeojson.features?.length > 0) {
        const firstCoord = getFirstCoordinate(rawGeojson.features[0].geometry);
      }
      
      const transformResult = transformFeatureCollection(rawGeojson, set.prj);
      
      if (transformResult.featureCollection.features?.length > 0) {
        const firstCoord = getFirstCoordinate(transformResult.featureCollection.features[0].geometry);
      }
      
      results.push({
        name: set.baseName,
        geojson: transformResult.featureCollection,
        sourceCrs: set.prj,
        reprojectionFailed: transformResult.failed,
        sourceFiles: set.fileNames
      });
      
    } catch (error) {
      console.error(`Failed to parse shapefile ${set.baseName}:`, error);
    }
  }
  
  return results;
}

export async function parseShapefileWithEncoding(arrayBuffer: ArrayBuffer, fileName: string): Promise<ParsedShapefile[]> {
  if (fileName.toLowerCase().endsWith('.zip')) {
    return parseShapefileZip(arrayBuffer);
  }
  
  const shpjs = await import('shpjs');
  
  const cpgBuffer = new TextEncoder().encode('CP1251');
  const shapefileObj: any = {
    shp: arrayBuffer,
    cpg: cpgBuffer.buffer,
  };
  
  try {
    const geojson = await shpjs.default(shapefileObj) as FeatureCollection | FeatureCollection[];
    
    if (Array.isArray(geojson)) {
      return geojson.map((fc, i) => ({
        name: (fc as any).fileName || `Layer ${i + 1}`,
        geojson: fc,
        sourceCrs: null
      }));
    }
    
    return [{
      name: fileName.replace(/\.(zip|shp)$/i, ''),
      geojson: geojson,
      sourceCrs: null
    }];
  } catch (err) {
    console.warn('Failed to parse .shp with CP1251 encoding, falling back to default:', err);
    const geojson = await shpjs.default(arrayBuffer) as FeatureCollection | FeatureCollection[];
    
    if (Array.isArray(geojson)) {
      return geojson.map((fc, i) => ({
        name: (fc as any).fileName || `Layer ${i + 1}`,
        geojson: fc,
        sourceCrs: null
      }));
    }
    
    return [{
      name: fileName.replace(/\.(zip|shp)$/i, ''),
      geojson: geojson,
      sourceCrs: null
    }];
  }
}
