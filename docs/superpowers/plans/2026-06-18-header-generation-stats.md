# Header Generation Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact header stats for generated image counts, total duration, successes, failures, and per-tab hover details across today, 7 days, and 30 days.

**Architecture:** Keep statistics derived from persisted `TaskRecord` and `WorkspaceTab` state instead of adding a second write path. Put all date/count math in a small library with unit tests, then render it from `Header` with existing Tailwind and tooltip patterns.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest, Tailwind CSS.

---

### Task 1: Tested Stats Calculator

**Files:**
- Create: `src/lib/generationStats.ts`
- Create: `src/lib/generationStats.test.ts`

- [ ] **Step 1: Write failing tests**

Cover image-based counts, running durations, date ranges, and per-tab rollups.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/lib/generationStats.test.ts`
Expected: FAIL because `generationStats` does not exist yet.

- [ ] **Step 3: Implement minimal calculator**

Export `getGenerationStats(tasks, workspaceTabs, range, now)` and helper formatters for compact time and range labels.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/lib/generationStats.test.ts`
Expected: PASS.

### Task 2: Header UI

**Files:**
- Modify: `src/components/Header.tsx`

- [ ] **Step 1: Add stats component inside Header**

Subscribe to `tasks` and `workspaceTabs`, keep a local range state, and show four compact metrics before the gallery/agent switcher on desktop.

- [ ] **Step 2: Add hover details**

Use `ViewportTooltip` and the existing `useTooltip` hook so hovering each metric shows per-tab values for that metric.

- [ ] **Step 3: Keep mobile uncluttered**

Render stats only on `sm` and larger viewports.

### Task 3: Verification

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/generationStats.test.ts`
Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS.
