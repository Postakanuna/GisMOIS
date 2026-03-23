import { storage } from "./storage";
import { setDynamicFieldLabels } from "@shared/field-labels";

export async function refreshFieldLabelsCache(): Promise<void> {
  const entries = await storage.getZuluFieldLabels();
  const map: Record<string, string> = {};
  for (const entry of entries) {
    map[entry.fieldName] = entry.label;
  }
  setDynamicFieldLabels(map);
}
