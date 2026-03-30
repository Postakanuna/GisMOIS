import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Вариант Б: перехватывать ошибки пула на уровне соединения.
// Без этого обработчика ошибка TLS-сокета (например, разрыв соединения с БД
// во время длительной блокировки event loop) поднимается как unhandled 'error'
// event и убивает процесс.
pool.on("error", (err) => {
  console.error("[DB Pool] Idle client error:", err.message);
});
