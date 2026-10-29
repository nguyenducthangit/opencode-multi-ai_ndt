---
name: app-reconstruction
description: Reconstruct a mobile or desktop application feature from an authorized artifact, decompiled code, and UI references. Use for planning, implementing, or reviewing a source-backed rebuild; do not use for ordinary source-only feature work.
---

# App reconstruction

Treat the shipped artifact and decompiled source as evidence, and the target project as the implementation. Screenshot/video identifies the starting point; it is not the complete specification.

## Shared rules for every phase

- Read the current task, its predecessor reports, workspace instructions (`.antigravityrules`), and `FEATURE_REVERSE_ENGINEERING.md`. Preserve unrelated changes.
- Cite important findings with source path plus class/method/symbol, native binary/symbol or offset, or a repeatable runtime observation. Mark a statement as verified, inferred, or unknown.
- Follow a behavior end to end: UI event → state/controller → business logic → API/local/native data → result mapping → state → UI/navigation. Reading a single UI file or endpoint interface is not enough.
- Do not invent endpoints, JSON fields, feature flags, algorithms, missing binary code, or backend behavior. Record a bounded unknown and the next artifact or runtime observation that would resolve it.
- Never commit, push, reset, clean, or alter supervisor checkpoint files. The supervisor owns Git and task state.
- **Architectural & Coding Standards (`.antigravityrules`):**
  - Target architecture: **Flutter + GetX + Dart 3.x**.
  - Feature-First layout: `lib/features/<feature>/` with `binding/`, `controller/`, `pages/`, `widgets/`.
  - Barrel file pattern (`part` / `part of`). Every widget > 50 lines must be extracted to `widgets/featureName_chucNang_widget.dart`.
  - GetX DI: `Get.lazyPut()` in Bindings. Obx wraps smallest widget with at least one `.obs` variable.
  - Dispose controllers, stream subscriptions, and timers in `onClose()`.
  - Deprecated APIs strictly forbidden: use `withValues(alpha: ...)` instead of `withOpacity`, `debugPrint` instead of `print`, `MediaQuery.sizeOf(context)` instead of `MediaQuery.of(context).size`.
  - **No Ads Policy:** Strictly DO NOT inject any mock ads, placeholder ads, or ad widgets into layouts.
  - **No Pro / VIP Lock (100% Free & Unlocked):** Do NOT implement In-App Purchases (IAP), Google Play Billing, Paywalls, subscriptions, or Pro upgrade dialogs. Do NOT display lock icons, crown badges (👑), or VIP tags on any tools/filters/stickers. All features must be fully unlocked and free to use.
  - **No Coins / Wallet / Points:** Do NOT build coin wallets, rewarded task loops, daily check-in rewards, or coin-based unlocking. Features requiring coins in the original app must be immediately accessible for free.
  - **Skip Commercial Code During Analysis:** Immediately skip scanning classes/packages related to `billing`, `iap`, `ads`, `monetization`, `subscription`, `wallet`, or `coin` to save time and token budget.

## Effect Resources & Native Reverse Engineering (.zip, shader, .bin, LUT, .so)

- **Unpack Effect Bundles:** Photo editor effects frequently rely on `.zip` materials, shaders (`.glsl`, `.frag`), binary weight meshes (`.bin`, `.onnx`, `.tflite`), or LUT textures. Locate them in `assets/`, `res/raw/`, local cache, or store catalogs.
- **Server Download Endpoints:** If materials are downloaded on-demand, extract the exact API endpoint, query parameters, download headers, and ZIP extraction/caching logic.
- **Deep C++ / .so Inspection:** When facial landmarks, skin retouching, or complex warping logic are hidden in native binaries (`libfacelandmarks.so`, `libEffectSDK.so`, `libfaceretouching.so`), inspect them with `nm`, `strings`, `readelf`, `objdump`, or disassembly to recover hidden API URLs, math transformations, coordinate spaces, and shader codes. Never invent algorithms without native evidence!

