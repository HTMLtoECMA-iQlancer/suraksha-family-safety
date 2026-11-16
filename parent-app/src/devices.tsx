import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Device } from '@suraksha/shared';
import { apiFetch } from './api';
import type { DevicesResponse } from './api';
import { useAuth } from './auth';
import { useRealtime, useRealtimeMessage } from './realtime';

interface DevicesValue {
  devices: Device[];
  selected: Device | null;
  selectedId: string | null;
  select: (id: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateDevice: (id: string, patch: Partial<Device>) => void;
}

const DevicesContext = createContext<DevicesValue | null>(null);

function storageKey(familyId: string) {
  return `suraksha.device.${familyId}`;
}

export function DevicesProvider({ children }: { children: ReactNode }) {
  const { status, family } = useAuth();
  const { connected } = useRealtime();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (status !== 'authed' || !family) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<DevicesResponse>(`/families/${family.id}/devices`);
      setDevices(data.devices);
      setError(null);
      setSelectedId((current) => {
        const stored = current ?? localStorage.getItem(storageKey(family.id));
        if (stored && data.devices.some((device) => device.id === stored)) return stored;
        return data.devices[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load devices');
    } finally {
      setLoading(false);
    }
  }, [status, family]);

  useEffect(() => {
    if (status !== 'authed' || !family) {
      setDevices([]);
      setSelectedId(null);
      setLoading(status === 'loading');
      return;
    }
    setLoading(true);
    void refresh();
  }, [status, family, refresh]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  useEffect(() => {
    if (!family || !selectedId) return;
    localStorage.setItem(storageKey(family.id), selectedId);
  }, [family, selectedId]);

  useRealtimeMessage((message) => {
    if (message.type === 'device.status') {
      const { deviceId, online, battery, network, lastSeenAt } = message.data;
      setDevices((prev) =>
        prev.map((device) =>
          device.id === deviceId
            ? {
                ...device,
                online,
                status: online ? 'online' : 'offline',
                battery: battery ?? device.battery,
                network: network ?? device.network,
                lastSeenAt: lastSeenAt ?? device.lastSeenAt,
              }
            : device,
        ),
      );
    }
    if (message.type === 'device.unlinked') {
      setDevices((prev) => prev.filter((device) => device.id !== message.data.deviceId));
    }
    if (message.type === 'family.changed' || message.type === 'policy.updated') {
      void refresh();
    }
  });

  const select = useCallback((id: string) => setSelectedId(id), []);

  const updateDevice = useCallback((id: string, patch: Partial<Device>) => {
    setDevices((prev) => prev.map((device) => (device.id === id ? { ...device, ...patch } : device)));
  }, []);

  const selected = useMemo(
    () => devices.find((device) => device.id === selectedId) ?? devices[0] ?? null,
    [devices, selectedId],
  );

  useEffect(() => {
    if (!selected && devices[0]) setSelectedId(devices[0].id);
  }, [selected, devices]);

  const value = useMemo<DevicesValue>(
    () => ({
      devices,
      selected,
      selectedId: selected?.id ?? null,
      select,
      loading,
      error,
      refresh,
      updateDevice,
    }),
    [devices, selected, select, loading, error, refresh, updateDevice],
  );

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
}

export function useDevices(): DevicesValue {
  const ctx = useContext(DevicesContext);
  if (!ctx) throw new Error('useDevices must be used inside DevicesProvider');
  return ctx;
}
