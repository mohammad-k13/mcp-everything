# MCP Resources: 0 → 100

A complete walkthrough of what MCP resources are, how the protocol works, and how this server implements them.

**[Architecture](architecture.md)
| [Project Structure](structure.md)
| [Server Features](features.md)
| [How It Works](how-it-works.md)
| Resources Guide
| [Prompts Guide](prompts-guide.md)**

---

## Part 1: The Concept (0–20)

### What is an MCP resource?

A **resource** is **read-only data** your server exposes to an AI client. Think of it like a file or document the client can discover and read — but accessed over the MCP protocol, not the filesystem.

| MCP primitive | Mental model |
|---------------|--------------|
| **Tool** | "Do something" (action, compute, side effect) |
| **Resource** | "Here's some data" (read-only) |
| **Prompt** | "Start the chat with this template" |

**Example:** A docs server might expose `docs://api-reference.md` as a resource. The AI calls `resources/read` and gets the markdown content to answer questions.

### Key idea: URI-based identity

Every resource has a **URI** — a unique address like:

```
demo://resource/static/document/features.md
demo://resource/dynamic/text/5
demo://resource/session/README.md.gz
```

The client never guesses paths. It discovers URIs via `resources/list` (or templates), then fetches content via `resources/read`.

---

## Part 2: The Protocol (20–40)

### What the client sends (JSON-RPC)

| Method | Purpose |
|--------|---------|
| `resources/list` | "What resources do you have?" |
| `resources/read` | "Give me the content of URI X" |
| `resources/templates/list` | "What URI patterns can I use?" |
| `resources/subscribe` | "Notify me when URI X changes" |
| `resources/unsubscribe` | "Stop notifying me" |

### What the server sends back

**List response** — metadata only (no content yet):

```json
{
  "resources": [
    {
      "uri": "demo://resource/static/document/features.md",
      "name": "features.md",
      "mimeType": "text/markdown",
      "description": "Static document file exposed from /docs: features.md"
    }
  ]
}
```

**Read response** — actual content:

```json
{
  "contents": [
    {
      "uri": "demo://resource/static/document/features.md",
      "mimeType": "text/markdown",
      "text": "# Everything Server - Features\n..."
    }
  ]
}
```

### Content can be `text` or `blob`

| Field | Use for |
|-------|---------|
| `text` | Plain strings (markdown, JSON, code) |
| `blob` | Base64-encoded binary (images, gzip, PDF) |

### Server capabilities (what you advertise)

In `server/index.ts`, the server tells the client what resource features it supports:

```typescript
resources: {
  subscribe: true,
  listChanged: true,
},
```

- **`subscribe: true`** — client can subscribe to URIs and get update notifications
- **`listChanged: true`** — the resource list can change at runtime (e.g. when a tool creates a session resource)

---

## Part 3: Registration Flow in This Server (40–55)

### Startup sequence

```
Transport → createServer()
              ├── registerResources(server)
              │     ├── registerResourceTemplates()   (templates.ts)
              │     └── registerFileResources()       (files.ts)
              └── setSubscriptionHandlers(server)     (subscriptions.ts)

Client connects → initialize → resources/list → resources/read
```

The orchestrator in `resources/index.ts`:

```typescript
export const registerResources = (server: McpServer) => {
  registerResourceTemplates(server);
  registerFileResources(server);
};
```

Two registrations at startup:

1. **Templates** — infinite dynamic URIs (`templates.ts`)
2. **Static files** — one resource per file in `docs/` (`files.ts`)

A third type — **session resources** — is created later by tools at runtime (`session.ts`).

---

## Part 4: Three Resource Patterns (55–85)

### Pattern A: Static resources (`files.ts`)

**Simplest pattern.** Fixed URI, content read from disk.

```typescript
server.registerResource(
  name,
  uri,
  { mimeType, description },
  async (uri) => {
    const text = readFileSafe(fullPath);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType,
          text,
        },
      ],
    };
  }
);
```

**What happens step by step:**

1. Server starts → reads `docs/` directory
2. For each file (e.g. `features.md`), registers a resource:
   - **Name:** `features.md`
   - **URI:** `demo://resource/static/document/features.md`
   - **MIME:** `text/markdown` (from extension)
3. Client calls `resources/list` → sees all markdown files in `docs/`
4. Client calls `resources/read { uri: "...features.md" }` → handler runs → reads file from disk → returns content

