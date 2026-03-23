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
