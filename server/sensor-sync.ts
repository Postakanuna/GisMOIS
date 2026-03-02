import { storage } from "./storage";
import { log } from "./index";

interface SensorApiRecord {
  id_cds_koteln: number;
  mr_name: string;
  place_name: string;
  name_koteln: string;
  address: string;
  rso_name: string;
  type: string;
  mkd_count: number;
  mkd_people_count: number;
  active_claims: number[];
  sensors_state: string;
  last_sensor_data: {
    date: string;
    t_forward: string | number | null;
    t_reverse: string | number | null;
    p_forward: string | number | null;
    p_revers: string | number | null;
  } | null;
  responsibles: {
    full_name: string;
    phone: string;
    position: string;
    messenger?: string;
    email?: string;
  }[];
}

interface SensorApiResponse {
  data: SensorApiRecord[];
  success: boolean;
  message: string;
  pagination: {
    current_page: number;
    total_pages: number;
    last_page: number;
    from: number;
    to: number;
    per_page: number;
    total: number;
  };
}

async function fetchSensorPage(apiUrl: string, apiToken: string, page: number, limit = 500): Promise<SensorApiResponse> {
  const url = new URL(apiUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    headers: {
      "X-API-TOKEN": apiToken,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as SensorApiResponse;
  if (!data.success) {
    throw new Error(data.message || "API returned unsuccessful response");
  }

  return data;
}

export async function fetchAllSensorPages(apiUrl: string, apiToken: string): Promise<SensorApiRecord[]> {
  const firstPage = await fetchSensorPage(apiUrl, apiToken, 1);
  const allRecords: SensorApiRecord[] = [...firstPage.data];
  const totalPages = firstPage.pagination.total_pages;

  const pagePromises: Promise<SensorApiResponse>[] = [];
  for (let page = 2; page <= totalPages; page++) {
    pagePromises.push(fetchSensorPage(apiUrl, apiToken, page));
  }

  const pages = await Promise.all(pagePromises);
  for (const page of pages) {
    allRecords.push(...page.data);
  }

  return allRecords;
}

export async function testSensorConnection(apiUrl: string, apiToken: string): Promise<{ success: boolean; total?: number; error?: string }> {
  try {
    const result = await fetchSensorPage(apiUrl, apiToken, 1, 1);
    return { success: true, total: result.pagination.total };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function syncSensors(): Promise<{ synced: number; error?: string }> {
  try {
    const config = await storage.getSensorIntegrationConfig();
    if (!config || !config.isEnabled || !config.apiToken) {
      return { synced: 0, error: "Integration disabled or not configured" };
    }

    log("Starting sensor sync...", "sensor-sync");
    const records = await fetchAllSensorPages(config.apiUrl, config.apiToken);

    const readings = records.map(r => ({
      idCdsKoteln: r.id_cds_koteln,
      mrName: r.mr_name || null,
      placeName: r.place_name || null,
      nameKoteln: r.name_koteln || null,
      address: r.address || null,
      rsoName: r.rso_name || null,
      type: r.type || null,
      mkdCount: r.mkd_count ?? null,
      mkdPeopleCount: r.mkd_people_count ?? null,
      activeClaims: r.active_claims || [],
      sensorsState: r.sensors_state || null,
      sensorDate: r.last_sensor_data?.date ? new Date(r.last_sensor_data.date) : null,
      tForward: r.last_sensor_data?.t_forward != null ? parseFloat(String(r.last_sensor_data.t_forward)) : null,
      tReverse: r.last_sensor_data?.t_reverse != null ? parseFloat(String(r.last_sensor_data.t_reverse)) : null,
      pForward: r.last_sensor_data?.p_forward != null ? parseFloat(String(r.last_sensor_data.p_forward)) : null,
      pRevers: r.last_sensor_data?.p_revers != null ? parseFloat(String(r.last_sensor_data.p_revers)) : null,
      responsibles: r.responsibles || [],
      fetchedAt: new Date(),
    }));

    await storage.upsertSensorReadingsCache(readings);
    await storage.updateSensorLastSyncAt(new Date());

    log(`Sensor sync complete: ${readings.length} objects synced`, "sensor-sync");
    return { synced: readings.length };
  } catch (err: any) {
    log(`Sensor sync error: ${err.message}`, "sensor-sync");
    return { synced: 0, error: err.message };
  }
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export async function startSensorPolling(): Promise<void> {
  const config = await storage.getSensorIntegrationConfig();
  if (!config || !config.isEnabled) return;

  const intervalMs = (config.pollingIntervalMinutes || 15) * 60 * 1000;

  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }

  await syncSensors();

  pollingTimer = setInterval(async () => {
    const currentConfig = await storage.getSensorIntegrationConfig();
    if (!currentConfig || !currentConfig.isEnabled) {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
      return;
    }
    await syncSensors();
  }, intervalMs);

  log(`Sensor polling started (interval: ${config.pollingIntervalMinutes} min)`, "sensor-sync");
}

export function restartSensorPolling(): void {
  startSensorPolling().catch(err => {
    log(`Failed to restart sensor polling: ${err.message}`, "sensor-sync");
  });
}

export function stopSensorPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    log("Sensor polling stopped", "sensor-sync");
  }
}
