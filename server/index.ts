import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startAuditCleanup } from "./audit";
import { startSensorPolling } from "./sensor-sync";
import { refreshFieldLabelsCache } from "./field-labels-cache";
import { seedFieldLabelsIfEmpty } from "./seed-field-labels";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({ contentSecurityPolicy: false }));

app.use(
  express.json({
    limit: "100mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "100mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Seed field labels dictionary if production DB is empty
  await seedFieldLabelsIfEmpty();

  // Load field labels from DB into server cache
  try {
    await refreshFieldLabelsCache();
    log("Field labels cache loaded from DB", "init");
  } catch (err: any) {
    log(`Field labels cache warning: ${err.message}`, "init");
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error("[UnhandledError]", err.message || err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const isWindows = process.platform === "win32";
  const host = isWindows ? "127.0.0.1" : "0.0.0.0";
  
  const listenOptions: any = { port, host };
  if (!isWindows) {
    listenOptions.reusePort = true;
  }
  
  httpServer.listen(listenOptions, () => {
    log(`serving on port ${port}`);
    startAuditCleanup();
    startSensorPolling().catch(err => {
      log(`Sensor polling init error: ${err.message}`, "sensor-sync");
    });
  });

  const shutdown = () => {
    log("Shutting down gracefully...");
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
