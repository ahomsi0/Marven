import { spawn, type ChildProcess } from "child_process";
import type { MCPServer, ToolDefinition } from "@/types";

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ServerEntry {
  process: ChildProcess;
  status: "connected" | "disconnected";
  buffer: string;
  pending: Map<number, PendingRequest>;
  nextId: number;
}

const TIMEOUT_MS = 30_000;

class MCPClient {
  private servers = new Map<string, ServerEntry>();
  private starting = new Set<string>();

  async start(server: MCPServer): Promise<void> {
    if (this.starting.has(server.id)) {
      throw new Error(`MCP server ${server.id} is already starting`);
    }
    this.starting.add(server.id);
    try {
      // Kill existing process if restarting, rejecting any pending requests
      const existing = this.servers.get(server.id);
      if (existing) {
        for (const [, req] of existing.pending) {
          clearTimeout(req.timer);
          req.reject(new Error("MCP server restarted"));
        }
        existing.process.kill();
        this.servers.delete(server.id);
      }

      const proc = spawn("sh", ["-c", server.command], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const entry: ServerEntry = {
        process: proc,
        status: "disconnected",
        buffer: "",
        pending: new Map(),
        nextId: 1,
      };
      this.servers.set(server.id, entry);

      proc.stdout!.on("data", (chunk: Buffer) =>
        this.handleData(server.id, chunk.toString())
      );
      proc.on("exit", () => {
        const e = this.servers.get(server.id);
        if (!e) return;
        for (const [, req] of e.pending) {
          clearTimeout(req.timer);
          req.reject(new Error("MCP server exited unexpectedly"));
        }
        e.pending.clear();
        this.servers.delete(server.id);
      });
      let stderrOutput = "";
      proc.stderr!.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      // MCP handshake
      try {
        await this.request(server.id, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "marven", version: "1.0.0" },
        });
      } catch (err) {
        this.servers.delete(server.id);
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`MCP initialize failed: ${msg}${stderrOutput ? `\nServer stderr: ${stderrOutput.slice(0, 500)}` : ""}`);
      }
      this.notify(server.id, "notifications/initialized", {});
      entry.status = "connected";
    } finally {
      this.starting.delete(server.id);
    }
  }

  stop(id: string): void {
    const entry = this.servers.get(id);
    if (entry) {
      entry.process.kill();
      this.servers.delete(id);
    }
  }

  async listTools(id: string): Promise<MCPTool[]> {
    const result = (await this.request(id, "tools/list", {})) as {
      tools: MCPTool[];
    };
    return result.tools ?? [];
  }

  async callTool(
    id: string,
    tool: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const result = (await this.request(id, "tools/call", {
      name: tool,
      arguments: args,
    })) as { content: Array<{ type: string; text?: string }> };
    return (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
  }

  getStatus(): Record<string, "connected" | "disconnected"> {
    const out: Record<string, "connected" | "disconnected"> = {};
    for (const [id, entry] of this.servers) {
      out[id] = entry.status;
    }
    return out;
  }

  private handleData(id: string, chunk: string): void {
    const entry = this.servers.get(id);
    if (!entry) return;
    entry.buffer += chunk;
    const lines = entry.buffer.split("\n");
    entry.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as {
          id?: number;
          result?: unknown;
          error?: { message: string };
        };
        if (msg.id !== undefined) {
          const pending = entry.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            entry.pending.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error.message));
            else pending.resolve(msg.result);
          }
        }
      } catch {
        /* ignore non-JSON stdout lines (server startup messages, etc.) */
      }
    }
  }

  private request(id: string, method: string, params: unknown): Promise<unknown> {
    const entry = this.servers.get(id);
    if (!entry) {
      return Promise.reject(new Error(`MCP server ${id} not found`));
    }
    const reqId = entry.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(reqId);
        reject(new Error(`MCP timeout: ${method}`));
      }, TIMEOUT_MS);
      entry.pending.set(reqId, { resolve, reject, timer });
      const msg =
        JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n";
      entry.process.stdin!.write(msg); // stdin is pipe — guaranteed non-null by spawn options
    });
  }

  private notify(id: string, method: string, params: unknown): void {
    const entry = this.servers.get(id);
    if (!entry) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    entry.process.stdin!.write(msg);
  }
}

/** Convert an MCP tool schema to a ToolDefinition the agent loop understands */
export function mcpToolToDefinition(serverName: string, tool: MCPTool): ToolDefinition {
  return {
    name: `${serverName}__${tool.name}`,
    description: tool.description ?? tool.name,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema?.properties ?? {}).map(([k, v]) => [
          k,
          { type: (v.type as "string") ?? "string", description: v.description ?? k },
        ])
      ),
      required: tool.inputSchema?.required ?? [],
    },
  };
}

// Module-level singleton — persists for the lifetime of the Next.js server process
export const mcpClient = new MCPClient();
