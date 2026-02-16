import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Upload, Trash2, Loader2, Circle, Square, Triangle, Cloud, Diamond, Star, Plus as CrossIcon, Hexagon, Pentagon } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  getHeatNetworkPreviewIcon,
  HEAT_NETWORK_LABELS,
  type HeatNetworkPointStyle,
} from "@/lib/heat-network-icons";
import type { CustomIcon, PointStyle } from "@shared/schema";

const BASIC_SHAPES: { value: PointStyle; label: string; icon: typeof Circle }[] = [
  { value: "circle", label: "Круг", icon: Circle },
  { value: "square", label: "Квадрат", icon: Square },
  { value: "triangle", label: "Треугольник", icon: Triangle },
  { value: "cloud", label: "Облако", icon: Cloud },
  { value: "diamond", label: "Ромб", icon: Diamond },
  { value: "star", label: "Звезда", icon: Star },
  { value: "cross", label: "Крест", icon: CrossIcon },
  { value: "hexagon", label: "Шестиугольник", icon: Hexagon },
  { value: "pentagon", label: "Пятиугольник", icon: Pentagon },
];

const HEAT_NETWORK_STYLES: { value: HeatNetworkPointStyle; label: string }[] = Object.entries(
  HEAT_NETWORK_LABELS
).map(([value, label]) => ({ value: value as HeatNetworkPointStyle, label }));

interface IconPickerProps {
  selectedPointStyle?: string;
  selectedCustomIconId?: number;
  color: string;
  onSelect: (selection: { pointStyle?: string; customIconId?: number }) => void;
  disabled?: boolean;
}

function getCustomIconPreview(svgContent: string, color: string): string {
  let svg = svgContent.replace(/\{color\}/g, color);
  svg = svg.replace(/currentColor/g, color);
  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml,${encoded}`;
}

export function IconPicker({
  selectedPointStyle,
  selectedCustomIconId,
  color,
  onSelect,
  disabled,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);

  const { data: customIcons = [] } = useQuery<CustomIcon[]>({
    queryKey: ["/api/custom-icons"],
    enabled: open,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: { name: string; svgContent: string }) => {
      const res = await apiRequest("POST", "/api/custom-icons", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-icons"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/custom-icons/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-icons"] });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        if (content && content.includes("<svg")) {
          const name = file.name.replace(/\.svg$/i, "");
          uploadMutation.mutate({ name, svgContent: content });
        }
      };
      reader.readAsText(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadMutation]
  );

  const handleSelect = (selection: { pointStyle?: string; customIconId?: number }) => {
    onSelect(selection);
    setOpen(false);
  };

  const isBasicSelected = (v: string) =>
    !selectedCustomIconId && selectedPointStyle === v;
  const isHeatSelected = (v: string) =>
    !selectedCustomIconId && selectedPointStyle === v;
  const isCustomSelected = (id: number) =>
    selectedCustomIconId === id;

  const previewElement = (() => {
    if (selectedCustomIconId) {
      const icon = customIcons.find((i) => i.id === selectedCustomIconId);
      if (icon) {
        return (
          <img
            src={getCustomIconPreview(icon.svgContent, color)}
            alt={icon.name}
            className="h-5 w-5"
          />
        );
      }
    }
    if (selectedPointStyle) {
      const basic = BASIC_SHAPES.find((s) => s.value === selectedPointStyle);
      if (basic) {
        const Icon = basic.icon;
        return <Icon className="h-4 w-4" style={{ color }} />;
      }
      const isHeat = Object.keys(HEAT_NETWORK_LABELS).includes(selectedPointStyle);
      if (isHeat) {
        return (
          <img
            src={getHeatNetworkPreviewIcon(selectedPointStyle as HeatNetworkPointStyle, color)}
            alt=""
            className="h-5 w-5"
          />
        );
      }
    }
    return <Circle className="h-4 w-4" style={{ color }} />;
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className="h-8 w-8 flex items-center justify-center rounded border border-border disabled:opacity-50 hover-elevate"
          data-testid="button-icon-picker"
        >
          {previewElement}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" data-testid="popover-icon-picker">
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
            <TabsTrigger value="basic" className="text-xs" data-testid="tab-basic-shapes">
              Базовые
            </TabsTrigger>
            <TabsTrigger value="gost" className="text-xs" data-testid="tab-gost-icons">
              ГОСТ
            </TabsTrigger>
            <TabsTrigger value="custom" className="text-xs" data-testid="tab-custom-icons">
              Свои
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="p-2 m-0">
            <div className="grid grid-cols-4 gap-1">
              {BASIC_SHAPES.map(({ value, label, icon: Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      className={`h-9 w-full flex items-center justify-center rounded border ${
                        isBasicSelected(value)
                          ? "bg-primary/20 border-primary"
                          : "border-border"
                      } hover-elevate`}
                      onClick={() => handleSelect({ pointStyle: value })}
                      data-testid={`icon-basic-${value}`}
                    >
                      <Icon className="h-5 w-5" style={{ color }} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{label}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="gost" className="p-2 m-0">
            <div className="grid grid-cols-4 gap-1">
              {HEAT_NETWORK_STYLES.map(({ value, label }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      className={`h-9 w-full flex items-center justify-center rounded border ${
                        isHeatSelected(value)
                          ? "bg-primary/20 border-primary"
                          : "border-border"
                      } hover-elevate`}
                      onClick={() => handleSelect({ pointStyle: value })}
                      data-testid={`icon-gost-${value}`}
                    >
                      <img
                        src={getHeatNetworkPreviewIcon(value, color)}
                        alt={label}
                        className="h-6 w-6"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{label}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="custom" className="p-2 m-0">
            <ScrollArea className="max-h-[200px]">
              <div className="grid grid-cols-4 gap-1">
                {customIcons.map((icon) => (
                  <Tooltip key={icon.id}>
                    <TooltipTrigger asChild>
                      <div className="relative group">
                        <button
                          className={`h-9 w-full flex items-center justify-center rounded border ${
                            isCustomSelected(icon.id)
                              ? "bg-primary/20 border-primary"
                              : "border-border"
                          } hover-elevate`}
                          onClick={() =>
                            handleSelect({ customIconId: icon.id, pointStyle: undefined })
                          }
                          data-testid={`icon-custom-${icon.id}`}
                        >
                          <img
                            src={getCustomIconPreview(icon.svgContent, color)}
                            alt={icon.name}
                            className="h-6 w-6"
                          />
                        </button>
                        <button
                          className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center invisible group-hover:visible"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(icon.id);
                          }}
                          data-testid={`button-delete-icon-${icon.id}`}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">{icon.name}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </ScrollArea>
            <div className="mt-2 pt-2 border-t">
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg"
                className="hidden"
                onChange={handleFileUpload}
                data-testid="input-upload-svg"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                data-testid="button-upload-svg"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3 mr-1" />
                )}
                Загрузить SVG
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

export { getCustomIconPreview };
