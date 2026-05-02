---
title: "VAL Master Phase 4 Sprint 4.5 — Round Screenshots CC Implementation"
date: 2026-04-06
created: 2026-04-06T22:15
type: project-doc
status: processed
tags:
  - val-master
  - phase-4
  - sprint-4-5
  - claude-code-prompt
  - round-screenshots
aliases:
  - sprint 4.5 cc prompt
source: "Claude conversation"
project: "[[Valorant Performance Hub]]"
related:
  - "[[2026-04-06-VAL-Master-Phase4-Sprint4.5-RoundScreenshots]]"
  - "[[2026-04-05-VAL-Master-Phase4-Sprint4-CC-Implementation]]"
  - "[[2026-04-05-VAL-Master-Phase4-Sprint4-HierarchicalRounds-InlineDebrief]]"
cssclasses:
  - obsidian-ready
action-items: 3
version: "4.5"
---

# VAL Master Phase 4 Sprint 4.5 — Round Screenshots CC Implementation

Companion to [[2026-04-06-VAL-Master-Phase4-Sprint4.5-RoundScreenshots|Sprint 4.5 Reasoning Doc]]. Follow the 3 pre-requisite steps below, then copy the Claude Code prompt into Claude Code.

---

## Pre-requisites

> [!warning] Complete ALL 3 steps below IN ORDER before running the Claude Code prompt.

### Step 1: Create the Supabase Storage Bucket (UI)

A Storage Bucket is Supabase's cloud file storage — it holds the actual image files. The `round_screenshots` database table (Step 3) only stores metadata like URLs and sizes; the bucket stores the real images. Think of it as: the table is the index card, the bucket is the filing cabinet.

**How to create it:**

1. Open Supabase Dashboard: `https://supabase.com/dashboard/project/achlbgqwefjpbsmgevzd`
2. In the left sidebar, click **Storage** (the folder icon)
3. Click the **New Bucket** button (top right area)
4. Fill in the form:
   - **Name:** `round-screenshots` (exact spelling, with the hyphen)
   - **Public bucket:** toggle this **ON** — this allows `<img src="...">` tags to load the images without needing auth tokens on every image request
   - **File size limit:** `5` MB
   - **Allowed MIME types:** add these three: `image/png`, `image/jpeg`, `image/webp`
5. Click **Create bucket**

You should now see `round-screenshots` in your Storage bucket list. It will be empty — that's expected.

### Step 2: Add Storage Security Policies (SQL Editor)

The bucket exists, but Supabase blocks ALL uploads and deletes by default until you add security policies. This is the same concept as RLS on database tables — you need explicit rules saying who can do what.

**Go to SQL Editor** (left sidebar → SQL Editor) and run this:

```sql
-- POLICY 1: Let authenticated users upload images into their own folder
-- The folder structure is: {user_id}/{match_id}/r{round}_{timestamp}.png
-- This policy ensures users can ONLY upload to paths starting with their own user ID
CREATE POLICY "Users can upload own screenshots"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'round-screenshots'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- POLICY 2: Let authenticated users delete their own images
-- Same folder-scoping: you can only delete files in your own {user_id}/ path
CREATE POLICY "Users can delete own screenshots"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'round-screenshots'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- POLICY 3: Let anyone view/download images (public read)
-- This is what makes <img src="supabase-url"> work without auth headers
-- The URLs are unguessable UUIDs, so this is safe for a personal tool
CREATE POLICY "Public read access for screenshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'round-screenshots');
```

You should see "Success. No rows returned" for each policy. That's correct.

### Step 3: Create the `round_screenshots` Table (SQL Editor)

This table stores the metadata about each screenshot — which match, which round, the Storage URL, file size, and image dimensions. The actual image file lives in the Storage bucket from Step 1.

**Still in SQL Editor**, run this:

```sql
-- Create the table
CREATE TABLE IF NOT EXISTS round_screenshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  match_id TEXT NOT NULL,
  round_number SMALLINT NOT NULL,
  storage_path TEXT NOT NULL,   -- path in the Storage bucket (for deletion)
  image_url TEXT NOT NULL,      -- public URL for <img> rendering
  file_size INTEGER,            -- bytes, for reference
  width INTEGER,                -- original image width in pixels
  height INTEGER                -- original image height in pixels
);

-- Enable Row Level Security (same pattern as all other VAL Master tables)
ALTER TABLE round_screenshots ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only see/add/delete their own screenshots
CREATE POLICY "Users can view own round_screenshots"
  ON round_screenshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own round_screenshots"
  ON round_screenshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own round_screenshots"
  ON round_screenshots FOR DELETE USING (auth.uid() = user_id);

-- Indexes for fast lookups (filter by match + round is the hot path)
CREATE INDEX IF NOT EXISTS idx_round_screenshots_match_round
  ON round_screenshots(match_id, round_number);
CREATE INDEX IF NOT EXISTS idx_round_screenshots_user_id
  ON round_screenshots(user_id);
```

