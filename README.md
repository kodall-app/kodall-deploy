# kodall-one-deploy

Fast, modern, zero-fluff CLI and library to build, package, and deploy web applications to ONE Framework / Kodall instances.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- ⚡ **Ultra-Lean Production Footprint**: Built with Node 18+ native `fetch`, `FormData`, `util.parseArgs`, and `node:readline`.
- 🌍 **Multi-Environment Support**: Target `dev`, `staging`, `prod` from a single configuration file.
- 🔑 **Flexible Authentication**: Supports username & password login, session cookies, CSRF tokens, and API Key authentication.
- 🤖 **CI/CD & Headless Ready**: CLI flags & environment variables allow zero-prompt pipeline execution.
- 🛡️ **Workspace Clean**: Archives in OS temporary directories with guaranteed auto-cleanup.
- 📦 **Dual Output**: CLI binary (`one-deploy`, `kodall-deploy`) + Programmatic TypeScript/ESM/CJS library (`import { deploy } from 'kodall-one-deploy'`).
- 🧪 **Dry-Run Mode**: Validate configs, index.html, authentication, and entity existence without mutating the server.

---

## Installation

```bash
# Global CLI
npm install -g kodall-one-deploy

# Or run directly with npx
npx kodall-one-deploy [options]
```

Or as a project devDependency:

```bash
npm install -D kodall-one-deploy
```

---

## Quick Start

### 1. Initialize Configuration
Generate `config_web_app.json` interactively:

```bash
npx one-deploy --init
```

### 2. Multi-Environment Configuration (`config_web_app.json`)

```json
{
  "web_app_name": "my-web-app",
  "web_app_path": "my-web-app",
  "dist_path": "./dist",
  "default_env": "dev",
  "environments": {
    "dev": {
      "instance": "https://dev.instance.onesoftware.ro"
    },
    "staging": {
      "instance": "https://staging.instance.onesoftware.ro",
      "api_key": "optional-staging-api-key"
    },
    "prod": {
      "instance": "https://app.instance.onesoftware.ro",
      "web_app_name": "my-web-app-prod",
      "web_app_path": "production-app",
      "api_key": "optional-prod-api-key"
    }
  }
}
```

> **Backward Compatibility**: Legacy flat `config_web_app.json` files without `environments` are automatically supported.

### 3. Deploy

```bash
# Interactive or default environment
npx one-deploy

# Deploy to specific environment
npx one-deploy -e staging
npx one-deploy -e prod

# Dry run (test config & auth without deploying)
npx one-deploy -e prod --dry-run
```

---

## CLI Usage & Options

```text
USAGE:
  $ one-deploy [options]
  $ npx kodall-one-deploy [options]

OPTIONS:
  -e, --env <name>          Target environment (e.g., dev, staging, prod)
  -i, --instance <url>      Instance base URL (e.g., https://app.domain.com)
  -n, --name <name>         WebApp name in ONE Framework
  -p, --path <path>         URL path where web app is served
  -d, --dist <dir>          Path to build directory containing index.html [default: ./dist]
  -u, --user <username>     ONE Framework login username
  -P, --password <password> ONE Framework login password
  -k, --api-key <key>       API key authentication (bypasses username/password)
  -c, --config <file>       Path to config file [default: config_web_app.json]
      --ci                  Non-interactive CI mode (fail if required parameters are missing)
      --dry-run             Validate build, test auth and query entity without mutating
      --init                Interactively generate or update config_web_app.json
  -v, --version             Display CLI version
  -h, --help                Display help message
```

---

## Environment Variables

All parameters can be configured via environment variables for CI/CD runners (e.g., Bitbucket Pipelines, GitHub Actions, GitLab CI):

| Variable | Description |
|---|---|
| `ONE_ENV` / `KODALL_ENV` | Target environment name (`dev`, `staging`, `prod`) |
| `ONE_INSTANCE` / `KODALL_INSTANCE` | Instance URL |
| `ONE_APP_NAME` / `KODALL_APP_NAME` | WebApp name |
| `ONE_APP_PATH` / `KODALL_APP_PATH` | WebApp URL path |
| `ONE_DIST_PATH` / `KODALL_DIST_PATH` | Path to build directory |
| `ONE_USERNAME` / `ONE_USER` | Login username |
| `ONE_PASSWORD` | Login password |
| `ONE_API_KEY` / `KODALL_API_KEY` | API Key authentication |

### Priority Order
1. CLI Flags (`--instance`, `--user`, etc.)
2. Environment Variables (`ONE_INSTANCE`, `ONE_USERNAME`, etc.)
3. Target Environment in `config_web_app.json` (`environments[targetEnv]`)
4. Top-level Defaults in `config_web_app.json`
5. Interactive Prompts (skipped in `--ci` mode)

---

## Programmatic API

You can also use `kodall-one-deploy` directly inside custom build scripts or Node.js tooling:

```typescript
import { deploy } from "kodall-one-deploy";

const result = await deploy({
  instance: "https://dev.instance.onesoftware.ro",
  webAppName: "my-app",
  webAppPath: "my-app",
  distPath: "./dist",
  username: process.env.ONE_USER,
  password: process.env.ONE_PASSWORD,
  // or apiKey: process.env.ONE_API_KEY,
});

console.log(`Deployed in ${result.durationMs}ms:`, result.action, result.entityKey);
```

---

## Development & Testing

```bash
# Typecheck
npm run typecheck

# Run test suite
npm test

# Build bundle
npm run build
```

---

## License

[MIT](LICENSE)
