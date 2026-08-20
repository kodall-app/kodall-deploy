# kodall-one-deploy

A fast, modern CLI tool and TypeScript library to package, bundle, and deploy web applications to ONE Framework / Kodall instances with multi-environment support, session cookie / CSRF handling, and zero-dependency runtime footprint.

[**Explore the docs »**](https://developer.oneerp.ro/)

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Configuration (`config_web_app.json`)](#configuration-config_web_appjson)
   - [Multi-Environment Configuration](#multi-environment-configuration)
   - [Legacy Flat Configuration (Backward Compatible)](#legacy-flat-configuration-backward-compatible)
   - [Configuration Fields Reference](#configuration-fields-reference)
   - [Resolution & Priority Order](#resolution--priority-order)
5. [CLI Usage](#cli-usage)
   - [Commands & Options](#commands--options)
   - [Environment Variables](#environment-variables)
   - [Common CLI Examples](#common-cli-examples)
6. [Programmatic API](#programmatic-api)
   - [`deploy(options)`](#deployoptions)
   - [`DeployOptions` Interface](#deployoptions-interface)
   - [`DeployResult` Interface](#deployresult-interface)
7. [TypeScript Types](#typescript-types)
8. [CI / CD Pipeline Integration](#ci--cd-pipeline-integration)
   - [Bitbucket Pipelines](#bitbucket-pipelines)
   - [GitHub Actions](#github-actions)
   - [GitLab CI](#gitlab-ci)
9. [Troubleshooting & FAQ](#troubleshooting--faq)
10. [License](#license)

---

## Features

* ⚡ **Ultra-Lean Runtime**: Built on native Node 18+ capabilities (`fetch`, `FormData`, `Blob`, `util.parseArgs`, `readline`).
* 🌍 **Multi-Environment Support**: Target `dev`, `staging`, `prod`, and custom environments from a single configuration file.
* 🔐 **Flexible Authentication**:
  * Username & Password (with automatic session cookie management and `X-CSRF-TOKEN` extraction).
  * API Key / Security Token (`api_key` in config, `--api-key` flag, or `ONE_API_KEY` env var).
* 🛡️ **Zero Workspace Pollution**: Compresses archives inside OS temporary directories with guaranteed auto-cleanup.
* 🤖 **CI/CD & Headless Ready**: CLI flags & environment variables allow 100% headless, non-interactive execution (`--ci`).
* 🧪 **Dry-Run Mode**: Validate files, authentication, and entity existence without uploading or mutating data (`--dry-run`).
* 🔄 **Smart Entity Operations**: Automatically queries `FETCH web_app` and either creates or updates the entity.
* 📦 **Dual Output**: Use as a global/local CLI (`one-deploy`, `kodall-deploy`) or import as a TypeScript/ESM/CJS library.

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
Run the interactive wizard to generate `config_web_app.json`:

```bash
npx one-deploy --init
```

### 2. Deploy Web App
```bash
# Interactive or default environment
npx one-deploy

# Deploy to specific environment
npx one-deploy -e dev
npx one-deploy -e prod

# Dry run (test config & auth without deploying)
npx one-deploy -e prod --dry-run
```

---
[↑ back to top](#kodall-one-deploy)

## Configuration (`config_web_app.json`)

`kodall-one-deploy` reads settings from `config_web_app.json` in your project root (or a custom path passed via `--config <path>`).

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
    "prod-us": {
      "type": "prod",
      "instance": "https://us.instance.kodall.ro",
      "api_key": "us-secret-key"
    },
    "prod-eu": {
      "type": "prod",
      "instance": "https://eu.instance.kodall.ro",
      "api_key": "eu-secret-key"
    }
  }
}
```

### Legacy Flat Configuration (Backward Compatible)

Legacy `one-deploy` v1.x configurations are supported automatically without modification:

```json
{
  "web_app_name": "my-portal",
  "web_app_path": "my-portal",
  "instance": "https://dev.instance.kodall.ro",
  "dist_path": "./dist"
}
```

### Configuration Fields Reference

| Field | Type | Description | Required |
|---|---|---|---|
| `web_app_name` | `string` | Entity name in ONE Framework / Kodall. | Yes |
| `web_app_path` | `string` | URL route where web app is served (auto-prefixed with `/`). | Yes |
| `instance` | `string` | Base URL of ONE Framework instance (e.g. `https://app.domain.com`). | Yes |
| `dist_path` | `string` | Local folder containing build assets. Must contain `index.html`. | Optional (default: `./dist`) |
| `api_key` | `string` | API Key for authentication (bypasses username & password prompt). | Optional |
| `type` | `string` | Category of environment: `"dev"`, `"staging"`, `"prod"`, `"test"`. | Optional |
| `default_env` | `string` | Default environment name to use if `--env` is omitted. | Optional (default: `dev`) |
| `environments` | `object` | Map of environment overrides (`dev`, `staging`, `prod`, etc.). | Optional |

### Resolution & Priority Order

Parameters are resolved in the following strict order (highest priority first):

1. **CLI Flags**: (`--instance`, `--name`, `--path`, `--dist`, `--user`, `--password`, `--api-key`, `--env`, `--type`, `--all`)
2. **Environment Variables**: (`ONE_INSTANCE`, `ONE_APP_NAME`, `ONE_APP_PATH`, `ONE_DIST_PATH`, `ONE_USERNAME`, `ONE_PASSWORD`, `ONE_API_KEY`, `ONE_ENV`)
3. **Environment Overrides**: Block in `config_web_app.json` under `environments[targetEnv]`
4. **Top-Level Defaults**: Values in root of `config_web_app.json`
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
  -c, --config <file>       Path to config file [default: config_web_app.json]
      --add-env [name]      Add or update an environment in config_web_app.json
      --ci                  Non-interactive CI mode (fail if required parameters are missing)
      --dry-run             Validate build, test auth and query entity without mutating
      --init                Interactively generate or update config_web_app.json
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

### Common CLI Examples

```bash
# 1. Deploy to all production environments (e.g. prod-us, prod-eu)
npx one-deploy --type prod

# 2. Deploy to ALL configured environments sequentially
npx one-deploy --all

# 3. Deploy to specific comma-separated environments
npx one-deploy -e dev,staging

# 4. Add a new custom environment to config_web_app.json
npx one-deploy --add-env client-b
# or interactive wizard
npx one-deploy --add-env

# 5. Interactive deployment (prompts if anything is missing)
npx one-deploy

# 6. Deploy to staging using config_web_app.json
npx one-deploy -e staging

# 7. Deploy to production using API Key
npx one-deploy -e prod -k "2aefed1a-9bc8-49b6-8f5a-e825614bb2b0"

# 8. Headless CI deployment with credentials
npx one-deploy -e prod -u "$ONE_USER" -P "$ONE_PASSWORD" --ci

# 9. Full command-line deployment without any config file
npx one-deploy \
  --instance "https://app.kodall.ro" \
  --name "my-app" \
  --path "/my-app" \
  --dist "./build" \
  --api-key "$ONE_API_KEY" \
  --ci

# 10. Dry run verification
npx one-deploy -e prod --dry-run
```

---
[↑ back to top](#kodall-one-deploy)

## Programmatic API

You can use `kodall-one-deploy` directly inside custom build scripts, release automations, or Node.js tools:

```typescript
import { deploy } from "kodall-one-deploy";
```

### `deploy(options)`

Coordinates the full deployment lifecycle (configuration resolution, `dist/index.html` validation, zip compression, authentication, storage upload, and entity create/update).

```typescript
import { deploy, DeployResult } from "kodall-one-deploy";

try {
  const result: DeployResult = await deploy({
    instance: "https://dev.instance.kodall.ro",
    webAppName: "my-portal",
    webAppPath: "/my-portal",
    distPath: "./dist",
    username: "root",
    password: "secretpassword",
    // or apiKey: "your-api-key",
    dryRun: false,
    onProgress: (step, status, message) => {
      console.log(`[${step}] ${status}: ${message}`);
    },
  });

  console.log("Success:", result.action, "Entity Key:", result.entityKey, "Storage ID:", result.storageId);
} catch (error) {
  console.error("Deployment failed:", error);
}
```

### `DeployOptions` Interface

```typescript
interface DeployOptions {
  configPath?: string;
  env?: string;
  instance?: string;
  webAppName?: string;
  webAppPath?: string;
  distPath?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  ci?: boolean;
  dryRun?: boolean;
  silent?: boolean;
  onProgress?: (
    step: string,
    status: "start" | "success" | "warn" | "error" | "info",
    message?: string
  ) => void;
}
```

### `DeployResult` Interface

```typescript
interface DeployResult {
  success: boolean;
  storageId?: number | string;
  entityKey?: number | string;
  action?: "created" | "updated" | "dry-run";
  durationMs: number;
  archiveSizeBytes?: number;
  error?: Error | string;
}
```

---
[↑ back to top](#kodall-one-deploy)

## TypeScript Types

Exported TypeScript interfaces:

```typescript
import type {
  DeployOptions,
  DeployResult,
  ResolvedConfig,
  WebAppConfigFile,
  EnvironmentConfig,
  ArchiveResult,
} from "kodall-one-deploy";
```

---
[↑ back to top](#kodall-one-deploy)

## CI / CD Pipeline Integration

### Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
image: node:20

pipelines:
  branches:
    master:
      - step:
          name: Build & Deploy to Production
          caches:
            - node
          script:
            - npm ci
            - npm run build
            - npx kodall-one-deploy -e prod --ci
          deployment: production
```

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy WebApp

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install & Build
        run: |
          npm ci
          npm run build

      - name: Deploy to ONE Framework
        env:
          ONE_API_KEY: ${{ secrets.ONE_API_KEY }}
        run: |
          npx kodall-one-deploy -e prod --ci
```

### GitLab CI

```yaml
# .gitlab-ci.yml
image: node:20

stages:
  - deploy

deploy_production:
  stage: deploy
  only:
    - main
  script:
    - npm ci
    - npm run build
    - npx kodall-one-deploy -e prod -u "$ONE_USERNAME" -P "$ONE_PASSWORD" --ci
```

---
[↑ back to top](#kodall-one-deploy)

## Troubleshooting & FAQ

### `Create error: Path must start with '/'`
* **Cause**: ONE Framework routes require a leading slash (`/my-app`).
* **Fix**: `kodall-one-deploy` automatically prefixes your `web_app_path` with `/` if omitted.

### `Missing index.html in build directory`
* **Cause**: `dist_path` does not contain `index.html`.
* **Fix**: Verify your build output folder (e.g. `dist`, `build`, `out`) and ensure `npm run build` has run before deploying.

### `Authentication failed with status 401`
* **Cause**: Invalid credentials or expired API key.
* **Fix**: Check `ONE_USERNAME` / `ONE_PASSWORD` or verify your `ONE_API_KEY` token permissions on your instance.

### `Temporary zip files remaining in workspace`
* **Cause**: Previous legacy tools left `web_app.zip` in your working directory.
* **Fix**: `kodall-one-deploy` writes archives to `os.tmpdir()` and automatically cleans them up in a `finally` block.

---
[↑ back to top](#kodall-one-deploy)

## License

[MIT](LICENSE)
