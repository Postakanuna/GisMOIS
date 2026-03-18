import proj4 from 'proj4';

// МСК-50 (Московская система координат): Кrassovsky эллипсоид, TM-проекция,
// центральные меридианы через 3°, x_0 = зона*1000000+250000, y_0 подобрано
// под фактические координаты Московского региона (ш.≈55.5–56.5°).
// Ключевое: y_0 ≈ -5 709 869 м (начало отсчёта широт ~51.5°с.ш.)
const Y0_MSK50 = -5709869;
const TOWGS84_KRASS = '+towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12';
const ELLPS_KRASS = '+ellps=krass';
const msk50 = (zone: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${34.5 + zone * 3} +k=1 +x_0=${zone * 1000000 + 250000} +y_0=${Y0_MSK50} ${ELLPS_KRASS} ${TOWGS84_KRASS} +units=m +no_defs`;

const CRS_DEFINITIONS: Record<string, string> = {
  'MSK50-1': msk50(1),
  'MSK50-2': msk50(2),
  'MSK50-3': msk50(3),
  'MSK50-4': msk50(4),
  'MSK50-5': msk50(5),
  'MSK50-6': msk50(6),
  // СК-42 (Пулково 1942), зоны Гаусса-Крюгера 6° — без ложного смещения по N
  'SK42-7':  `+proj=tmerc +lat_0=0 +lon_0=39 +k=1 +x_0=7500000 +y_0=0 ${ELLPS_KRASS} ${TOWGS84_KRASS} +units=m +no_defs`,
  'SK42-8':  `+proj=tmerc +lat_0=0 +lon_0=45 +k=1 +x_0=8500000 +y_0=0 ${ELLPS_KRASS} ${TOWGS84_KRASS} +units=m +no_defs`,
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
  'none': '',
};

export const CRS_OPTIONS = [
  { value: 'MSK50-2', label: 'МСК-50, зона 2 (X≈2 2xx xxx)' },
  { value: 'MSK50-1', label: 'МСК-50, зона 1 (X≈1 2xx xxx)' },
  { value: 'MSK50-3', label: 'МСК-50, зона 3 (X≈3 2xx xxx)' },
  { value: 'MSK50-4', label: 'МСК-50, зона 4 (X≈4 2xx xxx)' },
  { value: 'MSK50-5', label: 'МСК-50, зона 5 (X≈5 2xx xxx)' },
  { value: 'MSK50-6', label: 'МСК-50, зона 6 (X≈6 2xx xxx)' },
  { value: 'SK42-7',  label: 'СК-42, зона 7 (X≈7 5xx xxx)' },
  { value: 'SK42-8',  label: 'СК-42, зона 8 (X≈8 5xx xxx)' },
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
  firstRawCoord?: [number, number];
}

function transformCoord(x: number, y: number, crs: string, swapXY: boolean): [number, number] {
  const ex = swapXY ? y : x;
  const ey = swapXY ? x : y;
  if (crs === 'EPSG:4326' || crs === 'none') return [ex, ey];
  const def = CRS_DEFINITIONS[crs];
  if (!def) return [ex, ey];
  try {
    const result = proj4(def, '+proj=longlat +datum=WGS84 +no_defs', [ex, ey]);
    return [result[0], result[1]];
  } catch {
    return [ex, ey];
  }
}

export async function parseDxfContent(content: string, crs: string, swapXY = false): Promise<ParsedDxfResult> {
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

  let firstRawCoord: [number, number] | undefined;

  for (const entity of entities) {
    const layerName: string = entity.layer || '0';

    if (!layerMap.has(layerName)) {
      layerMap.set(layerName, { name: layerName, count: 0, types: [] });
    }

    const layerInfo = layerMap.get(layerName)!;
    let feature: DxfFeature | null = null;

    if (!firstRawCoord) {
      let rawX: number | undefined;
      let rawY: number | undefined;
      if (entity.type === 'LINE') {
        rawX = entity.vertices?.[0]?.x ?? entity.start?.x;
        rawY = entity.vertices?.[0]?.y ?? entity.start?.y;
      } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        rawX = entity.vertices?.[0]?.x;
        rawY = entity.vertices?.[0]?.y;
      } else if (entity.type === 'POINT') {
        rawX = entity.position?.x;
        rawY = entity.position?.y;
      }
      if (rawX !== undefined && rawY !== undefined) {
        firstRawCoord = [rawX, rawY];
        console.log('[DXF] RAW first coord (before transform):', rawX, rawY, '| CRS:', crs, '| swapXY:', swapXY);
      }
    }

    if (entity.type === 'LINE') {
      const start = transformCoord(
        entity.vertices?.[0]?.x ?? entity.start?.x ?? 0,
        entity.vertices?.[0]?.y ?? entity.start?.y ?? 0,
        crs, swapXY
      );
      const end = transformCoord(
        entity.vertices?.[1]?.x ?? entity.end?.x ?? 0,
        entity.vertices?.[1]?.y ?? entity.end?.y ?? 0,
        crs, swapXY
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
        const coords = verts.map((v: any) => transformCoord(v.x ?? 0, v.y ?? 0, crs, swapXY));
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
        const coords = pts.map((p: any) => transformCoord(p.x ?? 0, p.y ?? 0, crs, swapXY));
        feature = {
          type: 'LineString',
          coordinates: coords,
          layer: layerName,
          entityType: 'SPLINE',
        };
      }
    } else if (entity.type === 'POINT') {
      const pt = transformCoord(entity.position?.x ?? 0, entity.position?.y ?? 0, crs, swapXY);
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

  if (features.length > 0) {
    const sample = features[0];
    console.log('[DXF] Parsed features:', features.length, 'layers:', resultLayers.length);
    console.log('[DXF] Sample raw feature type:', sample.type, 'coords count:', sample.coordinates.length);
    if (sample.coordinates.length > 0) {
      console.log('[DXF] Sample coord[0]:', sample.coordinates[0]);
    }
    if (sample.coordinates.length > 1) {
      console.log('[DXF] Sample coord[1]:', sample.coordinates[1]);
    }
  } else {
    console.warn('[DXF] No features extracted! Entities count:', entities.length);
    if (entities.length > 0) {
      console.log('[DXF] First entity type:', entities[0].type, entities[0]);
    }
  }

  return {
    layers: resultLayers,
    features,
    totalCount: features.length,
    firstRawCoord,
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
