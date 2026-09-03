# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.3] - 2026-09-03

### Added
- **Multi-Framework Live Proxy Adapters** ([Docs](https://docs.kodall.io/sdk/web-app-deployment/local-dev-proxy#3-layer-proxy-architecture)):
  - `kodallProxyNuxt`: Nuxt 3 module with automated dev proxy injection ([Docs](https://docs.kodall.io/sdk/web-app-deployment/local-dev-proxy#2-nuxt-3--nuxt-4)).
  - `createNextProxyHandler`: Next.js App Router catch-all route proxy handler ([Docs](https://docs.kodall.io/sdk/web-app-deployment/local-dev-proxy#3-nextjs)).
  - `kodallProxyWebpack`: Webpack DevServer / Angular CLI / CRA `setupMiddlewares` proxy table helper ([Docs](https://docs.kodall.io/sdk/web-app-deployment/local-dev-proxy#architecture-principles)).
  - `kodallProxyAngular`: Angular CLI `proxy.conf.json` helper ([Docs](https://docs.kodall.io/sdk/web-app-deployment/local-dev-proxy#4-angular-cli)).
- **Local Active Proxy State Isolation** ([Docs](https://docs.kodall.io/sdk/web-app-deployment/kodall-deploy#environment-management-suite)):
  - `kodall-deploy use <env>` and `switch <env>` save active local targets to `.kodall-deploy/active-env` (untracked and gitignored).
  - Keeps `kodall-webapp.config.json` clean in source control without dirtying working trees or altering CI/CD deployment targets.
- **Dedicated Deployment vs Proxy Commands** ([Docs](https://docs.kodall.io/sdk/web-app-deployment/kodall-deploy#cli-options-reference)):
  - `kodall-deploy --set-default <env>`: Explicitly updates `default_env` in `kodall-webapp.config.json` for deployment defaults.
  - `kodall-deploy --clear-active`: Clears local active dev proxy override and reverts to config file defaults.
  - `kodall-deploy -l` / `--list-envs`: Displays environment table with both `DEFAULT` (`★` deploy target) and `PROXY` (`▶` active local dev proxy) indicators.
- **Modular CLI Architecture**:
  - Refactored CLI into modular subcommands under `src/commands/` (`deploy`, `envs`, `status`, `history`, `rollback`, `init`, `ci`, `auth-probe`).

### Fixed
- **Live Proxy Environment Switching During `npm run dev`**: Added dynamic `router` function to `getDevProxy` and `kodallVitePlugin`. Switching proxy targets now takes effect immediately per-request without requiring dev server restarts ([Docs](https://docs.kodall.io/sdk/web-app-deployment/local-dev-proxy#1-vite-vue-3-react-sveltekit-solidjs)).
- **Configuration Decoupling**: Fixed `kodall-deploy use` modifying `default_env` in `kodall-webapp.config.json` which caused accidental target changes in non-interactive / CI deployments.

---

## [1.2.2] - 2026-09-01

### Added
- **Native Dev Proxy Helpers**:
  - Added `kodallVitePlugin` / `@kodall/kodall-deploy/plugin/vite` for automated dev proxy configuration in Vite projects.
  - Added `getDevProxy` and `resolveProxyConfig` for programmatic dev proxy resolution.
  - Added `kodall-deploy use [env]` and `kodall-deploy switch [env]` commands.
- Comprehensive test coverage reaching 100% across all core modules, Kodall API client, and ANSI UI utilities (256 automated unit and integration tests).
- Automated CI test suites with Vitest.

### Security
- Hardened URL and path sanitization to prevent traversal and malformed target instances.
- Secure PKCE OAuth 2.0 loopback server cleanup and error handling.

### Fixed
- Fixed packaging and dual ESM/CJS exports in `tsup.config.ts`.

---

## [1.2.0] - 2026-08-24

### Added
- **TypeScript Rewrite & Rebrand to `@kodall/kodall-deploy`**: Migrated and upgraded from legacy `one-deploy` / `kodall-one-deploy` codebase into modern TypeScript package.
- **Multi-Environment Configuration**:
  - Configuration schema supporting `environments: { dev, staging, prod, ... }` in `kodall-webapp.config.json`.
  - Batch deployments with `--all`, `--type <type>`, and comma-separated `-e dev,staging`.
  - Automatic migration from legacy `.one-deploy.json` configuration files.
- **Live Remote Status Dashboard (`--status`)**:
  - Real-time HTTP health check, latency measurement, active storage ID, and entity key inspection across instances.
- **Deployment History & Instant Rollback**:
  - Local deployment audit log (`.kodall-deploy/history.json`).
  - Server-side rollback and `web_app_log` / `storage_file_version` querying for Kodall instances `>= 1.8.0`.
- **1-Click OAuth 2.0 / OpenID Connect PKCE Login**:
  - Automatic detection of OpenID Connect authentication endpoints.
  - Interactive browser-based authentication flow capturing and caching access tokens.
  - Multi-environment batch deployment realm session reuse (one login per realm).
- **CI/CD Pipeline Generator**:
  - Interactive `kodall-deploy --init-ci` command.
  - Support for 7 CI/CD platforms: GitHub Actions, GitLab CI, Bitbucket Pipelines, Jenkins, Azure DevOps, CircleCI, AWS CodeBuild.
- **Framework Auto-Detection**:
  - Automatic detection of Vite, Next.js, Nuxt, Angular, Astro, SvelteKit, React, Vue projects and build output directories.
- **Pre-Deployment Build Verification**:
  - Stale build detection comparing source files against build artifact timestamps.
  - Post-deployment live HTTP health check ping.
