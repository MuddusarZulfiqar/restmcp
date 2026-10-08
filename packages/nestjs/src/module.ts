import { Inject, Module, type DynamicModule, type OnModuleDestroy, type OnModuleInit, type Provider } from "@nestjs/common";
import { HttpAdapterHost, ModulesContainer } from "@nestjs/core";
import {
  type MCPConfig,
  type McpToolsManifest,
  type OpenAPIDocument,
  type RouteDescriptor,
  type ToolDefinition,
  DEFAULT_ENDPOINT,
  buildManifest,
  createLoopbackInvoker,
  createMcpRequestHandler,
  generateTools,
  routesToOpenAPI,
} from "@restmcp/core";
import { discoverNestRoutes } from "./scanner.js";

export interface NestMcpConfig extends MCPConfig {
  /** Prepended to every discovered path — set this if the host app calls `app.setGlobalPrefix()`. */
  globalPrefix?: string;
}

const MCP_CONFIG = Symbol("API_MCP_CONFIG");

interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface ExpressLikeResponse {
  headersSent: boolean;
  status(code: number): ExpressLikeResponse;
  json(body: unknown): void;
}

@Module({})
export class MCPModule implements OnModuleInit, OnModuleDestroy {
  private closeInvoker?: () => Promise<void>;

  constructor(
    private readonly modulesContainer: ModulesContainer,
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(MCP_CONFIG) private readonly config: NestMcpConfig,
  ) {}

  /**
   * Wires MCP support into an existing Nest application: discovers
   * controllers via Nest's own DI/reflection metadata, generates tools, and
   * mounts `config.endpoint` (default "/mcp") on the underlying HTTP
   * adapter once the app has bootstrapped. Opt-in — importing this module
   * only adds the one route; it changes nothing else about the host app.
   */
  static forRoot(config: NestMcpConfig): DynamicModule {
    const configProvider: Provider = { provide: MCP_CONFIG, useValue: config };
    return {
      module: MCPModule,
      providers: [configProvider],
      exports: [configProvider],
    };
  }

  private discoverRoutes(): RouteDescriptor[] {
    return discoverNestRoutes(this.modulesContainer, { globalPrefix: this.config.globalPrefix });
  }

  getTools(): ToolDefinition[] {
    return generateTools(this.discoverRoutes(), this.config).tools;
  }

  getManifest(): McpToolsManifest {
    return buildManifest(this.getTools(), this.config);
  }

  getOpenAPI(): OpenAPIDocument {
    return routesToOpenAPI(this.discoverRoutes(), { title: this.config.name, version: this.config.version });
  }

  onModuleInit(): void {
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const instance = httpAdapter.getInstance();
    const { invoke, close } = createLoopbackInvoker(instance);
    this.closeInvoker = close;

    const handler = createMcpRequestHandler({
      config: this.config,
      getTools: () => this.getTools(),
      invoke,
    });

    const endpoint = this.config.endpoint ?? DEFAULT_ENDPOINT;
    const middlewares = this.config.middleware ?? [];

    const finalHandler = async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
      try {
        await handler(req as never, res as never, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: error instanceof Error ? error.message : "internal error" });
        }
      }
    };

    // AbstractHttpAdapter#post forwards all arguments to the underlying
    // platform instance (Express's app.post(path, ...middleware, handler)),
    // but its .d.ts only declares the 1-2 arg overloads — cast to call it
    // with the variadic middleware array the config contract promises.
    const postMethod = httpAdapter.post.bind(httpAdapter) as (...args: unknown[]) => void;
    postMethod(endpoint, ...middlewares, finalHandler);
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeInvoker?.();
  }
}
