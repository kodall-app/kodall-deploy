# kodall-one-deploy

A fast, modern CLI tool and TypeScript library to package, bundle, and deploy web applications to ONE Framework / Kodall instances with multi-environment support, framework auto-detection, instant rollbacks, live health monitoring, and zero runtime dependencies.

[**Explore the docs »**](https://developer.oneerp.ro/)

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Framework Auto-Detection](#framework-auto-detection)
5. [Configuration (`kodall-webapp.config.json`)](#configuration-kodall-webappconfigjson)
   - [Multi-Environment Configuration](#multi-environment-configuration)
   - [Configuration Fields Reference](#configuration-fields-reference)
   - [Resolution & Priority Order](#resolution--priority-order)
6. [CLI Usage](#cli-usage)
   - [Commands & Options](#commands--options)
   - [Environment Variables](#environment-variables)
   - [Common CLI Examples](#common-cli-examples)
7. [Environment Management](#environment-management)
8. [Live Remote Status Dashboard](#live-remote-status-dashboard)
9. [Deployment History & Instant Rollback](#deployment-history--instant-rollback)
10. [CI / CD Pipeline Integration (`--init-ci`)](#ci--cd-pipeline-integration---init-ci)
11. [Programmatic API](#programmatic-api)
    - [`deploy(options)`](#deployoptions)
    - [`rollback(options)`](#rollbackoptions)
    - [`listEnvironments(configPath)`](#listenvironmentsconfigpath)
    - [`checkAllEnvironmentsStatus(configPath)`](#checkallenvironmentsstatusconfigpath)
12. [TypeScript Types](#typescript-types)
13. [Troubleshooting & FAQ](#troubleshooting--faq)
14. [License](#license)

---

## Features

* ⚡ **Framework Auto-Detection**: Instant zero-config setup detecting Vite, Next.js, Nuxt, Vue, Angular, SvelteKit, Remix, Astro, and Static HTML.
* 🔨 **Stale & Missing Build Detection**: Checks if source code was modified after the last build and offers one-click rebuild before deploying.
* 🩺 **Post-Deploy Live Health Check**: Automatically pings your live endpoint after deploy to verify `200 OK` status and display server latency.
* 📜 **Deployment History & Instant Rollback**: Sub-second rollback to any previous storage build (`--rollback`) with zero rebuild or re-upload.
* ⚙️ **Environment Management Suite**: Add, remove, clone, list, and set default environments directly from CLI flags or interactive menus.
* 📊 **Live Remote Status Dashboard**: Inspect live server availability, active storage IDs, and response latency across all instances simultaneously (`--status`).
* 🤖 **CI/CD Workflow Generator**: Generate ready-to-run automated pipeline files for GitHub Actions, GitLab CI, or Bitbucket Pipelines (`--init-ci`).
* 🌍 **Multi-Environment Batch Deployments**: Deploy to specific environments (`-e dev,staging`), categories (`--type prod`), or all servers sequentially (`--all`).
* 🔐 **Flexible Authentication**: Supports API Key tokens and Username/Password with automatic session and CSRF handling.
* 🧪 **Dry-Run Mode**: Test configurations, authentication, and server routes without uploading or mutating files (`--dry-run`).
* 🛡️ **Zero Workspace Pollution**: Temp archives are created in OS temporary folders and cleaned up automatically.
* 📦 **CLI & Library**: Use as an interactive or headless CLI (`npx one-deploy`) or import as a TypeScript/ESM/CJS library.

---
[↑ back to top](#kodall-one-deploy)

## Installation

### Global CLI
```bash
npm install -g kodall-one-deploy
```

### In Project (devDependency)
```bash
npm install -D kodall-one-deploy
```

### Direct Execution with `npx`
```bash
npx kodall-one-deploy [options]
# or
npx one-deploy [options]
```

---
[↑ back to top](#kodall-one-deploy)

## Quick Start

### 1. Initialize Configuration
Run the interactive wizard to detect your framework and generate `kodall-webapp.config.json`:

```bash
npx one-deploy --init
```

### 2. Deploy Web App
```bash
# Interactive menu or default environment
npx one-deploy

# Deploy to specific environment
npx one-deploy -e dev
npx one-deploy -e prod

# Dry run (test config & auth without deploying)
npx one-deploy -e prod --dry-run
```

---
[↑ back to top](#kodall-one-deploy)

## Framework Auto-Detection

When running `--init`, `--add-env`, or custom deployments, `kodall-one-deploy` automatically inspects your project layout and dependencies:

| Framework | Detected Output Directory |
|---|---|
| **Vite** / **Vue** | `./dist` |
| **Next.js (Static)** | `./out` |
| **Angular** | `./dist/<project-name>` |
| **SvelteKit** | `./build` |
| **Nuxt (Static)** | `./.output/public` |
| **Remix** | `./build/client` |
| **Create React App** | `./build` |
| **Astro** | `./dist` |
| **Static HTML** | `.` |

---
[↑ back to top](#kodall-one-deploy)

## Configuration (`kodall-webapp.config.json`)

`kodall-one-deploy` reads settings from `kodall-webapp.config.json` in your project root (or a custom path passed via `--config <path>`).

> [!NOTE]
> **Automatic Migration**: When running `npx one-deploy`, any legacy `config_web_app.json` or flat single-instance configuration is automatically converted to the new multi-environment `kodall-webapp.config.json` format.

### Multi-Environment Configuration

Define common defaults at the top level and environment-specific overrides in the `environments` map:

```json
{
  "web_app_name": "my-portal",
  "web_app_path": "my-portal",
  "dist_path": "./dist",
  "default_env": "dev",
  "environments": {
    "dev": {
      "type": "dev",
      "instance": "https://dev.instance.kodall.ro"
    },
    "staging": {
      "type": "staging",
      "instance": "https://staging.instance.kodall.ro",
      "api_key": "staging-secret-api-key"
    },
    "prod": {
      "type": "prod",
      "instance": "https://app.kodall.ro",
      "api_key": "prod-secret-api-key"
    }
  }
}
```

### Configuration Fields Reference

| Field | Type | Description | Required |
|---|---|---|---|
| `web_app_name` | `string` | WebApp entity name in ONE Framework / Kodall. | Yes |
| `web_app_path` | `string` | URL route where web app is served (auto-prefixed with `/`). | Yes |
| `dist_path` | `string` | Local folder containing build assets. Must contain `index.html`. | Optional (default: `./dist`) |
| `default_env` | `string` | Default environment name to use if `--env` is omitted. | Optional (default: `dev`) |
| `environments` | `object` | Map of environment definitions (`dev`, `staging`, `prod`, etc.). | Yes |
| `environments[name].instance` | `string` | Base URL of ONE Framework instance (e.g. `https://app.domain.com`). | Yes |
| `environments[name].type` | `string` | Category of environment: `"dev"`, `"staging"`, `"prod"`, `"test"`. | Optional |
| `environments[name].api_key` | `string` | API Key for authentication (bypasses username & password prompt). | Optional |
| `environments[name].web_app_path` | `string` | Environment-specific URL route override. | Optional |
| `environments[name].dist_path` | `string` | Environment-specific build directory override. | Optional |

### Resolution & Priority Order

Parameters are resolved in the following strict order (highest priority first):

1. **CLI Flags**: (`--instance`, `--name`, `--path`, `--dist`, `--user`, `--password`, `--api-key`, `--env`, `--type`, `--all`)
2. **Environment Variables**: (`ONE_INSTANCE`, `ONE_APP_NAME`, `ONE_APP_PATH`, `ONE_DIST_PATH`, `ONE_USERNAME`, `ONE_PASSWORD`, `ONE_API_KEY`, `ONE_ENV`)
3. **Environment Overrides**: Block in `kodall-webapp.config.json` under `environments[targetEnv]`
4. **Top-Level Defaults**: Values in root of `kodall-webapp.config.json` (`web_app_name`, `web_app_path`, `dist_path`)
5. **Interactive Wizard**: Prompted fallback for missing values (skipped when `--ci` is active)

---
[↑ back to top](#kodall-one-deploy)

## CLI Usage

### Commands & Options

```text
USAGE:
  $ one-deploy [options]
  $ npx kodall-one-deploy [options]

OPTIONS:
  -e, --env <name>          Target environment(s) (e.g., dev, prod, or comma-separated "dev,staging")
  -t, --type <type>         Deploy all environments of given type (e.g., dev, staging, prod)
      --all                 Deploy to ALL configured environments sequentially
  -i, --instance <url>      Instance base URL (e.g., https://app.domain.com)
  -n, --name <name>         WebApp name in ONE Framework
  -p, --path <path>         URL path where web app is served
  -d, --dist <dir>          Path to build directory containing index.html [default: ./dist]
  -u, --user <username>     ONE Framework login username
  -P, --password <password> ONE Framework login password
  -k, --api-key <key>       API key authentication (bypasses username/password)
      --token <token>       OAuth / OpenID Connect access token (bypasses username/password)
  -c, --config <file>       Path to config file [default: kodall-webapp.config.json]
  -l, --list-envs           List all configured environments in a table
  -s, --status [env]        Display live status & health dashboard for environment(s)
      --add-env [name]      Add or update an environment in kodall-webapp.config.json
      --remove-env [name]   Remove an environment from configuration
      --clone-env <src> [dst] Duplicate/clone an existing environment
      --set-default <name>  Set default deployment environment
  -H, --history             Display deployment history for environment(s)
  -R, --rollback [storage]  Roll back web application to a previous storage build
      --build               Force running "npm run build" before deploying
      --no-build            Skip build check and build prompts
      --no-health-check     Skip post-deployment live HTTP health check ping
      --init-ci             Generate CI/CD pipeline (GitHub Actions, GitLab CI, Bitbucket)
      --ci                  Non-interactive CI mode (fail if required parameters are missing)
      --dry-run             Validate build, test auth and query entity without mutating
      --init                Interactively generate or update kodall-webapp.config.json
  -v, --version             Display CLI version
  -h, --help                Display help message
```

### Environment Variables

| Variable | Description |
|---|---|
| `ONE_ENV` / `KODALL_ENV` | Target environment name |
| `ONE_INSTANCE` / `KODALL_INSTANCE` | Instance URL |
| `ONE_APP_NAME` / `KODALL_APP_NAME` | WebApp name |
| `ONE_APP_PATH` / `KODALL_APP_PATH` | WebApp URL path |
| `ONE_DIST_PATH` / `KODALL_DIST_PATH` | Path to build directory |
| `ONE_USERNAME` / `ONE_USER` | Login username |
| `ONE_PASSWORD` | Login password |
| `ONE_API_KEY` / `KODALL_API_KEY` | API Key |
| `ONE_TOKEN` / `KODALL_TOKEN` | OAuth / OpenID Connect Access Token |

### Common CLI Examples

```bash
# 1. Open main interactive menu
npx one-deploy

# 2. Deploy to specific environment
npx one-deploy -e prod

# 3. Deploy to all production environments (e.g. prod-us, prod-eu)
npx one-deploy --type prod

# 4. Deploy to ALL configured environments sequentially
npx one-deploy --all

# 5. List configured environments
npx one-deploy -l

# 6. Check live remote status dashboard across all servers
npx one-deploy -s

# 7. View deployment history for production
npx one-deploy -H -e prod

# 8. Roll back production to a previous build interactively
npx one-deploy --rollback -e prod

# 9. Roll back directly to Storage ID 137 (instant restore)
npx one-deploy --rollback 137 -e prod

# 10. Generate CI/CD workflow for GitHub Actions / GitLab / Bitbucket
npx one-deploy --init-ci

# 11. Headless CI deployment with credentials
npx one-deploy -e prod -u "$ONE_USER" -P "$ONE_PASSWORD" --ci

# 12. Dry run verification
npx one-deploy -e prod --dry-run
```

---
[↑ back to top](#kodall-one-deploy)

## Environment Management

Manage environments without manually editing JSON files:

```bash
# List all configured environments with default indicator, type, and auth mode
npx one-deploy --list-envs

# Add or update an environment
npx one-deploy --add-env uat

# Clone / duplicate an existing environment
npx one-deploy --clone-env dev dev2

# Set default deployment environment
npx one-deploy --set-default prod

# Remove an environment
npx one-deploy --remove-env dev2
```

---
[↑ back to top](#kodall-one-deploy)

## Live Remote Status Dashboard

Inspect live availability, response latency, active storage IDs, and entity status across all configured instances:

```bash
npx one-deploy --status
# or for a specific environment
npx one-deploy --status prod
```

Output:
```text
📊 Live Remote Environment Status:

  DEFAULT   ENV NAME        HEALTH          HTTP CODE       LATENCY     STORAGE ID    ENTITY KEY    ROUTE PATH          INSTANCE URL
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ★         dev             ● ONLINE        200 OK          112ms       144           102           /my-app             https://dev.kodall.ro
            prod            ● ONLINE        200 OK           85ms       139           94            /my-app             https://app.kodall.ro
```

---
[↑ back to top](#kodall-one-deploy)

## Deployment History & Instant Rollback

Every successful deployment is tracked in `.one-deploy/history.json`.

```bash
# View deployment history
npx one-deploy --history
npx one-deploy -H -e prod

# Interactive rollback
npx one-deploy --rollback -e prod

# Instant direct rollback by Storage ID
npx one-deploy --rollback 144 -e prod
```

---
[↑ back to top](#kodall-one-deploy)

## CI / CD Pipeline Integration (`--init-ci`)

Run `npx one-deploy --init-ci` to automatically generate ready-to-use workflows for your CI platform.

### GitHub Actions (`.github/workflows/one-deploy.yml`)

```yaml
name: Deploy to ONE Framework

on:
  push:
    branches: ["develop", "main"]

jobs:
  deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build web application
        run: npm run build

      - name: Deploy to ONE Framework / Kodall
        env:
          ONE_API_KEY: ${{ secrets.ONE_API_KEY }}
          ONE_INSTANCE: ${{ secrets.ONE_INSTANCE }}
        run: |
          case "${{ github.ref_name }}" in
            "develop") npx kodall-one-deploy --ci -e dev ;;
            "main") npx kodall-one-deploy --ci -e prod ;;
            *) echo "No deployment mapping found for branch ${{ github.ref_name }}" && exit 1 ;;
          esac
```

---
[↑ back to top](#kodall-one-deploy)

## Programmatic API

Use `kodall-one-deploy` directly inside custom build scripts, release automations, or Node.js tools:

```typescript
import {
  deploy,
  rollback,
  listEnvironments,
  checkAllEnvironmentsStatus,
  getDeploymentHistory,
} from "kodall-one-deploy";
```

### `deploy(options)`

Coordinates the full deployment lifecycle:

```typescript
import { deploy, DeployResult } from "kodall-one-deploy";

const result: DeployResult = await deploy({
  instance: "https://dev.instance.kodall.ro",
  webAppName: "my-portal",
  webAppPath: "/my-portal",
  distPath: "./dist",
  apiKey: process.env.ONE_API_KEY,
  onProgress: (step, status, message) => {
    console.log(`[${step}] ${status}: ${message}`);
  },
});

console.log("Success:", result.action, "Storage ID:", result.storageId);
```

### `rollback(options)`

Restores a web application to a previous storage build without re-uploading:

```typescript
import { rollback } from "kodall-one-deploy";

const result = await rollback({
  env: "prod",
  targetStorageId: 144, // or stepsBack: 1
  apiKey: process.env.ONE_API_KEY,
});

console.log(`Restored Storage ID: ${result.toStorageId}`);
```

### `listEnvironments(configPath)`

```typescript
import { listEnvironments } from "kodall-one-deploy";

const envs = listEnvironments("kodall-webapp.config.json");
console.log(envs);
```

### `checkAllEnvironmentsStatus(configPath)`

```typescript
import { checkAllEnvironmentsStatus } from "kodall-one-deploy";

const statuses = await checkAllEnvironmentsStatus("kodall-webapp.config.json");
console.log(statuses);
```

---
[↑ back to top](#kodall-one-deploy)

## TypeScript Types

Exported TypeScript interfaces:

```typescript
import type {
  DeployOptions,
  DeployResult,
  RollbackOptions,
  RollbackResult,
  DeploymentRecord,
  EnvironmentInfo,
  RemoteEnvironmentStatus,
  CIWorkflowOptions,
  CIWorkflowResult,
  ResolvedConfig,
  WebAppConfigFile,
  EnvironmentConfig,
  DetectedProject,
  BuildCheckResult,
  HealthCheckResult,
} from "kodall-one-deploy";
```

---
[↑ back to top](#kodall-one-deploy)

## Troubleshooting & FAQ

### `Create error: Path must start with '/'`
* **Fix**: `kodall-one-deploy` automatically prefixes your `web_app_path` with `/` if omitted.

### `Missing index.html in build directory`
* **Fix**: Run `npm run build` or pass `--build` to let `kodall-one-deploy` automatically compile your project before deploying.

### `Authentication failed with status 401`
* **Fix**: Check `ONE_USERNAME` / `ONE_PASSWORD` or verify your `ONE_API_KEY` token permissions on your instance.

### `503 Service Unavailable / Offline Backend`
* **Fix**: Run `npx one-deploy -s` to verify whether the backend instance is online and reachable.

---
[↑ back to top](#kodall-one-deploy)

## License

[MIT](LICENSE)