You should see "Success. No rows returned." You can verify the table exists by going to **Table Editor** in the sidebar — `round_screenshots` should appear in the list.

> [!success] Pre-requisites complete
> You now have:
> - ✅ A Storage bucket (`round-screenshots`) where image files will be stored
> - ✅ Security policies controlling who can upload/delete/view those files
> - ✅ A database table (`round_screenshots`) tracking which images belong to which rounds
> 
> You're ready to copy the Claude Code prompt below.

---

## Claude Code Prompt

> [!important] Copy everything below this line into Claude Code

---

**Context:** VAL Master Phase 4 Sprint 4.5. We're adding screenshot attachments to round cards in the VOD Review page. Users can paste Valoplant composition screenshots (or any image) directly into an expanded round card via `Ctrl+V`, or use a file picker. Screenshots display as thumbnails inside the round card; clicking opens a lightbox modal.

**Repo:** `bastienr1/VAL-Master` on `main` branch.

**Stack:** React 19, Vite, TypeScript, Tailwind 4 (using `@theme` in `index.css` for design tokens), Supabase, lucide-react for icons.

**Design tokens (from `src/index.css`):**
- Colors: `val-red` (#FF4655), `val-cyan` (#53CADC), `val-yellow` (#FFCA3A), `val-green` (#3DD598), `bg-primary` (#0A0E17), `bg-secondary` (#111827), `bg-card` (#1A1F2E), `bg-elevated` (#242938), `text-primary` (#F1F5F9), `text-secondary` (#94A3B8), `text-muted` (#64748B)
- Fonts: `font-heading` (Rajdhani), `font-body` (Inter), `font-stats` (JetBrains Mono)

**Current state:**
- `RoundCard.tsx` (~400 lines) renders collapsible round cards with kill/death events, structured comments, and manual tags. Each card receives `round`, `roundVideoTime`, `manualTags`, `comments`, `vodReviewId`, `onSeek`, `onCommentAdded`, `onCommentDeleted` as props.
- `VodReview.tsx` (~900 lines) renders the full VOD Review page with hierarchical ATK/DEF sections containing RoundCard instances.
- Supabase client is imported from `src/lib/supabase.ts`.
- Types are in `src/lib/types.ts`.

**Pre-requisites completed:**
- Supabase Storage bucket `round-screenshots` created (public read, authenticated write).
- `round_screenshots` table created with RLS policies.
- Storage policies applied for upload/delete scoped to `{user_id}/` folder.

---

### Task 1: Add `RoundScreenshot` type to `src/lib/types.ts`

Add this interface after the existing `VodComment` interface:

```typescript
export interface RoundScreenshot {
  id: string
  created_at: string
  user_id: string
  match_id: string
  round_number: number
  storage_path: string
  image_url: string
  file_size: number | null
  width: number | null
  height: number | null
}
```

---

### Task 2: Create `src/components/RoundScreenshots.tsx`

Self-contained component handling screenshot display, upload, and lightbox.

**Props:**
```typescript
interface RoundScreenshotsProps {
  matchId: string
  roundNumber: number
  screenshots: RoundScreenshot[]
  pastedFile: File | null
  onPasteConsumed: () => void
  onScreenshotAdded: (screenshot: RoundScreenshot) => void
  onScreenshotDeleted: (screenshotId: string) => void
}
```

**Features to implement:**

**A) Thumbnail row:**
- Horizontal flex row of thumbnails, each 56×40px
- `<img>` with `object-cover`, `rounded`, `border border-bg-elevated`
- Hover: `ring-1 ring-val-cyan/50`, `scale-105` transition
- Delete button: absolute positioned top-right of each thumbnail, visible on hover only, small X icon with `bg-black/60 rounded-full` backdrop, `text-val-red` on hover
- "+" upload button at the end: same size (56×40px), dashed border (`border-dashed border-text-muted/30`), `Plus` icon from lucide-react, triggers hidden `<input type="file">`

