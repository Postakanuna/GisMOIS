import proj4 from 'proj4';

const CRS_DEFINITIONS: Record<string, string> = {
  'MSK50-1': '+proj=tmerc +lat_0=0 +lon_0=37.5 +k=1 +x_0=1250000 +y_0=-4511057.628 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs',
  'MSK50-2': '+proj=tmerc +lat_0=0 +lon_0=40.5 +k=1 +x_0=2250000 +y_0=-4511057.628 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs',
  'MSK50-3': '+proj=tmerc +lat_0=0 +lon_0=43.5 +k=1 +x_0=3250000 +y_0=-4511057.628 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs',
  'MSK50-4': '+proj=tmerc +lat_0=0 +lon_0=46.5 +k=1 +x_0=4250000 +y_0=-4511057.628 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs',
  'MSK50-5': '+proj=tmerc +lat_0=0 +lon_0=49.5 +k=1 +x_0=5250000 +y_0=-4511057.628 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs',
  'MSK50-6': '+proj=tmerc +lat_0=0 +lon_0=52.5 +k=1 +x_0=6250000 +y_0=-4511057.628 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs',
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
  'none': '',
};

export const CRS_OPTIONS = [
  { value: 'MSK50-1', label: 'МСК-50, зона 1 (EPSG:28467)' },
  { value: 'MSK50-2', label: 'МСК-50, зона 2 (EPSG:28468)' },
  { value: 'MSK50-3', label: 'МСК-50, зона 3 (EPSG:28469)' },
  { value: 'MSK50-4', label: 'МСК-50, зона 4 (EPSG:28470)' },
  { value: 'MSK50-5', label: 'МСК-50, зона 5 (EPSG:28471)' },
  { value: 'MSK50-6', label: 'МСК-50, зона 6 (EPSG:28472)' },
  { value: 'EPSG:4326', label: 'WGS 84 (EPSG:4326)' },
  { value: 'none', label: 'Без привязки (только просмотр)' },
];

export interface DxfLayerInfo {
  name: string;
  count: number;
  types: string[];
}

export interface DxfFeature {
  type: 'LineString' | 'Point';
  coordinates: number[][];
  layer: string;
  entityType: string;
}

export interface ParsedDxfResult {
  layers: DxfLayerInfo[];
  features: DxfFeature[];
  totalCount: number;
}

function transformCoord(x: number, y: number, crs: string): [number, number] {
  if (crs === 'EPSG:4326' || crs === 'none') return [x, y];
  const def = CRS_DEFINITIONS[crs];
  if (!def) return [x, y];
  try {
    const result = proj4(def, '+proj=longlat +datum=WGS84 +no_defs', [x, y]);
    return [result[0], result[1]];
  } catch {
    return [x, y];
  }
}

export async function parseDxfContent(content: string, crs: string): Promise<ParsedDxfResult> {
  const { default: DxfParser } = await import('dxf-parser');
  const parser = new DxfParser();

  let dxf: any;
  try {
    dxf = parser.parseSync(content);
  } catch (e) {
    throw new Error('Не удалось разобрать DXF файл. Убедитесь, что файл корректен и сохранён в формате DXF.');
  }

  if (!dxf) throw new Error('Пустой или повреждённый DXF файл');

  const layerMap = new Map<string, DxfLayerInfo>();
  const features: DxfFeature[] = [];

  if (dxf.tables?.layer?.layers) {
    for (const name of Object.keys(dxf.tables.layer.layers)) {
      layerMap.set(name, { name, count: 0, types: [] });
    }
  }

  const entities: any[] = dxf.entities || [];

  for (const entity of entities) {
    const layerName: string = entity.layer || '0';

    if (!layerMap.has(layerName)) {
      layerMap.set(layerName, { name: layerName, count: 0, types: [] });
    }

    const layerInfo = layerMap.get(layerName)!;
    let feature: DxfFeature | null = null;

    if (entity.type === 'LINE') {
      const start = transformCoord(
        entity.vertices?.[0]?.x ?? entity.start?.x ?? 0,
        entity.vertices?.[0]?.y ?? entity.start?.y ?? 0,
        crs
      );
      const end = transformCoord(
        entity.vertices?.[1]?.x ?? entity.end?.x ?? 0,
        entity.vertices?.[1]?.y ?? entity.end?.y ?? 0,
        crs
      );
      feature = {
        type: 'LineString',
        coordinates: [start, end],
        layer: layerName,
        entityType: 'LINE',
      };
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const verts: any[] = entity.vertices || [];
      if (verts.length >= 2) {
        const coords = verts.map((v: any) => transformCoord(v.x ?? 0, v.y ?? 0, crs));
        feature = {
          type: 'LineString',
          coordinates: coords,
          layer: layerName,
          entityType: entity.type,
        };
      }
    } else if (entity.type === 'SPLINE') {
      const pts: any[] = entity.controlPoints || entity.fitPoints || [];
      if (pts.length >= 2) {
        const coords = pts.map((p: any) => transformCoord(p.x ?? 0, p.y ?? 0, crs));
        feature = {
          type: 'LineString',
          coordinates: coords,
          layer: layerName,
          entityType: 'SPLINE',
        };
      }
    } else if (entity.type === 'POINT') {
      const pt = transformCoord(entity.position?.x ?? 0, entity.position?.y ?? 0, crs);
      feature = {
        type: 'Point',
        coordinates: [pt],
        layer: layerName,
        entityType: 'POINT',
      };
    }

    if (feature) {
      features.push(feature);
      layerInfo.count++;
      if (!layerInfo.types.includes(entity.type)) {
        layerInfo.types.push(entity.type);
      }
    }
  }

  const resultLayers = Array.from(layerMap.values()).filter(l => l.count > 0);

  return {
    layers: resultLayers,
    features,
    totalCount: features.length,
  };
}

export function filterFeaturesByLayers(features: DxfFeature[], selectedLayers: string[]): DxfFeature[] {
  if (selectedLayers.length === 0) return features;
  return features.filter(f => selectedLayers.includes(f.layer));
}

export function getEntityTypeIcon(types: string[]): string {
  if (types.includes('POINT')) return '●';
  if (types.some(t => ['LINE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'].includes(t))) return '〰';
  return '□';
}
