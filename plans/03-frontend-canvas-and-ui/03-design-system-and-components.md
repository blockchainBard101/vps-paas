# 03. Design System, Theme Tokens & Component Specifications

Railway's aesthetic is celebrated for its deep dark mode, razor-sharp typography, glassmorphism, and responsive micro-animations. This document sets out the design tokens and layout foundations for our PaaS dashboard.

---

## 1. Color Palette & Theme Tokens

We use a curated Zinc palette with focused functional accents:

```css
/* Core Palette Tokens */
:root {
  /* Surfaces */
  --bg-canvas: #09090b;        /* Zinc 950 (Canvas background) */
  --bg-surface: #121215;       /* Slightly lighter layer for cards/nodes */
  --bg-surface-elevated: #18181b; /* Zinc 900 (Dropdowns, modals) */
  
  /* Borders */
  --border-subtle: #27272a;    /* Zinc 800 */
  --border-muted: #1f1f23;     /* Zinc 850 */
  --border-focus: #6366f1;     /* Indigo 500 */
  
  /* Functional Accents */
  --accent-database: #818cf8;  /* Indigo 400 (PostgreSQL & storage) */
  --accent-web: #34d399;       /* Emerald 400 (Web applications) */
  --accent-worker: #a78bfa;    /* Violet 400 (Background queues) */
  --accent-redis: #f87171;     /* Rose 400 (Key-value cache) */
  --accent-routing: #38bdf8;   /* Sky 400 (Caddy edge proxy) */

  /* Status Colors */
  --status-healthy: #10b981;   /* Emerald 500 */
  --status-building: #f59e0b;  /* Amber 500 */
  --status-failed: #ef4444;    /* Red 500 */
  --status-sleeping: #71717a;  /* Zinc 500 */
}
```

---

## 2. Canvas Background Styling

The canvas features a subtle, glowing dot pattern and radial ambient background:

```css
/* Interactive Canvas Grid */
.railway-canvas {
  background-color: var(--bg-canvas);
  background-image: 
    radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.04) 0%, transparent 60%),
    radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 100% 100%, 24px 24px;
}
```

---

## 3. Global Navigation & Layout Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [Logo: PAAS] / [Acme Org] / [E-Commerce ▼] | [Env: Production ▼]  |  [⌘K Search...]    │
│                                            | [Active Deployments: 3] [RAM: 480MB/8GB]  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [Toggle: 🎨 Canvas | 📋 List]    [Zoom Controls]      [+ New Service]  [Project Settings]│
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│                                                                                        │
│                               INTERACTIVE CANVAS VIEW                                  │
│                                                                                        │
│                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ⚡ api-backend: [Deploying v4...] █ [Open Terminal (xterm)]         [Status: Healthy]  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Slide-Over Service Inspector Drawer

When a developer clicks on any node on the canvas (e.g. `api-backend` or `postgres`), a sleek slide-over drawer animates from the right side of the screen (`w-[640px]`):

### Tabs in the Service Inspector Drawer:
1. **Overview**: Status, image name, exposed domains, recent deployment timeline, resource gauges.
2. **Data Studio (Neon Viewer)**: *Only visible on Database nodes.* Mounts the table explorer and Monaco SQL runner.
3. **Variables**: Visual key-value editor with one-click secret hiding/revealing, import `.env` file, and variable reference generator (`${{ service.VAR }}`).
4. **Deployments**: History list of commits, authors, build duration, rollback button (`Rollback to this commit`).
5. **Settings**: Resource limits (RAM/CPU sliders), restart policy, health check endpoint (`/health`), delete service.
