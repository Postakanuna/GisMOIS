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
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import {
  Trash2,
  Plus,
  Loader2,
  Minus,
  MoreHorizontal,
  Layers,
  Grid3X3,
  BarChart3,
} from "lucide-react";
import { IconPicker, getCustomIconPreview } from "@/components/icon-picker";
import { LinePicker } from "@/components/line-picker";
import {
  getHeatNetworkPreviewIcon,
  isHeatNetworkStyle,
  HEAT_NETWORK_LABELS,
  type HeatNetworkPointStyle,
} from "@/lib/heat-network-icons";
import {
  getHeatNetworkLineStyles,
  getLinePreviewDataUrl,
  isHeatNetworkLineStyle,
} from "@/lib/heat-network-lines";
import type {
  StyleConfig,
  CategorizedClass,
  GraduatedClass,
  StyleClassItem,
  AttributeField,
  CustomIcon,
} from "@shared/schema";

const STYLE_COLORS = [
  "#D32F2F", "#F57C00", "#FBC02D", "#388E3C", "#1976D2",
  "#7B1FA2", "#C2185B", "#0097A7", "#512DA8", "#E64A19",
  "#AFB42B", "#00796B", "#303F9F", "#5D4037", "#455A64",
  "#E91E63", "#FF5722", "#8BC34A", "#03A9F4", "#9C27B0",
];

const LAYER_COLORS = [
  "#1976D2", "#D32F2F", "#388E3C", "#7B1FA2",
  "#F57C00", "#0097A7", "#C2185B", "#512DA8",
  "#E64A19", "#AFB42B", "#00796B", "#303F9F",
];

const BASIC_LINE_STYLES = [
  { value: "solid", label: "Сплошная" },
  { value: "dashed", label: "Пунктирная" },
  { value: "double", label: "Двойная" },
  { value: "dash-dot", label: "Штрих-пунктир" },
  { value: "dotted", label: "Точечная" },
  { value: "long-dash", label: "Длинный пунктир" },
  { value: "dash-dot-dot", label: "Штрих-точка-точка" },
];

function generateColor(index: number): string {
  return STYLE_COLORS[index % STYLE_COLORS.length];
}

interface LayerStylePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layer: {
    id: number;
    name: string;
    geometryType: string;
    color: string;
    pointStyle: string;
    lineStyle: string;
    opacity: number;
    styleConfig?: any;
  };
  onSave: (updates: {
    color?: string;
    pointStyle?: string;
    lineStyle?: string;
    opacity?: number;
    styleConfig?: StyleConfig;
  }) => void;
}

