import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plug, PlugZap, Server, Zap, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { zuluConnectionSchema, type ZuluConnection, type ConnectionStatus } from "@shared/schema";
import { z } from "zod";

interface ConnectionFormProps {
  onConnect: (config: ZuluConnection) => Promise<void>;
  onConnectZws: () => Promise<void>;
  onConnectCustomZws: (config: ZuluConnection) => Promise<void>;
  onDisconnect: () => void;
  status: ConnectionStatus;
  error: string | null;
}

const zwsConnectionSchema = z.object({
  baseUrl: z.string().min(1, "URL сервера обязателен").refine(
    (val) => {
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Неверный формат URL (пример: https://server.example.com/zws)" }
  ),
  layerNames: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

type ZwsConnectionForm = z.infer<typeof zwsConnectionSchema>;

export function ConnectionForm({
  onConnect,
  onConnectZws,
  onConnectCustomZws,
  onDisconnect,
  status,
  error,
}: ConnectionFormProps) {
  const [showCustomZws, setShowCustomZws] = useState(false);

  const form = useForm<ZuluConnection>({
    resolver: zodResolver(zuluConnectionSchema),
    defaultValues: {
      host: "localhost",
      port: 8080,
      layerName: "",
      useWfs: false,
      useZws: false,
    },
  });

  const zwsForm = useForm<ZwsConnectionForm>({
    resolver: zodResolver(zwsConnectionSchema),
    defaultValues: {
      baseUrl: "https://",
      layerNames: "",
      username: "",
      password: "",
    },
  });

  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

  const onSubmit = async (data: ZuluConnection) => {
    await onConnect(data);
  };

  const handleQuickConnect = async () => {
    await onConnectZws();
  };

  const onZwsSubmit = async (data: ZwsConnectionForm) => {
    try {
      const url = new URL(data.baseUrl);
      const config: ZuluConnection = {
        host: url.host,
        layerName: data.layerNames || "",
        useWfs: false,
        useZws: true,
        baseUrl: data.baseUrl,
      };
      await onConnectCustomZws(config);
    } catch {
      zwsForm.setError("baseUrl", { message: "Неверный формат URL" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-sidebar-border">
        <Server className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium">Подключение к серверу</h2>
      </div>

      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">МосОблГаз (ZWS)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Быстрое подключение к is.arki.mosreg.ru
        </p>
        <Button
          type="button"
          variant="default"
          className="w-full"
          onClick={handleQuickConnect}
          disabled={isConnected || isConnecting}
          data-testid="button-quick-connect-zws"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Подключение...
            </>
          ) : (
            <>
              <Zap className="mr-2 h-4 w-4" />
              Подключиться к МосОблГаз
            </>
          )}
        </Button>
      </div>

      <Collapsible open={showCustomZws} onOpenChange={setShowCustomZws}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between"
            disabled={isConnected || isConnecting}
            data-testid="button-toggle-custom-zws"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              <span>Своё ZWS-подключение</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {showCustomZws ? "Свернуть" : "Развернуть"}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <Form {...zwsForm}>
            <form onSubmit={zwsForm.handleSubmit(onZwsSubmit)} className="space-y-3">
              <FormField
                control={zwsForm.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">URL сервера ZWS</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://server.example.com/zws"
                        {...field}
                        disabled={isConnected || isConnecting}
                        data-testid="input-zws-base-url"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Полный URL до ZWS-сервиса (например: https://is.arki.mosreg.ru/zws)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={zwsForm.control}
                name="layerNames"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Слои (необязательно)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="LAYER1, LAYER2 — оставьте пустым для всех слоёв"
                        {...field}
                        disabled={isConnected || isConnecting}
                        data-testid="input-zws-layers"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Названия слоёв через запятую. Если не указано — загрузятся все доступные слои.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={zwsForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Логин (опционально)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Имя пользователя"
                        {...field}
                        disabled={isConnected || isConnecting}
                        data-testid="input-zws-username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={zwsForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Пароль (опционально)</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Пароль"
                        {...field}
                        disabled={isConnected || isConnecting}
                        data-testid="input-zws-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={isConnecting || isConnected}
                data-testid="button-connect-custom-zws"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Подключение...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Подключиться (ZWS)
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CollapsibleContent>
      </Collapsible>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-sidebar-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-sidebar px-2 text-muted-foreground">или WMS</span>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="host"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Хост</FormLabel>
                <FormControl>
                  <Input
                    placeholder="localhost или IP-адрес"
                    {...field}
                    disabled={isConnected || isConnecting}
                    data-testid="input-host"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="port"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Порт</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="8080"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    disabled={isConnected || isConnecting}
                    data-testid="input-port"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="layerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Имя слоя</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Название слоя на сервере"
                    {...field}
                    disabled={isConnected || isConnecting}
                    data-testid="input-layer-name"
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  Оставьте пустым для загрузки всех доступных слоёв
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="useWfs"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-md border border-sidebar-border p-3">
                <div className="space-y-0.5">
                  <FormLabel className="text-sm font-medium">
                    Использовать WFS
                  </FormLabel>
                  <FormDescription className="text-xs">
                    Векторные данные вместо WMS
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isConnected || isConnecting}
                    data-testid="switch-use-wfs"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" data-testid="text-connection-error">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            {!isConnected ? (
              <Button
                type="submit"
                variant="outline"
                className="flex-1"
                disabled={isConnecting}
                data-testid="button-connect"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Подключение...
                  </>
                ) : (
                  <>
                    <Plug className="mr-2 h-4 w-4" />
                    Подключиться (WMS)
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                onClick={onDisconnect}
                data-testid="button-disconnect"
              >
                <PlugZap className="mr-2 h-4 w-4" />
                Отключиться
              </Button>
            )}
          </div>

          {isConnected && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400" data-testid="text-connection-success">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              Подключено к серверу
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
