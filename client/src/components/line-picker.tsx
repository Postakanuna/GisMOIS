import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getHeatNetworkLineStyles,
  getLinePreviewDataUrl,
  isHeatNetworkLineStyle,
  type HeatNetworkLineStyle,
} from "@/lib/heat-network-lines";
import type { LineStyle } from "@shared/schema";

const BASIC_LINE_STYLES: { value: string; label: string }[] = [
  { value: "solid", label: "Сплошная" },
  { value: "dashed", label: "Пунктирная" },
  { value: "double", label: "Двойная" },
  { value: "dash-dot", label: "Штрих-пунктир" },
  { value: "dotted", label: "Точечная" },
  { value: "long-dash", label: "Длинный пунктир" },
  { value: "dash-dot-dot", label: "Штрих-точка-точка" },
];

function createBasicLinePreviewSvg(style: string, color: string): string {
  const width = 48;
  const height = 16;
  const y = height / 2;

  let dashArray = "";
  switch (style) {
    case "dashed": dashArray = 'stroke-dasharray="8 4"'; break;
    case "dotted": dashArray = 'stroke-dasharray="2 4"'; break;
    case "dash-dot": dashArray = 'stroke-dasharray="10 4 2 4"'; break;
    case "long-dash": dashArray = 'stroke-dasharray="16 6"'; break;
    case "dash-dot-dot": dashArray = 'stroke-dasharray="10 4 2 4 2 4"'; break;
    case "double":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <path d="M 2 ${y - 2} L ${width - 2} ${y - 2}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <path d="M 2 ${y + 2} L ${width - 2} ${y + 2}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <path d="M 2 ${y} L ${width - 2} ${y}" stroke="${color}" stroke-width="2" stroke-linecap="round" ${dashArray}/>
  </svg>`;
}

function getBasicLinePreviewDataUrl(style: string, color: string): string {
  const svg = createBasicLinePreviewSvg(style, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface LinePickerProps {
  selectedLineStyle?: string;
  color: string;
  onSelect: (lineStyle: string) => void;
  disabled?: boolean;
}

export function LinePicker({
  selectedLineStyle = "solid",
  color,
  onSelect,
  disabled,
}: LinePickerProps) {
  const [open, setOpen] = useState(false);

  const heatStyles = getHeatNetworkLineStyles();

  const handleSelect = (value: string) => {
    onSelect(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className="h-8 w-12 flex items-center justify-center rounded border border-border disabled:opacity-50 hover-elevate"
          data-testid="button-line-picker"
        >
          <img
            src={isHeatNetworkLineStyle(selectedLineStyle) ? getLinePreviewDataUrl(selectedLineStyle as HeatNetworkLineStyle, color) : getBasicLinePreviewDataUrl(selectedLineStyle, color)}
            alt={selectedLineStyle}
            className="h-4 w-full object-contain"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" data-testid="popover-line-picker">
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="w-full grid grid-cols-2 rounded-none border-b">
            <TabsTrigger value="basic" className="text-xs" data-testid="tab-basic-lines">
              Базовые
            </TabsTrigger>
            <TabsTrigger value="gost" className="text-xs" data-testid="tab-gost-lines">
              ГОСТ
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
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
