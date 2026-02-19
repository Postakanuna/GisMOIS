import { ArrowLeft, Server, MapPin, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectionForm } from "@/components/connection-form";
import { ApiKeysManager } from "@/components/api-keys-manager";
import { useZuluConnectionContext } from "@/contexts/zulu-connection-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { connect, connectZws, connectCustomZws, disconnect, status, error } = useZuluConnectionContext();
  const { toast } = useToast();

  const { data: providerData, isLoading: providerLoading } = useQuery<{ provider: string }>({
    queryKey: ["/api/settings/geocode-provider"],
  });

  const updateProvider = useMutation({
    mutationFn: async (provider: string) => {
      await apiRequest("PUT", "/api/settings/geocode-provider", { provider });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/geocode-provider"] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      toast({ title: "Сохранено", description: "Провайдер геокодирования обновлён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message || "Не удалось обновить настройку", variant: "destructive" });
    },
  });

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
                  onConnectCustomZws={connectCustomZws}
                  onDisconnect={disconnect}
                  status={status}
                  error={error}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Геокодирование
                </CardTitle>
                <CardDescription>
                  Выбор API-провайдера для обратного геокодирования (определение адреса по координатам)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="geocode-provider">Провайдер геокодирования</Label>
                    {providerLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Загрузка...</span>
                      </div>
                    ) : (
                      <Select
                        value={providerData?.provider || "yandex"}
                        onValueChange={(value) => updateProvider.mutate(value)}
                        disabled={updateProvider.isPending}
                      >
                        <SelectTrigger id="geocode-provider" data-testid="select-geocode-provider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yandex">Яндекс Геокодер</SelectItem>
                          <SelectItem value="dadata">DaData</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {(providerData?.provider || "yandex") === "yandex" ? (
                      <p>Яндекс Геокодер определяет адрес по координатам. Поддерживает до 40 запросов/сек. Поля: адресные ориентиры.</p>
                    ) : (
                      <p>DaData определяет адрес и ФИАС ID по координатам. Поддерживает до 10 запросов/сек. Поля: адресные ориентиры + ФИАС ID.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <ApiKeysManager />
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