**Key detail:** The handler is **lazy** — the file is only read when someone requests it, not at registration time.

**MIME mapping:**

| Extension | MIME type |
|-----------|-----------|
| `.md`, `.markdown` | `text/markdown` |
| `.txt` | `text/plain` |
| `.json` | `application/json` |
| other | `text/plain` |

---

### Pattern B: Template resources (`templates.ts`)

**For infinite/parametric data.** URI has a variable: `{resourceId}`.

```typescript
server.registerResource(
  "Dynamic Text Resource",
  new ResourceTemplate(textUriTemplate, {
    list: undefined,
    complete: { resourceId: resourceIdForResourceTemplateCompleter },
  }),
  {
    mimeType: "text/plain",
    description:
      "Plaintext dynamic resource fabricated from the {resourceId} variable, which must be an integer.",
  },
  async (uri, variables) => {
    const resourceId = parseResourceId(uri, variables);
    return {
      contents: [textResource(uri, resourceId)],
    };
  }
);
```

**URI patterns:**

```
demo://resource/dynamic/text/{resourceId}   → text/plain
demo://resource/dynamic/blob/{resourceId}   → application/octet-stream
```

**What `list: undefined` means:**

These resources **do NOT appear** in `resources/list`. Why? Because there are infinitely many possible IDs (1, 2, 3, …). Instead, the client discovers them via:

- `resources/templates/list` — sees the URI pattern
- Tools/prompts that return `resource_link` blocks

**Content is generated on read:**

```typescript
export const textResource = (uri: URL, resourceId: number) => {
  const timestamp = new Date().toLocaleTimeString();
  return {
    uri: uri.toString(),
    mimeType: "text/plain",
    text: `Resource ${resourceId}: This is a plaintext resource created at ${timestamp}`,
  };
};
```

Every `resources/read` call gets **fresh content** with a new timestamp.

**Autocomplete (`complete`):**

```typescript
export const resourceIdForResourceTemplateCompleter = (value: string) => {
  const resourceId = Number(value);
  return Number.isInteger(resourceId) && resourceId > 0 ? [value] : [];
};
```

When a client UI asks "what values are valid for `{resourceId}`?", this function validates that it's a positive integer.

**Exported helpers** (reused by tools and prompts):

| Helper | Purpose |
|--------|---------|
| `textResource(uri, id)` | Build text resource content object |
| `blobResource(uri, id)` | Build blob resource content object |
| `textResourceUri(id)` | Build text URI |
| `blobResourceUri(id)` | Build blob URI |
| `resourceTypeCompleter` | Autocomplete for prompts |
| `resourceIdForPromptCompleter` | Validate resource ID in prompts |

---

### Pattern C: Session resources (`session.ts`)

**Created at runtime by tools.** Lives only for the current client session.

```typescript
export const registerSessionResource = (
  server: McpServer,
  resource: Resource,
  type: "text" | "blob",
  payload: string
): ResourceLink => {
  const resourceContent =
    type === "text"
      ? { uri: uri.toString(), mimeType, text: payload }
      : { uri: uri.toString(), mimeType, blob: payload };

  // Remove old resource if same URI exists
  const existingResource = registeredResources.get(uri);
  if (existingResource) {
    existingResource.remove();
    registeredResources.delete(uri);
  }

  const registeredResource = server.registerResource(
    name,
    uri,
    { mimeType, description, title, annotations, icons, _meta },
    async () => ({ contents: [resourceContent] })
  );

  registeredResources.set(uri, registeredResource);
  return { type: "resource_link", ...resource };
};
```

**URI pattern:** `demo://resource/session/<name>`

**Used by `gzip-file-as-resource` tool:**

1. User/tool calls `gzip-file-as-resource { name: "README.md.gz", data: "https://..." }`
2. Tool fetches URL, gzips it
3. Tool calls `registerSessionResource()` → new resource at `demo://resource/session/README.md.gz`
4. Tool returns either a `resource_link` (pointer) or inline `resource` (full data)
5. Client can later call `resources/read` on that URI
6. When session ends → resource is gone

**Re-registration safety:** If the same URI is registered twice, the old one is removed first.

---

## Part 5: Three Ways to Deliver Resource Data (85–92)

Resources can reach the client through different paths:

