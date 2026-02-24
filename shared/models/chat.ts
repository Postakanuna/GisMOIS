import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const aiProviders = pgTable("ai_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  apiKey: text("api_key"),
  model: text("model"),
  isActive: boolean("is_active").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertAiProviderSchema = createInsertSchema(aiProviders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateAiProviderSchema = z.object({
  name: z.string().optional(),
  baseUrl: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type AiProvider = typeof aiProviders.$inferSelect;
export type InsertAiProvider = z.infer<typeof insertAiProviderSchema>;
export type UpdateAiProvider = z.infer<typeof updateAiProviderSchema>;

