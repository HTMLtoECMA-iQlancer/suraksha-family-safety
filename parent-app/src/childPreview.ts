import { apiFetch } from './api';

export async function openChildPreview(deviceId?: string): Promise<void> {
  if (deviceId) {
    try {
      const result = await apiFetch<{ tokens: unknown }>('/demo/child-session', {
        method: 'POST',
        body: { deviceId },
      });
      localStorage.setItem('suraksha.childTokens', JSON.stringify(result.tokens));
    } catch {
      // Demo mode may be off; the child page falls back to the pairing flow.
    }
  }
  window.open('/child', '_blank', 'noopener');
}
