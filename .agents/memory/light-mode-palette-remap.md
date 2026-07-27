---
name: Light-mode via palette remap
description: How the dashboard's light theme is implemented despite hardcoded dark utility classes.
---

The dashboard was built dark-first with ~430 hardcoded `zinc-*` / accent `*-950/-800/-400/-300` Tailwind classes. Tailwind v4 utilities resolve to `var(--color-*)`, so light mode is implemented by remapping those palette variables (inverted zinc scale, light accent tints) plus the semantic HSL tokens inside an `html:not(.dark)` block in `index.css` — no per-component edits.

**Why:** editing hundreds of class usages is error-prone and every new component would need dual classes; the var remap makes light mode automatic for any zinc/accent-based UI.

**How to apply:** when adding new UI, keep using the dark zinc/accent palette classes and they will retheme automatically. If you introduce a new accent shade (e.g. `bg-pink-950`), add its light override to the `html:not(.dark)` block. Theme preference is stored in localStorage key `jarvis-theme` ("light"/"dark", default dark), applied by an inline script in `index.html` before paint and by the `useTheme` hook.
