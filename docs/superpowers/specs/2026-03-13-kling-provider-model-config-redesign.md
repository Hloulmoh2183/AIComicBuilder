---
title: Kling AI Provider + Model Config UI Redesign
date: 2026-03-13
status: approved
---

# Kling AI Provider + Model Config UI Redesign

## Overview

Two coupled changes:
1. **Add Kling AI** as a new provider protocol supporting image generation (text-to-image) and video generation (image-to-video).
2. **Redesign the model configuration UI** so that language, image, and video models are configured in separate, independent sections — a provider belongs to exactly one capability type.

---

## 1. Data Structure Changes

### `model-store.ts`

**`Protocol` type** — add `"kling"`:
```ts
export type Protocol = "openai" | "gemini" | "seedance" | "kling";
```

**`Provider.capability`** — change from `capabilities: Capability[]` (multi-select) to `capability: Capability` (single value):
```ts
// Before
export interface Provider {
  capabilities: Capability[];
  ...
}

// After
export interface Provider {
  capability: Capability;  // single value, set at creation time
  ...
}
```

**localStorage migration** — bump `version` to `2`, add `migrate` function:
- Old `capabilities: Capability[]` → take `capabilities[0]` as the new `capability`
- If array was empty, default to `"text"`

No changes to `defaultTextModel`, `defaultImageModel`, `defaultVideoModel`, `ModelRef`, `ModelConfig`, or `getModelConfig()`.

---

## 2. Settings Page UI Redesign

### Layout

Replace the single flat provider list with three independent sections, each managing its own provider list:

```
┌──────────────────────────────────────────────────┐
│  🔤 Language Models                  [+ Add]     │
│  [ProviderCard] [ProviderCard] ...               │
│  [ProviderForm for selected provider]            │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  🖼️  Image Models                    [+ Add]     │
│  [ProviderCard] [ProviderCard] ...               │
│  [ProviderForm for selected provider]            │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  🎬 Video Models                     [+ Add]     │
│  [ProviderCard] [ProviderCard] ...               │
│  [ProviderForm for selected provider]            │
└──────────────────────────────────────────────────┘
```

The DefaultModelPicker at the top remains unchanged.

### `settings/page.tsx`

- Three independent `selectedId` states (one per capability section).
- Each section's "Add Provider" pre-fills `capability` for that section plus a sensible default protocol (e.g., `"openai"` for text, `"openai"` for image, `"seedance"` for video).
- Extract a reusable `ProviderSection` component that encapsulates the card list + form for one capability.

### `ProviderForm` changes

- Remove the capability multi-checkbox UI — capability is now fixed.
- Filter the Protocol options shown based on the provider's capability:
  - `text`: `openai`, `gemini`
  - `image`: `openai`, `gemini`, `kling`
  - `video`: `seedance`, `gemini` (Veo), `kling`
- No other changes to the form.

### New i18n keys (all 4 locales: zh, en, ja, ko)

```
settings.languageModels   — "Language Models" / "语言模型" / ...
settings.imageModels      — "Image Models" / "图片模型" / ...
settings.videoModels      — "Video Models" / "视频模型" / ...
```

---

## 3. Kling AI Provider Implementation

### Authentication

All Kling API requests use:
```
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Base URL: `https://api.klingai.com` (configurable via `baseUrl` field).

### 3a. Image Provider — `src/lib/ai/providers/kling-image.ts`

Implements `AIProvider` interface (`generateImage` method only; `generateText` throws unsupported).

**Submit task**: `POST /v1/images/generations`
```json
{
  "model": "<modelId>",
  "prompt": "<prompt>",
  "n": 1,
  "aspect_ratio": "16:9"
}
```

**Poll**: `GET /v1/images/generations/{task_id}` every 5 seconds, up to 60 attempts (5 minutes).

**Success condition**: `data.task_status === "succeed"` and `data.task_result.images[0].url` is present.

