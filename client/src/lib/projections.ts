import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import { get as getProjection } from "ol/proj";
import { createXYZ } from "ol/tilegrid";

export type ProjectionType = "EPSG:3857" | "EPSG:3395";

export const PROJECTION_INFO: Record<ProjectionType, { name: string; description: string }> = {
  "EPSG:3857": {
    name: "Web Mercator",
    description: "OSM, Google Maps, Bing Maps",
  },
  "EPSG:3395": {
    name: "World Mercator", 
    description: "Яндекс Карты",
  },
};

const EPSG_3395_DEF = "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs";

let projectionsRegistered = false;

export function registerProjections(): void {
  if (projectionsRegistered) return;
  
  proj4.defs("EPSG:3395", EPSG_3395_DEF);
  register(proj4);
  
  const proj3395 = getProjection("EPSG:3395");
  if (proj3395) {
    proj3395.setExtent([-20037508.34, -20048966.1, 20037508.34, 20048966.1]);
  }
  
  projectionsRegistered = true;
  console.log("Projections registered: EPSG:3395");
}

export const YANDEX_TILE_GRID = createXYZ({
  extent: [-20037508.34, -20037508.34, 20037508.34, 20037508.34],
});

export const YANDEX_MAP_URL = "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=21.06.04-0&x={x}&y={y}&z={z}&scale=1&lang=ru_RU";
export const YANDEX_SATELLITE_URL = "https://core-sat.maps.yandex.net/tiles?l=sat&v=3.1030.0&x={x}&y={y}&z={z}&scale=1&lang=ru_RU";
