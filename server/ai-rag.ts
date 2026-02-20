import { db } from "./db";
import { sql } from "drizzle-orm";
import { fieldLabels } from "@shared/field-labels";

interface FoundObject {
  layerName: string;
  objectName: string;
  address: string;
  geometryType: string;
  properties: Record<string, any>;
}

const IMPORTANT_FIELDS = [
  "Name", "Adres", "Nist", "Sist", "Mode",
  "Qsum", "Qo_r", "Qgv_r", "Qsv_r", "Qo_t", "Qgv_t", "Qsv_t",
  "T1_r", "T1_t", "T2_r", "T2_t", "Tpod", "Tobr",
  "H_obr", "H_pod", "H_ras", "H_geo", "Hstat",
  "Ppod", "Pobr", "Pt_pod", "Pt_obr",
  "Gso", "Ggv", "Gsv", "Gt_obr", "Gsum_pod",
  "yst_moshn", "Rasp_moch", "iznos", "Iznos_set",
  "D_teplose", "D_gvs", "prot_set_",
  "vid_siste", "vid_osnov", "vid_rezer",
  "faktich_t", "utv_temp_", "Period",
  "gorodskoi", "naselenni", "ylitca", "dom", "kadastr",
  "Name_sobs", "name_eksp", "INN_ekspl",
  "kolvo_OKS", "kolvo_ctp", "MKD", "Soc_obekti",
  "otpusk", "virabotka", "sobstv_nu", "rezev_def",
  "obshiq_po", "N_schem", "RegulType",
  "Dist", "Time", "Dw_pod", "Dw_obr", "Dn_pod", "Dn_obr", "L",
  "Tb", "Tgrunt", "Tnv_r", "Tnv_t",
  "ZType", "ZMode",
];

function extractKeyTerms(userMessage: string): string[] {
  const lower = userMessage.toLowerCase();
  const terms: string[] = [];

  const words = lower
    .replace(/[?!.,;:()«»""'']/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);

  const stopWords = new Set([
    "что", "как", "где", "кто", "для", "при", "это", "тот", "его", "она", "они",
    "все", "или", "так", "уже", "ещё", "еще", "мне", "мой", "моя", "мои",
    "можно", "нужно", "какие", "какой", "какая", "каких", "какую",
    "расскажи", "покажи", "скажи", "дай", "подскажи", "объясни",
    "характеристики", "характеристика", "параметры", "параметр", "данные",
    "информация", "информацию", "сведения", "описание",
    "про", "объекте", "объект", "объекта", "объектов",
  ]);

  for (const word of words) {
    if (!stopWords.has(word) && word.length > 2) {
      terms.push(word);
    }
  }

  const quotedPattern = /[«"']([^«"'»"']+)[»"']/g;
  let match;
  while ((match = quotedPattern.exec(userMessage)) !== null) {
    terms.unshift(match[1].trim());
  }

  return terms;
}

function detectLayerTypeKeywords(userMessage: string): string[] {
  const lower = userMessage.toLowerCase();
  const layerKeywords: string[] = [];

  const typeMap: Record<string, string[]> = {
    "Источник": ["источник", "котельн", "грэс", "тэц", "бойлерн"],
    "ЦТП": ["цтп", "тп-", "центральн тепловой пункт", "тепловой пункт", "теплопункт"],
    "Потpебитель": ["потребител", "абонент", "здание", "дом", "жилой", "мкд"],
    "Узел": ["узел", "узла", "камер"],
    "Задвижка": ["задвижк", "вентил", "кран", "арматур"],
    "Участки": ["участ", "трубопровод", "труб", "магистраль", "сеть", "сети"],
    "Насосная станция": ["насос", "нпс"],
    "Вспомогательный участок": ["вспомогательн", "перемычк", "байпас"],
    "Дросселирующий узел": ["дроссел", "дросс"],
    "Обобщенный потребитель": ["обобщенн"],
    "ЖАЛОБА": ["жалоб"],
    "Ордер": ["ордер"],
    "Чек-лист": ["чек-лист", "чеклист", "утс"],
  };

  for (const [layerType, keywords] of Object.entries(typeMap)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        layerKeywords.push(layerType);
        break;
      }
    }
  }

  return layerKeywords;
}

function formatPropertiesForContext(props: Record<string, any>): string {
  const lines: string[] = [];

  for (const key of IMPORTANT_FIELDS) {
    if (props[key] !== undefined && props[key] !== null && props[key] !== "" && props[key] !== 0) {
      const label = fieldLabels[key] || key;
      lines.push(`  ${label}: ${props[key]}`);
    }
  }

  if (lines.length === 0) {
    const allKeys = Object.keys(props).slice(0, 20);
    for (const key of allKeys) {
      if (props[key] !== undefined && props[key] !== null && props[key] !== "" && props[key] !== 0) {
        const label = fieldLabels[key] || key;
        lines.push(`  ${label}: ${props[key]}`);
      }
    }
  }

  return lines.join("\n");
}

