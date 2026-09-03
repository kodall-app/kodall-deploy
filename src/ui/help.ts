import { bold, dim } from "./logger.js";

export function getHelpText(version: string): string {
  return `
${bold("kodall-deploy")} ${dim(`v${version}`)}
Deploy web applications to Kodall instances and manage local dev proxies.

${bold("USAGE:")}
  $ kodall-deploy [command] [options]
  $ one-deploy [command] [options]
  $ npx kodall-deploy [command] [options]

${bold("COMMANDS:")}
  use [env]                 Set active local dev proxy environment (untracked)
  switch [env]              Alias for 'use'

${bold("OPTIONS:")}
  -e, --env <name>          Target environment(s) (e.g., dev, prod, or comma-separated "dev,staging")
  -t, --type <type>         Deploy all environments of given type (e.g., dev, staging, prod)
      --all                 Deploy to ALL configured environments sequentially
  -i, --instance <url>      Instance base URL (e.g., https://app.domain.com)
  -n, --name <name>         WebApp name in Kodall
  -p, --path <path>         URL path where web app is served
  -d, --dist <dir>          Path to build directory containing index.html [default: ./dist]
  -u, --user <username>     Kodall login username
  -P, --password <password> Kodall login password
  -k, --api-key <key>       API key authentication (bypasses username/password)
      --token <token>       OAuth / OpenID Connect access token (bypasses username/password)
  -O, --otp <code>          One-Time Password / 2FA code for authentication
      --client-id <id>      OAuth / OpenID Connect Client ID [default: admin-cli]
  -c, --config <file>       Path to config file [default: kodall-webapp.config.json]
  -l, --list-envs           List all configured environments in a table
  -s, --status [env]        Display live status & health dashboard for environment(s)
      --use [name]          Set active local dev proxy environment (untracked)
      --clear-active        Clear active local dev proxy environment override
      --add-env [name]      Add or update an environment in kodall-webapp.config.json
      --remove-env [name]   Remove an environment from configuration
      --clone-env <src> [dst] Duplicate/clone an existing environment
      --set-default <name>  Set default deployment environment in config file
      --save-config         When using 'use', also save as default in config file
  -H, --history             Display deployment history for environment(s)
  -R, --rollback [storage]  Roll back web application to a previous storage build
      --build               Force running "npm run build" before deploying
      --no-build            Skip build check and build prompts
      --no-health-check     Skip post-deployment live HTTP health check ping
      --init-ci             Generate CI/CD pipeline (GitHub Actions, GitLab CI, Bitbucket)
      --ci                  Non-interactive CI mode (fail if required parameters are missing)
      --dry-run             Validate build, test auth and query entity without mutating
      --init                Interactively generate or update kodall-webapp.config.json
      --debug               Print detailed debug info and stack traces on error
  -v, --version             Display CLI version
  -h, --help                Display this help message

${bold("ENVIRONMENT VARIABLES:")}
  KODALL_ENV, ONE_ENV               Target environment name
  KODALL_INSTANCE, ONE_INSTANCE     Instance URL
  KODALL_APP_NAME, ONE_APP_NAME     WebApp name
  KODALL_APP_PATH, ONE_APP_PATH     WebApp URL path
  KODALL_DIST_PATH, ONE_DIST_PATH   Build directory path
  KODALL_USERNAME, ONE_USERNAME     Login username
  KODALL_PASSWORD, ONE_PASSWORD     Login password
  KODALL_API_KEY, ONE_API_KEY       API key
  KODALL_TOKEN, ONE_TOKEN           OAuth / OpenID Connect access token
  KODALL_OTP, ONE_OTP               One-Time Password (OTP / 2FA)
  KODALL_CLIENT_ID, ONE_CLIENT_ID   OAuth Client ID

${bold("EXAMPLES:")}
  $ kodall-deploy use staging       # Switch local dev proxy to staging (clean git)
  $ kodall-deploy use               # Interactively select active proxy environment
  $ kodall-deploy --set-default dev # Set default deployment environment in config file
  $ kodall-deploy -l                # List all configured environments
  $ kodall-deploy                   # Interactive deployment menu
  $ kodall-deploy -e prod           # Deploy to production environment
  $ kodall-deploy --type prod       # Deploy to ALL production environments (e.g. prod-us, prod-eu)
  $ kodall-deploy --all             # Deploy to all configured environments
  $ kodall-deploy -H -e prod        # View deployment history for production
  $ kodall-deploy --rollback -e prod # Interactively roll back prod to a previous build
  $ kodall-deploy --rollback 137    # Roll back directly to storage ID 137
  $ kodall-deploy -e staging --dry-run # Validate and test staging deployment
  $ kodall-deploy --ci -u admin -P secret # Non-interactive CI deployment
`;
}
