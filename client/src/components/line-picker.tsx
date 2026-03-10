import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import {
  getHeatNetworkLineStyles,
  getLinePreviewDataUrl,
  isHeatNetworkLineStyle,
  type HeatNetworkLineStyle,
} from "@/lib/heat-network-lines";
import type { LineLayer, LineStyle } from "@shared/schema";

const BASIC_LINE_STYLES: { value: string; label: string }[] = [
  { value: "solid", label: "Сплошная" },
  { value: "dashed", label: "Пунктирная" },
  { value: "double", label: "Двойная" },
  { value: "dash-dot", label: "Штрих-пунктир" },
  { value: "dotted", label: "Точечная" },
  { value: "long-dash", label: "Длинный пунктир" },
  { value: "dash-dot-dot", label: "Штрих-точка-точка" },
  { value: "crossed", label: "Перечёркнутая" },
  { value: "double-solid-dashed", label: "Двойная (верх сплошная)" },
  { value: "double-dashed-solid", label: "Двойная (низ сплошная)" },
  { value: "double-dashed", label: "Двойная прерывистая" },
];

const DASH_LABELS: Record<string, string> = {
  solid: "Сплошная",
  dashed: "Пунктир",
  dotted: "Точки",
  "dash-dot": "Штрих-точка",
};

function createBasicLinePreviewSvg(style: string, color: string): string {
  const w = 48;
  const h = 16;
  const cy = h / 2;

  switch (style) {
    case "dashed":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="8 4"/>
      </svg>`;
    case "dotted":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 4"/>
      </svg>`;
    case "dash-dot":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="10 4 2 4"/>
      </svg>`;
    case "long-dash":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="16 6"/>
      </svg>`;
    case "dash-dot-dot":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="10 4 2 4 2 4"/>
      </svg>`;
    case "double":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy - 2} L ${w - 2} ${cy - 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M 2 ${cy + 2} L ${w - 2} ${cy + 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    case "crossed":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="${cy - 4}" x2="15" y2="${cy + 4}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="15" y1="${cy - 4}" x2="9" y2="${cy + 4}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="23" y1="${cy - 4}" x2="29" y2="${cy + 4}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="29" y1="${cy - 4}" x2="23" y2="${cy + 4}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="37" y1="${cy - 4}" x2="43" y2="${cy + 4}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="43" y1="${cy - 4}" x2="37" y2="${cy + 4}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    case "double-solid-dashed":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy - 2} L ${w - 2} ${cy - 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M 2 ${cy + 2} L ${w - 2} ${cy + 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="8 4"/>
      </svg>`;
    case "double-dashed-solid":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy - 2} L ${w - 2} ${cy - 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="8 4"/>
        <path d="M 2 ${cy + 2} L ${w - 2} ${cy + 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    case "double-dashed":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy - 2} L ${w - 2} ${cy - 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="8 4"/>
        <path d="M 2 ${cy + 2} L ${w - 2} ${cy + 2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="8 4" stroke-dashoffset="6"/>
      </svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
  }
}