export function LayerStylePanel({
  open,
  onOpenChange,
  layer,
  onSave,
}: LayerStylePanelProps) {
  const existing = layer.styleConfig as StyleConfig | undefined;

  const [color, setColor] = useState(layer.color);
  const [pointStyle, setPointStyle] = useState(layer.pointStyle);
  const [lineStyle, setLineStyle] = useState(layer.lineStyle);
  const [opacity, setOpacity] = useState(layer.opacity);
  const [iconSize, setIconSize] = useState<number>(
    existing?.defaultStyle?.iconSize || 24
  );
  const [strokeWidth, setStrokeWidth] = useState<number>(
    existing?.defaultStyle?.strokeWidth || 2
  );
  const [fillOpacity, setFillOpacity] = useState<number>(
    existing?.defaultStyle?.fillOpacity ?? 0.7
  );
  const [customIconId, setCustomIconId] = useState<number | undefined>(
    existing?.defaultStyle?.customIconId
  );

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

  useEffect(() => {
    if (!open) return;
    const sc = layer.styleConfig as StyleConfig | undefined;
    setColor(layer.color);
    setPointStyle(layer.pointStyle);
    setLineStyle(layer.lineStyle);
    setOpacity(layer.opacity);
    setIconSize(sc?.defaultStyle?.iconSize || 24);
    setStrokeWidth(sc?.defaultStyle?.strokeWidth || 2);
    setFillOpacity(sc?.defaultStyle?.fillOpacity ?? 0.7);
    setCustomIconId(sc?.defaultStyle?.customIconId);
    setRenderer(sc?.renderer || "single");
    setField(sc?.field || "");
    setCategorizedClasses(sc?.categorizedClasses || []);
    setGraduatedClasses(sc?.graduatedClasses || []);
  }, [layer, open]);

  const { data: schemaData } = useQuery<{ layerId: number; fields: AttributeField[] }>({
    queryKey: ["/api/editable-layers", layer.id, "schema"],
    queryFn: async () => {
      const res = await fetch(`/api/editable-layers/${layer.id}/schema`);
      if (!res.ok) return { layerId: layer.id, fields: [] };
      return res.json();
    },
    enabled: open,
  });

  const { data: fallbackAttrs } = useQuery<{ name: string; type: string }[]>({
    queryKey: ["/api/editable-layers", layer.id, "attributes-fallback"],
    queryFn: async () => {
      const res = await fetch(`/api/editable-layers/${layer.id}/attributes`);
      if (!res.ok) return [];
      const data = await res.json();
      const attrs: string[] = Array.isArray(data) ? data : (data.attributes || []);
      return attrs.map((a: any) => ({
        name: typeof a === "string" ? a : (a.name || String(a)),
        type: typeof a === "object" && a.type ? a.type : "text",
      }));
    },
    enabled: open && (!schemaData || schemaData.fields.length === 0),
  });

  const fields = useMemo(() => {
    const schemaFields = schemaData?.fields || [];
    if (schemaFields.length > 0) return schemaFields;
    return (fallbackAttrs || []).map((a) => ({
      name: a.name,
      type: a.type as any,
      required: false,
    }));
  }, [schemaData, fallbackAttrs]);

  const numericFields = useMemo(
    () => fields.filter((f) => f.type === "number"),
    [fields]
  );

  const { data: uniqueValues, isFetching: isFetchingValues } = useQuery<string[]>({
    queryKey: ["/api/editable-layers", layer.id, "unique-values", field],
    queryFn: async () => {
      const res = await fetch(
        `/api/editable-layers/${layer.id}/unique-values?field=${encodeURIComponent(field)}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.values || [];
    },
    enabled: open && renderer === "categorized" && !!field,
  });

  const { data: fieldStats, isFetching: isFetchingStats } = useQuery<{
    min: number;
    max: number;
    count: number;
  }>({
    queryKey: ["/api/editable-layers", layer.id, "field-stats", field],
    queryFn: async () => {
      const res = await fetch(
        `/api/editable-layers/${layer.id}/field-stats?field=${encodeURIComponent(field)}`
      );
      if (!res.ok) return { min: 0, max: 100, count: 0 };
      return res.json();
    },
    enabled: open && renderer === "graduated" && !!field,
  });

  const { data: customIcons = [] } = useQuery<CustomIcon[]>({
    queryKey: ["/api/custom-icons"],
    enabled: open,
  });

  const handleAutoClassify = () => {
    if (!uniqueValues || uniqueValues.length === 0) return;
    const newClasses: CategorizedClass[] = uniqueValues.map((val, i) => ({
      value: val,
      label: String(val),
      style: { color: generateColor(i), iconSize },
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
        style: { color: generateColor(i), iconSize },
      });
    }
    setGraduatedClasses(newClasses);
  };

  const handleSave = () => {
    const defaultStyle: StyleClassItem = {
      color,
      strokeWidth,
      fillOpacity,
      iconSize,
      pointStyle: pointStyle as any,
      lineStyle: lineStyle as any,
      customIconId,
    };

    const config: StyleConfig = {
      renderer,
      field: renderer !== "single" ? field : undefined,
      defaultStyle,
    };
    if (renderer === "categorized") {
      config.categorizedClasses = categorizedClasses;
    }
    if (renderer === "graduated") {
      config.graduatedClasses = graduatedClasses;
    }

    onSave({
      color,
      pointStyle,
      lineStyle,
      opacity,
      styleConfig: config,
    });
    onOpenChange(false);
  };

  const updateCategorizedClass = (
    index: number,
    updates: Partial<CategorizedClass>
  ) => {
    setCategorizedClasses((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  };

  const removeCategorizedClass = (index: number) => {
    setCategorizedClasses((prev) => prev.filter((_, i) => i !== index));
  };

  const addCategorizedClass = () => {
    setCategorizedClasses((prev) => [
      ...prev,
      {
        value: "",
        label: "",
        style: { color: generateColor(prev.length), iconSize },
      },
    ]);
  };

  const updateGraduatedClass = (
    index: number,
    updates: Partial<GraduatedClass>
  ) => {
    setGraduatedClasses((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  };

  const removeGraduatedClass = (index: number) => {
    setGraduatedClasses((prev) => prev.filter((_, i) => i !== index));
  };

  const addGraduatedClass = () => {
    const last = graduatedClasses[graduatedClasses.length - 1];
    const newMin = last ? last.max : 0;
    const newMax = newMin + 10;
    setGraduatedClasses((prev) => [
      ...prev,
      {
        min: newMin,
        max: newMax,
        label: `${newMin} - ${newMax}`,
        style: { color: generateColor(prev.length), iconSize },
      },
    ]);
  };

  const getIconPreview = (style: StyleClassItem) => {
    if (style.customIconId) {
      const icon = customIcons.find((i) => i.id === style.customIconId);
      if (icon) {
        return (
          <img
            src={getCustomIconPreview(icon.svgContent, style.color)}
            alt=""
            className="h-5 w-5"
          />
        );
      }
    }
    if (style.pointStyle && isHeatNetworkStyle(style.pointStyle)) {
      return (
        <img
          src={getHeatNetworkPreviewIcon(
            style.pointStyle as HeatNetworkPointStyle,
            style.color
          )}
          alt=""
          className="h-5 w-5"
        />
      );
    }
    return (
      <div
        className="h-4 w-4 rounded-full border"
        style={{ backgroundColor: style.color }}
      />
    );
  };

  const isPoint = layer.geometryType === "Point" || layer.geometryType === "MultiPoint";
  const isLine = layer.geometryType === "LineString" || layer.geometryType === "MultiLineString";
  const heatNetworkLineStyles = getHeatNetworkLineStyles();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col p-0"
        data-testid="dialog-layer-style-panel"
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle data-testid="text-style-panel-title">
            Стилизация слоя: {layer.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 px-4 pb-2 border-b">
          <Button
            variant={renderer === "single" ? "default" : "outline"}
            size="sm"
            onClick={() => setRenderer("single")}
            data-testid="button-renderer-single"
          >
            <Layers className="h-4 w-4 mr-1" />
            Единый стиль
          </Button>
          <Button
            variant={renderer === "categorized" ? "default" : "outline"}
            size="sm"
            onClick={() => setRenderer("categorized")}
            data-testid="button-renderer-categorized"
          >
            <Grid3X3 className="h-4 w-4 mr-1" />
            Категоризация
          </Button>
          <Button
            variant={renderer === "graduated" ? "default" : "outline"}
            size="sm"
            onClick={() => setRenderer("graduated")}
            data-testid="button-renderer-graduated"
          >
            <BarChart3 className="h-4 w-4 mr-1" />
            Градуирование
          </Button>
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 pt-3 space-y-3 flex-shrink-0">
            {renderer === "single" && (
              <>
                <div>
                  <Label className="text-xs font-medium mb-2 block">Цвет</Label>
                  <div className="flex flex-wrap gap-1">
                    {LAYER_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`h-6 w-6 rounded-sm border ${
                          color === c ? "ring-2 ring-primary ring-offset-1" : ""
                        }`}
                        style={{ backgroundColor: c }}
                        onClick={() => setColor(c)}
                        data-testid={`color-swatch-${c}`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-8 h-8 rounded border cursor-pointer"
                      data-testid="input-custom-color"
                    />
                    <span className="text-xs text-muted-foreground">Произвольный</span>
                  </div>
                </div>

                {isPoint && (
                  <div className="flex items-center gap-3">
                    <div>
                      <Label className="text-xs font-medium mb-2 block">Иконка</Label>
                      <div className="flex items-center gap-2">
                        <IconPicker
                          selectedPointStyle={pointStyle}
                          selectedCustomIconId={customIconId}
                          color={color}
                          onSelect={(sel) => {
                            if (sel.pointStyle !== undefined) setPointStyle(sel.pointStyle || "circle");
                            if (sel.customIconId !== undefined) {
                              setCustomIconId(sel.customIconId);
                              if (sel.customIconId) setPointStyle("circle");
                            } else {
                              setCustomIconId(undefined);
                            }
                          }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {customIconId
                            ? customIcons.find((i) => i.id === customIconId)?.name || "Своя"
                            : isHeatNetworkStyle(pointStyle)
                            ? HEAT_NETWORK_LABELS[pointStyle as HeatNetworkPointStyle]
                            : pointStyle}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs font-medium mb-1 block">
                        Размер: {iconSize}px
                      </Label>
                      <Slider
                        value={[iconSize]}
                        onValueChange={([v]) => setIconSize(v)}
                        min={8}
                        max={64}
                        step={1}
                        className="w-full"
                        data-testid="slider-icon-size"
                      />
                    </div>
                  </div>
                )}

                {isLine && (
                  <div>
                    <Label className="text-xs font-medium mb-2 block">Стиль линии</Label>
                    <div className="flex items-center gap-2">
                      <LinePicker
                        selectedLineStyle={lineStyle}
                        color={color}
                        onSelect={(ls) => setLineStyle(ls)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {BASIC_LINE_STYLES.find(s => s.value === lineStyle)?.label
                          || heatNetworkLineStyles.find(s => s.value === lineStyle)?.label
                          || lineStyle}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {renderer !== "single" && (
              <>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Поле:</Label>
                  <Select value={field} onValueChange={setField}>
                    <SelectTrigger
                      className="flex-1"
                      data-testid="select-style-field"
                    >
                      <SelectValue placeholder="Выберите поле атрибута" />
                    </SelectTrigger>
                    <SelectContent>
                      {(renderer === "graduated" ? numericFields : fields).map(
                        (f) => (
                          <SelectItem key={f.name} value={f.name}>
                            {f.name} ({f.type})
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-medium mb-2 block">Стиль по умолчанию</Label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {LAYER_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`h-5 w-5 rounded-sm border ${
                          color === c ? "ring-2 ring-primary ring-offset-1" : ""
                        }`}
                        style={{ backgroundColor: c }}
                        onClick={() => setColor(c)}
                        data-testid={`color-swatch-${c}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-7 h-7 rounded border cursor-pointer flex-shrink-0"
                      data-testid="input-custom-color"
                    />
                    {isPoint && (
                      <IconPicker
                        selectedPointStyle={pointStyle}
                        selectedCustomIconId={customIconId}
                        color={color}
                        onSelect={(sel) => {
                          if (sel.pointStyle !== undefined) setPointStyle(sel.pointStyle || "circle");
                          if (sel.customIconId !== undefined) {
                            setCustomIconId(sel.customIconId);
                            if (sel.customIconId) setPointStyle("circle");
                          } else {
                            setCustomIconId(undefined);
                          }
                        }}
                      />
                    )}
                    {isLine && (
                      <LinePicker
                        selectedLineStyle={lineStyle}
                        color={color}
                        onSelect={(ls) => setLineStyle(ls)}
                      />
                    )}
                    <span className="text-xs text-muted-foreground">
                      для объектов без класса
                    </span>
                  </div>
                  {isPoint && (
                    <div className="mt-2">
                      <Label className="text-xs font-medium mb-1 block">
                        Размер иконки по умолчанию: {iconSize}px
                      </Label>
                      <Slider
                        value={[iconSize]}
                        onValueChange={([v]) => setIconSize(v)}
                        min={8}
                        max={64}
                        step={1}
                        className="w-full"
                        data-testid="slider-icon-size"
                      />
                    </div>
                  )}
                </div>

                {renderer === "categorized" && field && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-xs">
                      Классы ({categorizedClasses.length})
                    </Label>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAutoClassify}
                        disabled={isFetchingValues}
                        data-testid="button-auto-classify"
                      >
                        {isFetchingValues && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
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
                )}

                {renderer === "graduated" && field && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-xs">
                      Диапазоны ({graduatedClasses.length})
                    </Label>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAutoGraduate}
                        disabled={isFetchingStats}
                        data-testid="button-auto-graduate"
                      >
                        {isFetchingStats && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
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
                )}
              </>
            )}
          </div>

          {renderer !== "single" && field && (
            <ScrollArea className="flex-1 min-h-0 px-4 py-2">
              <div className="space-y-1.5 pr-3">
                {renderer === "categorized" && categorizedClasses.map((cls, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 p-1.5 rounded border border-border"
                    data-testid={`categorized-class-${i}`}
                  >
                    <input
                      type="color"
                      value={cls.style.color}
                      onChange={(e) =>
                        updateCategorizedClass(i, {
                          style: {
                            ...cls.style,
                            color: e.target.value,
                          },
                        })
                      }
                      className="w-7 h-7 rounded border cursor-pointer flex-shrink-0"
                      data-testid={`input-class-color-${i}`}
                    />
                    {isPoint && (
                      <IconPicker
                        selectedPointStyle={cls.style.pointStyle}
                        selectedCustomIconId={cls.style.customIconId}
                        color={cls.style.color}
                        onSelect={(sel) => {
                          updateCategorizedClass(i, {
                            style: {
                              ...cls.style,
                              pointStyle: sel.pointStyle as any,
                              customIconId: sel.customIconId,
                            },
                          });
                        }}
                      />
                    )}
                    {isLine && (
                      <LinePicker
                        selectedLineStyle={cls.style.lineStyle || lineStyle}
                        color={cls.style.color}
                        onSelect={(ls) => {
                          updateCategorizedClass(i, {
                            style: {
                              ...cls.style,
                              lineStyle: ls as any,
                            },
                          });
                        }}
                      />
                    )}
                    <Input
                      value={String(cls.value)}
                      onChange={(e) =>
                        updateCategorizedClass(i, {
                          value: e.target.value,
                          label: e.target.value,
                        })
                      }
                      placeholder="Значение"
                      className="flex-1 h-8 text-sm"
                      data-testid={`input-class-value-${i}`}
                    />
                    <Input
                      type="number"
                      value={cls.style.iconSize || iconSize}
                      onChange={(e) => {
                        const size = parseInt(e.target.value) || 24;
                        updateCategorizedClass(i, {
                          style: {
                            ...cls.style,
                            iconSize: Math.min(128, Math.max(4, size)),
                          },
                        });
                      }}
                      placeholder="Px"
                      className="w-14 h-8 text-sm"
                      title="Размер иконки (px)"
                      data-testid={`input-class-size-${i}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCategorizedClass(i)}
                      data-testid={`button-remove-class-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {renderer === "categorized" && categorizedClasses.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нажмите "Автоклассификация" для заполнения классов
                  </p>
                )}

                {renderer === "graduated" && graduatedClasses.map((cls, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 p-1.5 rounded border border-border"
                    data-testid={`graduated-class-${i}`}
                  >
                    <input
                      type="color"
                      value={cls.style.color}
                      onChange={(e) =>
                        updateGraduatedClass(i, {
                          style: {
                            ...cls.style,
                            color: e.target.value,
                          },
                        })
                      }
                      className="w-7 h-7 rounded border cursor-pointer flex-shrink-0"
                      data-testid={`input-range-color-${i}`}
                    />
                    {isPoint && (
                      <IconPicker
                        selectedPointStyle={cls.style.pointStyle}
                        selectedCustomIconId={cls.style.customIconId}
                        color={cls.style.color}
                        onSelect={(sel) => {
                          updateGraduatedClass(i, {
                            style: {
                              ...cls.style,
                              pointStyle: sel.pointStyle as any,
                              customIconId: sel.customIconId,
                            },
                          });
                        }}
                      />
                    )}
                    {isLine && (
                      <LinePicker
                        selectedLineStyle={cls.style.lineStyle || lineStyle}
                        color={cls.style.color}
                        onSelect={(ls) => {
                          updateGraduatedClass(i, {
                            style: {
                              ...cls.style,
                              lineStyle: ls as any,
                            },
                          });
                        }}
                      />
                    )}
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
                    <Input
                      type="number"
                      value={cls.style.iconSize || iconSize}
                      onChange={(e) => {
                        const size = parseInt(e.target.value) || 24;
                        updateGraduatedClass(i, {
                          style: {
                            ...cls.style,
                            iconSize: Math.min(128, Math.max(4, size)),
                          },
                        });
                      }}
                      placeholder="Px"
                      className="w-14 h-8 text-sm"
                      title="Размер иконки (px)"
                      data-testid={`input-range-size-${i}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeGraduatedClass(i)}
                      data-testid={`button-remove-range-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {renderer === "graduated" && graduatedClasses.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нажмите "Авторазбиение" для заполнения диапазонов
                  </p>
                )}
              </div>
            </ScrollArea>
          )}

          {renderer !== "single" && !field && (
            <div className="flex items-center justify-center flex-1 px-4">
              <p className="text-sm text-muted-foreground">
                Выберите поле атрибута для настройки классов
              </p>
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3 space-y-3 flex-shrink-0">
          <Label className="text-xs font-medium text-muted-foreground">Общие параметры</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-medium mb-1 block">
                Толщина обводки: {strokeWidth}px
              </Label>
              <Slider
                value={[strokeWidth]}
                onValueChange={([v]) => setStrokeWidth(v)}
                min={0.5}
                max={10}
                step={0.5}
                className="w-full"
                data-testid="slider-stroke-width"
              />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1 block">
                Прозрачность заливки: {Math.round(fillOpacity * 100)}%
              </Label>
              <Slider
                value={[fillOpacity]}
                onValueChange={([v]) => setFillOpacity(v)}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
                data-testid="slider-fill-opacity"
              />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1 block">
                Непрозрачность слоя: {Math.round(opacity * 100)}%
              </Label>
              <Slider
                value={[opacity]}
                onValueChange={([v]) => setOpacity(v)}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
                data-testid="slider-layer-opacity"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-style-cancel"
          >
            Отмена
          </Button>
          <Button onClick={handleSave} data-testid="button-style-save">
            Применить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
