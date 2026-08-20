import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deploy } from "../src/index.js";
import { saveConfigFile } from "../src/core/config.js";

const INSTANCE = "https://deviulianr2.oneerp.ro/";
const USERNAME = "root";
const PASSWORD = "1234";
const API_KEY = "2aefed1a-9bc8-49b6-8f5a-e825614bb2b0";

async function runLiveTests() {
  console.log("=== STARTING LIVE INTEGRATION TESTS AGAINST ONE ERP ===");
  console.log("Instance:", INSTANCE);

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-live-test-"));
  const distDir = path.join(testDir, "dist");
  const assetsDir = path.join(distDir, "assets");

  fs.mkdirSync(assetsDir, { recursive: true });

  // 1. Create multi-file sample web application
  fs.writeFileSync(
    path.join(distDir, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kodall Deploy Live Test</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <h1>Deployed via kodall-one-deploy (Modern TS Rebuild)</h1>
  <p id="timestamp">Timestamp: ${new Date().toISOString()}</p>
  <script src="assets/main.js"></script>
</body>
</html>`
  );

  fs.writeFileSync(
    path.join(assetsDir, "style.css"),
    `body { font-family: system-ui, sans-serif; background: #f0f4f8; color: #102a43; padding: 2rem; }
h1 { color: #0b69a3; }`
  );

  fs.writeFileSync(
    path.join(assetsDir, "main.js"),
    `console.log("Kodall live deployment active:", new Date());`
  );

  console.log("\n[TEST 1] Testing Basic Auth Deployment (root / 1234)...");
  const res1 = await deploy(
    {
      instance: INSTANCE,
      webAppName: "kodall-test-basic",
      webAppPath: "kodall-test-basic",
      distPath: distDir,
      username: USERNAME,
      password: PASSWORD,
    },
    testDir
  );
  console.log("✔ Basic Auth Deploy Result:", res1);

  console.log("\n[TEST 2] Testing API Key Deployment (2aefed1a-9bc8-49b6-8f5a-e825614bb2b0)...");
  const res2 = await deploy(
    {
      instance: INSTANCE,
      webAppName: "kodall-test-apikey",
      webAppPath: "kodall-test-apikey",
      distPath: distDir,
      apiKey: API_KEY,
    },
    testDir
  );
  console.log("✔ API Key Deploy Result:", res2);

  console.log("\n[TEST 3] Testing Update Flow (Redeploying kodall-test-basic)...");
  // Modify a file to simulate code update
  fs.writeFileSync(
    path.join(assetsDir, "main.js"),
    `console.log("Updated at:", new Date());`
  );
  const res3 = await deploy(
    {
      instance: INSTANCE,
      webAppName: "kodall-test-basic",
      webAppPath: "kodall-test-basic",
      distPath: distDir,
      username: USERNAME,
      password: PASSWORD,
    },
    testDir
  );
  console.log("✔ Update Deploy Result (Action should be updated):", res3);

  console.log("\n[TEST 4] Testing Multi-Environment Config (config_web_app.json)...");
  saveConfigFile(
    "config_web_app.json",
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

  console.log("\n[TEST 5] Testing Legacy Flat Config Backward Compatibility...");
  saveConfigFile(
    "config_web_app.json",
    {
      web_app_name: "kodall-legacy-flat",
      web_app_path: "kodall-legacy-flat",
      instance: INSTANCE,
      dist_path: "./dist",
    },
    testDir
  );

  const res5 = await deploy(
    {
      username: USERNAME,
      password: PASSWORD,
    },
    testDir
  );
  console.log("✔ Legacy Config Deploy:", res5);

  console.log("\n[TEST 6] Testing Dry-Run Mode...");
  saveConfigFile(
    "config_web_app.json",
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

  const res6 = await deploy(
    {
      env: "prod",
      dryRun: true,
    },
    testDir
  );
  console.log("✔ Dry-Run Result:", res6);

  console.log("\n=== ALL LIVE INTEGRATION TESTS PASSED ===");
}

runLiveTests().catch((err) => {
  console.error("❌ Live test failed:", err);
  process.exit(1);
});
