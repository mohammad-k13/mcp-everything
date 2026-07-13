# MCP Prompts: 0 → 100

A complete walkthrough of what MCP prompts are, how the protocol works, and how this server implements them.

**[Architecture](architecture.md)
| [Project Structure](structure.md)
| [Server Features](features.md)
| [How It Works](how-it-works.md)
| [Resources Guide](resources-guide.md)
| Prompts Guide**

---

## Part 1: The Concept (0–20)

### What is an MCP prompt?

A **prompt** is a **reusable message template** your server exposes to an AI client. The user (or client UI) picks a prompt, fills in any arguments, and the server returns ready-made **chat messages** that get injected into the conversation.

| MCP primitive | Mental model |
|---------------|--------------|
| **Tool** | "Do something" (action, compute, side effect) |
| **Resource** | "Here's some data" (read-only) |
| **Prompt** | "Start the chat with this template" |

**Example:** A weather app might expose a prompt `args-prompt` with a `city` argument. The user picks it, types "Chicago", and the server returns:

```
User: What's weather in Chicago?
```

The AI then responds to that message as if the user typed it.

### Key idea: prompts return messages, not actions

Unlike tools (which return `content` blocks with results), prompts return **`messages`** — a slice of chat history with `role` and `content`:

```json
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "What's weather in Chicago?"
      }
    }
  ]
}
```

The client merges these messages into the conversation and the LLM continues from there.

### Prompts vs server instructions

| Feature | Purpose | When set |
|---------|---------|----------|
| **Server instructions** | Global guidance for the AI on how to use the server | `initialize` handshake (`docs/instructions.md`) |
| **Prompts** | Specific conversation starters the user can pick | `prompts/list` → `prompts/get` |

Instructions are always present. Prompts are optional templates the user explicitly selects.

---

## Part 2: The Protocol (20–40)

### What the client sends (JSON-RPC)

| Method | Purpose |
|--------|---------|
| `prompts/list` | "What prompts do you have?" |
| `prompts/get` | "Give me the messages for prompt X with these arguments" |
| `completion/complete` | "Suggest values for argument Y" (autocomplete) |

### What the server sends back

**List response** — metadata and argument definitions:

```json
{
  "prompts": [
    {
      "name": "args-prompt",
      "title": "Arguments Prompt",
      "description": "A prompt with two arguments, one required and one optional",
      "arguments": [
        { "name": "city", "description": "Name of the city", "required": true },
        { "name": "state", "description": "Name of the state", "required": false }
      ]
    }
  ]
}
```

**Get response** — ready-made messages:

```json
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "What's weather in Chicago, IL?"
      }
    }
  ]
}
```

### Message content types

Prompt messages can include the same content types as tool results:

| `content.type` | Use for |
|----------------|---------|
| `text` | Plain strings |
| `image` | Base64 image + `mimeType` |
| `resource` | Inline resource data (text or blob) |

### Server capabilities

In `server/index.ts`:

```typescript
prompts: {
  listChanged: true,
},
```

**`listChanged: true`** — the prompt list can change at runtime (if you register prompts dynamically after startup).

---

## Part 3: Registration Flow in This Server (40–55)

### Startup sequence

```
Transport → createServer()
              └── registerPrompts(server)
                    ├── registerSimplePrompt()           (simple.ts)
                    ├── registerArgumentsPrompt()        (args.ts)
                    ├── registerPromptWithCompletions()  (completions.ts)
                    └── registerEmbeddedResourcePrompt() (resource.ts)

Client connects → initialize → prompts/list → prompts/get
```

The orchestrator in `prompts/index.ts`:

```typescript
export const registerPrompts = (server: McpServer) => {
  registerSimplePrompt(server);
  registerArgumentsPrompt(server);
  registerPromptWithCompletions(server);
  registerEmbeddedResourcePrompt(server);
};
```

All four prompts are registered at startup — unlike tools, none are conditional on client capabilities.

---

## Part 4: All Four Prompts (55–85)

### Prompt 1: `simple-prompt` — no arguments (`simple.ts`)

**Simplest pattern.** Static message, nothing to configure.

```typescript
server.registerPrompt(
  "simple-prompt",
  {
    title: "Simple Prompt",
    description: "A prompt with no arguments",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "This is a simple prompt without arguments.",
        },
      },
    ],
  })
);
```

**What happens:**

1. Client calls `prompts/list` → sees `simple-prompt` with no arguments
2. User picks it in the UI
3. Client calls `prompts/get { name: "simple-prompt" }` (no arguments)
4. Server returns the fixed user message
5. Client injects it into the chat → AI responds

