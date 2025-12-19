import { ArrowLeft, Server } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectionForm } from "@/components/connection-form";
import { useZuluConnectionContext } from "@/contexts/zulu-connection-context";

export default function Settings() {
  const { connect, connectZws, disconnect, status, error } = useZuluConnectionContext();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-to-map">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold">Настройки</span>
          </div>
        </div>

        <ThemeToggle />
      </header>

      <main className="container max-w-2xl py-6">
        <ScrollArea className="h-[calc(100vh-5rem)]">
          <div className="space-y-6 px-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Подключение к серверу
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ConnectionForm
                  onConnect={connect}
                  onConnectZws={connectZws}
                  onDisconnect={disconnect}
                  status={status}
                  error={error}
                />
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
