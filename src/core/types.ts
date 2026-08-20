/**
 * Environment-specific configuration overrides
 */
export interface EnvironmentConfig {
  type?: "dev" | "staging" | "prod" | "test" | string;
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
  build?: boolean;
  noBuild?: boolean;
  healthCheck?: boolean;
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
  healthCheck?: HealthCheckResult;
  error?: Error | string;
}

/**
 * Historical record of a deployment event
 */
export interface DeploymentRecord {
  id: string;
  timestamp: string;
  env?: string;
  instance: string;
  entityKey: string | number;
  storageId: string | number;
  webAppName: string;
  webAppPath: string;
  archiveSha256?: string;
  action: "created" | "updated" | "rollback";
  username?: string;
  durationMs?: number;
}

/**
 * Options passed to the rollback() function
 */
export interface RollbackOptions {
  configPath?: string;
  env?: string;
  instance?: string;
  webAppName?: string;
  webAppPath?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  targetStorageId?: string | number;
  stepsBack?: number;
  ci?: boolean;
  silent?: boolean;
  healthCheck?: boolean;
  onProgress?: (
    step: string,
    status: "start" | "success" | "warn" | "error" | "info",
    message?: string
  ) => void;
}

/**
 * Result returned by the rollback process
 */
export interface RollbackResult {
  success: boolean;
  entityKey: string | number;
  fromStorageId?: string | number;
  toStorageId: string | number;
  webAppName: string;
  webAppPath: string;
  durationMs: number;
  healthCheck?: HealthCheckResult;
  error?: Error | string;
}

/**
 * Result of project framework & directory detection
 */
export interface DetectedProject {
  framework: string;
  distPath: string;
  appName: string;
  hasBuildScript: boolean;
}

/**
 * Result of checking whether a project build is present and fresh
 */
export interface BuildCheckResult {
  exists: boolean;
  isStale: boolean;
  hasBuildScript: boolean;
  distPath: string;
  newestSourceFile?: string;
  newestSourceMtime?: number;
  distMtime?: number;
}

/**
 * Result of an HTTP health check ping
 */
export interface HealthCheckResult {
  url: string;
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  error?: string;
}


