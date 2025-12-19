import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plug, PlugZap, Server } from "lucide-react";
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
  onDisconnect: () => void;
  status: ConnectionStatus;
  error: string | null;
}

export function ConnectionForm({
  onConnect,
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
    },
  });

  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

  const onSubmit = async (data: ZuluConnection) => {
    await onConnect(data);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-sidebar-border">
        <Server className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium">Подключение к серверу</h2>
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
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
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
                    Подключиться
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
