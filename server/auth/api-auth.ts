import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { storage } from "../storage";
import { users } from "@shared/models/auth";
import { db } from "../db";
import { eq } from "drizzle-orm";
import type { ApiKey, ApiKeyPermission } from "@shared/schema";

export interface ApiAuthenticatedRequest extends Request {
  apiKey?: ApiKey;
  apiUser?: {
    id: string;
    username: string;
    role: string;
  };
}

export function generateApiToken(): string {
  return `gis_${crypto.randomBytes(32).toString("hex")}`;
}

export async function hashApiToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

export async function verifyApiToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

export function isApiAuthenticated(requiredPermission?: ApiKeyPermission) {
  return async (req: ApiAuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ 
        error: "Unauthorized", 
        message: "Bearer token required" 
      });
    }

    const token = authHeader.substring(7);
    
    if (!token.startsWith("gis_")) {
      return res.status(401).json({ 
        error: "Unauthorized", 
        message: "Invalid token format" 
      });
    }

    try {
      const allKeys = await db.select().from(
        (await import("@shared/schema")).apiKeys
      );
      
      let matchedKey: ApiKey | undefined;
      for (const key of allKeys) {
        if (key.isActive === 1) {
          const isValid = await verifyApiToken(token, key.tokenHash);
          if (isValid) {
            matchedKey = key;
            break;
          }
        }
      }

      if (!matchedKey) {
        return res.status(401).json({ 
          error: "Unauthorized", 
          message: "Invalid or revoked token" 
        });
      }

      if (requiredPermission) {
        const permissions = matchedKey.permissions as string[];
        if (!permissions.includes(requiredPermission)) {
          return res.status(403).json({ 
            error: "Forbidden", 
            message: `Missing permission: ${requiredPermission}` 
          });
        }
      }

      const [user] = await db.select().from(users).where(eq(users.id, matchedKey.userId));
      if (!user || user.isActive !== "true") {
        return res.status(401).json({ 
          error: "Unauthorized", 
          message: "User account is disabled" 
        });
      }

      await storage.updateApiKeyLastUsed(matchedKey.id);

      req.apiKey = matchedKey;
      req.apiUser = {
        id: user.id,
        username: user.username,
        role: user.role,
      };

      next();
    } catch (error) {
      console.error("API auth error:", error);
      return res.status(500).json({ 
        error: "Internal Server Error", 
        message: "Authentication failed" 
      });
    }
  };
}
