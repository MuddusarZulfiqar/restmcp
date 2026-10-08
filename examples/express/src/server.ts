import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => {
  console.log(`Library API listening on http://localhost:${port}`);
  console.log(`MCP endpoint:      http://localhost:${port}/mcp`);
});
