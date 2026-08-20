/**
 * Environment-specific configuration overrides
 */
export interface EnvironmentConfig {
  instance?: string;
  web_app_name?: string;
  web_app_path?: string;
  dist_path?: string;
  api_key?: string;
}

/**
 * Structure of config_web_app.json
 * Supports both multi-environment and legacy flat schema.
 */
export interface WebAppConfigFile {
  web_app_name?: string;
  web_app_path?: string;
  instance?: string;
  dist_path?: string;
  api_key?: string;
  default_env?: string;
  environments?: Record<string, EnvironmentConfig>;
}

/**
 * Fully resolved configuration ready for deployment execution
 */
export interface ResolvedConfig {
  instance: string;
  web_app_name: string;
  web_app_path: string;
  dist_path: string;
  api_key?: string;
  username?: string;
  password?: string;
  env?: string;
}

/**
 * Options passed to the deploy() function or CLI
 */
export interface DeployOptions {
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

/**
 * Result returned by the deployment process
 */
export interface DeployResult {
  success: boolean;
  storageId?: number | string;
  entityKey?: number | string;
  action?: "created" | "updated" | "dry-run";
  durationMs: number;
  archiveSizeBytes?: number;
  error?: Error | string;
}
