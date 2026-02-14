interface GeocodingResult {
  lat: number;
  lon: number;
  formattedAddress: string;
  precision: string;
}

interface GeocodingBatchResult {
  index: number;
  address: string;
  result: GeocodingResult | null;
  error: string | null;
}

const YANDEX_GEOCODER_URL = "https://geocode-maps.yandex.ru/1.x/";
const MAX_RPS = 40;
const DELAY_MS = Math.ceil(1000 / MAX_RPS);

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

export async function geocodeBatch(
  addresses: { index: number; address: string }[],
  apiKey: string,
  onProgress?: (processed: number, total: number) => void
): Promise<GeocodingBatchResult[]> {
  const results: GeocodingBatchResult[] = [];
  let retryCount = 0;
  const maxRetries = 3;

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
      const result = await geocodeAddress(address.trim(), apiKey);
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
      await sleep(DELAY_MS);
    }

    if (onProgress) {
      onProgress(results.length, addresses.length);
    }
  }

  return results;
}
