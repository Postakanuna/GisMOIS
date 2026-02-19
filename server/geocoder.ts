import type { GeocodeProvider } from "@shared/schema";

interface GeocodingResult {
  lat: number;
  lon: number;
  formattedAddress: string;
  precision: string;
  fiasId?: string;
}

interface GeocodingBatchResult {
  index: number;
  address: string;
  result: GeocodingResult | null;
  error: string | null;
}

const YANDEX_GEOCODER_URL = "https://geocode-maps.yandex.ru/1.x/";
const DADATA_GEOLOCATE_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/geolocate/address";
const DADATA_SUGGEST_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address";
const MAX_RPS = 40;
const DELAY_MS = Math.ceil(1000 / MAX_RPS);
const DADATA_MAX_RPS = 10;
const DADATA_DELAY_MS = Math.ceil(1000 / DADATA_MAX_RPS);
const FETCH_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
      clearTimeout(timer);
    } else {
      parentSignal.addEventListener("abort", () => {
        controller.abort();
        clearTimeout(timer);
      }, { once: true });
    }
  }
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

class GeocoderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocoderAuthError";
  }
}

class GeocoderRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocoderRateLimitError";
  }
}

class GeocoderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocoderTimeoutError";
  }
}

async function geocodeAddress(
  address: string,
  apiKey: string,
  parentSignal?: AbortSignal
): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    apikey: apiKey,
    geocode: address,
    format: "json",
    results: "1",
    lang: "ru_RU",
  });

  const signal = createTimeoutSignal(FETCH_TIMEOUT_MS, parentSignal);

  let response: Response;
  try {
    response = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`, { signal });
  } catch (err: any) {
    if (err.name === "AbortError") {
      if (parentSignal?.aborted) throw err;
      throw new GeocoderTimeoutError(`Таймаут запроса к Яндекс Геокодеру (${FETCH_TIMEOUT_MS / 1000}с)`);
    }
    throw err;
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new GeocoderAuthError("Недействительный API-ключ Яндекс Геокодера");
    }
    if (response.status === 429) {
      throw new GeocoderRateLimitError("Превышен лимит запросов к Яндекс Геокодеру");
    }
    throw new Error(`Ошибка Яндекс Геокодера: ${response.status}`);
  }

  const data = await response.json();
  const members =
    data?.response?.GeoObjectCollection?.featureMember;

  if (!members || members.length === 0) {
    return null;
  }

  const geoObject = members[0].GeoObject;
  const pos = geoObject?.Point?.pos;
  if (!pos) return null;

  const [lonStr, latStr] = pos.split(" ");
  const lon = parseFloat(lonStr);
  const lat = parseFloat(latStr);

  if (isNaN(lon) || isNaN(lat)) return null;

  const precision =
    geoObject?.metaDataProperty?.GeocoderMetaData?.precision || "unknown";
  const formattedAddress =
    geoObject?.metaDataProperty?.GeocoderMetaData?.text || address;

  return { lat, lon, formattedAddress, precision };
}

async function geocodeAddressDadata(
  address: string,
  apiKey: string,
  parentSignal?: AbortSignal
): Promise<GeocodingResult | null> {
  const signal = createTimeoutSignal(FETCH_TIMEOUT_MS, parentSignal);

  let response: Response;
  try {
    response = await fetch(DADATA_SUGGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Token ${apiKey}`,
      },
      body: JSON.stringify({
        query: address,
        count: 1,
      }),
      signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      if (parentSignal?.aborted) throw err;
      throw new GeocoderTimeoutError(`Таймаут запроса к DaData (${FETCH_TIMEOUT_MS / 1000}с)`);
    }
    throw err;
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new GeocoderAuthError("Недействительный API-ключ DaData");
    }
    if (response.status === 429) {
      throw new GeocoderRateLimitError("Превышен лимит запросов к DaData");
    }
    throw new Error(`Ошибка DaData: ${response.status}`);
  }

  const data = await response.json();
  const suggestions = data?.suggestions;

  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  const suggestion = suggestions[0];
  const latStr = suggestion.data?.geo_lat;
  const lonStr = suggestion.data?.geo_lon;

  if (!latStr || !lonStr) return null;

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) return null;

  const formattedAddress = suggestion.value || address;
  const fiasId = suggestion.data?.fias_id || "";
  const fiasLevel = suggestion.data?.fias_level || "";

  return {
    lat,
    lon,
    formattedAddress,
    precision: fiasLevel ? `fias_level_${fiasLevel}` : "unknown",
    fiasId: fiasId || undefined,
  };
}

export interface ReverseGeocodingResult {
  formattedAddress: string;
  precision: string;
  fiasId?: string;
}

