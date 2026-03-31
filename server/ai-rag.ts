import { db } from "./db";
import { sql } from "drizzle-orm";
import { getFieldLabelPlain } from "@shared/field-labels";

interface FoundObject {
  featureId: number;
  layerId: number;
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

const ACCIDENT_LAYER_FIELDS = [
  "Begin_uch", "End_uch", "L", "Dpod", "AccidentCount",
  "Sys", "Kol_potreb", "Kol_zhit",
];

function normalizeRussianAdjective(word: string): string | null {
  const lower = word.toLowerCase();
  if (lower.endsWith("ой") && lower.length > 4)
    return lower.slice(0, -2) + "ая";
  if (lower.endsWith("ей") && lower.length > 4)
    return lower.slice(0, -2) + "ья";
  if (lower.endsWith("ого") && lower.length > 5)
    return lower.slice(0, -3) + "ый";
  if (lower.endsWith("его") && lower.length > 5)
    return lower.slice(0, -3) + "ий";
  return null;
}

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

        const normalized = normalizeRussianAdjective(prefix);
        if (normalized && normalized !== prefix.toLowerCase()) {
          terms.push(`${normalized} №${numMatch[0]}`);
          terms.push(`${normalized} ${numMatch[0]}`);
        }
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
      const label = getFieldLabelPlain(key);
      lines.push(`  ${label}: ${props[key]}`);
    }
  }

  if (lines.length === 0) {
    const allKeys = Object.keys(props).slice(0, 20);
    for (const key of allKeys) {
      if (props[key] !== undefined && props[key] !== null && props[key] !== "" && props[key] !== 0) {
        const label = getFieldLabelPlain(key);
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
      SELECT df.id as feature_id, df.properties, df.geometry_type, el.id as layer_id, el.name as layer_name, el.network_type
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
      ORDER BY
        CASE
          WHEN lower(df.properties->>'Name') = lower(${term}) THEN 0
          WHEN lower(df.properties->>'Name') LIKE lower(${term + '%'}) THEN 1
          ELSE 2
        END,
        df.id
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
          featureId: Number(row.feature_id),
          layerId: Number(row.layer_id),
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
          SELECT df.id as feature_id, df.properties, df.geometry_type, el.id as layer_id, el.name as layer_name, el.network_type
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
            featureId: Number(row.feature_id),
            layerId: Number(row.layer_id),
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
    context += `\nОбъект ${i + 1}: "${obj.objectName || "без имени"}" (ID объекта: ${obj.featureId}, ID слоя: ${obj.layerId}, ${layerInfo}, тип геометрии: ${obj.geometryType})\n`;
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

async function getLayerAttributes(layerId: number): Promise<string[]> {
  try {
    const rows = await db.execute(sql`
      SELECT properties FROM drawn_features
      WHERE layer_id = ${layerId}
      LIMIT 20
    `);
    const dbRows = (rows as any).rows || [];
    const attrSet = new Set<string>();
    for (const row of dbRows) {
      const props = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
      if (props) {
        Object.keys(props).forEach(k => attrSet.add(k));
      }
    }
    return Array.from(attrSet);
  } catch (e) {
    return [];
  }
}

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
      SELECT id, name, geometry_type, feature_count, network_type, metadata
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

      let meta: Record<string, any> = {};
      if (l.metadata) {
        try { meta = typeof l.metadata === "string" ? JSON.parse(l.metadata) : l.metadata; } catch {}
      }
      const isAccidentResult = meta.analysisType === "accident_analysis";
      const accidentTag = isAccidentResult
        ? ` [РЕЗУЛЬТАТ АНАЛИЗА АВАРИЙНОСТИ от ${meta.analysisDate ? new Date(meta.analysisDate).toLocaleDateString("ru-RU") : "неизвестной даты"}]`
        : "";

      summary += `- ${l.name} (ID: ${l.id}, ${l.geometry_type}, ${l.feature_count} объектов${typeInfo}${accidentTag})\n`;

      const attrs = await getLayerAttributes(l.id);
      if (attrs.length > 0) {
        summary += `  Атрибуты: ${attrs.join(", ")}\n`;
      }
    }

    layersCacheByScene.set(cacheKey, { summary, time: now });
    return summary;
  } catch (e) {
    console.error("[RAG] layers summary error:", e);
    return cached?.summary || "";
  }
}

