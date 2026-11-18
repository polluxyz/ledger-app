import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthTokenResponse, AuthUser, type JwtPayload } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * 認證端點：註冊、登入與登出。註冊與登入用 `@Public()` 豁免全域 JWT guard（尚未登入的人
 * 本來就無 token），並套用比全域更嚴的流量限制。
 */

// 對未認證的 auth 端點收緊流量，鈍化暴力破解與帳號枚舉：每個 IP 每分鐘 5 次。
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiConflictResponse({ description: 'Email is already registered.' })
  register(@Body() dto: RegisterDto): Promise<AuthUser> {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  // 保持既有的登入回應狀態碼。
  @HttpCode(HttpStatus.OK)
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.' })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponse> {
    return this.authService.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('jwt')
  @ApiNoContentResponse({ description: 'Current login has been revoked.' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired token' })
  logout(@CurrentUser() user: JwtPayload): Promise<void> {
    return this.authService.logout(user.sub, user.sid);
  }
}
