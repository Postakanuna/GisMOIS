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
// Map: fieldNameLower → (valueString → label)
let _dynamicFieldValues: Record<string, Record<string, string>> = {};

export function setDynamicFieldValues(
  entries: { fieldName: string; fieldValue: string; label: string }[]
): void {
  const map: Record<string, Record<string, string>> = {};
  for (const entry of entries) {
    const key = entry.fieldName.toLowerCase();
    if (!map[key]) map[key] = {};
    map[key][String(entry.fieldValue)] = entry.label;
  }
  _dynamicFieldValues = map;
}

export function getFieldValueLabel(fieldName: string, rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return "—";
  const str = String(rawValue);
  const valueMap = _dynamicFieldValues[fieldName.toLowerCase()];
  if (valueMap) {
    const decoded = valueMap[str];
    if (decoded !== undefined) return decoded;
  }
  return str;
}

export function hasFieldValueDecoding(fieldName: string): boolean {
  return !!_dynamicFieldValues[fieldName.toLowerCase()];
}