**Use case:** Quick conversation starters, help text, onboarding messages.

---

### Prompt 2: `args-prompt` — required + optional arguments (`args.ts`)

**Parameterized template.** Arguments are defined with Zod schemas.

```typescript
const promptArgsSchema = {
  city: z.string().describe("Name of the city"),
  state: z.string().describe("Name of the state").optional(),
};

server.registerPrompt(
  "args-prompt",
  {
    title: "Arguments Prompt",
    description: "A prompt with two arguments, one required and one optional",
    argsSchema: promptArgsSchema,
  },
  (args) => {
    const location = `${args?.city}${args?.state ? `, ${args?.state}` : ""}`;
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `What's weather in ${location}?`,
          },
        },
      ],
    };
  }
);
```

**Arguments:**

| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `city` | Yes | string | Name of the city |
| `state` | No | string | Name of the state |

**Example flows:**

```
prompts/get { name: "args-prompt", arguments: { city: "Chicago" } }
→ "What's weather in Chicago?"

prompts/get { name: "args-prompt", arguments: { city: "Chicago", state: "IL" } }
→ "What's weather in Chicago, IL?"
```

**Use case:** Any template where the user provides values that get interpolated into the message.

---

### Prompt 3: `completable-prompt` — autocomplete arguments (`completions.ts`)

**Context-aware autocomplete.** Uses the SDK's `completable()` helper so the client UI can suggest valid values as the user types.

```typescript
const promptArgsSchema = {
  department: completable(
    z.string().describe("Choose the department."),
    (value) => {
      return ["Engineering", "Sales", "Marketing", "Support"].filter((d) =>
        d.startsWith(value)
      );
    }
  ),
  name: completable(
    z.string().describe("Choose a team member to lead the selected department."),
    (value, context) => {
      const department = context?.arguments?.["department"];
      if (department === "Engineering") {
        return ["Alice", "Bob", "Charlie"].filter((n) => n.startsWith(value));
      } else if (department === "Sales") {
        return ["David", "Eve", "Frank"].filter((n) => n.startsWith(value));
      }
      // ... Marketing, Support
      return [];
    }
  ),
};
```

**Arguments:**

| Argument | Required | Autocomplete | Depends on |
|----------|----------|--------------|------------|
| `department` | Yes | Engineering, Sales, Marketing, Support | — |
| `name` | Yes | Department-specific names | `department` value |

**Key feature — cascading completions:**

When the user picks `department: "Engineering"`, the `name` completer only suggests `Alice`, `Bob`, `Charlie`. The second argument's suggestions depend on the first via `context.arguments`.

**Result message:**

```
prompts/get { name: "completable-prompt", arguments: { department: "Engineering", name: "Alice" } }
→ "Please promote Alice to the head of the Engineering team."
```

**Use case:** Dropdowns, type-ahead search, any UI where valid values are constrained or depend on prior choices.

---

### Prompt 4: `resource-prompt` — embedded resource (`resource.ts`)

**Combines prompts with resources.** Returns chat messages that include inline resource data.

```typescript
const promptArgsSchema = {
  resourceType: resourceTypeCompleter,   // "Text" or "Blob"
  resourceId: resourceIdForPromptCompleter,  // positive integer as string
};

server.registerPrompt(
  "resource-prompt",
  { title: "Resource Prompt", description: "...", argsSchema: promptArgsSchema },
  (args) => {
    // validate resourceType and resourceId
    const resource = resourceType === "Text"
      ? textResource(uri, resourceId)
      : blobResource(uri, resourceId);

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `This prompt includes the ${resourceType} resource with id: ${resourceId}. Please analyze the following resource:`,
          },
        },
        {
          role: "user",
          content: {
            type: "resource",
            resource: resource,
          },
        },
      ],
    };
  }
);
```

**Arguments:**

| Argument | Required | Values | Notes |
|----------|----------|--------|-------|
| `resourceType` | Yes | `Text`, `Blob` | Autocomplete from `RESOURCE_TYPES` |
| `resourceId` | Yes | Positive integer (as string) | Prompt args are strings per MCP spec |

**Important:** Prompt arguments are **always strings** in the MCP protocol. Numeric IDs must be defined as `z.string()` and converted with `Number()` in the handler.

**Result:** Two user messages — intro text + embedded resource. The AI sees the resource data directly in the conversation without calling `resources/read`.

**Reuses helpers from `resources/templates.ts`:**

- `resourceTypeCompleter`, `resourceIdForPromptCompleter`
- `textResource()`, `blobResource()`, `textResourceUri()`, `blobResourceUri()`

**Use case:** "Analyze this document", "Review this file" — prompts that hand the AI data as conversation context.

---

## Part 5: Prompts vs Tools vs Resources (85–90)

### When to use what

| Need | Use |
|------|-----|
| User picks a conversation starter | **Prompt** |
| AI needs to fetch read-only data | **Resource** (+ `resources/read`) |
| AI needs to perform an action | **Tool** |
| Hand data to AI inside a template | **Prompt** with embedded `resource` content |
| Hand a pointer to data | **Tool** returning `resource_link` |

### Return shape comparison

```typescript
// Tool returns content blocks
return {
  content: [{ type: "text", text: "result" }],
};

