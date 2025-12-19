import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plug, PlugZap, Server, Zap } from "lucide-react";
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
import { zuluConnectionSchema, type ZuluConnection, type ConnectionStatus } from "@shared/schema";

interface ConnectionFormProps {
  onConnect: (config: ZuluConnection) => Promise<void>;
  onConnectZws: () => Promise<void>;
  onDisconnect: () => void;
  status: ConnectionStatus;
  error: string | null;
}

export function ConnectionForm({
  onConnect,
  onConnectZws,
  onDisconnect,
  status,
  error,
}: ConnectionFormProps) {
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

  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

  const onSubmit = async (data: ZuluConnection) => {
    await onConnect(data);
  };

  const handleQuickConnect = async () => {
    await onConnectZws();
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

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-sidebar-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-sidebar px-2 text-muted-foreground">или</span>
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
