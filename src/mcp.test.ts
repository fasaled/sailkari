import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "bun:test";
import { createMcpServer } from "./mcp.js";

const clients: Client[] = [];

async function connectTestServer(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  clients.push(client);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
});

describe("MCP presentation", () => {
  test("exposes the shared evaluation operations as tools", async () => {
    const client = await connectTestServer();
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "list_models",
      "load_model",
      "set_system_prompt",
      "classify_documents",
      "list_classifications",
      "remove_classifications",
    ]);

    // Ensure strictly no API key management or leakage tools exist in MCP
    for (const tool of result.tools) {
      expect(tool.name.toLowerCase()).not.toContain("key");
      expect(tool.name.toLowerCase()).not.toContain("secret");
      expect(tool.description?.toLowerCase()).not.toContain("api key");
    }
  });

  test("list_models reports models without exposing any secret keys", async () => {
    const originalKey = process.env.TYPESAFE_API_KEY;
    const originalModels = process.env.TYPESAFE_MODELS;
    process.env.TYPESAFE_API_KEY = "ts_secret_live_key_999";
    process.env.TYPESAFE_MODELS = "jev,jev-latest";
    try {
      const client = await connectTestServer();
      const result = await client.callTool({
        name: "list_models",
        arguments: {},
      });

      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as {
        models: { id: string; available: boolean; provider?: string }[];
      };
      expect(structured.models).toBeDefined();
      const jev = structured.models.find((m) => m.id === "typesafe:jev");
      expect(jev).toBeDefined();
      expect(jev!.available).toBe(true);

      // Verify no key string or hash leaked in serialized response
      const rawText = JSON.stringify(result);
      expect(rawText).not.toContain("ts_secret_live_key_999");
    } finally {
      if (originalKey) process.env.TYPESAFE_API_KEY = originalKey;
      else delete process.env.TYPESAFE_API_KEY;
      if (originalModels) process.env.TYPESAFE_MODELS = originalModels;
      else delete process.env.TYPESAFE_MODELS;
    }
  });

  test("load_model fails with helpful message when cloud API key is missing", async () => {
    const originalKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const client = await connectTestServer();
      const result = await client.callTool({
        name: "load_model",
        arguments: { modelPath: "typesafe:jev" },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("API key for provider 'typesafe' is not configured");
    } finally {
      if (originalKey) process.env.TYPESAFE_API_KEY = originalKey;
    }
  });

  test("load_model loads OpenAI-compatible cloud models when key is present", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-mock-key";
    try {
      const client = await connectTestServer();
      const result = await client.callTool({
        name: "load_model",
        arguments: { modelPath: "openai:gpt-4o-mini" },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        modelPath: "openai:gpt-4o-mini",
        loaded: true,
      });
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  test("publishes the system prompt contract and generator prompt", async () => {
    const client = await connectTestServer();
    const resource = await client.readResource({ uri: "sailkari://system-prompt-contract" });
    const prompt = await client.getPrompt({ name: "generate-system-prompt", arguments: { taxonomy: "banking: Financial documents" } });

    expect(resource.contents[0]).toMatchObject({ mimeType: "text/plain" });
    expect((resource.contents[0] as { text: string }).text).toContain("exactly one label");
    expect(prompt.messages[0]?.content).toMatchObject({ type: "text" });
    expect(JSON.stringify(prompt)).toContain("banking: Financial documents");
  });

  test("routes system prompt configuration through the application", async () => {
    const client = await connectTestServer();
    const result = await client.callTool({
      name: "set_system_prompt",
      arguments: { systemPrompt: "Return exactly one label and no explanation." },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ configured: true, warnings: [] });
  });
});
