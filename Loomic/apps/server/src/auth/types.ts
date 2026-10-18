import type { FastifyRequest } from "fastify";

export type AuthenticatedUser = {
  accessToken: string;
  email: string;
  id: string;
  userMetadata: Record<string, unknown>;
};

export type RequestAuthenticator = {
  authenticate(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AuthenticatedUser | null>;
};

type QueryRow = any;
type QueryResult = Promise<{ data: any; error: { message: string; code?: string } | null; count?: number | null }>;
type QueryBuilder = {
  select(...args: any[]): QueryBuilder;
  insert(...args: any[]): QueryBuilder;
  update(...args: any[]): QueryBuilder;
  delete(...args: any[]): QueryBuilder;
  eq(...args: any[]): QueryBuilder;
  neq(...args: any[]): QueryBuilder;
  is(...args: any[]): QueryBuilder;
  not(...args: any[]): QueryBuilder;
  in(...args: any[]): QueryBuilder;
  order(...args: any[]): QueryBuilder;
  limit(...args: any[]): QueryBuilder;
  upsert(...args: any[]): QueryBuilder;
  single(): QueryResult;
  maybeSingle(): QueryResult;
  then<TResult1 = { data: QueryRow[]; error: { message: string; code?: string } | null; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: QueryRow[]; error: { message: string; code?: string } | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

// Structural compatibility for retired remote adapters; runtime services use local PostgreSQL.
export type DataClient = {
  from(table: string): QueryBuilder;
  rpc(...args: any[]): QueryResult;
  auth: any;
  storage: any;
};
export type DataAdminClient = DataClient;
