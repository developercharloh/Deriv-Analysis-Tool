import { useState, useEffect, useRef } from 'react';
import { type Signal } from '@workspace/api-client-react';

const VALIDITY_SECONDS = 600; // 10-minute default validity window

function isExpired(signal: Signal): boolean {
  // Prefer the server-set expiresAt; fall back to createdAt + 600 s
  const expiryMs = signal.expiresAt
    ? new Date(signal.expiresAt).getTime()
    : new Date(signal.createdAt).getTime() + VALIDITY_SECONDS * 1000;
  return Date.now() >= expiryMs;
}

function isActive(signal: Signal): boolean {
  return !isExpired(signal) && signal.outcome !== 'cancelled';
}

export function useLiveSignals(initialSignals: Signal[] = []) {
  const [signals, setSignals] = useState<Signal[]>(() =>
    initialSignals.filter(isActive)
  );
  const [isConnected, setIsConnected] = useState(false);
  const initialized = useRef(false);

  // Sync with initial data once (filtering already-expired / cancelled entries)
  useEffect(() => {
    if (!initialized.current && initialSignals.length > 0) {
      setSignals(initialSignals.filter(isActive));
      initialized.current = true;
    }
  }, [initialSignals]);

  // Periodic cleanup: every 15 s remove any signal that has now expired or been cancelled
  useEffect(() => {
    const id = setInterval(() => {
      setSignals(prev => {
        const next = prev.filter(isActive);
        return next.length === prev.length ? prev : next;
      });
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: number;

    const connect = () => {
      try {
        eventSource = new EventSource('/api/signals/stream');

        eventSource.onopen = () => {
          setIsConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === 'connected') return;

            // Signal cancelled — remove it from the live feed immediately
            if (parsed.type === 'signal_cancelled') {
              setSignals(prev => prev.filter(s => s.id !== parsed.id));
              return;
            }

            const newSignal: Signal = parsed;
            // Only add the signal if it hasn't already expired
            if (isExpired(newSignal)) return;
            setSignals((prev) => {
              if (prev.some(s => s.id === newSignal.id)) return prev;
              return [newSignal, ...prev].slice(0, 100);
            });
          } catch (e) {
            console.error('[SSE] Failed to parse signal data:', e);
          }
        };

        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource?.close();
          reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch (err) {
        console.error('[SSE] Connection error:', err);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  return { signals, isConnected };
}