export async function reverseGeocode(
  lon: number,
  lat: number,
  apiKey: string,
  parentSignal?: AbortSignal
): Promise<ReverseGeocodingResult | null> {
  const params = new URLSearchParams({
    apikey: apiKey,
    geocode: `${lon},${lat}`,
    format: "json",
    results: "1",
    kind: "house",
    lang: "ru_RU",
  });

  const signal = createTimeoutSignal(FETCH_TIMEOUT_MS, parentSignal);

  let response: Response;
  try {
    response = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`, { signal });
  } catch (err: any) {
    if (err.name === "AbortError") {
      if (parentSignal?.aborted) throw err;
      throw new GeocoderTimeoutError(`Таймаут запроса к Яндекс Геокодеру (${FETCH_TIMEOUT_MS / 1000}с)`);
    }
    throw err;
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new GeocoderAuthError("Недействительный API-ключ Яндекс Геокодера");
    }
    if (response.status === 429) {
      throw new GeocoderRateLimitError("Превышен лимит запросов к Яндекс Геокодеру");
    }
    throw new Error(`Ошибка Яндекс Геокодера: ${response.status}`);
  }

  const data = await response.json();
  const members = data?.response?.GeoObjectCollection?.featureMember;

  if (!members || members.length === 0) {
    return null;
  }

  const geoObject = members[0].GeoObject;
  const precision = geoObject?.metaDataProperty?.GeocoderMetaData?.precision || "unknown";
  const formattedAddress = geoObject?.metaDataProperty?.GeocoderMetaData?.text || "";

  if (!formattedAddress) return null;

  return { formattedAddress, precision };
}

export async function reverseGeocodeDadata(
  lon: number,
  lat: number,
  apiKey: string,
  parentSignal?: AbortSignal
): Promise<ReverseGeocodingResult | null> {
  const signal = createTimeoutSignal(FETCH_TIMEOUT_MS, parentSignal);

  let response: Response;
  try {
    response = await fetch(DADATA_GEOLOCATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Token ${apiKey}`,
      },
      body: JSON.stringify({
        lat,
        lon,
        count: 1,
        radius_meters: 100,
      }),
      signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      if (parentSignal?.aborted) throw err;
      throw new GeocoderTimeoutError(`Таймаут запроса к DaData (${FETCH_TIMEOUT_MS / 1000}с)`);
    }
    throw err;
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new GeocoderAuthError("Недействительный API-ключ DaData");
    }
    if (response.status === 429) {
      throw new GeocoderRateLimitError("Превышен лимит запросов к DaData");
    }
    throw new Error(`Ошибка DaData: ${response.status}`);
  }

  const data = await response.json();
  const suggestions = data?.suggestions;

  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  const suggestion = suggestions[0];
  const formattedAddress = suggestion.value || "";
  const fiasId = suggestion.data?.fias_id || "";
  const fiasLevel = suggestion.data?.fias_level || "";

  if (!formattedAddress) return null;

  return {
    formattedAddress,
    precision: fiasLevel ? `fias_level_${fiasLevel}` : "unknown",
    fiasId: fiasId || undefined,
  };
}

export interface ReverseGeocodeBatchItem {
  featureId: number;
  coords: { lon: number; lat: number }[];
}

export interface ReverseGeocodeBatchResult {
  featureId: number;
  addresses: (string | null)[];
  fiasIds: (string | null)[];
  error: string | null;
}

