# AGENTS.md

## Product Direction
- This repository is building `TermoraX`, a desktop SSH/SFTP workspace inspired by the problem space of FinalShell.
- V1 scope is `SSH + SFTP + workspace shell + built-in extension points`.
- Do not introduce a third-party plugin marketplace or dynamic external plugin loading in V1.
- Localization baseline is Simplified Chinese. Startup should detect the system locale and keep a clear extension point for future non-Chinese language packs.

## Stack
- Frontend: React 19 + TypeScript + Vite
- Desktop host: Tauri 2
- Backend/runtime boundary: Rust

## Architecture Rules
- Keep frontend code organized by business domain under `src/features`, with app bootstrap in `src/app`, shared domain types in `src/entities`, and reusable primitives in `src/shared`.
- All host/runtime calls must go through `src/integrations/tauri`. UI components should not call `invoke` directly.
- Rust `commands` are a thin boundary layer. Non-trivial behavior belongs in `src-tauri/src/services`.
- Domain models that cross the frontend/backend boundary must be explicitly defined and kept aligned in TypeScript and Rust.
- New UI capabilities should prefer registration-style design over hardcoded menus or sidebars when practical.

## Implementation Priorities
- First make the core workspace loop stable: connection profiles, session lifecycle, right-side panels, persisted settings.
- Add real SSH/SFTP transport behind the existing command boundary rather than bypassing the current structure.
- Treat session transport, file transfer, snippets, and settings as separate domains even when the UI composes them together.

## Persistence And Security
- Do not scatter credential handling across React component state beyond short-lived form editing.
- Any persisted schema change must consider backward compatibility for the local state file.
- Prefer a single backend-owned persistence flow instead of frontend-written local files.

## Quality Bar
- New Tauri commands must have matching frontend client wrappers.
- New feature work should cover success flow and failure flow, not just happy-path rendering.
- Avoid dumping new product logic back into `src/App.tsx` or `src-tauri/src/lib.rs`; keep those as entry shims.
- If a feature is stubbed or simulated, label it clearly in UI copy and code comments where needed.
