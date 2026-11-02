import { Laptop, Router, Smartphone, Waypoints, Wifi, type LucideIcon } from 'lucide-react';
import type { ConsumerId, SourceId } from '@/api';

/* Plain-language names for the things on the Network page, used wherever they appear. */

interface PortLabel {
  title: string;
  /** For tight places like the status bar. */
  short: string;
  icon: LucideIcon;
  /** What turning it on does. */
  explain: string;
}

export const SOURCE_LABELS: Record<SourceId, PortLabel> = {
  wifi_client: { title: 'Wi-Fi network', short: 'Wi-Fi', icon: Wifi, explain: 'Join a Wi-Fi network and use its internet.' },
  usb_phone: { title: 'Phone over USB', short: 'phone over USB', icon: Smartphone, explain: 'Use the mobile data of a phone plugged into the USB port.' },
  mesh_gateway: { title: 'Mesh device', short: 'mesh', icon: Waypoints, explain: 'Use the internet a whitelisted device shares over the radio.' },
};

export const CONSUMER_LABELS: Record<ConsumerId, PortLabel> = {
  hotspot: { title: 'Hotspot', short: 'Hotspot', icon: Router, explain: 'Phones and laptops connect to this device over Wi-Fi.' },
  usb_computer: { title: 'Computer over USB', short: 'USB', icon: Laptop, explain: 'A computer plugged into the USB port joins the local network.' },
  mesh_peers: { title: 'Whitelisted mesh devices', short: 'Mesh', icon: Waypoints, explain: 'Share this internet connection with whitelisted devices over the radio.' },
};
