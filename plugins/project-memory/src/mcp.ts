#!/usr/bin/env node
import { startProjectMemoryMcpServer } from "./mcp/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "./schema/project-registrars.js";
import { registerProjectSchemas } from "./schema/registry.js";

const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
if (!registered.ok) {
  process.stderr.write(`${JSON.stringify({
    code: "MCP_STARTUP_SCHEMA_REGISTRATION_FAILED",
    issues: registered.issues,
  })}\n`);
  process.exitCode = 1;
} else {
  try {
    await startProjectMemoryMcpServer();
  } catch {
    process.stderr.write("Project Memory MCP startup failed\n");
    process.exitCode = 1;
  }
}