// Prompt returns messages
return {
  messages: [
    { role: "user", content: { type: "text", text: "question" } },
  ],
};
```

### Prompts can include multiple messages and roles

```typescript
return {
  messages: [
    { role: "user", content: { type: "text", text: "..." } },
    { role: "user", content: { type: "resource", resource: {...} } },
    { role: "assistant", content: { type: "text", text: "..." } },  // also valid
  ],
};
```

This server uses `role: "user"` for all prompt messages, but the spec allows `user` and `assistant` roles.

---

## Part 6: Autocomplete / Completions (90–95)

### How `completable()` works

```typescript
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";

completable(
  z.string().describe("Field description"),  // Zod schema for the argument
  (value, context?) => string[]              // returns matching suggestions
);
```

**Flow:**

```
1. User types "Eng" in department field
2. Client → completion/complete { ref: { type: "ref/prompt", name: "completable-prompt" }, argument: { name: "department", value: "Eng" } }
3. Server runs completer → ["Engineering"]
4. Client shows "Engineering" as suggestion
```

**Context-aware completions:**

The second argument to the completer receives `context` with already-filled argument values:

```typescript
(value, context) => {
  const department = context?.arguments?.["department"];
  // return different suggestions based on department
}
```

### Prompt args vs resource template completions

| Feature | Used in | Helper |
|---------|---------|--------|
| Prompt argument autocomplete | `prompts/get`, `completion/complete` | `completable()` |
| Resource template variable autocomplete | `resources/read`, template URIs | `CompleteResourceTemplateCallback` |

Both live in this codebase — prompt completions in `completions.ts` and `resource.ts`, resource template completions in `resources/templates.ts`.

---

## Part 7: End-to-End Example Flows (95–100)

### Flow 1: Simple prompt (no args)

```
1. Client → prompts/list
   ← [{ name: "simple-prompt", title: "Simple Prompt", arguments: [] }]

2. User picks "Simple Prompt" in UI

3. Client → prompts/get { name: "simple-prompt" }
   ← { messages: [{ role: "user", content: { type: "text", text: "This is a simple prompt..." } }] }

4. Client injects message into chat → AI responds
```

### Flow 2: Args prompt with optional field

```
1. Client → prompts/list
   ← [{ name: "args-prompt", arguments: [{ name: "city", required: true }, { name: "state", required: false }] }]

2. User fills: city = "Chicago", state = "IL"

3. Client → prompts/get { name: "args-prompt", arguments: { city: "Chicago", state: "IL" } }
   ← { messages: [{ role: "user", content: { type: "text", text: "What's weather in Chicago, IL?" } }] }
```

### Flow 3: Completable prompt with cascading suggestions

```
1. User types "Eng" in department → completion/complete → ["Engineering"]
2. User selects "Engineering"
3. User types "Al" in name → completion/complete → ["Alice"]  (only Engineering names)
4. User selects "Alice"

5. Client → prompts/get { name: "completable-prompt", arguments: { department: "Engineering", name: "Alice" } }
   ← { messages: [{ role: "user", content: { type: "text", text: "Please promote Alice to the head of the Engineering team." } }] }
```

### Flow 4: Resource prompt with embedded data

```
1. User picks resource-prompt, sets resourceType = "Text", resourceId = "3"

2. Client → prompts/get { name: "resource-prompt", arguments: { resourceType: "Text", resourceId: "3" } }
   ← {
        messages: [
          { role: "user", content: { type: "text", text: "This prompt includes the Text resource with id: 3..." } },
          { role: "user", content: { type: "resource", resource: { uri: "demo://resource/dynamic/text/3", text: "Resource 3: ..." } } }
        ]
      }

