import proj4 from 'proj4';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';

interface ParsedShapefile {
  name: string;
  geojson: FeatureCollection;
  sourceCrs: string | null;
  reprojectionFailed?: boolean;
}

interface ShapefileSet {
  baseName: string;
  shp: ArrayBuffer | null;
  shx: ArrayBuffer | null;
  dbf: ArrayBuffer | null;
  prj: string | null;
  cpg: string | null;
}

const CP1251_DECODER = new TextDecoder('windows-1251');

function decodeCP1251(buffer: ArrayBuffer): string {
  return CP1251_DECODER.decode(buffer);
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
  
  console.log('PRJ content sample:', prjContent.substring(0, 200));
  
  // Check for Web Mercator FIRST (before WGS84, because Web Mercator includes WGS84 as datum)
  // Web Mercator identifiers: Pseudo_Mercator, Web_Mercator, Auxiliary_Sphere, EPSG:3857, EPSG:102100
  if (prjLower.includes('pseudo_mercator') || 
      prjLower.includes('web_mercator') || 
      prjLower.includes('auxiliary_sphere') ||
      prjLower.includes('mercator_auxiliary') ||
      prjLower.includes('popular visualisation')) {
    console.log('Detected Web Mercator from projection name');
    return 'EPSG:3857';
  }
  
  // Check for EPSG codes - find ALL AUTHORITY blocks
  const epsgRegex = /AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi;
  const epsgCodes: string[] = [];
  let epsgMatch;
  while ((epsgMatch = epsgRegex.exec(prjContent)) !== null) {
    epsgCodes.push(epsgMatch[1]);
  }
  console.log('Found EPSG codes:', epsgCodes);
  
  // Check for Web Mercator EPSG codes
  if (epsgCodes.includes('3857') || epsgCodes.includes('102100') || epsgCodes.includes('900913')) {
    console.log('Detected Web Mercator from EPSG code');
    return 'EPSG:3857';
  }
  
  // Check for Pulkovo codes
  for (const code of epsgCodes) {
    if (['28406', '28407', '28408'].includes(code)) {
      console.log(`Detected Pulkovo from EPSG:${code}`);
      return `EPSG:${code}`;
    }
  }
  
  // If it's a projected CRS with Mercator projection (not just lon/lat WGS84)
  if (prjLower.includes('projcs') && prjLower.includes('mercator')) {
    console.log('Detected Mercator projection in PROJCS');
    return 'EPSG:3857';
  }
  
  // Only now check for pure WGS84 (geographic, not projected)
  // WGS84 geographic should have GEOGCS but NOT PROJCS
  if (!prjLower.includes('projcs') && prjLower.includes('wgs') && prjLower.includes('84')) {
    console.log('Detected WGS84 geographic (no PROJCS)');
    return 'EPSG:4326';
  }
  
  // Pulkovo 1942 detection
  if (prjLower.includes('pulkovo') || prjLower.includes('krassowsky') || prjLower.includes('krass')) {
    const zoneMatch = prjContent.match(/zone[_\s]*(\d+)/i);
    if (zoneMatch) {
      const zone = parseInt(zoneMatch[1]);
      if (zone >= 6 && zone <= 8) {
        console.log(`Detected Pulkovo zone ${zone}`);
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
  
  console.log('Could not detect projection, will attempt WKT parsing');
  return null;
}

interface TransformResult {
  featureCollection: FeatureCollection;
  failed: boolean;
}

function transformFeatureCollection(fc: FeatureCollection, prjContent: string | null): TransformResult {
  if (!prjContent) {
    console.log('No .prj file found, assuming WGS84');
    return { featureCollection: fc, failed: false };
  }

  try {
    console.log('PRJ content:', prjContent.substring(0, 300));
    
    const knownProj = detectProjection(prjContent);
    let sourceProj: string;
    
    if (knownProj) {
      console.log('Detected known projection:', knownProj);
      sourceProj = knownProj;
    } else {
      console.log('No known projection detected, trying to parse WKT directly');
      sourceProj = prjContent;
    }
    
    if (sourceProj === 'EPSG:4326') {
      console.log('Already WGS84, no transformation needed');
      return { featureCollection: fc, failed: false };
    }
    
    const transform = proj4(sourceProj, 'EPSG:4326');
    
    const transformedFeatures: Feature[] = fc.features.map(feature => ({
      ...feature,
      geometry: feature.geometry ? transformGeometry(feature.geometry, transform) : feature.geometry
    }));

    console.log('Coordinate transformation successful');
    
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

function decodeCP1251Filename(rawBytes: Uint8Array | string[] | ArrayBuffer): string {
  if (rawBytes instanceof Uint8Array) {
    return CP1251_DECODER.decode(rawBytes);
  }
  if (rawBytes instanceof ArrayBuffer) {
    return CP1251_DECODER.decode(new Uint8Array(rawBytes));
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
    decodeFileName: decodeCP1251Filename as any
  });
  
  const shapefileSets = new Map<string, ShapefileSet>();
  
  const entries: { path: string; entry: any }[] = [];
  zip.forEach((path, entry) => {
    entries.push({ path, entry });
  });
  
  console.log('=== PARSING ZIP WITH CP1251 SUPPORT ===');
  console.log('Found', entries.length, 'entries in ZIP');
  
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
        cpg: null
      });
    }
    
    const set = shapefileSets.get(pathWithoutExt)!;
    
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
    
    console.log(`Processing shapefile: ${set.baseName}`);
    console.log(`  - PRJ: ${set.prj ? 'found' : 'missing'}`);
    console.log(`  - CPG: ${set.cpg || 'missing (defaulting to CP1251)'}`);
    
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
      
      console.log(`  - Features: ${rawGeojson.features?.length || 0}`);
      
      if (rawGeojson.features?.length > 0) {
        const firstCoord = getFirstCoordinate(rawGeojson.features[0].geometry);
        console.log(`  - Sample coord before transform: [${firstCoord?.join(', ')}]`);
      }
      
      const transformResult = transformFeatureCollection(rawGeojson, set.prj);
      
      if (transformResult.featureCollection.features?.length > 0) {
        const firstCoord = getFirstCoordinate(transformResult.featureCollection.features[0].geometry);
        console.log(`  - Sample coord after transform: [${firstCoord?.join(', ')}]`);
      }
      
      results.push({
        name: set.baseName,
        geojson: transformResult.featureCollection,
        sourceCrs: set.prj,
        reprojectionFailed: transformResult.failed
      });
      
    } catch (error) {
      console.error(`Failed to parse shapefile ${set.baseName}:`, error);
    }
  }
  
  return results;
}

function getFirstCoordinate(geometry: Geometry | null): Position | null {
  if (!geometry) return null;
  
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates[0];
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates[0]?.[0];
    case 'MultiPolygon':
      return geometry.coordinates[0]?.[0]?.[0];
    default:
      return null;
  }
}

export async function parseShapefileWithEncoding(arrayBuffer: ArrayBuffer, fileName: string): Promise<ParsedShapefile[]> {
  if (fileName.toLowerCase().endsWith('.zip')) {
    return parseShapefileZip(arrayBuffer);
  }
  
  const shpjs = await import('shpjs');
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
