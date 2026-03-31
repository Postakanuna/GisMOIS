import { Agent } from "undici";
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
    total_pages?: number;
    last_page?: number;
    from: number;
    to: number;
    per_page: number;
    total: number;
  };
}

let debugMode = false;

function debugLog(message: string, data?: unknown) {
  if (!debugMode) return;
  if (data !== undefined) {
    log(`[DEBUG] ${message} ${JSON.stringify(data)}`, "sensor-sync");
  } else {
    log(`[DEBUG] ${message}`, "sensor-sync");
  }
}

function buildFetchOptions(apiToken: string): RequestInit {
  const noSslAgent = new Agent({ connect: { rejectUnauthorized: false } });
  return {
    headers: {
      "HTTP-X-API-TOKEN": apiToken,
    },
    signal: AbortSignal.timeout(30000),
    // @ts-ignore — undici dispatcher is supported in Node.js 18+ native fetch
    dispatcher: noSslAgent,
  };
}

async function fetchSensorPage(apiUrl: string, apiToken: string, page: number, limit = 500): Promise<SensorApiResponse> {
  const url = new URL(apiUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  debugLog(`Fetching page ${page}, limit=${limit}`, { url: url.toString() });

  const startTime = Date.now();
  let response: Response;

  try {
    response = await fetch(url.toString(), buildFetchOptions(apiToken));
  } catch (err: any) {
    debugLog(`Network error on page ${page}`, { error: err.message, code: err.code });
    throw new Error(`Сетевая ошибка при запросе страницы ${page}: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  debugLog(`Page ${page} response`, { status: response.status, statusText: response.statusText, ms: elapsed });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    debugLog(`Page ${page} non-OK response body`, { body: body.slice(0, 500) });
    throw new Error(`API вернул ${response.status} ${response.statusText}`);
  }

  let data: SensorApiResponse;
  try {
    data = await response.json() as SensorApiResponse;
  } catch (err: any) {
    debugLog(`Page ${page} JSON parse error`, { error: err.message });
    throw new Error(`Ошибка разбора JSON ответа страницы ${page}: ${err.message}`);
  }

  debugLog(`Page ${page} parsed`, {
    success: data.success,
    records: data.data?.length ?? 0,
    pagination: data.pagination,
  });

  if (!data.success) {
    throw new Error(data.message || "API вернул неуспешный ответ");
  }

  return data;
}

export async function fetchAllSensorPages(apiUrl: string, apiToken: string): Promise<SensorApiRecord[]> {
  debugLog("Starting fetchAllSensorPages", { apiUrl });

  const firstPage = await fetchSensorPage(apiUrl, apiToken, 1);
  const allRecords: SensorApiRecord[] = [...firstPage.data];

  const totalPages = firstPage.pagination.total_pages ?? firstPage.pagination.last_page ?? 1;
  debugLog(`Pagination resolved`, {
    total_pages_field: firstPage.pagination.total_pages,
    last_page_field: firstPage.pagination.last_page,
    resolved_totalPages: totalPages,
    total_records: firstPage.pagination.total,
    per_page: firstPage.pagination.per_page,
  });

  const pagePromises: Promise<SensorApiResponse>[] = [];
  for (let page = 2; page <= totalPages; page++) {
    pagePromises.push(fetchSensorPage(apiUrl, apiToken, page));
  }

  if (pagePromises.length > 0) {
    debugLog(`Fetching remaining ${pagePromises.length} pages in parallel`);
    const pages = await Promise.all(pagePromises);
    for (const page of pages) {
      allRecords.push(...page.data);
    }
  }

  debugLog(`fetchAllSensorPages complete`, { totalRecords: allRecords.length });
  return allRecords;
}

export async function testSensorConnection(apiUrl: string, apiToken: string): Promise<{ success: boolean; total?: number; error?: string }> {
  debugLog("Testing sensor connection", { apiUrl });
  try {
    const result = await fetchSensorPage(apiUrl, apiToken, 1, 1);
    debugLog("Connection test success", { total: result.pagination.total });
    return { success: true, total: result.pagination.total };
  } catch (err: any) {
    debugLog("Connection test failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

export async function syncSensors(): Promise<{ synced: number; error?: string }> {
  try {
    const config = await storage.getSensorIntegrationConfig();
    if (!config || !config.isEnabled || !config.apiToken) {
      debugLog("Sync skipped: integration disabled or not configured", {
        hasConfig: !!config,
        isEnabled: config?.isEnabled,
        hasToken: !!config?.apiToken,
      });
      return { synced: 0, error: "Интеграция отключена или не настроена" };
    }

    debugMode = config.isDebugMode === 1;
    log("Starting sensor sync...", "sensor-sync");
    debugLog("Sync started", {
      apiUrl: config.apiUrl,
      pollingIntervalMinutes: config.pollingIntervalMinutes,
      debugMode,
    });

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

    debugLog(`Mapped ${readings.length} records, saving to DB...`);

    await storage.upsertSensorReadingsCache(readings);
    await storage.updateSensorLastSyncAt(new Date());

    log(`Sensor sync complete: ${readings.length} objects synced`, "sensor-sync");
    debugLog("Sync finished successfully", { synced: readings.length });
    return { synced: readings.length };
  } catch (err: any) {
    log(`Sensor sync error: ${err.message}`, "sensor-sync");
    debugLog("Sync failed", { error: err.message, stack: err.stack });
    return { synced: 0, error: err.message };
  }
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export async function startSensorPolling(): Promise<void> {
  const config = await storage.getSensorIntegrationConfig();
  if (!config || !config.isEnabled) {
    log("Sensor polling not started: disabled or not configured", "sensor-sync");
    return;
  }

  debugMode = config.isDebugMode === 1;
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
    debugMode = currentConfig.isDebugMode === 1;
    await syncSensors();
  }, intervalMs);

  log(`Sensor polling started (interval: ${config.pollingIntervalMinutes} min, debug: ${debugMode})`, "sensor-sync");
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

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
  log(`Sensor debug mode: ${enabled ? "ON" : "OFF"}`, "sensor-sync");
}
