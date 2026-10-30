import { Body, Controller, Get, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  type AccountView,
  type AuthState,
  credentialsBody,
  localeBody,
  loginBody,
  type Principal,
  registerBody,
} from '#shared/access';
import type { z } from 'zod';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import {
  type AuthedRequest,
  clearedSessionCookie,
  CurrentPrincipal,
  readSessionToken,
  sessionCookie,
} from './principal.js';
import { AuthService } from './service.js';
import { SessionGuard } from './session.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private startSession(principal: Principal, req: FastifyRequest, reply: FastifyReply): AccountView {
    const token = this.auth.createSession(principal);
    void reply.header('set-cookie', sessionCookie(token, req));
    return this.auth.account(principal);
  }

  @Get('state')
  state(@Req() req: FastifyRequest): AuthState {
    return this.auth.state(this.auth.resolveSession(readSessionToken(req)));
  }

  @Post('bootstrap')
  async bootstrap(
    @Body(new SchemaValidationPipe(credentialsBody)) body: z.infer<typeof credentialsBody>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountView> {
    const principal = await this.auth.bootstrapOwner(body.username, body.password);
    return this.startSession(principal, req, reply);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new SchemaValidationPipe(loginBody)) body: z.infer<typeof loginBody>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountView> {
    const principal = await this.auth.login(body.username, body.password, req.ip);
    return this.startSession(principal, req, reply);
  }

  @Post('register')
  async register(
    @Body(new SchemaValidationPipe(registerBody)) body: z.infer<typeof registerBody>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountView> {
    this.auth.joinLimiter.consume(req.ip);
    const principal = await this.auth.registerInvitedAccount(body.invite, body.username, body.password);
    return this.startSession(principal, req, reply);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    this.auth.revokeSession(req.sessionToken!);
    void reply.header('set-cookie', clearedSessionCookie(req));
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentPrincipal() principal: Principal): AccountView {
    return this.auth.account(principal);
  }

  @Put('me/locale')
  @UseGuards(SessionGuard)
  setLocale(
    @CurrentPrincipal() principal: Principal,
    @Body(new SchemaValidationPipe(localeBody)) body: z.infer<typeof localeBody>,
  ): AccountView {
    return this.auth.setLocale(principal, body.locale);
  }
}
