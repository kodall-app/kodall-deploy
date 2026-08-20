import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deploy } from "../src/core/deployer.js";
import { saveConfigFile } from "../src/core/config.js";

const execFileAsync = promisify(execFile);

describe("Full Integration Test (Real HTTP Server + CLI)", () => {
  let server: http.Server;
  let serverUrl: string;
  let tempDir: string;
  let distDir: string;

  // Server state tracking
  const requestLog: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  let uploadedZipBuffer: Buffer = Buffer.alloc(0);
  let webAppEntities: Map<string, any> = new Map();

  beforeAll(async () => {
    // 1. Create a real HTTP mock Kodall server
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        const bodyStr = bodyBuffer.toString("utf-8");
        requestLog.push({
          method: req.method || "GET",
          url: req.url || "/",
          headers: req.headers,
          body: bodyStr,
        });

        const url = req.url || "";

        // Route: /auth (POST)
        if (url.startsWith("/auth") && req.method === "POST") {
          let user = "";
          try {
            const parsed = JSON.parse(bodyStr);
            user = parsed.user;
          } catch {
            const params = new URLSearchParams(bodyStr);
            user = params.get("user") || "";
          }

          if (!user) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "Invalid credentials" }));
            return;
          }

          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": [
              "JSESSIONID=sess_test_12345; Path=/; HttpOnly",
              "one.erp.rest.csrf.token=csrf_token_secret_xyz; Path=/",
            ],
          });
          res.end(JSON.stringify({ userName: user, userKey: 1 }));
          return;
        }

        // Route: /storage (POST)
        if (url.startsWith("/storage") && req.method === "POST") {
          uploadedZipBuffer = bodyBuffer;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([{ id: 1042, name: "web_app.zip" }]));
          return;
        }

        // Route: /rest/fetch (POST)
        if (url.startsWith("/rest/fetch") && req.method === "POST") {
          // Check if we have matching entity
          const matches: any[] = [];
          for (const [key, entity] of webAppEntities.entries()) {
            if (bodyStr.includes(entity.properties.name) && bodyStr.includes(entity.properties.path)) {
              matches.push({ key });
            }
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(matches));
          return;
        }

        // Route: /rest/entity/web_app (POST - Create)
        if (url === "/rest/entity/web_app" && req.method === "POST") {
          const entity = JSON.parse(bodyStr);
          const newKey = "entity_key_999";
          entity.properties.key = newKey;
          webAppEntities.set(newKey, entity);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ key: newKey, operation: "insert" }));
          return;
        }

        // Route: /rest/entity/web_app/:key (POST - Update)
        if (url.startsWith("/rest/entity/web_app/") && req.method === "POST") {
          const key = url.replace("/rest/entity/web_app/", "");
          const entity = JSON.parse(bodyStr);
          webAppEntities.set(key, entity);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ key, operation: "update" }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Not found" }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    // 2. Set up temporary test workspace with sample web app
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-integration-"));
    distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(
      path.join(distDir, "index.html"),
      "<!DOCTYPE html><html><head><title>Test App</title></head><body><h1>Welcome</h1></body></html>"
    );
    fs.writeFileSync(path.join(distDir, "app.js"), "console.log('App loaded');");

    // 3. Write multi-environment config_web_app.json
    saveConfigFile(
      "config_web_app.json",
      {
        web_app_name: "sample-portal",
        web_app_path: "sample-portal",
        dist_path: "./dist",
        default_env: "dev",
        environments: {
          dev: {
            instance: serverUrl,
          },
          staging: {
            instance: serverUrl,
            api_key: "staging-api-key",
          },
          prod: {
            instance: serverUrl,
            web_app_name: "sample-portal-prod",
            web_app_path: "production-portal",
          },
        },
      },
      tempDir
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should perform programmatic deployment end-to-end (Create flow)", async () => {
    const result = await deploy(
      {
        env: "dev",
        username: "deploy_user",
        password: "secret_password",
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
    expect(result.storageId).toBe(1042);
    expect(result.entityKey).toBe("entity_key_999");
    expect(result.archiveSizeBytes).toBeGreaterThan(0);

    // Verify uploaded zip data was received
    expect(uploadedZipBuffer.length).toBeGreaterThan(0);

    // Verify entity was saved in mock server
    const created = webAppEntities.get("entity_key_999");
    expect(created).toBeDefined();
    expect(created.properties.name).toBe("sample-portal");
    expect(created.properties.id_storage_file).toBe(1042);

    // Verify auth cookie and csrf token were sent
    const fetchReq = requestLog.find((r) => r.url === "/rest/fetch");
    expect(fetchReq).toBeDefined();
    expect(fetchReq?.headers["x-csrf-token"]).toBe("csrf_token_secret_xyz");
    expect(fetchReq?.headers["cookie"]).toContain("JSESSIONID=sess_test_12345");
  });

  it("should perform programmatic deployment end-to-end (Update flow)", async () => {
    // Second deploy should detect existing entity and trigger update
    const result = await deploy(
      {
        env: "dev",
        username: "deploy_user",
        password: "secret_password",
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.entityKey).toBe("entity_key_999");
  });

  it("should execute CLI command binary via child process against real server", async () => {
    const cliPath = path.resolve(__dirname, "../dist/cli.js");

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, "-e", "dev", "-u", "ci_user", "-P", "ci_pass", "--ci"],
      { cwd: tempDir }
    );

    expect(stderr).toBe("");
    expect(stdout).toContain("ONE Framework / Kodall Deployer");
    expect(stdout).toContain("Deployment successful!");
  });
});
