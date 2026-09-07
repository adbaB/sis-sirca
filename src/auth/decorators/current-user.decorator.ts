import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../guards/auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
