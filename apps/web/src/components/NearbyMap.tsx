'use client';

// Real tile map for /map — Leaflet + OpenStreetMap tiles (free, no API key). Client-only
// (Leaflet touches `window`). Renders one marker per discovery result with a popup; the
// origin gets its own marker. Auto-fits the viewport to all points.

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  id: string;
  kind: 'job' | 'shop' | 'group';
  title: string;
  lat: number;
  lng: number;
  distanceM: number;
}

const KIND_EMOJI = { job: '🧰', shop: '🏪', group: '🏘️' } as const;

// Emoji divIcon so pins read by category without shipping image assets (and sidesteps
// the classic Leaflet "marker icon 404 under bundlers" issue entirely).
function pin(emoji: string, ring: string) {
  return L.divIcon({
    className: 'leaflet-emoji-pin',
    html: `<div style="font-size:22px;line-height:34px;text-align:center;width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.3)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function FitBounds({ points, origin }: { points: MapPoint[]; origin: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [origin, ...points.map((p) => [p.lat, p.lng] as [number, number])];
    if (pts.length > 1) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView(origin, 13);
    }
  }, [map, points, origin]);
  return null;
}

const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export function NearbyMap({ points, origin }: { points: MapPoint[]; origin: { lat: number; lng: number } }) {
  // Loaded via next/dynamic({ ssr: false }) from MapClient, so this only ever runs in the
  // browser — safe to touch Leaflet directly.
  const o: [number, number] = [origin.lat, origin.lng];
  return (
    <MapContainer center={o} zoom={13} scrollWheelZoom style={{ height: '70vh', width: '100%', borderRadius: 12 }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} origin={o} />
      <Marker position={o} icon={pin('📍', '#1f7a4d')}>
        <Popup>You — Mingora Bazaar</Popup>
      </Marker>
      {points.map((p) => (
        <Marker key={`${p.kind}:${p.id}`} position={[p.lat, p.lng]} icon={pin(KIND_EMOJI[p.kind], '#c2873a')}>
          <Popup>
            <strong>{p.title}</strong>
            <br />
            {p.kind} · {km(p.distanceM)}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
