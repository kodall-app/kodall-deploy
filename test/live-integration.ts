/**
 * Live Server End-to-End Integration Test
 * Run manually against real Kodall server:
 * $ npx tsx test/live-integration.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG_FILENAME, saveConfigFile } from "../src/core/config.js";
import { deploy } from "../src/core/deployer.js";

const INSTANCE = process.env.TEST_KODALL_INSTANCE || "https://example.kodall.com/";
const USERNAME = process.env.TEST_KODALL_USER || "root";
const PASSWORD = process.env.TEST_KODALL_PASSWORD || "password";
const API_KEY = process.env.TEST_KODALL_API_KEY || "mock-api-key";


async function runLiveTest() {
  console.log("=================================================");
  console.log("  Running Live Integration Test against Kodall ERP");
  console.log("=================================================");

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-live-test-"));
  const distDir = path.join(testDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kodall Deploy Live Test</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: grid; place-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #334155; text-align: center; }
    h1 { color: #38bdf8; margin: 0 0 0.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 Deployed via kodall-one-deploy</h1>
    <p>Live test deployment timestamp: ${new Date().toISOString()}</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(distDir, "index.html"), htmlContent, "utf-8");

  try {
    console.log("\n[TEST 1] Testing Deployment with Basic Auth (root / 1234)...");
    const res1 = await deploy(
      {
        instance: INSTANCE,
        webAppName: "kodall-live-test",
        webAppPath: "live-test",
        distPath: distDir,
        username: USERNAME,
        password: PASSWORD,
      },
      testDir
    );
    console.log("✔ Basic Auth Deploy Result:", res1);

    console.log("\n[TEST 2] Testing Deployment with API Key...");
    const res2 = await deploy(
      {
        instance: INSTANCE,
        webAppName: "kodall-live-test-apikey",
        webAppPath: "live-test-apikey",
        distPath: distDir,
        apiKey: API_KEY,
      },
      testDir
    );
    console.log("✔ API Key Deploy Result:", res2);

    console.log("\n[TEST 3] Testing Idempotent Entity Update...");
    const res3 = await deploy(
      {
        instance: INSTANCE,
        webAppName: "kodall-live-test",
        webAppPath: "live-test",
        distPath: distDir,
        username: USERNAME,
        password: PASSWORD,
      },
      testDir
    );
    console.log("✔ Update Deploy Result (Action should be updated):", res3);

    console.log("\n[TEST 4] Testing Multi-Environment Config (kodall-webapp.config.json)...");
    saveConfigFile(
      DEFAULT_CONFIG_FILENAME,
      {
        web_app_name: "kodall-multi-env",
        web_app_path: "kodall-multi-env",
        dist_path: "./dist",
        default_env: "dev",
        environments: {
          dev: {
            instance: INSTANCE,
          },
          prod: {
            instance: INSTANCE,
            web_app_name: "kodall-multi-env-prod",
            web_app_path: "kodall-multi-env-prod",
            api_key: API_KEY,
          },
        },
      },
      testDir
    );

    const res4Dev = await deploy(
      {
        env: "dev",
        username: USERNAME,
        password: PASSWORD,
      },
      testDir
    );
    console.log("✔ Multi-Env (dev via user/pass):", res4Dev);

    const res4Prod = await deploy(
      {
        env: "prod",
      },
      testDir
    );
    console.log("✔ Multi-Env (prod via api_key):", res4Prod);

    console.log("\n[TEST 5] Testing Legacy Config Auto-Migration...");
    fs.writeFileSync(
      path.join(testDir, "config_web_app.json"),
      JSON.stringify(
        {
          web_app_name: "kodall-migrated-app",
          web_app_path: "kodall-migrated-app",
          instance: INSTANCE,
          dist_path: "./dist",
        },
        null,
        2
      ),
      "utf-8"
    );

    // Remove new config so it triggers auto-migration from legacy config_web_app.json
    fs.unlinkSync(path.join(testDir, DEFAULT_CONFIG_FILENAME));

    const res5 = await deploy(
      {
        username: USERNAME,
        password: PASSWORD,
      },
      testDir
    );
    console.log("✔ Legacy Config Migrated & Deployed:", res5);

    console.log("\n[TEST 6] Testing Dry-Run Mode...");
    saveConfigFile(
      DEFAULT_CONFIG_FILENAME,
      {
        web_app_name: "kodall-multi-env",
        web_app_path: "kodall-multi-env",
        dist_path: "./dist",
        default_env: "dev",
        environments: {
          dev: {
            instance: INSTANCE,
          },
        },
      },
      testDir
    );

    const res6 = await deploy(
      {
        env: "dev",
        username: USERNAME,
        password: PASSWORD,
        dryRun: true,
      },
      testDir
    );
    console.log("✔ Dry Run Completed (No mutation):", res6);

    console.log("\n=================================================");
    console.log("  ALL 6 LIVE INTEGRATION TESTS PASSED!");
    console.log("=================================================");
  } finally {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

runLiveTest().catch((err) => {
  console.error("❌ Live test failed:", err);
  process.exit(1);
});
