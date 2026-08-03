import { Body, Controller, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '@ledger/shared';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiConflictResponse({ description: 'Email is already registered.' })
  register(@Body() dto: RegisterDto): Promise<AuthUser> {
    return this.authService.register(dto);
  }
}