export async function reverseGeocodeBatch(
  items: ReverseGeocodeBatchItem[],
  apiKey: string,
  onProgress?: (processed: number, total: number) => void,
  abortSignal?: AbortSignal,
  provider: GeocodeProvider = "yandex"
): Promise<ReverseGeocodeBatchResult[]> {
  const results: ReverseGeocodeBatchResult[] = [];
  let totalCoords = 0;
  for (const item of items) {
    totalCoords += item.coords.length;
  }
  let processedCoords = 0;
  let retryCount = 0;
  const maxRetries = 3;
  const delayMs = provider === "dadata" ? DADATA_DELAY_MS : DELAY_MS;
  let consecutiveTimeouts = 0;
  const maxConsecutiveTimeouts = 5;

  console.log(`[Geocoder] Starting reverse geocode batch: ${totalCoords} coords, provider=${provider}`);

  for (const item of items) {
    if (abortSignal?.aborted) break;

    const addresses: (string | null)[] = [];
    const fiasIds: (string | null)[] = [];
    let itemError: string | null = null;

    for (let ci = 0; ci < item.coords.length; ci++) {
      if (abortSignal?.aborted) break;

      const { lon, lat } = item.coords[ci];
      try {
        let result: ReverseGeocodingResult | null;
        if (provider === "dadata") {
          result = await reverseGeocodeDadata(lon, lat, apiKey, abortSignal);
        } else {
          result = await reverseGeocode(lon, lat, apiKey, abortSignal);
        }
        addresses.push(result?.formattedAddress || null);
        fiasIds.push(result?.fiasId || null);
        retryCount = 0;
        consecutiveTimeouts = 0;
      } catch (error: any) {
        if (error instanceof GeocoderTimeoutError) {
          consecutiveTimeouts++;
          console.warn(`[Geocoder] Timeout ${consecutiveTimeouts}/${maxConsecutiveTimeouts} at coord ${processedCoords + 1}/${totalCoords}: ${error.message}`);
          if (consecutiveTimeouts >= maxConsecutiveTimeouts) {
            console.error(`[Geocoder] Too many consecutive timeouts (${maxConsecutiveTimeouts}), stopping batch`);
            throw new Error(`Слишком много таймаутов подряд (${maxConsecutiveTimeouts}). API-провайдер не отвечает. Обработано ${processedCoords} из ${totalCoords}.`);
          }
          addresses.push(null);
          fiasIds.push(null);
          itemError = error.message;
          await sleep(3000);
        } else if (error instanceof GeocoderRateLimitError) {
          if (retryCount < maxRetries) {
            retryCount++;
            console.warn(`[Geocoder] Rate limit, retry ${retryCount}/${maxRetries} at coord ${processedCoords + 1}/${totalCoords}`);
            await sleep(2000 * retryCount);
            ci--;
            continue;
          }
          console.error(`[Geocoder] Rate limit exhausted after ${maxRetries} retries`);
          addresses.push(null);
          fiasIds.push(null);
          itemError = error.message;
        } else if (error instanceof GeocoderAuthError) {
          throw error;
        } else if (error.name === "AbortError") {
          break;
        } else {
          addresses.push(null);
          fiasIds.push(null);
          itemError = error.message || "Ошибка геокодирования";
          console.warn(`[Geocoder] Error at coord ${processedCoords + 1}/${totalCoords}: ${error.message}`);
        }
      }

      processedCoords++;
      await sleep(delayMs);

      if (onProgress) {
        onProgress(processedCoords, totalCoords);
      }

      if (processedCoords % 50 === 0) {
        console.log(`[Geocoder] Progress: ${processedCoords}/${totalCoords} (${Math.round(processedCoords / totalCoords * 100)}%)`);
      }
    }

    results.push({
      featureId: item.featureId,
      addresses,
      fiasIds,
      error: itemError,
    });
  }

  console.log(`[Geocoder] Batch complete: ${processedCoords}/${totalCoords} processed`);
  return results;
}

export async function geocodeBatch(
  addresses: { index: number; address: string }[],
  apiKey: string,
  onProgress?: (processed: number, total: number) => void,
  provider: GeocodeProvider = "yandex",
  abortSignal?: AbortSignal
): Promise<GeocodingBatchResult[]> {
  const results: GeocodingBatchResult[] = [];
  let retryCount = 0;
  const maxRetries = 3;
  const delayMs = provider === "dadata" ? DADATA_DELAY_MS : DELAY_MS;
  let consecutiveTimeouts = 0;
  const maxConsecutiveTimeouts = 5;

  console.log(`[Geocoder] Starting forward geocode batch: ${addresses.length} addresses, provider=${provider}`);

  for (let i = 0; i < addresses.length; i++) {
    const { index, address } = addresses[i];

    if (!address || address.trim().length === 0) {
      results.push({
        index,
        address,
        result: null,
        error: "Пустой адрес",
      });
      continue;
    }

    if (abortSignal?.aborted) break;

    try {
      let result: GeocodingResult | null;
      if (provider === "dadata") {
        result = await geocodeAddressDadata(address.trim(), apiKey, abortSignal);
      } else {
        result = await geocodeAddress(address.trim(), apiKey, abortSignal);
      }
      results.push({
        index,
        address,
        result,
        error: result ? null : "Адрес не найден",
      });
      retryCount = 0;
      consecutiveTimeouts = 0;
    } catch (error: any) {
      if (error instanceof GeocoderTimeoutError) {
        consecutiveTimeouts++;
        console.warn(`[Geocoder] Timeout ${consecutiveTimeouts}/${maxConsecutiveTimeouts} at address ${i + 1}/${addresses.length}`);
        if (consecutiveTimeouts >= maxConsecutiveTimeouts) {
          console.error(`[Geocoder] Too many consecutive timeouts, stopping`);
          throw new Error(`Слишком много таймаутов подряд. Обработано ${results.length} из ${addresses.length}.`);
        }
        results.push({ index, address, result: null, error: error.message });
        await sleep(3000);
      } else if (error instanceof GeocoderRateLimitError) {
        if (retryCount < maxRetries) {
          retryCount++;
          await sleep(2000 * retryCount);
          i--;
          continue;
        }
        results.push({ index, address, result: null, error: error.message });
      } else if (error instanceof GeocoderAuthError) {
        throw error;
      } else if (error.name === "AbortError") {
        break;
      } else {
        results.push({
          index,
          address,
          result: null,
          error: error.message || "Ошибка геокодирования",
        });
      }
    }

    if (i < addresses.length - 1) {
      await sleep(delayMs);
    }

    if (onProgress) {
      onProgress(results.length, addresses.length);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[Geocoder] Progress: ${i + 1}/${addresses.length} (${Math.round((i + 1) / addresses.length * 100)}%)`);
    }
  }

  console.log(`[Geocoder] Forward batch complete: ${results.length}/${addresses.length} processed`);
  return results;
}
