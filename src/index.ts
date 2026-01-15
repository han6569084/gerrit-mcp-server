import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { z } from "zod";
import { execSync } from "child_process";

// Initialize Gerrit client configuration
const gerritHost = process.env.GERRIT_HOST;
const gerritUser = process.env.GERRIT_USER;
const gerritPassword = process.env.GERRIT_PASSWORD;

if (!gerritHost || !gerritUser || !gerritPassword) {
  console.error("Missing required environment variables: GERRIT_HOST, GERRIT_USER, GERRIT_PASSWORD");
  process.exit(1);
}

// Gerrit REST API helper
const gerritApi = axios.create({
  baseURL: `${gerritHost.replace(/\/$/, "")}/a`, // '/a' is for authenticated requests
  auth: {
    username: gerritUser,
    password: gerritPassword,
  },
});

// Gerrit responses start with )]}' to prevent XSS
const parseGerritResponse = (data: string) => {
  if (typeof data === "string" && data.startsWith(")]}'")) {
    return JSON.parse(data.substring(4));
  }
  return data;
};

gerritApi.interceptors.response.use((response) => {
  response.data = parseGerritResponse(response.data);
  return response;
}, (error) => {
  if (error.response && error.response.data) {
    error.response.data = parseGerritResponse(error.response.data);
  }
  return Promise.reject(error);
});

