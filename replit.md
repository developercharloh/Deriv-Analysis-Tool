# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Deriv Signal Generator — an automated trading signal system that monitors Synthetic 1s Indices and Jump Indices, generates all 8 signal types (OVER/UNDER/RISE/FALL/EVEN/ODD/MATCHES/DIFFERS), and sends signals to Telegram + WhatsApp. Includes a paid subscriber management system with weekly/monthly/6-month/yearly tiers.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + Recharts + Framer Motion

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server + Deriv bot engine
│   └── deriv-signals/      # React frontend dashboard (PWA)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Features

- Live tick analysis from Deriv WebSocket API (falls back to tick simulator if WS unavailable)
- Signal types: OVER, UNDER, EVEN, ODD, RISE, FALL, MATCHES, DIFFERS
- Supported markets: 8 Synthetic 1s Indices (1HZ10V-1HZ100V) + 5 Jump Indices (JD10-JD100)
- Confidence levels: LOW, MEDIUM, HIGH
- Telegram bot integration for alert delivery (personal + group chat + subscribers)
- WhatsApp integration (Baileys-based)
- Real-time SSE stream for live dashboard updates
- Signal history stored in PostgreSQL
- Subscriber management with tiers (weekly/monthly/6-month/yearly)
- Outcome tracking with circuit breaker (3 consecutive losses → 30 min pause)
- Daily performance reports
- PWA support with service worker

## Key Backend Files

- `artifacts/api-server/src/lib/deriv.ts` — Deriv WebSocket client
- `artifacts/api-server/src/lib/analysis.ts` — Signal analysis engine (8-model ensemble)
- `artifacts/api-server/src/lib/bot.ts` — Bot orchestration + SSE broadcasting
- `artifacts/api-server/src/lib/telegram.ts` — Telegram message sender
- `artifacts/api-server/src/lib/whatsapp.ts` — WhatsApp integration (Baileys)
- `artifacts/api-server/src/lib/simulator.ts` — Tick simulator fallback
- `artifacts/api-server/src/lib/scheduler.ts` — Scheduled signal dispatch
- `artifacts/api-server/src/lib/outcome-tracker.ts` — Win/loss outcome tracking
- `artifacts/api-server/src/routes/signals.ts` — Signal + SSE routes
- `artifacts/api-server/src/routes/settings.ts` — Settings CRUD + Telegram test
- `artifacts/api-server/src/routes/subscribers.ts` — Subscriber management
- `artifacts/api-server/src/routes/status.ts` — Bot status + manual dispatch
- `artifacts/api-server/src/routes/whatsapp.ts` — WhatsApp QR + config
- `artifacts/api-server/src/routes/analysis-inspect.ts` — Analysis diagnostics

## Database Schema

- `signals` — Saved trading signals (market, symbol, digit, price, signalType, confidence, outcome)
- `bot_settings` — Bot config (telegramBotToken, chatId, selectedMarkets, signalTypes, isRunning)
- `subscribers` — Subscriber list with tier, status, expiry dates
- `subscriber_sessions` — Session tokens for subscriber access

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Routes

- `GET /api/healthz` — Health check
- `GET /api/signals?limit=N` — Signal history
- `GET /api/signals/stream` — SSE live stream
- `GET /api/settings` — Get settings
- `PUT /api/settings` — Update settings
- `POST /api/settings/test-telegram` — Test Telegram connection
- `GET /api/status` — Bot status
- `POST /api/status/dispatch` — Manual signal dispatch
- `GET /api/subscribers` — List subscribers
- `POST /api/subscribers` — Add subscriber
- `PATCH /api/subscribers/:id` — Update subscriber
- `DELETE /api/subscribers/:id` — Delete subscriber
- `GET /api/whatsapp/status` — WhatsApp QR/connection status
- `GET /api/analysis-inspect` — Analysis diagnostics snapshot
