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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    apikey: apiKey,
    geocode: address,
    format: "json",
    results: "1",
    lang: "ru_RU",
  });

  const response = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`);

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
  apiKey: string
): Promise<GeocodingResult | null> {
  const response = await fetch(DADATA_SUGGEST_URL, {
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
  });

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
  apiKey: string
): Promise<ReverseGeocodingResult | null> {
  const params = new URLSearchParams({
    apikey: apiKey,
    geocode: `${lon},${lat}`,
    format: "json",
    results: "1",
    kind: "house",
    lang: "ru_RU",
  });

  const response = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`);

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
  apiKey: string
): Promise<ReverseGeocodingResult | null> {
  const response = await fetch(DADATA_GEOLOCATE_URL, {
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
  });

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
          result = await reverseGeocodeDadata(lon, lat, apiKey);
        } else {
          result = await reverseGeocode(lon, lat, apiKey);
        }
        addresses.push(result?.formattedAddress || null);
        fiasIds.push(result?.fiasId || null);
        retryCount = 0;
      } catch (error: any) {
        if (error instanceof GeocoderRateLimitError) {
          if (retryCount < maxRetries) {
            retryCount++;
            await sleep(2000 * retryCount);
            ci--;
            continue;
          }
        }
        if (error instanceof GeocoderAuthError) {
          throw error;
        }
        addresses.push(null);
        fiasIds.push(null);
        itemError = error.message || "Ошибка геокодирования";
      }

      processedCoords++;
      await sleep(delayMs);

      if (onProgress) {
        onProgress(processedCoords, totalCoords);
      }
    }

    results.push({
      featureId: item.featureId,
      addresses,
      fiasIds,
      error: itemError,
    });
  }

  return results;
}

export async function geocodeBatch(
  addresses: { index: number; address: string }[],
  apiKey: string,
  onProgress?: (processed: number, total: number) => void,
  provider: GeocodeProvider = "yandex"
): Promise<GeocodingBatchResult[]> {
  const results: GeocodingBatchResult[] = [];
  let retryCount = 0;
  const maxRetries = 3;
  const delayMs = provider === "dadata" ? DADATA_DELAY_MS : DELAY_MS;

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

    try {
      let result: GeocodingResult | null;
      if (provider === "dadata") {
        result = await geocodeAddressDadata(address.trim(), apiKey);
      } else {
        result = await geocodeAddress(address.trim(), apiKey);
      }
      results.push({
        index,
        address,
        result,
        error: result ? null : "Адрес не найден",
      });
      retryCount = 0;
    } catch (error: any) {
      if (error instanceof GeocoderRateLimitError) {
        if (retryCount < maxRetries) {
          retryCount++;
          await sleep(2000 * retryCount);
          i--;
          continue;
        }
      }

      if (error instanceof GeocoderAuthError) {
        throw error;
      }

      results.push({
        index,
        address,
        result: null,
        error: error.message || "Ошибка геокодирования",
      });
    }

    if (i < addresses.length - 1) {
      await sleep(delayMs);
    }

    if (onProgress) {
      onProgress(results.length, addresses.length);
    }
  }

  return results;
}
