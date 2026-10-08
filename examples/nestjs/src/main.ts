import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Users API listening on http://localhost:${port}`);
  console.log(`MCP endpoint:      http://localhost:${port}/mcp`);
}

void bootstrap();
