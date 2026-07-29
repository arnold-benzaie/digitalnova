import type { components, operations } from "./generated/schema.js";
import { PublicMapApiError, PublicMapUnexpectedResponseError } from "./errors.js";

export type PublicMapClientOptions = {
  /** A key created for your organization — see the Authentication guide
   * at /developers/docs/authentication. Never hard-code this; read it
   * from an environment variable or secrets manager. */
  apiKey: string;
  /** Defaults to PUBLIC-MAP's production API. Override for local
   * development against a self-hosted instance. */
  baseUrl?: string;
  /** Override the fetch implementation (e.g. a logging/retrying wrapper,
   * or a polyfill on older runtimes). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

type ListAuditsQuery = NonNullable<operations["listAudits"]["parameters"]["query"]>;
type ListReportsQuery = NonNullable<operations["listReports"]["parameters"]["query"]>;
type ListClientsQuery = NonNullable<operations["listClients"]["parameters"]["query"]> & {
  stage?: "lead" | "prospect" | "client" | "churned";
};

type Audit = components["schemas"]["Audit"];
type Report = components["schemas"]["Report"];
type ReportListItem = components["schemas"]["ReportListItem"];
type Client = components["schemas"]["Client"];
type ClientPatchRequest = components["schemas"]["ClientPatchRequest"];
type Task = components["schemas"]["Task"];
/** openapi-typescript marks a field carrying an OpenAPI `default` as
 * non-optional (defaultNonNullable, on by default) — correct for a
 * response, but `status` is genuinely optional on the way IN (the server
 * fills "todo" when omitted, see lib/api-v1/tasks.ts). Widened back to
 * optional here rather than changing that upstream generator behavior. */
type TaskCreateRequest = Omit<components["schemas"]["TaskCreateRequest"], "status"> & {
  status?: components["schemas"]["TaskCreateRequest"]["status"];
};
type Interaction = components["schemas"]["Interaction"];
type InteractionCreateRequest = components["schemas"]["InteractionCreateRequest"];
type Pagination = components["schemas"]["Pagination"];

const DEFAULT_BASE_URL = "https://app.public-map.com/api/v1";

/**
 * Official TypeScript/JavaScript client for the PUBLIC-MAP public REST
 * API. Every method here corresponds 1:1 to an operation in
 * lib/api-v1/openapi.yaml — request/response shapes come from the
 * generated ./generated/schema.ts, never hand-duplicated.
 *
 * @example
 * ```ts
 * const client = new PublicMapClient({ apiKey: process.env.PUBLIC_MAP_API_KEY! });
 * const { data: audits } = await client.audits.list({ limit: 20 });
 * ```
 */
export class PublicMapClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PublicMapClientOptions) {
    if (!options.apiKey) throw new Error("PublicMapClient requires an apiKey.");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available — pass one explicitly via the `fetch` option on older runtimes.");
    }
  }

  /** Confirms the key is valid and lists the scopes it carries — see the Quick Start guide. */
  async ping(): Promise<{ pong: true; organizationId: string; scopes: string[] }> {
    return this.request("GET", "/ping");
  }

  readonly audits = {
    list: (query?: ListAuditsQuery): Promise<{ data: Audit[]; pagination: Pagination }> =>
      this.request("GET", `/audits${toQueryString(query)}`),
    get: (id: string): Promise<Audit> => this.request("GET", `/audits/${encodeURIComponent(id)}`),
  };

  readonly reports = {
    list: (query?: ListReportsQuery): Promise<{ data: ReportListItem[]; pagination: Pagination }> =>
      this.request("GET", `/reports${toQueryString(query)}`),
    get: (id: string): Promise<Report> => this.request("GET", `/reports/${encodeURIComponent(id)}`),
  };

  readonly clients = {
    list: (query?: ListClientsQuery): Promise<{ data: Client[]; pagination: Pagination }> =>
      this.request("GET", `/clients${toQueryString(query)}`),
    get: (id: string): Promise<Client> => this.request("GET", `/clients/${encodeURIComponent(id)}`),
    update: (id: string, patch: ClientPatchRequest): Promise<Client> =>
      this.request("PATCH", `/clients/${encodeURIComponent(id)}`, { body: patch }),
  };

  readonly tasks = {
    create: (input: TaskCreateRequest, options?: { idempotencyKey?: string }): Promise<Task> =>
      this.request("POST", "/tasks", { body: input, idempotencyKey: options?.idempotencyKey }),
  };

  readonly interactions = {
    create: (input: InteractionCreateRequest, options?: { idempotencyKey?: string }): Promise<Interaction> =>
      this.request("POST", "/interactions", { body: input, idempotencyKey: options?.idempotencyKey }),
  };

  /**
   * Low-level escape hatch — every method above is a thin wrapper around
   * this. Returns the parsed `data` (or `{data, pagination}` for list
   * responses) directly; throws PublicMapApiError on any non-2xx
   * response. Public so advanced use cases (a not-yet-wrapped future
   * endpoint) don't need to fork the whole client.
   */
  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    options?: { body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (options?.body !== undefined) headers["Content-Type"] = "application/json";
    if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new PublicMapUnexpectedResponseError(response.status, text);
    }

    if (!response.ok) {
      const errorBody = json as { error?: { code?: string; message?: string; requestId?: string } } | undefined;
      if (!errorBody?.error) throw new PublicMapUnexpectedResponseError(response.status, text);
      const retryAfterHeader = response.headers.get("Retry-After");
      throw new PublicMapApiError({
        code: errorBody.error.code ?? "INTERNAL_ERROR",
        message: errorBody.error.message ?? "Unknown error.",
        requestId: errorBody.error.requestId ?? "",
        status: response.status,
        retryAfterSeconds: retryAfterHeader ? Number(retryAfterHeader) : undefined,
      });
    }

    // Every success envelope is {"data": ...} plus, for list endpoints, a
    // sibling "pagination" key (see lib/api-v1/response.ts's apiSuccess) —
    // returning the whole body (not just body.data) lets list callers get
    // {data, pagination} while single-resource callers can destructure
    // {data} themselves; see the typed method signatures above.
    const body = json as { data?: unknown; pagination?: Pagination };
    if (body && typeof body === "object" && "pagination" in body) {
      return { data: body.data, pagination: body.pagination } as T;
    }
    return body?.data as T;
  }
}

function toQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