| Delivery method | When used |
|-----------------|-----------|
| `resources/read` | Client explicitly fetches by URI |
| `resource_link` | Tool returns a pointer (URI + metadata) |
| `resource` (inline) | Tool/prompt embeds full data in the response |

### `resource_link` — pointer only (`get-resource-links` tool)

```typescript
content.push({
  type: "resource_link",
  uri: resource.uri,
  name: `Text Resource ${resourceId}`,
  description: `Resource ${resourceId}: plaintext resource`,
  mimeType: resource.mimeType,
});
```

Client gets the URI. It must call `resources/read` to get actual content.

### `resource` — inline data (`get-resource-reference` tool)

```typescript
{
  type: "resource",
  resource: resource,
}
```

Client gets full content immediately — no second `resources/read` needed.

### Embedded in prompts (`resource-prompt`)

```typescript
{
  role: "user",
  content: {
    type: "resource",
    resource: resource,
  },
}
```

The prompt returns chat messages with a resource embedded — the AI sees the data as part of the conversation.

---

## Part 6: Subscriptions — Live Updates (92–97)

### How it works

```
1. Client → resources/subscribe { uri }
   Server tracks sessionId → uri

2. User calls toggle-subscriber-updates tool

3. Server → notifications/resources/updated { uri }  (every 5 seconds)

4. Client → resources/read { uri }  (re-fetches updated content)
```

**Subscribe handler** — records who wants updates (`resources/subscriptions.ts`):

```typescript
server.server.setRequestHandler(SubscribeRequestSchema, async (request, extra) => {
  const { uri } = request.params;
  const sessionId = extra.sessionId as string;
  subscribers.add(sessionId);
  subscriptions.set(uri, subscribers);
  return {};
});
```

**Update notifications** — sent only to subscribers:

```typescript
await server.server.notification({
  method: "notifications/resources/updated",
  params: { uri },
});
```

**Important:** The notification says *"this URI changed"* — it does NOT include the new content. The client must call `resources/read` again.

**Demo tool:** `toggle-subscriber-updates` starts/stops the 5-second interval via `beginSimulatedResourceUpdates()` / `stopSimulatedResourceUpdates()`.

---

## Part 7: End-to-End Example Flows (97–100)

### Flow 1: Client reads a static doc

```
1. Client → resources/list
   ← [{ uri: "demo://resource/static/document/features.md", mimeType: "text/markdown", ... }]

2. Client → resources/read { uri: "demo://resource/static/document/features.md" }
   ← { contents: [{ uri: "...", mimeType: "text/markdown", text: "# Features\n..." }] }

3. AI uses the markdown content to answer questions
```

### Flow 2: Client reads a dynamic template resource

```
1. Client → resources/templates/list
   ← [{ uriTemplate: "demo://resource/dynamic/text/{resourceId}", ... }]

2. Client → resources/read { uri: "demo://resource/dynamic/text/42" }
   ← { contents: [{ text: "Resource 42: This is a plaintext resource created at 3:55:12 PM" }] }

   (Note: NOT in resources/list — only accessible via known URI pattern)
```

### Flow 3: Tool creates a session resource

```
1. AI → tools/call { name: "gzip-file-as-resource", arguments: { name: "data.gz", data: "https://..." } }
   ← { content: [{ type: "resource_link", uri: "demo://resource/session/data.gz", ... }] }

2. Client → resources/list
   ← [..., { uri: "demo://resource/session/data.gz", mimeType: "application/gzip" }]
   (New resource appeared because listChanged: true)

3. Client → resources/read { uri: "demo://resource/session/data.gz" }
   ← { contents: [{ blob: "<base64 gzip data>" }] }
```

### Flow 4: Subscribe + get updates

```
1. Client → resources/subscribe { uri: "demo://resource/dynamic/text/1" }
   ← {}

2. AI → tools/call { name: "toggle-subscriber-updates", arguments: { enabled: true } }

3. Server → notifications/resources/updated { uri: "demo://resource/dynamic/text/1" }
   (every 5 seconds)

4. Client → resources/read { uri: "demo://resource/dynamic/text/1" }
   ← fresh content with new timestamp
```

---

## All Resource Types — Quick Reference

| Type | URI pattern | Listed? | When created | Module |
|------|-------------|---------|--------------|--------|
| Dynamic Text | `demo://resource/dynamic/text/{id}` | No | On read | `templates.ts` |
| Dynamic Blob | `demo://resource/dynamic/blob/{id}` | No | On read | `templates.ts` |
| Static Document | `demo://resource/static/document/<file>` | Yes | Server startup | `files.ts` |
| Session | `demo://resource/session/<name>` | Yes* | Tool call | `session.ts` |

