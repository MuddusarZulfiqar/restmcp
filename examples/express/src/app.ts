import express, { type Application } from "express";
import { MCPExpress } from "@restmcp/express";
import type { MCPConfig } from "@restmcp/core";

export interface Book {
  id: string;
  title: string;
  author: string;
}

export const books: Book[] = [
  { id: "1", title: "Dune", author: "Frank Herbert" },
  { id: "2", title: "Foundation", author: "Isaac Asimov" },
];

export const mcpConfig: MCPConfig = {
  name: "Library API",
  version: "1.0.0",
  exclude: ["/admin/*"],
  auth: {
    type: "apiKey",
    headerName: "x-api-key",
    validate: async (ctx) => ctx.credential === (process.env.API_MCP_DEMO_KEY ?? "demo-key"),
  },
};

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  app.get("/books", (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.toLowerCase() : undefined;
    const results = search ? books.filter((b) => b.title.toLowerCase().includes(search)) : books;
    res.json(results);
  });

  app.get("/books/:id", (req, res) => {
    const book = books.find((b) => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: "not found" });
    return res.json(book);
  });

  app.post("/books", (req, res) => {
    const book: Book = { id: String(books.length + 1), title: req.body.title, author: req.body.author };
    books.push(book);
    res.status(201).json(book);
  });

  app.put("/books/:id", (req, res) => {
    const book = books.find((b) => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: "not found" });
    Object.assign(book, { title: req.body.title ?? book.title, author: req.body.author ?? book.author });
    return res.json(book);
  });

  app.delete("/books/:id", (req, res) => {
    const index = books.findIndex((b) => b.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "not found" });
    const [removed] = books.splice(index, 1);
    return res.json(removed);
  });

  // Internal/admin route — excluded from MCP via config.exclude above.
  app.get("/admin/stats", (_req, res) => res.json({ bookCount: books.length }));

  MCPExpress.setup(app, mcpConfig);

  return app;
}
