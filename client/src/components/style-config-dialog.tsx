import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Plus, Loader2 } from "lucide-react";
import type { StyleConfig, CategorizedClass, GraduatedClass, StyleClassItem, AttributeField } from "@shared/schema";

const STYLE_COLORS = [
  "#D32F2F", "#F57C00", "#FBC02D", "#388E3C", "#1976D2",
  "#7B1FA2", "#C2185B", "#0097A7", "#512DA8", "#E64A19",
  "#AFB42B", "#00796B", "#303F9F", "#5D4037", "#455A64",
  "#E91E63", "#FF5722", "#8BC34A", "#03A9F4", "#9C27B0",
];

function generateColor(index: number): string {
  return STYLE_COLORS[index % STYLE_COLORS.length];
}

interface StyleConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layer: {
    id: number;
    name: string;
    geometryType: string;
    color: string;
    styleConfig?: any;
  };
  onSave: (styleConfig: StyleConfig) => void;
}

export function StyleConfigDialog({ open, onOpenChange, layer, onSave }: StyleConfigDialogProps) {
  const existing = layer.styleConfig as StyleConfig | undefined;

  const [renderer, setRenderer] = useState<"single" | "categorized" | "graduated">(
    existing?.renderer || "single"
  );
  const [field, setField] = useState<string>(existing?.field || "");
  const [categorizedClasses, setCategorizedClasses] = useState<CategorizedClass[]>(
    existing?.categorizedClasses || []
  );
  const [graduatedClasses, setGraduatedClasses] = useState<GraduatedClass[]>(
    existing?.graduatedClasses || []
  );
  const [defaultColor, setDefaultColor] = useState<string>(
    existing?.defaultStyle?.color || "#888888"
  );

  useEffect(() => {
    const sc = layer.styleConfig as StyleConfig | undefined;
    setRenderer(sc?.renderer || "single");
    setField(sc?.field || "");
    setCategorizedClasses(sc?.categorizedClasses || []);
    setGraduatedClasses(sc?.graduatedClasses || []);
    setDefaultColor(sc?.defaultStyle?.color || "#888888");
  }, [layer.styleConfig, open]);

  const { data: schemaData } = useQuery<{ id: number; layerId: number; fields: AttributeField[] }>({
    queryKey: ["/api/layer-schemas", layer.id],
    queryFn: async () => {
      const res = await fetch(`/api/layer-schemas/${layer.id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open,
  });

  const fields = useMemo(() => schemaData?.fields || [], [schemaData]);

  const numericFields = useMemo(
    () => fields.filter(f => f.type === "number"),
    [fields]
  );

  const { data: uniqueValues, isFetching: isFetchingValues } = useQuery<string[]>({
    queryKey: ["/api/editable-layers", layer.id, "unique-values", field],
    queryFn: async () => {
      const res = await fetch(`/api/editable-layers/${layer.id}/unique-values?field=${encodeURIComponent(field)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.values || [];
    },
    enabled: open && renderer === "categorized" && !!field,
  });

  const { data: fieldStats, isFetching: isFetchingStats } = useQuery<{ min: number; max: number; count: number }>({
    queryKey: ["/api/editable-layers", layer.id, "field-stats", field],
    queryFn: async () => {
      const res = await fetch(`/api/editable-layers/${layer.id}/field-stats?field=${encodeURIComponent(field)}`);
      if (!res.ok) return { min: 0, max: 100, count: 0 };
      return res.json();
    },
    enabled: open && renderer === "graduated" && !!field,
  });

  const handleAutoClassify = () => {
    if (!uniqueValues || uniqueValues.length === 0) return;
    const newClasses: CategorizedClass[] = uniqueValues.map((val, i) => ({
      value: val,
      label: String(val),
      style: { color: generateColor(i) },
    }));
    setCategorizedClasses(newClasses);
  };

  const handleAutoGraduate = () => {
    if (!field) return;
    const stats = fieldStats || { min: 0, max: 100, count: 0 };
    const classCount = 5;
    const range = stats.max - stats.min;
    const step = range > 0 ? range / classCount : 20;
    const newClasses: GraduatedClass[] = [];
    for (let i = 0; i < classCount; i++) {
      const min = parseFloat((stats.min + step * i).toFixed(2));
      const max = parseFloat((stats.min + step * (i + 1)).toFixed(2));
      newClasses.push({
        min,
        max,
        label: `${min} - ${max}`,
        style: { color: generateColor(i) },
      });
    }
    setGraduatedClasses(newClasses);
  };

  const handleSave = () => {
    const config: StyleConfig = {
      renderer,
      field: renderer !== "single" ? field : undefined,
      defaultStyle: { color: defaultColor },
    };
    if (renderer === "categorized") {
      config.categorizedClasses = categorizedClasses;
    }
    if (renderer === "graduated") {
      config.graduatedClasses = graduatedClasses;
    }
    onSave(config);
    onOpenChange(false);
  };

  const addCategorizedClass = () => {
    setCategorizedClasses(prev => [
      ...prev,
      {
        value: "",
        label: "",
        style: { color: generateColor(prev.length) },
      },
    ]);
  };

  const updateCategorizedClass = (index: number, updates: Partial<CategorizedClass>) => {
    setCategorizedClasses(prev => prev.map((c, i) => i === index ? { ...c, ...updates } : c));
  };

  const removeCategorizedClass = (index: number) => {
    setCategorizedClasses(prev => prev.filter((_, i) => i !== index));
  };

  const addGraduatedClass = () => {
    const last = graduatedClasses[graduatedClasses.length - 1];
    const newMin = last ? last.max : 0;
    const newMax = newMin + 10;
    setGraduatedClasses(prev => [
      ...prev,
      {
        min: newMin,
        max: newMax,
        label: `${newMin} - ${newMax}`,
        style: { color: generateColor(prev.length) },
      },
    ]);
  };

  const updateGraduatedClass = (index: number, updates: Partial<GraduatedClass>) => {
    setGraduatedClasses(prev => prev.map((c, i) => i === index ? { ...c, ...updates } : c));
  };

  const removeGraduatedClass = (index: number) => {
    setGraduatedClasses(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col" data-testid="dialog-style-config">
        <DialogHeader>
          <DialogTitle data-testid="text-style-config-title">
            Стилизация: {layer.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="space-y-2">
            <Label>Тип отображения</Label>
            <Select value={renderer} onValueChange={(v) => setRenderer(v as any)}>
              <SelectTrigger data-testid="select-renderer-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Единый стиль</SelectItem>
                <SelectItem value="categorized">Категоризированный</SelectItem>
                <SelectItem value="graduated">Градуированный</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {renderer !== "single" && (
            <div className="space-y-2">
              <Label>Поле атрибута</Label>
              <Select value={field} onValueChange={setField}>
                <SelectTrigger data-testid="select-style-field">
                  <SelectValue placeholder="Выберите поле" />
                </SelectTrigger>
                <SelectContent>
                  {(renderer === "graduated" ? numericFields : fields).map(f => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.name} ({f.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Стиль по умолчанию</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={defaultColor}
                onChange={(e) => setDefaultColor(e.target.value)}
                className="w-8 h-8 rounded border cursor-pointer"
                data-testid="input-default-color"
              />
              <span className="text-sm text-muted-foreground">
                Для объектов без совпадения
              </span>
            </div>
          </div>

          {renderer === "categorized" && field && (
            <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Классы ({categorizedClasses.length})</Label>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoClassify}
                    disabled={isFetchingValues}
                    data-testid="button-auto-classify"
                  >
                    {isFetchingValues && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Автоклассификация
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addCategorizedClass}
                    data-testid="button-add-class"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 min-h-0 max-h-[300px]">
                <div className="space-y-2 pr-3">
                  {categorizedClasses.map((cls, i) => (
                    <div key={i} className="flex items-center gap-2" data-testid={`categorized-class-${i}`}>
                      <input
                        type="color"
                        value={cls.style.color}
                        onChange={(e) => updateCategorizedClass(i, {
                          style: { ...cls.style, color: e.target.value },
                        })}
                        className="w-7 h-7 rounded border cursor-pointer flex-shrink-0"
                        data-testid={`input-class-color-${i}`}
                      />
                      <Input
                        value={String(cls.value)}
                        onChange={(e) => updateCategorizedClass(i, {
                          value: e.target.value,
                          label: e.target.value,
                        })}
                        placeholder="Значение"
                        className="flex-1 h-8 text-sm"
                        data-testid={`input-class-value-${i}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 flex-shrink-0"
                        onClick={() => removeCategorizedClass(i)}
                        data-testid={`button-remove-class-${i}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  {categorizedClasses.length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">
                      Нажмите "Автоклассификация" для заполнения
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {renderer === "graduated" && field && (
            <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Диапазоны ({graduatedClasses.length})</Label>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoGraduate}
                    disabled={isFetchingStats}
                    data-testid="button-auto-graduate"
                  >
                    {isFetchingStats && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Авторазбиение
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addGraduatedClass}
                    data-testid="button-add-range"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 min-h-0 max-h-[300px]">
                <div className="space-y-2 pr-3">
                  {graduatedClasses.map((cls, i) => (
                    <div key={i} className="flex items-center gap-2" data-testid={`graduated-class-${i}`}>
                      <input
                        type="color"
                        value={cls.style.color}
                        onChange={(e) => updateGraduatedClass(i, {
                          style: { ...cls.style, color: e.target.value },
                        })}
                        className="w-7 h-7 rounded border cursor-pointer flex-shrink-0"
                        data-testid={`input-range-color-${i}`}
                      />
                      <Input
                        type="number"
                        value={cls.min}
                        onChange={(e) => {
                          const min = parseFloat(e.target.value) || 0;
                          updateGraduatedClass(i, {
                            min,
                            label: `${min} - ${cls.max}`,
                          });
                        }}
                        placeholder="Мин"
                        className="w-20 h-8 text-sm"
                        data-testid={`input-range-min-${i}`}
                      />
                      <span className="text-muted-foreground text-sm">-</span>
                      <Input
                        type="number"
                        value={cls.max}
                        onChange={(e) => {
                          const max = parseFloat(e.target.value) || 0;
                          updateGraduatedClass(i, {
                            max,
                            label: `${cls.min} - ${max}`,
                          });
                        }}
                        placeholder="Макс"
                        className="w-20 h-8 text-sm"
                        data-testid={`input-range-max-${i}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 flex-shrink-0"
                        onClick={() => removeGraduatedClass(i)}
                        data-testid={`button-remove-range-${i}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  {graduatedClasses.length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">
                      Нажмите "Авторазбиение" для заполнения
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-style-cancel">
            Отмена
          </Button>
          <Button onClick={handleSave} data-testid="button-style-save">
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
