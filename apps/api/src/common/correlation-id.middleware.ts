import { randomUUID } from 'node:crypto';

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export function correlationIdMiddleware(
  request: { header(name: string): string | undefined },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
): void {
  const candidate = request.header('x-request-id');
  const requestId = candidate && requestIdPattern.test(candidate) ? candidate : randomUUID();
  response.setHeader('x-request-id', requestId);
  next();
}