**B) Clipboard paste handler:**
- Watch `pastedFile` prop with `useEffect` — when non-null, process the upload then call `onPasteConsumed()`
- Validate: file size ≤ 5MB. If too large, `console.error` and call `onPasteConsumed()` without uploading
- Show a loading placeholder thumbnail (pulsing `bg-bg-elevated` skeleton) while uploading
- Upload flow:
  1. Get current user: `const { data: { user } } = await supabase.auth.getUser()`
  2. Generate path: `${user.id}/${matchId}/r${roundNumber}_${Date.now()}.png`
  3. Upload: `supabase.storage.from('round-screenshots').upload(path, file, { contentType: file.type })`
  4. Get public URL: `supabase.storage.from('round-screenshots').getPublicUrl(path).data.publicUrl`
  5. Get image dimensions: load image into a temporary `Image()` object with `URL.createObjectURL(file)`, read `naturalWidth`/`naturalHeight`
  6. Insert row: `supabase.from('round_screenshots').insert({ user_id, match_id, round_number, storage_path: path, image_url: publicUrl, file_size: file.size, width, height }).select().single()`
  7. Call `onScreenshotAdded(data)`
  8. Call `onPasteConsumed()`
  9. Remove loading placeholder

**C) File picker upload:**
- Hidden `<input type="file" accept="image/png,image/jpeg,image/webp">` triggered by the "+" button
- Same upload flow as clipboard paste from the validation step onward

**D) Delete handler:**
- `supabase.storage.from('round-screenshots').remove([screenshot.storage_path])`
- `supabase.from('round_screenshots').delete().eq('id', screenshot.id)`
- Call `onScreenshotDeleted(screenshot.id)`

**E) Lightbox modal:**
- Triggered by clicking any thumbnail
- Render via React Portal (`createPortal` to `document.body`)
- Fixed overlay: `fixed inset-0 z-50 bg-black/85 flex items-center justify-center`
- Image: `<img>` with `max-w-[90vw] max-h-[85vh] object-contain rounded-lg`
- Close: click backdrop (not image), press `Escape`, or click X button (top-right corner, `text-white/70 hover:text-white`)
- Navigation: if multiple screenshots in this round, show left/right chevron buttons. Arrow keys also navigate. Wrap around at boundaries.
- Transition: fade-in the overlay (simple opacity transition with `useState`)

**Component layout order (inside the returned JSX):**
```
<div className="flex items-center gap-1.5 pl-4 pt-1">
  {/* Thumbnails */}
  {screenshots.map(s => <ThumbnailButton />)}
  {/* Loading placeholder if uploading */}
  {uploading && <SkeletonThumb />}
  {/* "+" upload button */}
  <UploadButton />
</div>
{/* Lightbox portal */}
{lightboxIndex !== null && createPortal(<Lightbox />, document.body)}
```

---

### Task 3: Modify `src/components/RoundCard.tsx`

**Changes:**

1. Add import: `import RoundScreenshots from './RoundScreenshots'` and `import type { RoundScreenshot } from '../lib/types'`

2. Add new props to `RoundCardProps`:
```typescript
matchId: string  // the match_id string (not UUID)
screenshots: RoundScreenshot[]
onScreenshotAdded: (screenshot: RoundScreenshot) => void
onScreenshotDeleted: (screenshotId: string) => void
```

3. Add paste state and handler inside the component:
```typescript
const [pastedFile, setPastedFile] = useState<File | null>(null)

const handlePaste = (e: React.ClipboardEvent) => {
  const items = Array.from(e.clipboardData.items)
  const imageItem = items.find(item => item.type.startsWith('image/'))
  if (imageItem) {
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (file) setPastedFile(file)
  }
  // If no image in clipboard, let the paste propagate normally (for text inputs)
}
```

4. Add `onPaste={handlePaste}` to the expanded content wrapper `<div>`:
```typescript
<div
  className="border-t border-bg-elevated px-3 py-2 space-y-1"
  onPaste={handlePaste}
>
```

5. Place `<RoundScreenshots>` in the expanded content area, AFTER death events and BEFORE the "Add note to round" button:

```tsx
{/* After death events, before "Add note to round" */}
<RoundScreenshots
  matchId={matchId}
  roundNumber={round.round_number}
  screenshots={screenshots}
  pastedFile={pastedFile}
  onPasteConsumed={() => setPastedFile(null)}
  onScreenshotAdded={onScreenshotAdded}
  onScreenshotDeleted={onScreenshotDeleted}
/>
```

---

### Task 4: Modify `src/pages/VodReview.tsx`

**Changes:**

1. Add import: `import type { RoundScreenshot } from '../lib/types'`

2. Add screenshots state:
```typescript
const [screenshots, setScreenshots] = useState<RoundScreenshot[]>([])
```

