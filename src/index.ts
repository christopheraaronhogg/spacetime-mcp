#!/usr/bin/env node

import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createSpacetimeMcpServer } from "./mcpServer.js";

const workspaceRoot = path.resolve(process.argv[2] ?? process.cwd());

const server = createSpacetimeMcpServer(workspaceRoot);
const transport = new StdioServerTransport();

await server.connect(transport);
