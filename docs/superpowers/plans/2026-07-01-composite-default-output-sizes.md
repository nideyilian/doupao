# Composite Default Output Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four confirmed output-size groups to fresh and reset composite workspace defaults without changing persisted-user loading behavior.

**Architecture:** Extend the existing `createDefaultCompositeV2OutputRuleGroups` factory in place. Add a focused defaults test in a new file so the user's existing uncommitted test changes remain untouched.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Lock the default rule catalog with a test

**Files:**
- Create: `src/features/composite/lib/compositeV2Defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2OutputRuleGroups } from './compositeV2Defaults'

describe('composite v2 defaults', () => {
  it('creates the confirmed disabled output-size catalog', () => {
    const groups = createDefaultCompositeV2OutputRuleGroups()

    expect(groups.map((group) => ({
      name: group.name,
      rules: group.rules.map(({ width, height, maxSizeKb, enabled }) => ({
        width,
        height,
        maxSizeKb,
        enabled,
      })),
    }))).toEqual([
      {
        name: '广点通',
        rules: [
          { width: 1280, height: 720, maxSizeKb: 399, enabled: false },
          { width: 1080, height: 1920, maxSizeKb: 399, enabled: false },
        ],
      },
      {
        name: '百度',
        rules: [
          { width: 1140, height: 640, maxSizeKb: 299, enabled: false },
          { width: 370, height: 245, maxSizeKb: 299, enabled: false },
          { width: 1080, height: 1920, maxSizeKb: 399, enabled: false },
        ],
      },
      {
        name: '厂商',
        rules: [
          { width: 1280, height: 720, maxSizeKb: 99, enabled: false },
          { width: 1080, height: 1920, maxSizeKb: 99, enabled: false },
          { width: 320, height: 211, maxSizeKb: 80, enabled: false },
          { width: 320, height: 210, maxSizeKb: 80, enabled: false },
          { width: 720, height: 1280, maxSizeKb: 99, enabled: false },
          { width: 720, height: 498, maxSizeKb: 99, enabled: false },
          { width: 474, height: 768, maxSizeKb: 99, enabled: false },
          { width: 1080, height: 528, maxSizeKb: 99, enabled: false },
        ],
      },
      {
        name: '头条',
        rules: [
          { width: 1080, height: 1920, maxSizeKb: 399, enabled: false },
          { width: 1280, height: 720, maxSizeKb: 399, enabled: false },
        ],
      },
    ])
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeV2Defaults.test.ts
```

Expected: FAIL because the factory still returns the combined `广点通/头条`
group and lacks the additional vendor and separate Toutiao rules.

### Task 2: Update the default rule factory

**Files:**
- Modify: `src/features/composite/lib/compositeV2Defaults.ts`
- Test: `src/features/composite/lib/compositeV2Defaults.test.ts`

- [ ] **Step 1: Implement the minimal default catalog change**

Change the first group to:

```ts
{
  id: 'gdt',
  name: '广点通',
  rules: [
    rule('gdt-1280x720', '1280x720', 1280, 720, 399),
    rule('gdt-1080x1920', '1080x1920', 1080, 1920, 399),
  ],
  distributionPaths: [],
},
```

Append these rules to the existing vendor group:

```ts
rule('vendor-720x1280', '720x1280', 720, 1280, 99),
rule('vendor-720x498', '720x498', 720, 498, 99),
rule('vendor-474x768', '474x768', 474, 768, 99),
rule('vendor-1080x528', '1080x528', 1080, 528, 99),
```

Append the separate Toutiao group:

```ts
{
  id: 'toutiao',
  name: '头条',
  rules: [
    rule('toutiao-1080x1920', '1080x1920', 1080, 1920, 399),
    rule('toutiao-1280x720', '1280x720', 1280, 720, 399),
  ],
  distributionPaths: [],
},
```

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeV2Defaults.test.ts
```

Expected: PASS with 1 test passing.

- [ ] **Step 3: Run relevant regression checks**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeV2Defaults.test.ts src/features/composite/lib/compositeOutputRulesV2.test.ts src/features/composite/storeV2.test.ts
npm run build
```

Expected: all selected tests pass and the production build exits with code 0.

- [ ] **Step 4: Review the surgical diff**

Run:

```powershell
git diff --check
git diff -- src/features/composite/lib/compositeV2Defaults.ts src/features/composite/lib/compositeV2Defaults.test.ts
```

Expected: only the confirmed default catalog and its focused test are added;
pre-existing changes in `compositeV2Defaults.ts` remain intact.
