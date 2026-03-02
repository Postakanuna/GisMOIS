import { useState } from "react";
import { DraggableModal } from "@/components/ui/draggable-modal";
import type { SelectedFeatureData } from "@/components/map-viewer";
import { getFieldLabel } from "@shared/field-labels";
import { SensorTelemetryBlock } from "@/components/sensor-telemetry-block";
import { Activity } from "lucide-react";

interface FeatureInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: SelectedFeatureData | null;
}

export function FeatureInfoModal({ isOpen, onClose, feature }: FeatureInfoModalProps) {
  const [activeTab, setActiveTab] = useState<"attrs" | "telemetry">("attrs");

  const title = feature
    ? `Объект: ${feature.layerName}`
    : "Информация об объекте";

  const entries = feature
    ? Object.entries(feature.properties).filter(
        ([key]) => key !== "geometry" && key !== "_geometry"
      )
    : [];

  const sensorId = feature?.properties?.sensor_id;
  const hasSensorId = sensorId != null && sensorId !== "";

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      defaultWidth={500}
      defaultHeight={520}
      minWidth={340}
      minHeight={260}
    >
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="flex border-b border-border shrink-0">
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "attrs"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("attrs")}
            data-testid="tab-feature-attrs"
          >
            Атрибуты
          </button>
          <button
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "telemetry"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("telemetry")}
            data-testid="tab-feature-telemetry"
          >
            <Activity className="h-3.5 w-3.5" />
            Телеметрия
            {hasSensorId && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
            )}
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "attrs" && (
            entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-6">
                Атрибуты отсутствуют
              </div>
            ) : (
              <table className="w-full text-sm border-collapse" data-testid="feature-info-table">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b w-1/2">
                      Атрибут
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b w-1/2">
                      Значение
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([key, value], index) => (
                    <tr
                      key={key}
                      className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}
                      data-testid={`feature-info-row-${key}`}
                    >
                      <td className="px-3 py-2 font-medium text-foreground align-top break-words border-b border-border/50">
                        {getFieldLabel(key)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground align-top break-words border-b border-border/50">
                        {value === null || value === undefined
                          ? <span className="italic text-muted-foreground/60">—</span>
                          : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {activeTab === "telemetry" && (
            <div className="p-4">
              <SensorTelemetryBlock sensorId={sensorId as number | string | undefined} />
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
