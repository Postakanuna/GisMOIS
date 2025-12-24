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

proj4.defs('EPSG:28406', '+proj=tmerc +lat_0=0 +lon_0=33 +k=1 +x_0=6500000 +y_0=0 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');
proj4.defs('EPSG:28407', '+proj=tmerc +lat_0=0 +lon_0=39 +k=1 +x_0=7500000 +y_0=0 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');
proj4.defs('EPSG:28408', '+proj=tmerc +lat_0=0 +lon_0=45 +k=1 +x_0=8500000 +y_0=0 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');

proj4.defs('Pulkovo_1942_GK_Zone_6', proj4.defs('EPSG:28406'));
proj4.defs('Pulkovo_1942_GK_Zone_7', proj4.defs('EPSG:28407'));
proj4.defs('Pulkovo_1942_GK_Zone_8', proj4.defs('EPSG:28408'));

proj4.defs('MSK_50_Zone_1', '+proj=tmerc +lat_0=0 +lon_0=38.48333333333333 +k=1 +x_0=1300000 +y_0=-4511057.628 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');
proj4.defs('MSK_50_Zone_2', '+proj=tmerc +lat_0=0 +lon_0=41.48333333333333 +k=1 +x_0=2300000 +y_0=-4511057.628 +ellps=krass +towgs84=23.57,-140.95,-79.8,0,-0.35,-0.79,-0.22 +units=m +no_defs');

function detectProjection(prjContent: string): string | null {
  const prjLower = prjContent.toLowerCase();
  
  if (prjLower.includes('wgs') && prjLower.includes('84')) {
    return 'EPSG:4326';
  }
  
  const epsgMatch = prjContent.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/i);
  if (epsgMatch) {
    const code = epsgMatch[1];
    if (['28406', '28407', '28408'].includes(code)) {
      return `EPSG:${code}`;
    }
  }
  
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
