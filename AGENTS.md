# Repository Guidelines

## Project Structure & Module Organization

This repository is a Next.js App Router application. UI and route handlers live under `app/`; shared TLR schemas, citation validation, provider metadata, and server adapters live under `lib/`. Unit tests are in `tests/`, while browser flows are in `e2e/`. Deployment files (`Dockerfile`, `compose.yaml`) stay at the repository root. Keep API keys and legal queries out of fixtures, logs, screenshots, and committed environment files.

## Build, Test, and Development Commands

- `npm run dev` — run the local app at `http://localhost:3000`.
- `npm run lint` — check TypeScript and Next.js lint rules.
- `npm test` — run Vitest unit and route tests.
- `npm run build` — create the standalone production build.
- `npm run test:e2e` — run mocked Playwright user flows and accessibility checks.
- `docker compose up --build` — build and run the self-hosted container.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, semicolons, and double quotes. Components and exported types use `PascalCase`; functions, variables, and route helpers use `camelCase`. Keep Zod schemas beside their inferred types in `lib/contracts.ts`. Prefer server-side provider adapters for built-in vendors; arbitrary custom endpoints must remain browser-direct to avoid SSRF.

## Testing Guidelines

Add unit coverage for Bundle validation, allowed/unread citation rules, raw case-number rejection, provider failures, and case-history warnings. E2E tests must mock TLR and model APIs—never consume real keys or quotas. A legal finding without an allowed `J` citation is expected to fail closed.

## Commit & Pull Request Guidelines

Use concise imperative commits, such as `Add Gemini explanation adapter`. Keep changes narrowly scoped. Pull requests should explain user-visible behavior, privacy or provider-flow changes, test commands run, and Docker impact. Include screenshots for visual changes, but redact all query content and credentials.

## Security & Legal Boundaries

Do not persist API keys, queries, Bundles, or AI answers in cookies, Web Storage, databases, or analytics. Do not add web-search tools to model calls. UI wording must describe validation as structural—not proof that an AI legal interpretation is correct.
