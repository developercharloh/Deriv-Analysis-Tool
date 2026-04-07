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
  // WhatsApp — Baileys (QR-based)
  whatsappEnabled: boolean("whatsapp_enabled").default(false).notNull(),
  whatsappTargetJids: text("whatsapp_target_jids"),
  // WhatsApp — Meta Cloud API (no QR)
  waCloudEnabled: boolean("wa_cloud_enabled").default(false).notNull(),
  waCloudPhoneNumberId: text("wa_cloud_phone_number_id"),
  waCloudAccessToken: text("wa_cloud_access_token"),
  waCloudRecipients: text("wa_cloud_recipients"), // comma-separated E.164 numbers e.g. 2547XXXXXXXX
  // WhatsApp — CallMeBot (no QR, personal)
  callmebotEnabled: boolean("callmebot_enabled").default(false).notNull(),
  callmebotPhone: text("callmebot_phone"),
  callmebotApiKey: text("callmebot_api_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