\* After the tool creates it

---

## Codebase Map

```
resources/
├── index.ts          → orchestrator: calls templates + files
├── templates.ts      → dynamic text/blob (infinite URIs, not listed)
├── files.ts          → static docs from docs/ folder (listed)
├── session.ts        → runtime resources created by tools (listed after creation)
└── subscriptions.ts  → subscribe/unsubscribe + fake update notifications

Consumed by:
├── tools/get-resource-links.ts      → returns resource_link pointers
├── tools/get-resource-reference.ts  → returns inline resource data
├── tools/gzip-file-as-resource.ts   → creates session resources
├── prompts/resource.ts              → embeds resources in chat messages
└── tools/toggle-subscriber-updates.ts → triggers update notifications
```

---

## Anatomy of a Resource (The Pattern)

### Static resource

```typescript
server.registerResource(
  name,           // display name
  uri,            // fixed URI string
  { mimeType, description },
  async (uri) => ({
    contents: [{ uri: uri.toString(), mimeType, text: "..." }],
  })
);
```

### Template resource

```typescript
server.registerResource(
  "Dynamic Text Resource",
  new ResourceTemplate("demo://resource/dynamic/text/{resourceId}", {
    list: undefined,                              // don't appear in list
    complete: { resourceId: completerFn },        // autocomplete
  }),
  { mimeType: "text/plain", description: "..." },
  async (uri, variables) => ({
    contents: [textResource(uri, parseId(variables))],
  })
);
```

### Session resource

```typescript
registerSessionResource(server, resourceMetadata, "text" | "blob", payload);
// → registers + returns a resource_link
```

---

## Best Practices

1. **Use a clear URI scheme** — `demo://resource/<category>/<id>`
2. **Set `mimeType` correctly** — clients use it to render (`.md` → `text/markdown`)
3. **Templates for infinite/parametric data** — `{resourceId}` with validation
4. **`list: undefined` for templates** — avoids flooding `resources/list` with infinite URIs
5. **Export helpers** — `textResource()`, `textResourceUri()` so tools/prompts stay DRY
6. **Session resources for ephemeral artifacts** — temp files, compressed data, generated output
7. **Handle re-registration** — session module removes old resource before re-adding same URI
8. **Safe file reads** — `readFileSafe()` returns error text instead of crashing
9. **Skip missing dirs gracefully** — `files.ts` returns early if `docs/` unreadable
10. **Subscriptions are opt-in** — client subscribes; server only notifies subscribers
11. **One file per resource category** — `templates.ts`, `files.ts`, `session.ts`
12. **Wire in `resources/index.ts`** — same pattern as tools

---

## Learning Path (Recommended Order)

1. **`files.ts`** — simplest: read a file, register fixed URI
2. **`templates.ts`** — URI patterns, generated content, autocomplete
3. **`get-resource-reference` tool** — how clients get resource data via tools
4. **`session.ts`** — runtime registration from tools
5. **`subscriptions.ts`** — subscribe/unsubscribe + live updates

---

## Adding Your Own Resource (Quick Recipe)

1. Create `resources/my-resource.ts` with `registerMyResource(server)`
2. Call it from `resources/index.ts`
3. Choose type:
   - **Static** → fixed URI + `registerResource(name, uri, meta, handler)`
   - **Dynamic** → `ResourceTemplate` with `{variables}`
   - **Runtime** → `registerSessionResource()` from a tool
4. Run `npm run build` and test with MCP Inspector (`npm run inspect`)

---

## Key Takeaways

1. **Resources are read-only data** identified by URIs
2. **Three registration patterns:** static (fixed URI), template (parametric URI), session (runtime)
3. **`registerResource(name, uri, metadata, handler)`** is the core SDK call — handler returns `{ contents: [...] }`
4. **Text vs blob** — use `text` field for strings, `blob` field for base64 binary
5. **Templates with `list: undefined`** — don't flood the list with infinite URIs
6. **Tools can deliver resources** as links (pointers) or inline (full data) without `resources/read`
7. **Subscriptions** notify clients of changes — client re-reads to get new content
8. **Session resources** are ephemeral — perfect for tool-generated artifacts
