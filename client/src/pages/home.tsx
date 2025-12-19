import { useState } from "react";
import { Map, Settings, Layers, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectionForm } from "@/components/connection-form";
import { LayerPanel } from "@/components/layer-panel";
import { MapViewer } from "@/components/map-viewer";
import { useZuluConnection } from "@/hooks/use-zulu-connection";
import type { ConnectionStatus } from "@shared/schema";

function SidebarContentPanel({
  connection,
  status,
  layers,
  error,
  connect,
  disconnect,
  toggleLayerVisibility,
  setLayerOpacity,
}: ReturnType<typeof useZuluConnection>) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        <ConnectionForm
          onConnect={connect}
          onDisconnect={disconnect}
          status={status}
          error={error}
        />

        <LayerPanel
          layers={layers}
          onToggleVisibility={toggleLayerVisibility}
          onOpacityChange={setLayerOpacity}
        />
      </div>
    </ScrollArea>
  );
}

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const statusConfig = {
    disconnected: { color: "bg-muted-foreground", text: "Не подключено" },
    connecting: { color: "bg-yellow-500 animate-pulse", text: "Подключение..." },
    connected: { color: "bg-green-500", text: "Подключено" },
    error: { color: "bg-destructive", text: "Ошибка" },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2" data-testid="connection-status-badge">
      <div className={`h-2 w-2 rounded-full ${config.color}`} />
      <span className="text-xs text-muted-foreground hidden sm:inline">
        {config.text}
      </span>
    </div>
  );
}

export default function Home() {
  const zuluConnection = useZuluConnection();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const sidebarStyle = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar className="hidden md:flex border-r border-sidebar-border">
          <SidebarHeader className="flex flex-row items-center justify-between gap-2 border-b border-sidebar-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                <Map className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-semibold">GIS ZULU Web</h1>
                <p className="text-xs text-muted-foreground">ZuluServer Client</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarContentPanel {...zuluConnection} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-1 flex-col min-w-0">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="hidden md:flex" data-testid="button-sidebar-toggle" />

              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="md:hidden"
                    data-testid="button-mobile-menu"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80 p-0">
                  <div className="flex items-center gap-2 border-b px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                      <Map className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div>
                      <h1 className="text-sm font-semibold">GIS ZULU Web</h1>
                      <p className="text-xs text-muted-foreground">ZuluServer Client</p>
                    </div>
                  </div>
                  <SidebarContentPanel {...zuluConnection} />
                </SheetContent>
              </Sheet>

              <div className="flex items-center gap-2 md:hidden">
                <Map className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold">GIS ZULU</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ConnectionStatusBadge status={zuluConnection.status} />
              <div className="h-4 w-px bg-border" />
              <ThemeToggle />
            </div>
          </header>

          <main className="relative flex-1 overflow-hidden">
            <MapViewer
              layers={zuluConnection.layers}
              connection={zuluConnection.connection}
              isConnected={zuluConnection.status === "connected"}
            />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
