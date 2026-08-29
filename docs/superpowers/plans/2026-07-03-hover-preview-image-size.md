# Hover Preview Image Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an output image's actual pixel dimensions in the upper-right corner of the task-detail hover preview, then merge and publish version 0.7.12.

**Architecture:** Extract the existing hover-preview markup into a small presentational component that receives the preview geometry and optional size text. `DetailModal` keeps ownership of image loading and its existing `imageSizes` map, passing only the selected image's actual `naturalWidth × naturalHeight` value to the component.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Vitest, react-dom/server, Electron Builder, GitHub Releases

---

### Task 1: Add a tested hover preview component

**Files:**
- Create: `src/components/HoverImagePreview.tsx`
- Create: `src/components/HoverImagePreview.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/components/HoverImagePreview.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HoverImagePreview from './HoverImagePreview'

const preview = {
  imageId: 'image-a',
  src: 'data:image/png;base64,a',
  left: 100,
  top: 120,
  width: 640,
  height: 360,
}

describe('HoverImagePreview', () => {
  it('shows the actual pixel dimensions in the upper-right label', () => {
    const html = renderToStaticMarkup(
      <HoverImagePreview preview={preview} sizeText="1536 × 1024" />,
    )

    expect(html).toContain('aria-label="图片尺寸"')
    expect(html).toContain('1536 × 1024')
  })

  it('omits the size label when dimensions are unavailable', () => {
    const html = renderToStaticMarkup(
      <HoverImagePreview preview={preview} sizeText="" />,
    )

    expect(html).not.toContain('aria-label="图片尺寸"')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run src/components/HoverImagePreview.test.tsx
```

Expected: FAIL because `HoverImagePreview.tsx` does not exist.

- [ ] **Step 3: Implement the minimal component**

Create `src/components/HoverImagePreview.tsx` with these public types and behavior:

```tsx
interface HoverPreviewState {
  imageId: string
  src: string
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  preview: HoverPreviewState
  sizeText?: string
}

export default function HoverImagePreview({ preview, sizeText }: Props) {
  return (
    <div
      className="pointer-events-none fixed z-[70] hidden overflow-hidden rounded-xl border border-white/15 bg-black/85 p-2 shadow-2xl backdrop-blur-md md:block"
      style={{
        left: preview.left,
        top: preview.top,
        width: preview.width,
        height: preview.height,
      }}
    >
      <img
        src={preview.src}
        data-image-id={preview.imageId}
        className="h-full w-full object-contain"
        alt=""
      />
      {sizeText && (
        <span
          aria-label="图片尺寸"
          className="absolute right-3 top-3 rounded-md bg-black/65 px-2 py-1 text-xs font-medium tabular-nums text-white shadow-sm backdrop-blur-sm"
        >
          {sizeText}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the component test and verify GREEN**

Run:

```powershell
npx vitest run src/components/HoverImagePreview.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the component**

Run:

```powershell
git add src/components/HoverImagePreview.tsx src/components/HoverImagePreview.test.tsx
git commit -m "feat: show dimensions on hover previews"
```

### Task 2: Connect actual dimensions from DetailModal

**Files:**
- Modify: `src/components/DetailModal.tsx`
- Test: `src/components/HoverImagePreview.test.tsx`

- [ ] **Step 1: Replace the inline preview markup**

Import the component:

```tsx
import HoverImagePreview from './HoverImagePreview'
```

Replace the existing `hoverPreview` block with:

```tsx
{hoverPreview && (
  <HoverImagePreview
    preview={hoverPreview}
    sizeText={imageSizes[hoverPreview.imageId] || ''}
  />
)}
```

This uses the existing `onLoad` path that stores `image.naturalWidth + '×' + image.naturalHeight`. No requested-size fallback is allowed.

- [ ] **Step 2: Run focused tests and type checking**

Run:

```powershell
npx vitest run src/components/HoverImagePreview.test.tsx src/lib/hoverPreviewPosition.test.ts
npx tsc -b --pretty false
```

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 3: Commit the integration**

Run:

```powershell
git add src/components/DetailModal.tsx
git commit -m "feat: connect actual hover image dimensions"
```

### Task 3: Verify and merge the feature branch

**Files:**
- Review: `src/components/HoverImagePreview.tsx`
- Review: `src/components/HoverImagePreview.test.tsx`
- Review: `src/components/DetailModal.tsx`

- [ ] **Step 1: Run full verification on the feature branch**

Run:

```powershell
npm test
npm run build
git diff --check
git status --short
```

Expected: zero failed tests, successful production build, no whitespace errors, and a clean feature branch.

- [ ] **Step 2: Merge locally into main**

From the main repository root:

```powershell
git checkout main
git merge --ff-only codex/hover-preview-image-size
```

Expected: fast-forward merge succeeds.

- [ ] **Step 3: Verify the merged main branch**

Run:

```powershell
npm test
```

Expected: zero failed tests.

- [ ] **Step 4: Remove the owned worktree and feature branch**

After the merge and test succeed:

```powershell
git worktree remove .worktrees/hover-preview-image-size
git worktree prune
git branch -d codex/hover-preview-image-size
```

Expected: the temporary worktree and merged feature branch are removed.

### Task 4: Prepare and publish version 0.7.12

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Set the exact release version**

Run:

```powershell
npm version 0.7.12 --no-git-tag-version
```

Expected: `package.json` and the root package entries in `package-lock.json` report `0.7.12`.

- [ ] **Step 2: Run release verification**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected: zero failed tests, successful build, and no whitespace errors.

- [ ] **Step 3: Commit the version**

Run:

```powershell
git add package.json package-lock.json
git commit -m "release: publish 0.7.12"
```

- [ ] **Step 4: Push main**

Run:

```powershell
git push origin main
```

Expected: `origin/main` advances through the `0.7.12` release commit.

- [ ] **Step 5: Publish Electron artifacts**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-version.ps1 -Bump none
```

Expected: tests and builds pass again, Electron Builder uploads the Windows installer and portable artifacts, and GitHub release `v0.7.12` is created or updated.

- [ ] **Step 6: Verify the release**

Run:

```powershell
gh release view v0.7.12 --repo nideyilian/doupao
git status -sb
```

Expected: GitHub release `v0.7.12` exists with uploaded artifacts and local `main` is clean and synchronized with `origin/main`.