const server = new Server(
  {
    name: "gerrit-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool schemas
const ListChangesSchema = z.object({
  query: z.string().optional().default("status:open"),
  limit: z.number().optional().default(10),
});

const GetChangeSchema = z.object({
  changeId: z.string(),
});

const SetReviewSchema = z.object({
  changeId: z.string(),
  revisionId: z.string().default("current"),
  message: z.string().optional(),
  labels: z.record(z.number()).optional(),
});

const SyncGerritSchema = z.object({
  topic: z.string().optional(),
  changeId: z.string().optional(),
});

const SubmitChangesSchema = z.object({
  changeIds: z.array(z.string()),
});

const BatchReviewSubmitSchema = z.object({
  topic: z.string(),
  voteVerified: z.number().default(1),
  voteReview: z.number().default(2),
});

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_changes",
        description: "List Gerrit changes based on a query",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Gerrit query string (e.g., 'status:open owner:self')", default: "status:open" },
            limit: { type: "number", description: "Maximum number of results", default: 10 },
          },
        },
      },
      {
        name: "get_change_detail",
        description: "Get detailed information about a specific Gerrit change",
        inputSchema: {
          type: "object",
          properties: {
            changeId: { type: "string", description: "The change ID (numeric or triplet ID)" },
          },
          required: ["changeId"],
        },
      },
      {
        name: "set_review",
        description: "Post a review to a Gerrit change",
        inputSchema: {
          type: "object",
          properties: {
            changeId: { type: "string", description: "The change ID" },
            revisionId: { type: "string", description: "The revision ID or 'current'", default: "current" },
            message: { type: "string", description: "The review message" },
            labels: { 
              type: "object", 
              description: "Review labels (e.g., {'Code-Review': 1, 'Verified': 1})",
              additionalProperties: { type: "number" }
            },
          },
          required: ["changeId"],
        },
      },
      {
        name: "submit_changes",
        description: "Submit (merge) one or more Gerrit changes",
        inputSchema: {
          type: "object",
          properties: {
            changeIds: { type: "array", items: { type: "string" }, description: "Array of change IDs to submit" },
          },
          required: ["changeIds"],
        },
      },
      {
        name: "batch_review_submit_by_topic",
        description: "Vote +1/+2 and then submit all open changes in a topic",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string", description: "The Gerrit topic name" },
            voteVerified: { type: "number", description: "Verified score", default: 1 },
            voteReview: { type: "number", description: "Code-Review score", default: 2 },
          },
          required: ["topic"],
        },
      },
      {
        name: "sync_gerrit_to_local",
        description: "Sync changes from Gerrit and use 'repo download' to apply them locally",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string", description: "The Gerrit topic to sync" },
            changeId: { type: "string", description: "The specific Change ID or number to sync" },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_changes": {
        const { query, limit } = ListChangesSchema.parse(args);
        const response = await gerritApi.get("/changes/", {
          params: { q: query, n: limit },
          transformResponse: [(data) => data], // Keep raw string for interceptor
        });
        return {
          content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        };
      }

      case "get_change_detail": {
        const { changeId } = GetChangeSchema.parse(args);
        const response = await gerritApi.get(`/changes/${changeId}/detail`, {
          params: { o: ["CURRENT_REVISION", "CURRENT_COMMIT", "LABELS"] },
          transformResponse: [(data) => data],
        });
        return {
          content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        };
      }

      case "set_review": {
        const { changeId, revisionId, message, labels } = SetReviewSchema.parse(args);
        const response = await gerritApi.post(`/changes/${changeId}/revisions/${revisionId}/review`, {
          message,
          labels,
        }, {
          transformResponse: [(data) => data],
        });
        return {
          content: [{ type: "text", text: `Successfully posted review to ${changeId}` }],
        };
      }

      case "submit_changes": {
        const { changeIds } = SubmitChangesSchema.parse(args);
        const results = [];
        for (const changeId of changeIds) {
          try {
            await gerritApi.post(`/changes/${changeId}/submit`, { wait_for_merge: true });
            results.push(`✓ Submitted ${changeId}`);
          } catch (e: any) {
            results.push(`✗ Failed ${changeId}: ${e.response?.data || e.message}`);
          }
        }
        return {
          content: [{ type: "text", text: results.join("\n") }],
        };
      }

      case "batch_review_submit_by_topic": {
        const { topic, voteVerified, voteReview } = BatchReviewSubmitSchema.parse(args);
        const listResp = await gerritApi.get("/changes/", {
          params: { q: `topic:"${topic}" status:open` },
        });

        const changes = listResp.data as any[];
        if (!changes || changes.length === 0) {
          return { content: [{ type: "text", text: `No open changes found for topic: ${topic}` }] };
        }

        const results = [];
        for (const change of changes) {
          const changeId = change._number;
          try {
            // 1. Vote
            await gerritApi.post(`/changes/${changeId}/revisions/current/review`, {
              labels: { "Verified": voteVerified, "Code-Review": voteReview },
              message: "Batch review and submit by MCP Server",
            });
            // 2. Submit
            await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
            await gerritApi.post(`/changes/${changeId}/submit`, { wait_for_merge: true });
            results.push(`✓ Processed ${changeId}: ${change.subject}`);
          } catch (e: any) {
            results.push(`✗ Failed ${changeId}: ${e.response?.data || e.message}`);
          }
        }
        return {
          content: [{ type: "text", text: results.join("\n") }],
        };
      }

      case "sync_gerrit_to_local": {
        const { topic, changeId } = SyncGerritSchema.parse(args);
        let query = "";
        if (topic) {
          query = `topic:"${topic}"`;
        } else if (changeId) {
          query = changeId;
        } else {
          throw new Error("Either topic or changeId must be provided");
        }

        const response = await gerritApi.get("/changes/", {
          params: { q: query, o: ["CURRENT_REVISION"] },
          transformResponse: [(data) => data],
        });

        const changes = response.data as any[];
        if (!changes || changes.length === 0) {
          return { content: [{ type: "text", text: "No changes found." }] };
        }

        const results = [];
        for (const change of changes) {
          const changeNumber = change._number;
          const project = change.project;
          const currentRev = change.current_revision;
          const revisionData = change.revisions[currentRev];
          const patchset = revisionData._number;

          try {
            // Use absolute path for repo if needed, but 'repo' should be in PATH
            const cmd = `repo download ${project} ${changeNumber}/${patchset}`;
            console.error(`Executing: ${cmd}`);
            execSync(cmd, { stdio: 'inherit' });
            results.push(`✓ Synced ${changeNumber}/${patchset} in ${project}: ${change.subject}`);
          } catch (e: any) {
            results.push(`✗ Failed ${changeNumber} in ${project}: ${e.message}`);
          }
        }

        return {
          content: [{ type: "text", text: results.join("\n") }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gerrit MCP Server running on stdio");
