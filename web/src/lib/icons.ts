'use client';

import {
  Bell,
  Camera,
  Car,
  Cctv,
  DoorClosed,
  Hand,
  Home,
  Landmark,
  Layers,
  MapPin,
  Plane,
  ScanLine,
  Shield,
  ShieldCheck,
  Siren,
  Store,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  cctv: Cctv,
  alarm: Siren,
  'parking-jack': Car,
  'electric-shutter': DoorClosed,
  travel: Plane,
  shop: Store,
  shield: ShieldCheck,
  plate: ScanLine,
  bell: Bell,
  siren: Siren,
  car: Car,
  users: Users,
  warehouse: Warehouse,
  insulation: Layers,
  hand: Hand,
  home: Home,
  building: Landmark,
};

/** Schema-driven icon lookup — unknown iconKeys fall back to the shield. */
export function serviceIcon(iconKey?: string | null): LucideIcon {
  if (iconKey && ICON_MAP[iconKey]) return ICON_MAP[iconKey];
  return Shield;
}

export const PILLAR_ICONS: Record<string, LucideIcon> = {
  PHYSICAL: DoorClosed,
  INTRUSION: Bell,
  MONITORING: Camera,
};

export function locationIcon(locationType: string): LucideIcon {
  switch (locationType) {
    case 'APARTMENT':
      return Landmark;
    case 'VILLA':
      return Home;
    case 'SHOP':
      return Store;
    case 'PARKING':
      return MapPin;
    case 'WAREHOUSE':
      return Warehouse;
    default:
      return Shield;
  }
}