- **Actively harvest original assets:** Before creating or updating UI, scan decompiled source `res/drawable*`, `res/mipmap*`, `assets/`, vector XMLs, and store catalogs (`.json`/`.zip`).
- **Extract & copy:** Copy original SVG/PNG/WebP assets into the target project's `assets/icons/` or `assets/images/`.
- **Register & bind:** Declare them in `AppAssets` (generated or static class) and load via `SvgPicture.asset` or `Image.asset`.
- **Zero generic fallback icons:** Do NOT substitute with generic framework icons (e.g. `Icons.star`, `Icons.tune`, `Icons.face`) when original icons exist in the artifact or decompiled source.

## Plan phase

Inventory the artifact, decompiled code, resources, manifest/configuration, source target, screenshots, and the target project's build/test commands. Locate the probable feature entry point by strings, resource IDs, routes, assets, call sites, and behavior; validate candidates with their callers.

Create small dependency-aware vertical slices without omitting any sub-feature. A slice must have an observable outcome and include the evidence to inspect. Order foundational data/auth/configuration before dependent UI flows. Include normal, loading, empty, error, success, pagination/refresh and navigation states where applicable.

For each slice identify expected source areas, target areas, risks, and verification. Record the source-to-target map, API/JSON leads, native/JNI leads, unverified assumptions, and task queue in the supervisor files requested by the prompt.

## Build phase

Trace and implement one task at a time according to `FEATURE_REVERSE_ENGINEERING.md`. Update all layers required for the selected flow: model/parser, service/repository, business/state logic, event handling, and rendered UI. Follow the target architecture rather than mechanically copying decompiler output.

### Auditing Pre-existing Code & Logic Parity Reconciliation (So sánh và sửa code cũ)
When files for the current task already exist in the target project:
- **Never trust existing code blindly:** Treat existing Dart files as unverified drafts.
- **Side-by-side comparison:** Open the decompiled source (Java/Kotlin/C++/JSON) as Ground Truth and compare it directly against the existing Dart implementation.
- **Trace & pinpoint logic bugs:**
  1. *Input & Range Parity:* Check if parameters (min, max, default, step, inversion) match the original code.
  2. *Math & Transformation Parity:* Check coordinate spaces, matrix transforms, and calculation formulas.
  3. *Data & API Parity:* Verify JSON field names, data types, query params, and parser mappings.
  4. *State & Lifecycle Parity:* Verify GetX reactive state (`.obs`), callbacks, and canvas repaints.
- **Proactive Refactoring:** If existing code has wrong assumptions, inverted logic, or missing steps, immediately refactor and correct it to achieve 100% logic parity with the decompiled ground truth.

For API and JSON, identify actual calls, trigger conditions, request order and dependency, serialized request fields, response path, null/default handling, model mapping, filtering/sorting/grouping/pagination, item IDs, and UI use. Verify the whole path from interaction through request/response to render. An endpoint declaration alone is not a complete contract.

If native affects the task, continue past `native` declarations and `System.loadLibrary`: map Java/Kotlin method ↔ JNI signature ↔ native function through exports or `RegisterNatives`; then trace native inputs, outputs, error paths, buffers/encoding, callbacks, and callers. Use disassembly with pseudocode as supporting analysis, not proof. Confirm algorithms, serialization, signing, compression, or encryption only from evidence and, when available, test vectors or permitted runtime observations.

For photo/effect tools (Beauty, Face, Makeup, Filter, Crop), establish the parameter mapping table:
`UI Control -> Source Event/Resource -> Parameter/Effect Key -> Range/Default -> Landmark/Mask -> Render/Native Path -> Dart Target`.

Run the relevant build/tests after changes. Record changed target files, evidence, checks, outcomes, and unresolved gaps in the requested build report.

## Review phase

Review independently. Compare the changed flow to source evidence and inspect the actual diff, not only the build report. Verify that API/JSON mapping, state transitions, loading/error/empty paths, identifiers, navigation, and native claims are coherent. Check that mocks and guessed data are not silently used as the main implementation.

Verify that original assets/icons were properly harvested and used in the UI, and that no generic placeholder icons or fake ads remain.

Run focused verification where it adds evidence. Fail the review when a main-path placeholder, unsupported inference, missing required validation, or unrelated regression remains. End with the exact verdict requested by the supervisor.
