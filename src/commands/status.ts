import { checkAllEnvironmentsStatus } from "../core/status.js";
import { RemoteEnvironmentStatus } from "../core/types.js";
import { bold, cyan, dim, green, log, pad, red, Spinner, yellow } from "../ui/logger.js";

export function displayStatusDashboard(statuses: RemoteEnvironmentStatus[]): void {
  if (statuses.length === 0) {
    console.log(yellow("\nNo environments configured to check.\n"));
    return;
  }

  console.log(`\n${bold(cyan("Live Remote Environment Status:"))}\n`);
  console.log(
    "  " +
      dim(
        pad("DEFAULT", 10) +
        pad("ENV NAME", 16) +
        pad("HEALTH", 16) +
        pad("HTTP STATUS", 28) +
        pad("LATENCY", 12) +
        pad("STORAGE ID", 14) +
        pad("ENTITY KEY", 14) +
        pad("ROUTE PATH", 20) +
        "INSTANCE URL"
      )
  );
  console.log(dim("  " + "─".repeat(164)));

  for (const s of statuses) {
    const defaultTag = s.isDefault ? green(bold("  ★")) : "";
    const nameStr = s.isDefault ? bold(cyan(s.env)) : bold(s.env);

    let healthBadge: string;
    if (s.state === "ONLINE") {
      healthBadge = green(bold("● ONLINE"));
    } else if (s.state === "NOT_FOUND") {
      healthBadge = yellow("○ NOT FOUND");
    } else if (s.state === "PROTECTED") {
      healthBadge = yellow("🔒 PROTECTED");
    } else if (s.state === "OFFLINE") {
      healthBadge = red("○ OFFLINE");
    } else {
      healthBadge = red("▲ ERROR");
    }

    const httpCodeStr =
      s.httpStatus > 0
        ? `${s.httpStatus} ${s.httpStatusText}`
        : s.error
        ? dim("Unreachable")
        : dim("No resp");

    const latencyStr = s.latencyMs > 0 ? `${s.latencyMs}ms` : "-";
    const storageStr = s.storageId !== undefined ? cyan(String(s.storageId)) : dim("-");
    const entityStr = s.entityKey !== undefined ? dim(String(s.entityKey)) : dim("-");
    const routeStr = s.webAppPath || "/";
    const instanceStr = s.instanceUrl || "-";

    console.log(
      "  " +
        pad(defaultTag, 10) +
        pad(nameStr, 16) +
        pad(healthBadge, 16) +
        pad(httpCodeStr, 28) +
        pad(latencyStr, 12) +
        pad(storageStr, 14) +
        pad(entityStr, 14) +
        pad(routeStr, 20) +
        dim(instanceStr)
    );
  }
  console.log("");
}

export async function handleStatusDashboard(
  configPath: string,
  envFilter?: string,
  flags?: any
): Promise<void> {
  const spinner = new Spinner("Pinging remote instances and checking live status...", false);
  spinner.start("Pinging remote instances and checking live status...");

  try {
    const statuses = await checkAllEnvironmentsStatus(
      configPath,
      envFilter,
      process.cwd(),
      flags?.user && flags?.password ? { username: flags.user, password: flags.password } : undefined
    );
    spinner.stop();
    displayStatusDashboard(statuses);
  } catch (err: any) {
    spinner.stop();
    log.error(`Status check failed: ${err.message}`);
  }
}
