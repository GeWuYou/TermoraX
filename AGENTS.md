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
- Generated Rust code must include standard Rust documentation/comments on public items and non-obvious logic.
- React/TypeScript frontend code should include necessary comments for non-obvious state flow, side effects, and UX logic, but avoid trivial comments.

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
- User-visible features should ship with necessary tests. For frontend, prefer component/state tests around the changed behavior. For Rust, prefer unit tests around service and validation logic.
- When delegating work, choose the smallest capable sub-agent for bounded tasks and the stronger model for architecture-heavy or backend-heavy work. Current session should treat `gpt-5.4` as the default for complex Rust/backend tasks and use the available lightweight codex mini model for narrower frontend/component tasks when appropriate.

## AI Agent Rules

### Language
- Code comments in both Rust and TypeScript should be written in English.
- User-facing text (UI copy, logs intended for users) should default to Simplified Chinese.
- Documentation inside this repository (e.g., README, AGENTS.md) should primarily use English, with optional Chinese explanations where helpful.

### Task Delegation Strategy
- Use `gpt-5.4` for:
    - Architecture design
    - Rust backend/services
    - Cross-layer changes (frontend + backend)
    - Complex state or concurrency logic

- Use lightweight models (e.g., `gpt-5.4-mini` or Codex mini) for:
    - React components
    - UI styling and layout
    - Small refactors
    - Isolated TypeScript utilities

- Prefer the smallest capable model that can complete the task correctly to reduce cost and latency.

### Execution Guidelines
- Break large tasks into smaller, well-defined subtasks before delegating.
- Clearly define input/output expectations for sub-agents.
- Avoid mixing multiple domains (e.g., SSH + UI + persistence) in a single task unless necessary.

### Planning Maintenance
- Keep planning artifacts under `plan/`.
- When implementing work, update `plan/TODO.md` continuously so completed items are checked off in the same turn whenever practical.
- When a roadmap milestone or the entire current TODO set is completed, update `plan/ROADMAP.md` to reflect the new status.
- When `plan/TODO.md` is fully completed, archive the old TODO into `plan/archive/` with a timestamped filename, regenerate a fresh `plan/TODO.md` for the next phase, and refresh `plan/ROADMAP.md` to match the new backlog.
