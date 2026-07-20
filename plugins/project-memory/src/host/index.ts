import { createNodeProjectMemoryServices } from "../cli/node-composition.js";
import { ProjectMemoryHost } from "./project-memory-host.js";

export * from "./proposal-store.js";
export * from "./legacy-import-service.js";
export * from "./project-memory-host.js";

export function createNodeProjectMemoryHost(root: URL): ProjectMemoryHost {
  const services = createNodeProjectMemoryServices(root);
  return new ProjectMemoryHost({
    start: services.start,
    applyBootstrap: services.applyBootstrap,
    legacyImport: services.legacyImport,
  });
}
