import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Identity headers the gateway sets after verifying a JWT. Services never trust them from clients directly. */
export const IDENTITY_HEADERS = {
  id: 'x-user-id',
  email: 'x-user-email',
  role: 'x-user-role',
  gatewayToken: 'x-gateway-token',
} as const;

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, jwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
    issuer: 'node-microservices',
  });
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, jwtSecret(), { issuer: 'node-microservices' }) as jwt.JwtPayload;
  return { id: String(payload.sub), email: String(payload.email), role: payload.role === 'admin' ? 'admin' : 'user', name: payload.name };
}

function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Resolves the caller: identity headers are accepted only together with the shared gateway token
 * (so a client cannot reach a service port and forge them); a Bearer JWT is accepted as well.
 */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const gwToken = process.env.GATEWAY_SHARED_SECRET;
  if (gwToken && safeEqual(req.header(IDENTITY_HEADERS.gatewayToken), gwToken) && req.header(IDENTITY_HEADERS.id)) {
    req.user = {
      id: req.header(IDENTITY_HEADERS.id)!,
      email: req.header(IDENTITY_HEADERS.email) ?? '',
      role: req.header(IDENTITY_HEADERS.role) === 'admin' ? 'admin' : 'user',
    };
    return next();
  }
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(auth.slice(7));
    } catch {
      // invalid tokens are treated as anonymous; requireUser rejects them
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Admin role required'));
  next();
}

/** Guards service-to-service endpoints (`/internal/*`) with INTERNAL_API_TOKEN. */
export function requireInternal(req: Request, _res: Response, next: NextFunction): void {
  if (!safeEqual(req.header(INTERNAL_TOKEN_HEADER), process.env.INTERNAL_API_TOKEN)) {
    return next(new HttpError(403, 'Internal endpoint'));
  }
  next();
}
