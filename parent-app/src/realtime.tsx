import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WsClientMessage, WsServerMessage } from '@suraksha/shared';
import { refreshTokens, tokenStore, wsUrl } from './api';
import { useAuth } from './auth';

type Listener = (message: WsServerMessage) => void;

interface RealtimeValue {
  connected: boolean;
  lastMessage: WsServerMessage | null;
  send: (message: WsClientMessage) => boolean;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsServerMessage | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<Listener>());
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const send = useCallback((message: WsClientMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  useEffect(() => {
    if (status !== 'authed') return;
    closedRef.current = false;

    const clearTimers = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      timerRef.current = null;
      heartbeatRef.current = null;
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      retryRef.current = Math.min(retryRef.current + 1, 6);
      const delay = Math.min(1000 * 2 ** retryRef.current, 20_000);
      timerRef.current = window.setTimeout(connect, delay);
    };

    const connect = async () => {
      if (closedRef.current) return;
      if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;
      if (tokenStore.refresh && tokenStore.expiresAt - Date.now() < 60_000) {
        await refreshTokens();
      }
      const token = tokenStore.access;
      if (!token) return;

      const socket = new WebSocket(wsUrl(token));
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        heartbeatRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as WsServerMessage;
          setLastMessage(message);
          for (const listener of listeners.current) listener(message);
        } catch {
          // Ignore malformed frames from the relay.
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        socketRef.current = null;
        scheduleReconnect();
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    void connect();

    return () => {
      closedRef.current = true;
      clearTimers();
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [status]);

  const value = useMemo<RealtimeValue>(
    () => ({ connected, lastMessage, send, subscribe }),
    [connected, lastMessage, send, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}

export function useRealtimeMessage(handler: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((message) => ref.current(message)), [subscribe]);
}