export async function searchObjectsForRAG(userMessage: string): Promise<string> {
  const terms = extractKeyTerms(userMessage);
  const layerTypeKeywords = detectLayerTypeKeywords(userMessage);

  if (terms.length === 0 && layerTypeKeywords.length === 0) {
    return "";
  }

  const results: FoundObject[] = [];

  for (const term of terms) {
    if (results.length >= 5) break;

    try {
      const rows = await db.execute(sql`
        SELECT df.properties, df.geometry_type, el.name as layer_name
        FROM drawn_features df
        JOIN editable_layers el ON df.layer_id = el.id
        WHERE (
          df.properties->>'Name' ILIKE ${'%' + term + '%'}
          OR df.properties->>'Adres' ILIKE ${'%' + term + '%'}
          OR df.properties->>'name' ILIKE ${'%' + term + '%'}
          OR df.properties->>'ylitca' ILIKE ${'%' + term + '%'}
          OR df.properties->>'naselenni' ILIKE ${'%' + term + '%'}
          OR df.properties->>'gorodskoi' ILIKE ${'%' + term + '%'}
          OR el.name ILIKE ${'%' + term + '%'}
        )
        LIMIT 5
      `);

      const dbRows = (rows as any).rows || [];
      for (const row of dbRows) {
        if (results.length >= 5) break;
        const props = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
        const name = props.Name || props.name || "";
        const addr = props.Adres || props.adres || "";

        const isDuplicate = results.some(r =>
          r.objectName === name && r.layerName === row.layer_name
        );
        if (!isDuplicate) {
          results.push({
            layerName: row.layer_name,
            objectName: name,
            address: addr,
            geometryType: row.geometry_type,
            properties: props,
          });
        }
      }
    } catch (e) {
      console.error("[RAG] search error for term:", term, e);
    }
  }

  if (results.length === 0 && layerTypeKeywords.length > 0) {
    for (const layerType of layerTypeKeywords) {
      if (results.length >= 5) break;
      try {
        const rows = await db.execute(sql`
          SELECT df.properties, df.geometry_type, el.name as layer_name
          FROM drawn_features df
          JOIN editable_layers el ON df.layer_id = el.id
          WHERE el.name ILIKE ${'%' + layerType + '%'}
          LIMIT 3
        `);

        const dbRows = (rows as any).rows || [];
        for (const row of dbRows) {
          if (results.length >= 5) break;
          const props = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
          results.push({
            layerName: row.layer_name,
            objectName: props.Name || "",
            address: props.Adres || "",
            geometryType: row.geometry_type,
            properties: props,
          });
        }
      } catch (e) {
        console.error("[RAG] layer type search error:", layerType, e);
      }
    }
  }

  if (results.length === 0) {
    return "";
  }

  let context = `\n\n--- ДАННЫЕ ИЗ БАЗЫ (найдено ${results.length} объектов) ---\n`;

  for (let i = 0; i < results.length; i++) {
    const obj = results[i];
    context += `\nОбъект ${i + 1}: "${obj.objectName || "без имени"}" (слой: ${obj.layerName}, тип геометрии: ${obj.geometryType})\n`;
    if (obj.address) {
      context += `  Адрес: ${obj.address}\n`;
    }
    context += formatPropertiesForContext(obj.properties) + "\n";
  }

  context += "\n--- КОНЕЦ ДАННЫХ ИЗ БАЗЫ ---";

  return context;
}

let cachedLayersSummary: string = "";
let layersCacheTime: number = 0;
const LAYERS_CACHE_TTL = 5 * 60 * 1000;

export async function getLayersSummaryForContext(): Promise<string> {
  const now = Date.now();
  if (cachedLayersSummary && (now - layersCacheTime) < LAYERS_CACHE_TTL) {
    return cachedLayersSummary;
  }

  try {
    const rows = await db.execute(sql`
      SELECT name, geometry_type, feature_count
      FROM editable_layers
      WHERE feature_count > 0
      ORDER BY feature_count DESC
    `);

    const layers = (rows as any).rows || [];
    if (layers.length === 0) return "";

    let summary = "\n\nДоступные слои в системе:\n";
    for (const l of layers) {
      summary += `- ${l.name} (${l.geometry_type}, ${l.feature_count} объектов)\n`;
    }

    cachedLayersSummary = summary;
    layersCacheTime = now;
    return summary;
  } catch (e) {
    console.error("[RAG] layers summary error:", e);
    return cachedLayersSummary || "";
  }
}