3. AI analyzes the embedded resource directly — no resources/read needed
```

---

## All Prompts — Quick Reference

| Prompt | Args | Autocomplete | Embeds resource | Module |
|--------|------|--------------|-----------------|--------|
| `simple-prompt` | none | — | No | `simple.ts` |
| `args-prompt` | `city` (req), `state` (opt) | No | No | `args.ts` |
| `completable-prompt` | `department`, `name` | Yes (cascading) | No | `completions.ts` |
| `resource-prompt` | `resourceType`, `resourceId` | Yes | Yes | `resource.ts` |

---

## Codebase Map

```
prompts/
├── index.ts        → orchestrator: registers all four prompts
├── simple.ts       → no-argument static prompt
├── args.ts         → required + optional Zod arguments
├── completions.ts  → completable() with cascading suggestions
└── resource.ts     → embeds dynamic resource in messages

Depends on:
└── resources/templates.ts  → resource helpers + completable functions

Registered in:
└── server/index.ts → registerPrompts(server) at startup
```

---

## Anatomy of a Prompt (The Pattern)

### Minimal prompt (no arguments)

```typescript
export const registerMyPrompt = (server: McpServer) => {
  server.registerPrompt(
    "my-prompt",                    // kebab-case name
    {
      title: "My Prompt",           // display title
      description: "What it does",  // shown in prompts/list
    },
    () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hello!" },
        },
      ],
    })
  );
};
```

### Prompt with arguments

```typescript
const promptArgsSchema = {
  field: z.string().describe("Description shown in UI"),
  optionalField: z.string().optional().describe("Optional field"),
};

server.registerPrompt(
  "my-args-prompt",
  { title: "...", description: "...", argsSchema: promptArgsSchema },
  (args) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Value: ${args.field}` },
      },
    ],
  })
);
```

### Prompt with autocomplete

```typescript
const promptArgsSchema = {
  choice: completable(
    z.string().describe("Pick one"),
    (value) => ["Option A", "Option B"].filter((o) => o.startsWith(value))
  ),
};
```

### Prompt with embedded resource

```typescript
(args) => ({
  messages: [
    { role: "user", content: { type: "text", text: "Analyze this:" } },
    { role: "user", content: { type: "resource", resource: myResource } },
  ],
})
```

---

## Best Practices

1. **Use kebab-case names** — `simple-prompt`, `args-prompt` (matches tools/resources convention)
2. **Describe every argument** — `.describe()` on Zod fields becomes UI labels in `prompts/list`
3. **Keep prompts focused** — one clear use case per prompt
4. **Use `completable()` for constrained values** — better UX than free-text when choices are finite
5. **Cascading completions** — use `context.arguments` so later fields depend on earlier ones
6. **Prompt args are strings** — convert to numbers/dates in the handler, not in the schema type
7. **Validate in the handler** — throw clear errors for invalid argument combinations
8. **Export `registerX(server)`** — one file per prompt, wire in `prompts/index.ts`
9. **Reuse resource helpers** — don't duplicate resource-building logic; import from `resources/templates.ts`
10. **Multiple messages are fine** — intro text + embedded resource is a common pattern
11. **Prompts are read-only templates** — no side effects; use tools for actions
12. **Title and description matter** — they're what the user sees when browsing `prompts/list`

---

## Learning Path (Recommended Order)

1. **`simple.ts`** — minimal pattern, no arguments
2. **`args.ts`** — Zod schema, required vs optional, string interpolation
3. **`completions.ts`** — `completable()`, cascading suggestions
4. **`resource.ts`** — embedding resources in messages, cross-module reuse

---

## Adding Your Own Prompt (Quick Recipe)

1. Create `prompts/my-prompt.ts` with `registerMyPrompt(server)`
2. Add import + call in `prompts/index.ts`
3. Choose complexity:
   - **Static** → no `argsSchema`, fixed messages
   - **Parameterized** → `argsSchema` with Zod fields
   - **Autocomplete** → wrap fields with `completable()`
   - **With data** → embed `resource` or `image` content in messages
4. Run `npm run build` and test with MCP Inspector (`npm run inspect`)

---

## Key Takeaways

1. **Prompts are reusable chat templates** — they return `messages`, not `content`
2. **Four patterns in this server:** static, args, completable, resource-embedded
3. **`server.registerPrompt(name, config, handler)`** is the core SDK call
4. **Arguments use Zod schemas** in `argsSchema` — `.describe()` for UI labels
5. **`completable()` enables autocomplete** — including context-aware cascading
6. **Prompt args are always strings** in the protocol — convert types in the handler
7. **Prompts can embed resources** — AI gets data as conversation context without `resources/read`
8. **No conditional registration** — all prompts register at startup (unlike some tools)
9. **Prompts have no side effects** — pure template generation; use tools for actions
10. **Cross-feature reuse** — `resource-prompt` imports helpers from `resources/templates.ts`
