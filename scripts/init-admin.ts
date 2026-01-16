#!/usr/bin/env tsx
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

function parseArgs(): { username: string; password: string } {
  const args = process.argv.slice(2);
  let username = "";
  let password = "";

  for (const arg of args) {
    if (arg.startsWith("--username=")) {
      username = arg.split("=")[1];
    } else if (arg.startsWith("--password=")) {
      password = arg.split("=")[1];
    }
  }

  return { username, password };
}

function printUsage(): void {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Инициализация первого администратора                 ║
╚════════════════════════════════════════════════════════════════╝

Использование:
  npm run init-admin -- --username=<имя> --password=<пароль>

Пример:
  npm run init-admin -- --username=admin --password=SecurePass123

Требования:
  • Логин: минимум 3 символа
  • Пароль: минимум 6 символов

ВАЖНО: Эта команда работает ТОЛЬКО если в системе ещё нет
       администраторов. После создания первого админа используйте
       веб-интерфейс для управления пользователями.
`);
}

async function main(): Promise<void> {
  const { username, password } = parseArgs();

  if (!username || !password) {
    printUsage();
    process.exit(1);
  }

  if (username.length < 3) {
    console.error("❌ Ошибка: логин должен содержать минимум 3 символа");
    process.exit(1);
  }

  if (password.length < 6) {
    console.error("❌ Ошибка: пароль должен содержать минимум 6 символов");
    process.exit(1);
  }

  try {
    const existingAdmins = await db
      .select()
      .from(users)
      .where(eq(users.role, "admin"));

    if (existingAdmins.length > 0) {
      console.error(`
╔════════════════════════════════════════════════════════════════╗
║                    ⚠️  ОПЕРАЦИЯ ОТКЛОНЕНА                       ║
╚════════════════════════════════════════════════════════════════╝

В системе уже есть администратор(ы): ${existingAdmins.length} шт.

Первый администратор уже был создан ранее.
Для создания дополнительных администраторов используйте
веб-интерфейс системы (Управление пользователями).

Существующие администраторы:
${existingAdmins.map(a => `  • ${a.username} (${a.firstName || ''} ${a.lastName || ''})`).join('\n')}
`);
      process.exit(1);
    }

    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (existingUser) {
      console.error(`❌ Ошибка: пользователь с логином "${username}" уже существует`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);

    const [newAdmin] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        role: "admin",
        firstName: "Администратор",
        lastName: "Системы",
      })
      .returning();

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║               ✅ АДМИНИСТРАТОР УСПЕШНО СОЗДАН                  ║
╚════════════════════════════════════════════════════════════════╝

Данные для входа:
  Логин:    ${username}
  Пароль:   ${password}
  ID:       ${newAdmin.id}

⚠️  ВАЖНО: Сохраните эти данные в надёжном месте!
    Эта команда больше не будет работать.

Теперь вы можете:
  1. Войти в систему через веб-интерфейс
  2. Создать дополнительных пользователей через панель администратора
`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Ошибка при создании администратора:", error);
    process.exit(1);
  }
}

main();
