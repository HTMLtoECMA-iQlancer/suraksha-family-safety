import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Geofence } from '@suraksha/shared';

const DEFAULT_CENTER: [number, number] = [23.03, 72.58];

export interface MapPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  label?: string;
  emphasis?: boolean;
}

interface MapViewProps {
  center?: { lat: number; lng: number } | null;
  points?: MapPoint[];
  geofences?: Geofence[];
  height?: number;
  interactive?: boolean;
  zoom?: number;
  className?: string;
}

export function MapView({
  center,
  points = [],
  geofences = [],
  height = 280,
  interactive = true,
  zoom = 15,
  className = '',
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const start: [number, number] = center ? [center.lat, center.lng] : DEFAULT_CENTER;
    const map = L.map(hostRef.current, {
      center: start,
      zoom,
      zoomControl: interactive,
      scrollWheelZoom: false,
      dragging: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      keyboard: interactive,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const fence of geofences) {
      if (!fence.enabled) continue;
      L.circle([fence.lat, fence.lng], {
        radius: fence.radiusM,
        color: '#2563eb',
        weight: 1.5,
        fillColor: '#3b82f6',
        fillOpacity: 0.09,
        dashArray: '5 5',
      }).addTo(layer);
    }

    if (points.length > 1) {
      L.polyline(
        points.map((point) => [point.lat, point.lng] as [number, number]),
        { color: '#2563eb', weight: 3, opacity: 0.45, smoothFactor: 0.5 },
      ).addTo(layer);
    }

    points.forEach((point, index) => {
      const latest = index === points.length - 1;
      if (latest && point.accuracy && point.accuracy > 5) {
        L.circle([point.lat, point.lng], {
          radius: Math.min(point.accuracy, 400),
          color: '#3b82f6',
          weight: 1,
          opacity: 0.4,
          fillColor: '#60a5fa',
          fillOpacity: 0.12,
        }).addTo(layer);
      }
      L.circleMarker([point.lat, point.lng], {
        radius: latest ? 8 : 4,
        color: '#ffffff',
        weight: latest ? 3 : 1.5,
        fillColor: latest ? '#1d4ed8' : '#60a5fa',
        fillOpacity: 1,
      }).addTo(layer);
    });

    const target = points.length ? points[points.length - 1] : center;
    if (points.length > 1) {
      const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.25), { maxZoom: 16, animate: false });
    } else if (target) {
      map.setView([target.lat, target.lng], Math.max(map.getZoom(), 15), { animate: false });
    }
  }, [points, geofences, center]);

  return <div ref={hostRef} className={`map ${className}`.trim()} style={{ height }} role="img" aria-label="Map" />;
}
