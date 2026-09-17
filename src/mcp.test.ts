import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
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
      "load_model",
      "set_system_prompt",
      "classify_documents",
      "list_classifications",
      "remove_classifications",
    ]);
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
