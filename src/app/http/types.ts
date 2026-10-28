import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../../config.ts';
import type { Logger } from '../../logger.ts';
import type { WriteContext } from '../../persistence/repositories/context.ts';
import type { AppResponse } from './responses.ts';

export interface UploadedFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface AppDependencies {
  readonly db: DatabaseSync;
  readonly config: AppConfig;
  readonly logger: Logger;
}

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly fields: ReadonlyMap<string, string>;
  readonly file: UploadedFile | null;
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly requestId: string;
  readonly now: string;
  readonly deps: AppDependencies;
}

export type RouteHandler = (context: RequestContext) => AppResponse | Promise<AppResponse>;

export interface RouteDefinition {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly handler: RouteHandler;
}

export function writeContext(context: RequestContext): WriteContext {
  return { actor: context.deps.config.operator, at: context.now };
}

export function field(context: RequestContext, name: string): string | undefined {
  return context.fields.get(name);
}
