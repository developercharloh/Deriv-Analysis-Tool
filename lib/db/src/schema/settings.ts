import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botSettingsTable = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  telegramGroupChatId: text("telegram_group_chat_id"),
  enableTelegram: boolean("enable_telegram").default(false).notNull(),
  selectedMarkets: text("selected_markets").default("R_100").notNull(),
  signalTypes: text("signal_types").default("OVER,UNDER,EVEN,ODD,RISE,FALL").notNull(),
  minConfidence: text("min_confidence").default("HIGH").notNull(),
  isRunning: boolean("is_running").default(false).notNull(),
  signalIntervalMinutes: integer("signal_interval_minutes").default(60).notNull(),
  preAlertEnabled: boolean("pre_alert_enabled").default(true).notNull(),
  preAlertMinutes: integer("pre_alert_minutes").default(2).notNull(),
  // Per-market bot labels (JSON: { "1HZ10V": "Bot name", ... })
  marketBots: text("market_bots"),
  // WhatsApp integration
  whatsappEnabled: boolean("whatsapp_enabled").default(false).notNull(),
  whatsappTargetJids: text("whatsapp_target_jids"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
