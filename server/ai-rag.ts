import { db } from "./db";
import { sql } from "drizzle-orm";
import { fieldLabels } from "@shared/field-labels";

interface FoundObject {
  layerName: string;
  objectName: string;
  address: string;
  geometryType: string;
  networkType: string | null;
  properties: Record<string, any>;
}

const NETWORK_TYPE_LABELS: Record<string, string> = {
  source: "Источник",
  ctp: "ЦТП",
  consumer: "Потребитель",
  segment: "Участок сети",
  valve: "Задвижка",
  node: "Узел",
  pump: "Насос",
};

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

const STOP_WORDS = new Set([
  "что", "как", "где", "кто", "для", "при", "это", "тот", "его", "она", "они",
  "все", "или", "так", "уже", "ещё", "еще", "мне", "мой", "моя", "мои",
  "можно", "нужно", "какие", "какой", "какая", "каких", "какую",
  "расскажи", "покажи", "скажи", "дай", "подскажи", "объясни",
  "характеристики", "характеристика", "параметры", "параметр", "данные",
  "информация", "информацию", "сведения", "описание",
  "про", "объекте", "объект", "объекта", "объектов",
  "есть", "нет", "быть", "был", "была", "были",
]);

function extractSearchTerms(userMessage: string): string[] {
  const terms: string[] = [];

  const quotedPattern = /[«"']([^«"'»"']+)[»"']/g;
  let match;
  while ((match = quotedPattern.exec(userMessage)) !== null) {
    terms.push(match[1].trim());
  }

  const objectIdPattern = /(?:цтп|тп|итп|ктп|грэс|тэц|котельн\S*)\s*(?:[-–—]|№|номер)?\s*\d+/gi;
  while ((match = objectIdPattern.exec(userMessage)) !== null) {
    const raw = match[0].trim();
    terms.push(raw);

    const numMatch = raw.match(/\d+/);
    if (numMatch) {
      const prefix = raw.replace(/\s*(?:[-–—]|№|номер)?\s*\d+.*/, "").trim();
      if (prefix) {
        terms.push(`${prefix} №${numMatch[0]}`);
        terms.push(`${prefix}-${numMatch[0]}`);
        terms.push(`${prefix} ${numMatch[0]}`);
      }
    }
  }

  const words = userMessage
    .toLowerCase()
    .replace(/[?!.,;:()«»""'']/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);

  for (const word of words) {
    if (!STOP_WORDS.has(word)) {
      const alreadyIncluded = terms.some(t => t.toLowerCase().includes(word));
      if (!alreadyIncluded) {
        terms.push(word);
      }
    }
  }

  return terms;
}

function detectLayerTypeKeywords(userMessage: string): string[] {
  const lower = userMessage.toLowerCase();
  const layerKeywords: string[] = [];

  const typeMap: Record<string, string[]> = {
    "Источник": ["источник", "котельн", "грэс", "тэц", "бойлерн"],
    "ЦТП": ["цтп", "итп", "центральн тепловой пункт", "тепловой пункт", "теплопункт"],
    "Потpебитель": ["потребител", "абонент", "здание", "жилой", "мкд"],
    "Узел": ["узел", "узла", "камер"],
    "Задвижка": ["задвижк", "вентил", "кран", "арматур"],
    "Участки": ["участ", "трубопровод", "труб", "магистраль"],
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

function buildSceneFilter(sceneId?: number | null) {
  if (sceneId) {
    return sql`AND el.scene_id = ${sceneId}`;
  }
  return sql``;
}

async function searchByTerm(term: string, results: FoundObject[], limit: number, sceneId?: number | null): Promise<void> {
  if (results.length >= limit) return;

  try {
    const sceneFilter = sceneId ? sql`AND el.scene_id = ${sceneId}` : sql``;
    const rows = await db.execute(sql`
      SELECT df.properties, df.geometry_type, el.name as layer_name, el.network_type
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
      ${sceneFilter}
      LIMIT ${limit}
    `);

    const dbRows = (rows as any).rows || [];
    for (const row of dbRows) {
      if (results.length >= limit) break;
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
          networkType: row.network_type || null,
          properties: props,
        });
      }
    }
  } catch (e) {
    console.error("[RAG] search error for term:", term, e);
  }
}

