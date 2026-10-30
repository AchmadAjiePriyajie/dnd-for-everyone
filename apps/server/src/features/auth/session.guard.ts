import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.js';
import { type AuthedRequest, readSessionToken } from './principal.js';
import { AuthService } from './service.js';

/** Wajib sesi valid; menempelkan principal ke request. Membership tetap dicek di domain. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readSessionToken(req);
    const principal = this.auth.resolveSession(token);
    if (!principal || !token) throw new DomainError('UNAUTHENTICATED', 401);
    req.principal = principal;
    req.sessionToken = token;
    return true;
  }
}
