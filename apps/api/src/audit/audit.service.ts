import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ActorContext } from '../common/actor-context.js';

export interface AuditInput {
  actor: ActorContext | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  branchId?: string | null;
  reason?: string | null;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  requestId?: string | null;
}

@Injectable()
export class AuditService {
  write(tx: Prisma.TransactionClient, input: AuditInput) {
    return tx.auditEvent.create({
      data: {
        actorId: input.actor?.type === 'STAFF' ? input.actor.id : null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        branchId: input.branchId ?? null,
        reason: input.reason ?? null,
        beforeState: input.beforeState,
        afterState: input.afterState,
        requestId: input.requestId ?? null,
      },
    });
  }
}