**Output**: Download image from URL to `uploads/images/<ulid>.png`, return local path.

**Error**: Non-200 response or `data.task_status === "failed"` → throw with `data.task_status_msg`.

Known models: `kling-v1`, `kling-v1-5`, `kling-v2`, `kling-v2-new`, `kling-v2-1`

### 3b. Video Provider — `src/lib/ai/providers/kling-video.ts`

Implements `VideoProvider` interface (`generateVideo` method).

**Submit task**: `POST /v1/videos/image2video`
```json
{
  "model": "<modelId>",
  "prompt": "<prompt>",
  "image": "<firstFrame base64 with data URI prefix>",
  "tail_image": "<lastFrame base64 with data URI prefix>",
  "duration": 5,
  "aspect_ratio": "16:9"
}
```

Duration: pass through from params (Kling supports 5s and 10s).
Aspect ratio: map from `params.ratio` (e.g., `"16:9"`, `"9:16"`), default `"16:9"`.

**Poll**: `GET /v1/videos/image2video/{task_id}` every 5 seconds, up to 120 attempts (10 minutes).

**Success condition**: `data.task_status === "succeed"` and `data.task_result.videos[0].url` is present.

**Output**: Download `.mp4` to `uploads/videos/<ulid>.mp4`, return local path.

**Error**: Non-200 or `task_status === "failed"` → throw with `data.task_status_msg`.

Known models: `kling-v1`, `kling-v1-6`, `kling-v2-master`, `kling-v2-1-master`, `kling-v2-5-turbo`

### 3c. `provider-factory.ts` changes

```ts
// createAIProvider — add kling case
case "kling":
  return new KlingImageProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.modelId });

// createVideoProvider — add kling case
case "kling":
  return new KlingVideoProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.modelId });
```

### 3d. `/api/models/list` route changes

Add `kling` protocol handling: return a hardcoded list of known Kling models split by context. Since Kling does not expose a `/models` list endpoint publicly, we return static model lists:

- For capability `image`: `kling-v1`, `kling-v1-5`, `kling-v2`, `kling-v2-new`, `kling-v2-1`
- For capability `video`: `kling-v1`, `kling-v1-6`, `kling-v2-master`, `kling-v2-1-master`, `kling-v2-5-turbo`

The route currently does not receive a `capability` parameter, so we return the union of all known Kling models. The user can then manually pick the correct one from the list.

---

## 4. Error Handling & Edge Cases

- **Kling API error shape**: `{ code: number, message: string, data: {...} }`. Any `code !== 0` is an error; throw `new Error(message)`.
- **Image file encoding**: Read file to base64 and prefix with `data:<mime>;base64,` for Kling (same pattern as Seedance).
- **Polling timeout**: Image 5 min, Video 10 min — consistent with existing providers.
- **generateText on KlingImageProvider**: throw `Error("Kling does not support text generation")`.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/stores/model-store.ts` | `capabilities[]` → `capability`, add `"kling"` protocol, migration v2 |
| `src/app/[locale]/settings/page.tsx` | Three capability sections, `ProviderSection` component |
| `src/components/settings/provider-form.tsx` | Remove capability checkboxes, filter protocols by capability |
| `src/lib/ai/providers/kling-image.ts` | New — KlingImageProvider |
| `src/lib/ai/providers/kling-video.ts` | New — KlingVideoProvider |
| `src/lib/ai/provider-factory.ts` | Add `kling` cases to both factory functions |
| `src/app/api/models/list/route.ts` | Add `kling` protocol static model list |
| `messages/zh.json`, `en.json`, `ja.json`, `ko.json` | Add 3 new i18n keys |

---

## 6. Out of Scope

- Kling text generation (not supported by Kling API)
- Kling image-to-image / outpainting / omni features
- Kling video extension or multi-image-to-video
- Any changes to the pipeline logic beyond `provider-factory.ts`