export async function searchObjectsForRAG(userMessage: string, sceneId?: number | null): Promise<string> {
  const terms = extractSearchTerms(userMessage);
  const layerTypeKeywords = detectLayerTypeKeywords(userMessage);

  console.log("[RAG] Search terms:", terms, "Layer keywords:", layerTypeKeywords, "Scene ID:", sceneId);

  if (terms.length === 0 && layerTypeKeywords.length === 0) {
    return "";
  }

  const results: FoundObject[] = [];

  for (const term of terms) {
    if (results.length >= 5) break;
    await searchByTerm(term, results, 5, sceneId);
  }

  if (results.length === 0 && layerTypeKeywords.length > 0) {
    const sceneFilter = sceneId ? sql`AND el.scene_id = ${sceneId}` : sql``;
    for (const layerType of layerTypeKeywords) {
      if (results.length >= 5) break;
      try {
        const rows = await db.execute(sql`
          SELECT df.properties, df.geometry_type, el.name as layer_name, el.network_type
          FROM drawn_features df
          JOIN editable_layers el ON df.layer_id = el.id
          WHERE (el.name ILIKE ${'%' + layerType + '%'} OR el.network_type = ${layerType.toLowerCase()})
          ${sceneFilter}
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
            networkType: row.network_type || null,
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
    const networkLabel = obj.networkType ? NETWORK_TYPE_LABELS[obj.networkType] || obj.networkType : null;
    const layerInfo = networkLabel
      ? `слой: ${obj.layerName}, тип сети: ${networkLabel}`
      : `слой: ${obj.layerName}`;
    context += `\nОбъект ${i + 1}: "${obj.objectName || "без имени"}" (${layerInfo}, тип геометрии: ${obj.geometryType})\n`;
    if (obj.address) {
      context += `  Адрес: ${obj.address}\n`;
    }
    context += formatPropertiesForContext(obj.properties) + "\n";
  }

  context += "\n--- КОНЕЦ ДАННЫХ ИЗ БАЗЫ ---";

  return context;
}

const layersCacheByScene = new Map<string, { summary: string; time: number }>();
const LAYERS_CACHE_TTL = 2 * 60 * 1000;

export async function getLayersSummaryForContext(sceneId?: number | null): Promise<string> {
  const cacheKey = sceneId ? String(sceneId) : "all";
  const now = Date.now();
  const cached = layersCacheByScene.get(cacheKey);
  if (cached && (now - cached.time) < LAYERS_CACHE_TTL) {
    return cached.summary;
  }

  try {
    const sceneFilter = sceneId ? sql`AND scene_id = ${sceneId}` : sql``;
    const rows = await db.execute(sql`
      SELECT name, geometry_type, feature_count, network_type
      FROM editable_layers
      WHERE feature_count > 0
      ${sceneFilter}
      ORDER BY feature_count DESC
    `);

    const layers = (rows as any).rows || [];
    if (layers.length === 0) return "";

    let summary = "\n\nДоступные слои в текущей сцене:\n";
    for (const l of layers) {
      const networkLabel = l.network_type ? NETWORK_TYPE_LABELS[l.network_type] || l.network_type : null;
      const typeInfo = networkLabel ? `, тип сети: ${networkLabel}` : "";
      summary += `- ${l.name} (${l.geometry_type}, ${l.feature_count} объектов${typeInfo})\n`;
    }

    layersCacheByScene.set(cacheKey, { summary, time: now });
    return summary;
  } catch (e) {
    console.error("[RAG] layers summary error:", e);
    return cached?.summary || "";
  }
}
