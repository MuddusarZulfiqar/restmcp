# @restmcp/express

Automatically convert an existing Express app's routes into [MCP](https://modelcontextprotocol.io)
tools, so AI clients can call your API directly — no hand-written MCP tool
definitions.

```bash
npm install @restmcp/express
```

```ts
import express from "express";
import { MCPExpress } from "@restmcp/express";

const app = express();
app.use(express.json());

app.get("/users", listUsers);
app.get("/users/:id", getUser);
app.post("/users", createUser);

const mcp = MCPExpress.setup(app, { name: "My API", version: "1.0.0" });

app.listen(3000);
```

`POST /mcp` is now live, and every eligible route is an MCP tool — discovered
by walking Express's own router stack (supports both Express 4 and 5), never
by scanning your source files.

Refine what gets exposed:

```ts
// Override a route's generated name/description
mcp.tool("/users/:id", { name: "get_customer", description: "Look up a customer by id" }, "GET");

// Exclude a route entirely
mcp.exclude("/admin/stats");

// Register a route automatic discovery couldn't resolve
mcp.register({
  method: "GET",
  path: "/legacy/report",
  name: "get_legacy_report",
  description: "Fetch the legacy report",
  inputSchema: { type: "object", properties: {}, required: [] },
});
```

## Documentation

Full docs — configuration, authentication, tool filtering, security, the
CLI, troubleshooting — live in the
[project README](https://github.com/MuddusarZulfiqar/restmcp#readme).

## License

MIT
