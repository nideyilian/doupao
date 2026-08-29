# Manual Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace system-driven dark mode with a persisted manual light/dark toggle in the header.

**Architecture:** Store `themeMode` in existing app settings, normalize legacy settings to `light`, and apply the mode by toggling the `dark` class on `<html>`. Tailwind and custom CSS should read the class instead of `prefers-color-scheme`.

**Tech Stack:** React 19, Zustand settings persistence, Tailwind class dark mode, Vitest.

---

### Task 1: Theme State And Tests

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/apiProfiles.ts`
- Create: `src/lib/theme.ts`
- Create: `src/lib/theme.test.ts`

- [ ] **Step 1: Write tests**

Test default normalization, invalid fallback, dark class application, and light class removal.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/lib/theme.test.ts`
Expected: FAIL because `theme.ts` does not exist.

- [ ] **Step 3: Implement minimal theme helpers and settings field**

Add `ThemeMode`, `themeMode`, `normalizeThemeMode`, and `applyThemeMode`.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/lib/theme.test.ts`
Expected: PASS.

### Task 2: Manual UI Toggle

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/index.css`
- Modify: `src/App.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/icons.tsx`

- [ ] **Step 1: Switch Tailwind dark mode to class**

Set `darkMode: 'class'`.

- [ ] **Step 2: Replace system dark CSS with `.dark` selectors**

Convert custom `@media (prefers-color-scheme: dark)` blocks to class-based selectors.

- [ ] **Step 3: Apply theme in App**

Subscribe to settings and call `applyThemeMode(settings.themeMode)` in an effect.

- [ ] **Step 4: Add header toggle**

Add a compact icon button next to help/settings that toggles `light`/`dark`, with tooltip text matching the next action.

### Task 3: Verification

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/theme.test.ts`
Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS.
