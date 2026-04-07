import { useState, useEffect, useRef } from 'react';
import { type Signal } from '@workspace/api-client-react';

export function useLiveSignals(initialSignals: Signal[] = []) {
  const [signals, setSignals] = useState<Signal[]>(initialSignals);
  const [isConnected, setIsConnected] = useState(false);
  const initialized = useRef(false);

  // Sync with initial data once
  useEffect(() => {
    if (!initialized.current && initialSignals.length > 0) {
      setSignals(initialSignals);
      initialized.current = true;
    }
  }, [initialSignals]);

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
            const newSignal: Signal = parsed;
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
          // Try to reconnect after 3 seconds
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
