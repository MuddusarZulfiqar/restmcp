import { Module } from "@nestjs/common";
import { MCPModule } from "@restmcp/nestjs";
import { UsersController } from "./users/users.controller.js";

export const mcpConfig = {
  name: "Users API",
  version: "1.0.0",
  auth: {
    type: "bearer" as const,
    validate: async (ctx: { credential?: string }) => ctx.credential === (process.env.API_MCP_DEMO_TOKEN ?? "demo-token"),
  },
};

@Module({
  imports: [MCPModule.forRoot(mcpConfig)],
  controllers: [UsersController],
})
export class AppModule {}
