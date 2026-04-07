import { pgTable, serial, text, integer, real, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalTypeEnum = pgEnum("signal_type", ["OVER", "UNDER", "EVEN", "ODD", "RISE", "FALL", "MATCHES", "DIFFERS"]);
export const confidenceEnum = pgEnum("confidence_level", ["LOW", "MEDIUM", "HIGH"]);
export const outcomeEnum = pgEnum("signal_outcome", ["pending", "won", "lost", "expired", "cancelled"]);

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  market: text("market").notNull(),
  symbol: text("symbol").notNull(),
  digit: integer("digit").notNull(),
  price: real("price").notNull(),
  signalType: signalTypeEnum("signal_type").notNull(),
  confidence: confidenceEnum("confidence").notNull(),
  predictionDigit: integer("prediction_digit"),
  entryDigit: integer("entry_digit"),
  // Win-rate tracking
  outcome: outcomeEnum("outcome").default("pending"),
  validityMinutes: integer("validity_minutes"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;

// ── Subscribers ────────────────────────────────────────────────────────────────

export const subscriptionTierEnum = pgEnum("subscription_tier", ["weekly", "monthly", "6months", "yearly"]);
export const subscriberStatusEnum = pgEnum("subscriber_status", ["active", "expired", "suspended"]);

export const subscribersTable = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  telegramChatId: text("telegram_chat_id"),
  whatsappJid: text("whatsapp_jid"),
  tier: subscriptionTierEnum("tier").notNull(),
  status: subscriberStatusEnum("status").default("active").notNull(),
  startDate: timestamp("start_date").defaultNow().notNull(),
  endDate: timestamp("end_date").notNull(),
  notes: text("notes"),
  receivePreAlert: boolean("receive_pre_alert").default(true).notNull(),
  accessKey: text("access_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Subscriber = typeof subscribersTable.$inferSelect;
export type InsertSubscriber = typeof subscribersTable.$inferInsert;

// ── Subscriber Sessions ─────────────────────────────────────────────────────

export const subscriberSessionsTable = pgTable("subscriber_sessions", {
  id: serial("id").primaryKey(),
  subscriberId: integer("subscriber_id").notNull().references(() => subscribersTable.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  sessionToken: text("session_token").notNull().unique(),
  deviceName: text("device_name"),
  ipAddress: text("ip_address"),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const subscribersRelations = relations(subscribersTable, ({ many }) => ({
  sessions: many(subscriberSessionsTable),
}));

export const sessionsRelations = relations(subscriberSessionsTable, ({ one }) => ({
  subscriber: one(subscribersTable, { fields: [subscriberSessionsTable.subscriberId], references: [subscribersTable.id] }),
}));

export type SubscriberSession = typeof subscriberSessionsTable.$inferSelect;