3. Load screenshots when match is available (add a new `useEffect`):
```typescript
useEffect(() => {
  if (!match?.match_id) return

  async function loadScreenshots() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('round_screenshots')
      .select('*')
      .eq('match_id', match!.match_id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (!error && data) setScreenshots(data)
  }
  loadScreenshots()
}, [match])
```

4. Add screenshot handlers:
```typescript
const handleScreenshotAdded = (screenshot: RoundScreenshot) => {
  setScreenshots(prev => [...prev, screenshot])
}

const handleScreenshotDeleted = (screenshotId: string) => {
  setScreenshots(prev => prev.filter(s => s.id !== screenshotId))
}
```

5. Pass new props to each `RoundCard` instance (in both ATK and DEF sections):
```tsx
<RoundCard
  key={round.round_number}
  round={round}
  matchId={match.match_id}  // NEW
  roundVideoTime={getRoundVideoTime(round)}
  r1StartMs={matchRounds[0]?.round_start_ms}
  manualTags={tags.filter(t => !t.is_auto && t.round_number === round.round_number)}
  comments={comments.filter(c => c.round_number === round.round_number)}
  screenshots={screenshots.filter(s => s.round_number === round.round_number)}  // NEW
  vodReviewId={vodReview.id}
  onSeek={seekToTag}
  onCommentAdded={handleCommentAdded}
  onCommentDeleted={handleCommentDeleted}
  onScreenshotAdded={handleScreenshotAdded}  // NEW
  onScreenshotDeleted={handleScreenshotDeleted}  // NEW
/>
```

---

### Visual Styling Reference

**Thumbnail:**
```
w-14 h-10 rounded border border-bg-elevated object-cover cursor-pointer
hover:ring-1 hover:ring-val-cyan/50 hover:scale-105 transition-all
relative group/thumb
```

**Delete button on thumbnail:**
```
absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 
flex items-center justify-center
opacity-0 group-hover/thumb:opacity-100 transition-opacity
text-text-muted hover:text-val-red
```

**Upload "+" button:**
```
w-14 h-10 rounded border border-dashed border-text-muted/30 
flex items-center justify-center
text-text-muted hover:text-val-cyan hover:border-val-cyan/30 
transition-colors cursor-pointer
```

**Loading skeleton:**
```
w-14 h-10 rounded bg-bg-elevated animate-pulse
```

**Lightbox overlay:**
```
fixed inset-0 z-50 bg-black/85 flex items-center justify-center
```

**Lightbox image:**
```
max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl
```

**Lightbox close button:**
```
absolute top-4 right-4 p-2 rounded-full bg-white/10 
text-white/70 hover:text-white hover:bg-white/20 transition-colors
```

**Lightbox nav arrows:**
```
absolute top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10
text-white/70 hover:text-white hover:bg-white/20 transition-colors
left-4 (or right-4)
```

---

### Verification Checklist

After running, verify:

- [ ] `src/lib/types.ts` has `RoundScreenshot` interface
- [ ] `src/components/RoundScreenshots.tsx` exists and exports default component
- [ ] `src/components/RoundCard.tsx` imports `RoundScreenshots`, accepts new props (`matchId`, `screenshots`, `onScreenshotAdded`, `onScreenshotDeleted`), has `onPaste` on expanded div, renders `RoundScreenshots` between death events and "Add note to round"
- [ ] `src/pages/VodReview.tsx` has screenshots state, loads from `round_screenshots`, passes `matchId` + `screenshots` + handlers to each `RoundCard`
- [ ] Build passes: `npm run build` — zero errors
- [ ] Paste test: expand a round card → `Ctrl+V` an image from clipboard → thumbnail appears
- [ ] File picker test: click "+" button → select image → thumbnail appears
- [ ] Lightbox test: click thumbnail → full-size image in overlay → `Esc` closes
- [ ] Delete test: hover thumbnail → click X → screenshot removed
- [ ] Multiple screenshots: add 2+ to same round → all thumbnails show → lightbox arrows navigate between them
- [ ] Non-image paste: paste text into the round card area → should NOT trigger upload, should propagate normally to any focused text input

---

### Critical Constraints

- **DO NOT modify `src/lib/matchSync.ts`** — the round sync and auto-tag system must remain untouched
- **DO NOT modify `src/components/InlineDebrief.tsx`** — the debrief system is separate
- **DO NOT modify `src/lib/commentTags.ts`** — the tag vocabulary is unchanged
- **Preserve all existing RoundCard functionality** — comments, kill/death events, manual tags, badges, seek-on-click all must continue working exactly as before
- **The `onPaste` handler must NOT interfere with text input paste** — only intercept when clipboard contains image data, otherwise let the event propagate normally so users can paste text into the comment input or free-text fields
