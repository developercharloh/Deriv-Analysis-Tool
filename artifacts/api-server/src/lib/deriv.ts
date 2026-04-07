import WebSocket from "ws";
import { logger } from "./logger.js";

export interface DerivTick {
  symbol: string;
  price: number;
  digit: number;
  epoch: number;
}

type TickHandler = (tick: DerivTick) => void;

const DERIV_WS_URL = "wss://ws.deriv.com/websockets/v3?app_id=1089";

const MARKET_NAMES: Record<string, string> = {
  R_10: "Volatility 10",
  R_25: "Volatility 25",
  R_50: "Volatility 50",
  R_75: "Volatility 75",
  R_100: "Volatility 100",
  RDBULL: "Boom 1000",
  RDBEAR: "Crash 1000",
  stpRNG: "Step Index",
  "1HZ10V":  "Volatility 10 (1s)",
  "1HZ15V":  "Volatility 15 (1s)",
  "1HZ25V":  "Volatility 25 (1s)",
  "1HZ30V":  "Volatility 30 (1s)",
  "1HZ50V":  "Volatility 50 (1s)",
  "1HZ75V":  "Volatility 75 (1s)",
  "1HZ90V":  "Volatility 90 (1s)",
  "1HZ100V": "Volatility 100 (1s)",
  "JD10":    "Jump 10 Index",
  "JD25":    "Jump 25 Index",
  "JD50":    "Jump 50 Index",
  "JD75":    "Jump 75 Index",
  "JD100":   "Jump 100 Index",
};

export function getMarketName(symbol: string): string {
  return MARKET_NAMES[symbol] || symbol;
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private tickHandlers: Map<string, Set<TickHandler>> = new Map();
  private subscribedSymbols: Set<string> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
  private permanentlyFailed = false;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    logger.info("Connecting to Deriv WebSocket");
    this.ws = new WebSocket(DERIV_WS_URL);

    this.ws.on("open", () => {
      this.isConnected = true;
      logger.info("Connected to Deriv WebSocket");
      this.resubscribeAll();
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ ping: 1 }));
        }
      }, 30000);
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.msg_type === "tick" && msg.tick) {
          const tick = msg.tick;
          const priceStr = tick.quote?.toString() || "0";
          const priceDigit = parseInt(priceStr.slice(-1));
          const derivTick: DerivTick = {
            symbol: tick.symbol,
            price: tick.quote,
            digit: priceDigit,
            epoch: tick.epoch,
          };
          const handlers = this.tickHandlers.get(tick.symbol);
          if (handlers) {
            handlers.forEach((h) => h(derivTick));
          }
        }
      } catch (err) {
        logger.error({ err }, "Error parsing Deriv message");
      }
    });

    this.ws.on("close", () => {
      this.isConnected = false;
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      logger.warn("Deriv WebSocket disconnected, scheduling reconnect");
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.error({ err }, "Deriv WebSocket error");
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.permanentlyFailed) return;
    this.retryCount++;
    if (this.retryCount > this.MAX_RETRIES) {
      this.permanentlyFailed = true;
      logger.warn("Deriv WebSocket unreachable after max retries — using simulator only");
      return;
    }
    const delay = Math.min(5000 * this.retryCount, 30000);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  isPermanentlyFailed(): boolean {
    return this.permanentlyFailed;
  }

  private resubscribeAll(): void {
    for (const symbol of this.subscribedSymbols) {
      this.subscribeToSymbol(symbol);
    }
  }

  private subscribeToSymbol(symbol: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          ticks: symbol,
          subscribe: 1,
        })
      );
    }
  }

  private unsubscribeFromSymbol(symbol: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          forget_all: "ticks",
          ticks: symbol,
        })
      );
    }
  }

  onTick(symbol: string, handler: TickHandler): void {
    if (!this.tickHandlers.has(symbol)) {
      this.tickHandlers.set(symbol, new Set());
    }
    this.tickHandlers.get(symbol)!.add(handler);

    if (!this.subscribedSymbols.has(symbol)) {
      this.subscribedSymbols.add(symbol);
      if (this.isConnected) {
        this.subscribeToSymbol(symbol);
      }
    }
  }

  offTick(symbol: string, handler: TickHandler): void {
    const handlers = this.tickHandlers.get(symbol);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.tickHandlers.delete(symbol);
        this.subscribedSymbols.delete(symbol);
        this.unsubscribeFromSymbol(symbol);
      }
    }
  }

  updateSubscriptions(symbols: string[]): void {
    const newSymbols = new Set(symbols);
    for (const sym of this.subscribedSymbols) {
      if (!newSymbols.has(sym)) {
        this.subscribedSymbols.delete(sym);
        this.unsubscribeFromSymbol(sym);
      }
    }
    for (const sym of newSymbols) {
      if (!this.subscribedSymbols.has(sym)) {
        this.subscribedSymbols.add(sym);
        if (this.isConnected) this.subscribeToSymbol(sym);
      }
    }
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export const derivClient = new DerivClient();
