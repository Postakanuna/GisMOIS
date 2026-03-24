import { useEffect } from "react";
import { setDynamicFieldLabels, setDynamicFieldValues } from "@shared/field-labels";

export function FieldLabelsLoader() {
  useEffect(() => {
    fetch("/api/field-labels")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { fieldName: string; label: string }[] | null) => {
        if (!data) return;
        const map: Record<string, string> = {};
        for (const entry of data) map[entry.fieldName] = entry.label;
        setDynamicFieldLabels(map);
      })
      .catch(() => {});

    fetch("/api/field-values")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { fieldName: string; fieldValue: string; label: string; networkType?: string | null }[] | null) => {
        if (!data) return;
        setDynamicFieldValues(data);
      })
      .catch(() => {});
  }, []);
  return null;
}