export function invalidateLayersCache(sceneId?: number | null) {
  const cacheKey = sceneId ? String(sceneId) : "all";
  layersCacheByScene.delete(cacheKey);
}

/**
 * Загружает данные слоя с результатами анализа аварийности.
 * Если объектов <= SMALL_THRESHOLD — все; иначе топ-N по AccidentCount + агрегаты.
 */
export async function getAccidentLayerDataForContext(layerId: number, layerName: string): Promise<string> {
  const SMALL_THRESHOLD = 50;
  const TOP_N = 20;

  try {
    const countRows = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM drawn_features WHERE layer_id = ${layerId}
    `);
    const total = parseInt((countRows as any).rows?.[0]?.cnt ?? "0", 10);

    if (total === 0) return "";

    if (total <= SMALL_THRESHOLD) {
      const rows = await db.execute(sql`
        SELECT properties FROM drawn_features WHERE layer_id = ${layerId} ORDER BY id
      `);
      const dbRows = (rows as any).rows || [];
      let ctx = `\n\n--- ДАННЫЕ СЛОЯ "${layerName}" (все ${total} участков) ---\n`;
      dbRows.forEach((row: any, i: number) => {
        const p = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
        const fields = ACCIDENT_LAYER_FIELDS.map(f => p[f] !== undefined && p[f] !== null ? `${f}=${p[f]}` : null).filter(Boolean).join(", ");
        ctx += `${i + 1}. ${fields}\n`;
      });
      ctx += `--- КОНЕЦ ДАННЫХ СЛОЯ ---`;
      return ctx;
    }

    const topRows = await db.execute(sql`
      SELECT properties FROM drawn_features
      WHERE layer_id = ${layerId}
      ORDER BY (properties->>'AccidentCount')::numeric DESC NULLS LAST
      LIMIT ${TOP_N}
    `);
    const aggRows = await db.execute(sql`
      SELECT
        COUNT(*) as cnt,
        SUM((properties->>'AccidentCount')::numeric) as total_accidents,
        AVG((properties->>'AccidentCount')::numeric)::numeric(10,2) as avg_accidents,
        MAX((properties->>'AccidentCount')::numeric) as max_accidents,
        SUM((properties->>'L')::numeric)::numeric(12,1) as total_length_m,
        MIN((properties->>'Dpod')::numeric) as min_dpod,
        MAX((properties->>'Dpod')::numeric) as max_dpod
      FROM drawn_features
      WHERE layer_id = ${layerId}
    `);

    const agg = (aggRows as any).rows?.[0] || {};
    let ctx = `\n\n--- ДАННЫЕ СЛОЯ "${layerName}" (всего ${total} участков, показан топ-${TOP_N} по аварийности) ---\n`;
    ctx += `Агрегаты по всем участкам: аварий всего=${agg.total_accidents ?? "?"}, среднее=${agg.avg_accidents ?? "?"}, макс=${agg.max_accidents ?? "?"}, суммарная длина=${agg.total_length_m ?? "?"} м, диаметр от ${agg.min_dpod ?? "?"} до ${agg.max_dpod ?? "?"} м\n\n`;
    ctx += `Топ-${TOP_N} наиболее аварийных участков:\n`;

    const dbRows = (topRows as any).rows || [];
    dbRows.forEach((row: any, i: number) => {
      const p = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
      const fields = ACCIDENT_LAYER_FIELDS.map(f => p[f] !== undefined && p[f] !== null ? `${f}=${p[f]}` : null).filter(Boolean).join(", ");
      ctx += `${i + 1}. ${fields}\n`;
    });
    ctx += `--- КОНЕЦ ДАННЫХ СЛОЯ ---`;
    return ctx;
  } catch (e) {
    console.error("[RAG] accident layer data error:", e);
    return "";
  }
}

/**
 * Умная загрузка данных произвольного слоя.
 * Если объектов <= SMALL_THRESHOLD — все; иначе первые TOP_N + агрегаты по числовым полям.
 */
export async function getSmartLayerDataForContext(layerId: number, layerName: string, featureCount: number): Promise<string> {
  const SMALL_THRESHOLD = 40;
  const TOP_N = 15;

  try {
    if (featureCount <= SMALL_THRESHOLD) {
      const rows = await db.execute(sql`
        SELECT properties FROM drawn_features WHERE layer_id = ${layerId} ORDER BY id
      `);
      const dbRows = (rows as any).rows || [];
      let ctx = `\n\n--- ДАННЫЕ СЛОЯ "${layerName}" (все ${featureCount} объектов) ---\n`;
      dbRows.forEach((row: any, i: number) => {
        const p = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
        const importantPairs = IMPORTANT_FIELDS
          .filter(f => p[f] !== undefined && p[f] !== null && p[f] !== "" && p[f] !== 0)
          .map(f => `${f}=${p[f]}`);
        const otherPairs = importantPairs.length === 0
          ? Object.entries(p).slice(0, 10).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${v}`)
          : [];
        const line = [...importantPairs, ...otherPairs].join(", ");
        ctx += `${i + 1}. ${line}\n`;
      });
      ctx += `--- КОНЕЦ ДАННЫХ СЛОЯ ---`;
      return ctx;
    }

    const rows = await db.execute(sql`
      SELECT properties FROM drawn_features WHERE layer_id = ${layerId} ORDER BY id LIMIT ${TOP_N}
    `);
    const dbRows = (rows as any).rows || [];
    let ctx = `\n\n--- ДАННЫЕ СЛОЯ "${layerName}" (всего ${featureCount} объектов, показаны первые ${TOP_N}) ---\n`;
    dbRows.forEach((row: any, i: number) => {
      const p = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties;
      const importantPairs = IMPORTANT_FIELDS
        .filter(f => p[f] !== undefined && p[f] !== null && p[f] !== "" && p[f] !== 0)
        .map(f => `${f}=${p[f]}`);
      const otherPairs = importantPairs.length === 0
        ? Object.entries(p).slice(0, 10).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${v}`)
        : [];
      const line = [...importantPairs, ...otherPairs].join(", ");
      ctx += `${i + 1}. ${line}\n`;
    });
    ctx += `(Для работы со всеми объектами слоя используйте инструмент "Программа реконструкции" или другие аналитические функции.)\n`;
    ctx += `--- КОНЕЦ ДАННЫХ СЛОЯ ---`;
    return ctx;
  } catch (e) {
    console.error("[RAG] smart layer data error:", e);
    return "";
  }
}

/**
 * Возвращает список программ реконструкции для текущей сцены.
 */
export async function getReconstructionProgramsForContext(sceneId?: number | null): Promise<string> {
  if (!sceneId) return "";
  try {
    const rows = await db.execute(sql`
      SELECT rp.id, rp.name, rp.period_from, rp.period_to, rp.total_base_cost, rp.total_indexed_cost,
             COUNT(po.id) as object_count
      FROM reconstruction_programs rp
      LEFT JOIN program_objects po ON po.program_id = rp.id
      WHERE rp.scene_id = ${sceneId}
      GROUP BY rp.id, rp.name, rp.period_from, rp.period_to, rp.total_base_cost, rp.total_indexed_cost
      ORDER BY rp.id DESC
    `);
    const programs = (rows as any).rows || [];
    if (programs.length === 0) return "";

    let ctx = "\n\nПрограммы реконструкции в текущей сцене:\n";
    for (const p of programs) {
      const baseCostM = p.total_base_cost ? (parseFloat(p.total_base_cost) / 1000).toFixed(1) : "не рассчитана";
      ctx += `- "${p.name}" (ID: ${p.id}, период: ${p.period_from}–${p.period_to}, объектов: ${p.object_count}, базовая стоимость: ${baseCostM} млн руб.)\n`;
    }
    return ctx;
  } catch (e) {
    console.error("[RAG] reconstruction programs context error:", e);
    return "";
  }
}

/**
 * Возвращает содержимое справочника удельных стоимостей строительства для промпта.
 */
export async function getUnitRatesForContext(): Promise<string> {
  try {
    const rows = await db.execute(sql`
      SELECT object_type, laying_type, diameter_mm, work_type, price_per_unit, unit, base_year, notes
      FROM cost_unit_rates
      ORDER BY object_type, work_type, laying_type NULLS LAST, diameter_mm NULLS LAST
    `);
    const rates = (rows as any).rows || [];
    if (rates.length === 0) return "";

    const OBJECT_TYPE_LABELS: Record<string, string> = {
      pipe: "Труба (трубопровод)",
      ctp: "ЦТП / ИТП",
      source: "Источник теплоснабжения",
    };
    const LAYING_TYPE_LABELS: Record<string, string> = {
      underground: "подземная прокладка",
      above: "надземная прокладка",
    };
    const WORK_TYPE_LABELS: Record<string, string> = {
      overhaul: "кап.ремонт",
      reconstruction: "реконструкция",
    };
    const UNIT_LABELS: Record<string, string> = {
      rub_per_m: "руб/м",
      rub_per_mw: "руб/МВт",
    };

    let ctx = "\n\nСПРАВОЧНИК «УДЕЛЬНАЯ СТОИМОСТЬ СТРОИТЕЛЬСТВА» (расценки для расчёта стоимости работ на тепловых сетях):\n";
    for (const r of rates) {
      const objLabel = OBJECT_TYPE_LABELS[r.object_type] ?? r.object_type;
      const workLabel = WORK_TYPE_LABELS[r.work_type] ?? r.work_type;
      const layingLabel = r.laying_type ? `, ${LAYING_TYPE_LABELS[r.laying_type] ?? r.laying_type}` : "";
      const diamLabel = r.diameter_mm ? `, Ø${r.diameter_mm} мм` : "";
      const price = parseFloat(r.price_per_unit).toLocaleString("ru-RU");
      const unitLabel = UNIT_LABELS[r.unit] ?? r.unit;
      const notes = r.notes ? ` (${r.notes})` : "";
      ctx += `- ${objLabel}${diamLabel}${layingLabel}, ${workLabel}: ${price} ${unitLabel}, базовый год: ${r.base_year}${notes}\n`;
    }
    return ctx;
  } catch (e) {
    console.error("[RAG] unit rates context error:", e);
    return "";
  }
}

/**
 * Определяет, является ли сообщение запросом на получение данных конкретного слоя,
 * и возвращает его данные для контекста.
 */
export async function detectAndFetchLayerData(userMessage: string, sceneId?: number | null): Promise<string> {
  const lower = userMessage.toLowerCase();

  const reconstructionKeywords = ["реконструкц", "программ", "план перекладк", "лимит", "бюджет", "млн", "стоимост"];
  const accidentDataKeywords = ["участк", "аварий", "проблемн", "рейтинг", "список"];

  const wantsLayerData = reconstructionKeywords.some(k => lower.includes(k)) ||
    accidentDataKeywords.some(k => lower.includes(k));

  if (!wantsLayerData || !sceneId) return "";

  try {
    const sceneFilter = sql`AND scene_id = ${sceneId}`;
    const rows = await db.execute(sql`
      SELECT id, name, feature_count, metadata
      FROM editable_layers
      WHERE feature_count > 0
      ${sceneFilter}
      ORDER BY id DESC
    `);
    const layers = (rows as any).rows || [];

    let combined = "";
    for (const l of layers) {
      let meta: Record<string, any> = {};
      if (l.metadata) {
        try { meta = typeof l.metadata === "string" ? JSON.parse(l.metadata) : l.metadata; } catch {}
      }
      if (meta.analysisType === "accident_analysis") {
        const data = await getAccidentLayerDataForContext(Number(l.id), l.name);
        combined += data;
        break;
      }
    }
    return combined;
  } catch (e) {
    console.error("[RAG] detectAndFetchLayerData error:", e);
    return "";
  }
}
