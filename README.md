# Kaonic WebUI

The web UI of `kaonic-hub`: mesh, radio, network and device management for Kaonic
nodes, served by the node itself.

It is a static single-page app (React + TypeScript, built with Vite). The bundle
is self-contained and makes no network requests except to the hub, because the
device is expected to be offline.

## Pages

| page | what it is for |
|---|---|
| **Mesh** (home) | live 3D map of the mesh and its packets |
| **Talk** | push-to-talk to every node |
| **Nodes** | whitelist and blacklist, remote management, remote shell |
| **Network** | internet sources, Wi-Fi and hotspot |
| **Radio** | settings, traffic chart and waterfall for each of the four bands |
| **Traffic** | radio and VPN rates, frame analyser |
| **VPN** | peers, routes, internet sharing, packet capture |
| **Plugins** | install and run plugins; their pages open in the UI |
| **System** | device health, services, boot slots, kernel install, factory reset |
| **Guide** | how to use a node; readable before signing in |

## Run it

Needs Node 22.12+, 24 or 26+.

```bash
npm install
npm run dev        # http://localhost:5173, mock hub
npm run build      # static bundle in dist/, talks to the hub
npm run typecheck && npm run lint && npm test

VITE_HUB_URL=https://192.168.10.1 npm run dev   # dev server against a real hub
VITE_API=mock npm run build                     # a demo build that runs on the mock
```

The mock (`src/api/mock`) is an in-browser hub, so every screen works without a
device. It starts factory-fresh, at the setup flow. Set it up as an admin to try
the whitelist and node management. To start over, use **System -> Factory reset**.

