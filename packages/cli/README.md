# @muddusarzulfiqar/restmcp

CLI for [`@restmcp`](https://github.com/MuddusarZulfiqar/restmcp#readme):
inspect, generate, and export [MCP](https://modelcontextprotocol.io) tool
definitions from an existing Express or NestJS app.

```bash
npm install -D @muddusarzulfiqar/restmcp
```

The package name is scoped (a name-similarity collision on the unscoped
`restmcp` forced that), but the installed command is just `restmcp`:

```bash
npx restmcp init      # scaffold restmcp.config.json + an entry-point stub
npx restmcp inspect    # print discovered routes / generated tools / exclusions
npx restmcp generate   # write mcp-tools.json + openapi.generated.json
npx restmcp export     # write mcp-tools.json only
```

`inspect` output:

```
MCP API Generator

Detected framework: NestJS

Routes discovered: 27
MCP tools generated: 21
Excluded routes: 6

MCP endpoint:
  POST /mcp
```

The CLI reads `restmcp.config.json` (`{ "entry": "./dist/restmcp.entry.js" }`)
and dynamically imports that built entry module, which must default-export a
function returning `{ framework, config, routes }` — see the
[project README's CLI section](https://github.com/MuddusarZulfiqar/restmcp#cli)
for a complete example.

## Documentation

Full docs live in the
[project README](https://github.com/MuddusarZulfiqar/restmcp#readme).

## License

MIT
