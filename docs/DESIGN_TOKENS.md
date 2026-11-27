# Dent2025 — Master Design System & CSS Token Registry

Defined in `:root` inside `frontend-html box in wordpress astra/fonts/fonts.css`. All frontend templates, injected widgets, dynamic JS UI builders, modals, and drawers **MUST consume `var(--dent-*)`** instead of hardcoding hex/rgba values.

## Core Aesthetic Rules
1. **No loud saturated / neon colors or flashy gradients.** Muted dark zinc surfaces (`#121212` / `#1e1e1e` / `#27272a`) with restrained accents.
2. **No excessive emojis.** Use SVG icons; functional triggers (e.g. `🔒`) only.
3. **Typography:** `'Outfit'`, `'Noto Kufi Arabic'`, `sans-serif` (self-hosted WOFF2), RTL-first layout, subtle glassmorphism (`backdrop-filter: blur(12px)`), `transition: all 0.25s ease`.
4. **Squarish rounded corners ONLY (`8px`–`10px`)** on all badges, pills, tags, tabs, and status chips. Strictly NO capsule/pill radii (`999px`, `20px+`, or `50%` on non-circles).

## Token Registry (`fonts/fonts.css`)

### Surfaces & Backgrounds
- `--dent-bg-page`: `#121212` (Base page canvas)
- `--dent-bg-canvas-subtle`: `rgba(255, 255, 255, 0.03)` (Subtle section fills)
- `--dent-bg-card`: `#1e1e1e` (Primary cards & containers)
- `--dent-bg-card-hover`: `rgba(255, 255, 255, 0.06)` (Card hover surface)
- `--dent-bg-card-subtle`: `rgba(0, 0, 0, 0.35)` (Secondary inset containers)
- `--dent-bg-modal`: `#181818` (Modals, drawers & dialogs)
- `--dent-bg-overlay`: `rgba(0, 0, 0, 0.85)` (Modal backdrops)
- `--dent-bg-input`: `#121212` (Form inputs & dropdowns)
- `--dent-bg-input-subtle`: `rgba(0, 0, 0, 0.45)` (Secondary inputs)
- `--dent-bg-button`: `#262626` (Secondary / utility buttons)
- `--dent-bg-button-hover`: `#333333` (Button hover)
- `--dent-bg-button-active`: `#3f3f46` (Button pressed)
- `--dent-bg-pill`: `rgba(255, 255, 255, 0.06)` (Badges & tags)
- `--dent-bg-pill-hover`: `rgba(255, 255, 255, 0.12)`
- `--dent-bg-pill-active`: `rgba(255, 255, 255, 0.18)`

### Typography & Foreground Text
- `--dent-text-primary`: `#f4f4f5` (Headings & primary text)
- `--dent-text-secondary`: `#a1a1aa` (Body text & labels)
- `--dent-text-muted`: `#71717a` (Timestamps & disabled states)
- `--dent-text-dim`: `#52525b` (Tertiary captions)
- `--dent-text-light`: `#ffffff` (Pure white accent text)

### Borders & Dividers
- `--dent-border-subtle`: `rgba(255, 255, 255, 0.05)`
- `--dent-border-card`: `rgba(255, 255, 255, 0.06)`
- `--dent-border-hover`: `rgba(255, 255, 255, 0.18)`
- `--dent-border-focus`: `rgba(255, 255, 255, 0.35)`
- `--dent-border-dashed`: `rgba(255, 255, 255, 0.14)`

### Semantic Accents & Statuses
- **Primary (Neutral Monochrome & Glass):** `--dent-accent-primary` (`#ffffff`), `--dent-accent-primary-hover` (`#e4e4e7`), `--dent-accent-primary-bg` (`rgba(255, 255, 255, 0.08)`), `--dent-accent-primary-border` (`rgba(255, 255, 255, 0.20)`)
- **Success / Active:** `--dent-accent-success` (`#10b981`), `--dent-accent-success-bright` (`#34d399`), `--dent-accent-success-bg` (`rgba(16, 185, 129, 0.14)`), `--dent-accent-success-border` (`rgba(16, 185, 129, 0.35)`)
- **Warning / Alert:** `--dent-accent-warning` (`#f59e0b`), `--dent-accent-warning-bright` (`#fbbf24`), `--dent-accent-warning-bg` (`rgba(245, 158, 11, 0.14)`), `--dent-accent-warning-border` (`rgba(245, 158, 11, 0.35)`)
- **Danger / Delete:** `--dent-accent-danger` (`#ef4444`), `--dent-accent-danger-bright` (`#f87171`), `--dent-accent-danger-bg` (`rgba(239, 68, 68, 0.14)`), `--dent-accent-danger-border` (`rgba(239, 68, 68, 0.35)`)

### Shadows & Backdrops
- `--dent-shadow-card`: `0 6px 20px rgba(0, 0, 0, 0.35)`
- `--dent-shadow-modal`: `0 25px 60px rgba(0, 0, 0, 0.85)`
- `--dent-backdrop-blur`: `blur(12px)`