function createConstructorPreviewSvg(layers: LineLayer[], defaultColor: string): string {
  const w = 48;
  const h = 24;
  const cy = h / 2;

  const getDash = (dash: string) => {
    switch (dash) {
      case "dashed": return 'stroke-dasharray="8 4"';
      case "dotted": return 'stroke-dasharray="2 4"';
      case "dash-dot": return 'stroke-dasharray="10 4 2 4"';
      default: return "";
    }
  };

  if (layers.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <path d="M 2 ${cy} L ${w - 2} ${cy}" stroke="#aaa" stroke-width="1" stroke-dasharray="4 4"/>
    </svg>`;
  }

  const paths = layers.map((l) => {
    const y = cy + l.offset;
    const c = l.color || defaultColor;
    const dash = getDash(l.dash);
    return `<path d="M 2 ${y} L ${w - 2} ${y}" stroke="${c}" stroke-width="${l.width}" stroke-linecap="round" ${dash}/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}</svg>`;
}

function getBasicLinePreviewDataUrl(style: string, color: string): string {
  const svg = createBasicLinePreviewSvg(style, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getConstructorPreviewDataUrl(layers: LineLayer[], defaultColor: string): string {
  const svg = createConstructorPreviewSvg(layers, defaultColor);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DEFAULT_LINE_LAYER: LineLayer = { offset: 0, width: 2, color: "#1976D2", dash: "solid" };

interface LinePickerProps {
  selectedLineStyle?: string;
  color: string;
  constructorLayers?: LineLayer[];
  onSelect: (lineStyle: string, constructorLayers?: LineLayer[]) => void;
  disabled?: boolean;
}

export function LinePicker({
  selectedLineStyle = "solid",
  color,
  constructorLayers: externalConstructorLayers,
  onSelect,
  disabled,
}: LinePickerProps) {
  const [open, setOpen] = useState(false);
  const [localConstructorLayers, setLocalConstructorLayers] = useState<LineLayer[]>(
    externalConstructorLayers || [{ ...DEFAULT_LINE_LAYER, color }]
  );

  const heatStyles = getHeatNetworkLineStyles();

  const handleSelect = (value: string) => {
    onSelect(value);
    setOpen(false);
  };

  const handleConstructorChange = (layers: LineLayer[]) => {
    setLocalConstructorLayers(layers);
    onSelect("custom-constructor", layers);
  };

  const addConstructorLayer = () => {
    const newLayers = [...localConstructorLayers, { ...DEFAULT_LINE_LAYER, color }];
    handleConstructorChange(newLayers);
  };

  const removeConstructorLayer = (i: number) => {
    const newLayers = localConstructorLayers.filter((_, idx) => idx !== i);
    handleConstructorChange(newLayers);
  };

  const updateConstructorLayer = (i: number, updates: Partial<LineLayer>) => {
    const newLayers = localConstructorLayers.map((l, idx) =>
      idx === i ? { ...l, ...updates } : l
    );
    handleConstructorChange(newLayers);
  };

  const isConstructor = selectedLineStyle === "custom-constructor";
  const activeLayers = isConstructor
    ? (externalConstructorLayers && externalConstructorLayers.length > 0 ? externalConstructorLayers : localConstructorLayers)
    : localConstructorLayers;

  const triggerPreviewSrc = isConstructor
    ? getConstructorPreviewDataUrl(activeLayers, color)
    : isHeatNetworkLineStyle(selectedLineStyle)
    ? getLinePreviewDataUrl(selectedLineStyle as HeatNetworkLineStyle, color)
    : getBasicLinePreviewDataUrl(selectedLineStyle, color);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className="h-8 w-12 flex items-center justify-center rounded border border-border disabled:opacity-50 hover-elevate"
          data-testid="button-line-picker"
        >
          <img
            src={triggerPreviewSrc}
            alt={selectedLineStyle}
            className="h-4 w-full object-contain"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" data-testid="popover-line-picker">
        <Tabs defaultValue={isConstructor ? "constructor" : "basic"} className="w-full">
          <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
            <TabsTrigger value="basic" className="text-xs" data-testid="tab-basic-lines">
              Базовые
            </TabsTrigger>
            <TabsTrigger value="gost" className="text-xs" data-testid="tab-gost-lines">
              ГОСТ
            </TabsTrigger>
            <TabsTrigger value="constructor" className="text-xs" data-testid="tab-constructor-lines">
              Конструктор
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="p-2 m-0">
            <div className="space-y-1">
              {BASIC_LINE_STYLES.map(({ value, label }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      className={`w-full h-8 flex items-center gap-2 px-2 rounded border ${
                        selectedLineStyle === value
                          ? "bg-primary/20 border-primary"
                          : "border-border"
                      } hover-elevate`}
                      onClick={() => handleSelect(value)}
                      data-testid={`line-basic-${value}`}
                    >
                      <img
                        src={getBasicLinePreviewDataUrl(value, color)}
                        alt={label}
                        className="h-4 w-12 object-contain flex-shrink-0"
                      />
                      <span className="text-xs truncate">{label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-xs">{label}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="gost" className="p-2 m-0">
            <div className="space-y-1">
              {heatStyles.map(({ value, label }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      className={`w-full h-8 flex items-center gap-2 px-2 rounded border ${
                        selectedLineStyle === value
                          ? "bg-primary/20 border-primary"
                          : "border-border"
                      } hover-elevate`}
                      onClick={() => handleSelect(value)}
                      data-testid={`line-gost-${value}`}
                    >
                      <img
                        src={getLinePreviewDataUrl(value, color)}
                        alt={label}
                        className="h-4 w-12 object-contain flex-shrink-0"
                      />
                      <span className="text-xs truncate">{label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-xs">{label}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="constructor" className="p-2 m-0" data-testid="constructor-tab-content">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Слои линии</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={addConstructorLayer}
                  data-testid="button-add-constructor-layer"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Добавить
                </Button>
              </div>

              <div className="border rounded p-2 bg-muted/30 flex items-center justify-center h-10">
                <img
                  src={getConstructorPreviewDataUrl(localConstructorLayers, color)}
                  alt="preview"
                  className="h-6 w-full object-contain"
                  data-testid="constructor-preview"
                />
              </div>

              {localConstructorLayers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Нажмите "Добавить" чтобы создать слой линии
                </p>
              )}

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {localConstructorLayers.map((layer, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 p-1.5 rounded border border-border bg-background"
                    data-testid={`constructor-layer-${i}`}
                  >
                    <input
                      type="color"
                      value={layer.color}
                      onChange={(e) => updateConstructorLayer(i, { color: e.target.value })}
                      className="w-6 h-6 rounded border cursor-pointer flex-shrink-0"
                      title="Цвет"
                      data-testid={`constructor-layer-color-${i}`}
                    />
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground w-12">Толщина:</span>
                        <input
                          type="number"
                          min={0.5}
                          max={10}
                          step={0.5}
                          value={layer.width}
                          onChange={(e) => updateConstructorLayer(i, { width: parseFloat(e.target.value) || 2 })}
                          className="w-12 h-5 text-xs border rounded px-1"
                          data-testid={`constructor-layer-width-${i}`}
                        />
                        <span className="text-xs text-muted-foreground">px</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground w-12">Смещение:</span>
                        <input
                          type="number"
                          min={-10}
                          max={10}
                          step={1}
                          value={layer.offset}
                          onChange={(e) => updateConstructorLayer(i, { offset: parseFloat(e.target.value) || 0 })}
                          className="w-12 h-5 text-xs border rounded px-1"
                          data-testid={`constructor-layer-offset-${i}`}
                        />
                        <span className="text-xs text-muted-foreground">px</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground w-12">Тип:</span>
                        <select
                          value={layer.dash}
                          onChange={(e) => updateConstructorLayer(i, { dash: e.target.value as any })}
                          className="flex-1 h-5 text-xs border rounded px-0.5 bg-background"
                          data-testid={`constructor-layer-dash-${i}`}
                        >
                          {Object.entries(DASH_LABELS).map(([v, label]) => (
                            <option key={v} value={v}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => removeConstructorLayer(i)}
                      className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                      data-testid={`constructor-layer-remove-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {localConstructorLayers.length > 0 && (
                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => {
                    onSelect("custom-constructor", localConstructorLayers);
                    setOpen(false);
                  }}
                  data-testid="button-apply-constructor"
                >
                  Применить
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
