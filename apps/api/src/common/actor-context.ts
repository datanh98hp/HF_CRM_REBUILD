import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type ActorType = 'STAFF' | 'CUSTOMER';

export interface ActorContext {
  id: string;
  type: ActorType;
  sessionId?: string;
  isMock?: boolean;
  mustChangePassword?: boolean;
}

export interface ActorRequest {
  actor?: ActorContext;
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string | undefined>;
  body?: unknown;
  ip?: string;
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContext | undefined =>
    context.switchToHttp().getRequest<ActorRequest>().actor,
);
