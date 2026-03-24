let _dynamicLabels: Record<string, string> = {};
let _dynamicLabelsLower: Record<string, string> = {};

export function setDynamicFieldLabels(labels: Record<string, string>): void {
  _dynamicLabels = labels;
  _dynamicLabelsLower = {};
  for (const [key, value] of Object.entries(labels)) {
    _dynamicLabelsLower[key.toLowerCase()] = value;
  }
}

export function getFieldLabel(technicalName: string): string {
  const label = _dynamicLabels[technicalName] ?? _dynamicLabelsLower[technicalName.toLowerCase()];
  if (label) {
    return `${label} (${technicalName})`;
  }
  return technicalName;
}

export function getFieldLabelPlain(technicalName: string): string {
  return _dynamicLabels[technicalName] ?? _dynamicLabelsLower[technicalName.toLowerCase()] ?? technicalName;
}

export function transformPropertyKeys(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const newKey = getFieldLabel(key);
    result[newKey] = value;
  }
  return result;
}

// ─── Field Value Decoding ──────────────────────────────────────────────────────
// Structure: fieldNameLower → valueString → networkType (or "__any__") → label
type ValueMap = Record<string, Record<string, string>>;

// _fieldValueMap[fieldName][fieldValue][networkType | "__any__"] = label
let _fieldValueMap: Record<string, ValueMap> = {};

export function setDynamicFieldValues(
  entries: { fieldName: string; fieldValue: string; label: string; networkType?: string | null }[]
): void {
  const map: Record<string, ValueMap> = {};
  for (const entry of entries) {
    const field = entry.fieldName.toLowerCase();
    const val = String(entry.fieldValue);
    const nt = entry.networkType ?? "__any__";
    if (!map[field]) map[field] = {};
    if (!map[field][val]) map[field][val] = {};
    map[field][val][nt] = entry.label;
  }
  _fieldValueMap = map;
}

/**
 * Returns human-readable label for a field value.
 * Falls back: specific networkType → universal ("__any__") → raw string
 */
export function getFieldValueLabel(
  fieldName: string,
  rawValue: unknown,
  networkType?: string | null
): string {
  if (rawValue === null || rawValue === undefined) return "—";
  const str = String(rawValue);
  const field = fieldName.toLowerCase();
  const valueMap = _fieldValueMap[field];
  if (valueMap && valueMap[str]) {
    const byType = valueMap[str];
    if (networkType && byType[networkType] !== undefined) {
      return byType[networkType];
    }
    if (byType["__any__"] !== undefined) {
      return byType["__any__"];
    }
  }
  return str;
}

export function hasFieldValueDecoding(fieldName: string): boolean {
  return !!_fieldValueMap[fieldName.toLowerCase()];
}
