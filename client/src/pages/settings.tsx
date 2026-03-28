import { useState } from "react";
import { ArrowLeft, Settings as SettingsIcon, Bug, Info } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

type SettingsTab = "general" | "debug";

function useDebugSettings() {
  const [showLayerOverlay, setShowLayerOverlay] = useState(() => {
    try { return localStorage.getItem("debug_layer_overlay") === "1"; } catch { return false; }
  });

  const toggleLayerOverlay = (val: boolean) => {
    setShowLayerOverlay(val);
    try { localStorage.setItem("debug_layer_overlay", val ? "1" : "0"); } catch {}
    window.dispatchEvent(new CustomEvent("debug-settings-changed"));
  };

  return { showLayerOverlay, toggleLayerOverlay };
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const debug = useDebugSettings();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex items-center gap-2">
          <Link href="/gis/app">
            <Button variant="ghost" size="icon" data-testid="button-back-to-map">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold">Настройки</span>
          </div>
        </div>
      </header>

      <div className="flex">
        <nav className="w-56 border-r min-h-[calc(100vh-3.5rem)] p-3 space-y-1">
          <button
            onClick={() => setActiveTab("general")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${activeTab === "general" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
            data-testid="tab-general"
          >
            <Info className="h-4 w-4" />
            Общие
          </button>
          <button
            onClick={() => setActiveTab("debug")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${activeTab === "debug" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
            data-testid="tab-debug"
          >
            <Bug className="h-4 w-4" />
            Режим отладки
          </button>
        </nav>

        <main className="flex-1 px-6 py-6">
          {activeTab === "general" && (
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-lg font-medium mb-2">Подсказки</h3>
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>• Подключение к серверу ГИС Zulu доступно в <strong>Менеджере данных → Подключения</strong></p>
                  <p>• Настройки геокодирования и API-ключи доступны администратору на <strong>странице «Сцены»</strong></p>
                  <p>• Проекция карты настраивается в <strong>Менеджере данных → Настройки</strong></p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "debug" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-1">Режим отладки</h3>
                <p className="text-sm text-muted-foreground">Инструменты диагностики для разработчиков</p>
              </div>

              <div className="rounded-lg border bg-card p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Диагностика слоёв на карте</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Показывает оверлей с информацией о загруженных слоях, количестве объектов, состоянии загрузки и проекции</p>
                  </div>
                  <button
                    onClick={() => debug.toggleLayerOverlay(!debug.showLayerOverlay)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${debug.showLayerOverlay ? "bg-primary" : "bg-input"}`}
                    role="switch"
                    aria-checked={debug.showLayerOverlay}
                    data-testid="toggle-debug-layer-overlay"
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${debug.showLayerOverlay ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
