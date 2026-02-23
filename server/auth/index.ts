import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { db } from "../db";
import { users, type SafeUser } from "@shared/models/auth";
import { eq, and } from "drizzle-orm";
import { logAction } from "../audit";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export interface AuthRequest extends Request {
  user?: SafeUser;
}

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET || "gis-mo-secret-key-change-in-production",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

export function setupAuth(app: Express): void {
  app.set("trust proxy", 1);
  app.use(getSession());
}

export async function isAuthenticated(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, req.session.userId), eq(users.isActive, "true")));

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { passwordHash, ...safeUser } = user;
  req.user = safeUser;
  next();
}

export async function isAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.username, username), eq(users.isActive, "true")));

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const { passwordHash, ...safeUser } = user;
      
      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regeneration error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        req.session.userId = user.id;
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Login failed" });
          }
          logAction({ userId: user.id, username: user.username, action: "login", entityType: "auth" });
          res.json(safeUser);
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const userId = req.session.userId;
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      if (userId) {
        logAction({ userId, action: "logout", entityType: "auth" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", isAuthenticated as any, (req: Request, res: Response) => {
    res.json((req as AuthRequest).user);
  });

  app.get("/api/profile", isAuthenticated as any, async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const [fullUser] = await db.select({
        id: users.id,
        username: users.username,
        role: users.role,
        firstName: users.firstName,
        lastName: users.lastName,
        middleName: users.middleName,
        position: users.position,
        organization: users.organization,
        phone: users.phone,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.id, authReq.user!.id));
      res.json(fullUser);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.post("/api/profile/password", isAuthenticated as any, async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Текущий и новый пароль обязательны" });
      }

      if (newPassword.length < 4) {
        return res.status(400).json({ message: "Новый пароль должен быть не менее 4 символов" });
      }

      const [userRecord] = await db.select().from(users).where(eq(users.id, authReq.user!.id));
      if (!userRecord) {
        return res.status(404).json({ message: "Пользователь не найден" });
      }

      const isValid = await verifyPassword(currentPassword, userRecord.passwordHash);
      if (!isValid) {
        return res.status(400).json({ message: "Неверный текущий пароль" });
      }

      const passwordHash = await hashPassword(newPassword);
      await db.update(users).set({ passwordHash }).where(eq(users.id, authReq.user!.id));
      logAction({ userId: authReq.user!.id, username: authReq.user!.username, action: "password_change", entityType: "user", entityId: authReq.user!.id });
      res.json({ message: "Пароль успешно изменён" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Не удалось изменить пароль" });
    }
  });

  app.get("/api/admin/users", isAuthenticated as any, isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        role: users.role,
        firstName: users.firstName,
        lastName: users.lastName,
        middleName: users.middleName,
        position: users.position,
        organization: users.organization,
        phone: users.phone,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
      }).from(users);
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", isAuthenticated as any, isAdmin as any, async (req: Request, res: Response) => {
    try {
      const { username, password, role, firstName, lastName, middleName, position, organization, phone, email } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
      }

      const [existing] = await db.select().from(users).where(eq(users.username, username));
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const passwordHash = await hashPassword(password);
      const [newUser] = await db.insert(users).values({
        username,
        passwordHash,
        role: role || "user",
        firstName,
        lastName,
        middleName,
        position,
        organization,
        phone,
        email,
      }).returning();

      const { passwordHash: _, ...safeUser } = newUser;
      const authReq = req as AuthRequest;
      logAction({ userId: authReq.user?.id, username: authReq.user?.username, action: "user_create", entityType: "user", entityId: newUser.id, details: { newUsername: username, role: role || "user" } });
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.delete("/api/admin/users/:id", isAuthenticated as any, isAdmin as any, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const authReq = req as AuthRequest;

      if (id === authReq.user?.id) {
        return res.status(400).json({ message: "Cannot delete yourself" });
      }

      await db.update(users).set({ isActive: "false" }).where(eq(users.id, id));
      logAction({ userId: authReq.user?.id, username: authReq.user?.username, action: "user_deactivate", entityType: "user", entityId: id });
      res.json({ message: "User deactivated" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.patch("/api/admin/users/:id/password", isAuthenticated as any, isAdmin as any, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({ message: "Password required" });
      }

      const passwordHash = await hashPassword(password);
      await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
      const authReq = req as AuthRequest;
      logAction({ userId: authReq.user?.id, username: authReq.user?.username, action: "password_reset", entityType: "user", entityId: id, details: { targetUserId: id } });
      res.json({ message: "Password updated" });
    } catch (error) {
      console.error("Error updating password:", error);
      res.status(500).json({ message: "Failed to update password" });
    }
  });

  app.patch("/api/admin/users/:id", isAuthenticated as any, isAdmin as any, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { username, role, firstName, lastName, middleName, position, organization, phone, email } = req.body;

      if (!username) {
        return res.status(400).json({ message: "Username is required" });
      }

      const [existing] = await db.select().from(users).where(eq(users.username, username));
      if (existing && existing.id !== id) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const [updated] = await db.update(users).set({
        username,
        role: role || "user",
        firstName: firstName || null,
        lastName: lastName || null,
        middleName: middleName || null,
        position: position || null,
        organization: organization || null,
        phone: phone || null,
        email: email || null,
        updatedAt: new Date(),
      }).where(eq(users.id, id)).returning();

      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      const { passwordHash: _, ...safeUser } = updated;
      const authReq = req as AuthRequest;
      logAction({ userId: authReq.user?.id, username: authReq.user?.username, action: "user_update", entityType: "user", entityId: id, details: { updatedUsername: username } });
      res.json(safeUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });
}

export async function seedAdminUser(): Promise<void> {
  const admins = await db.select().from(users).where(eq(users.role, "admin"));
  if (admins.length === 0) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║          ⚠️  ВНИМАНИЕ: Администратор не найден!                 ║
╚════════════════════════════════════════════════════════════════╝

Для создания первого администратора выполните команду:

  npx tsx scripts/init-admin.ts -- --username=<логин> --password=<пароль>

Пример:
  npx tsx scripts/init-admin.ts -- --username=admin --password=SecurePass123

`);
  }
}
