import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  loginResponseSchema,
  loginSchema,
  pinLoginSchema,
  refreshSchema,
  registerDeviceSchema,
  sessionUserSchema,
  setPinSchema,
  trustedDeviceSchema,
  type LoginDto,
  type LoginResponseDto,
  type PinLoginDto,
  type RefreshDto,
  type RegisterDeviceDto,
  type SessionUserDto,
  type SetPinDto,
  type TrustedDeviceDto,
} from '@warekai/contracts';
import { ApiZodBody, ApiZodResponse, registerSchema } from '../../common/openapi';
import { CurrentUser, type Principal } from '../../common/principal';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public, TENANT_HEADER } from './auth.guard';

const Login = registerSchema('Login', loginSchema);
const PinLogin = registerSchema('PinLogin', pinLoginSchema);
const Refresh = registerSchema('Refresh', refreshSchema);
const RegisterDevice = registerSchema('RegisterDevice', registerDeviceSchema);
const SetPin = registerSchema('SetPin', setPinSchema);
const LoginResponse = registerSchema('LoginResponse', loginResponseSchema);
const SessionUser = registerSchema('SessionUser', sessionUserSchema);
const TrustedDevice = registerSchema('TrustedDevice', trustedDeviceSchema);

@ApiTags('Autenticacion')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entrar con correo y contrasena' })
  @ApiZodBody(Login)
  @ApiZodResponse(LoginResponse)
  login(
    @Body(zodPipe(loginSchema)) dto: LoginDto,
    @Headers(TENANT_HEADER) tenantSlug?: string,
  ): Promise<LoginResponseDto> {
    return this.auth.login(dto, tenantSlug);
  }

  @Public()
  @Post('pin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Entrar con PIN desde un dispositivo de confianza',
    description:
      'Pensado para la tablet de una partida. Exige el token del dispositivo, que se instala ' +
      'una vez, mas el PIN de la persona. La sesion resultante hereda el establecimiento del ' +
      'dispositivo, caduca antes y no puede modificar precios.',
  })
  @ApiZodBody(PinLogin)
  @ApiZodResponse(LoginResponse)
  loginWithPin(
    @Body(zodPipe(pinLoginSchema)) dto: PinLoginDto,
    @Headers(TENANT_HEADER) tenantSlug?: string,
  ): Promise<LoginResponseDto> {
    return this.auth.loginWithPin(dto, tenantSlug);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renovar la sesion. El refresco se rota en cada uso.' })
  @ApiZodBody(Refresh)
  @ApiZodResponse(LoginResponse)
  refresh(@Body(zodPipe(refreshSchema)) dto: RefreshDto): Promise<LoginResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cerrar todas las sesiones del usuario' })
  logout(@CurrentUser() principal: Principal): Promise<void> {
    return this.auth.logout(principal);
  }

  @Get('me')
  @ApiOperation({ summary: 'Sesion actual, con roles y establecimientos accesibles' })
  @ApiZodResponse(SessionUser)
  me(@CurrentUser() principal: Principal): Promise<SessionUserDto> {
    return this.auth.me(principal);
  }

  @Post('devices')
  @ApiOperation({
    summary: 'Dar de alta una tablet de partida',
    description: 'El token del dispositivo se devuelve una unica vez y no vuelve a mostrarse.',
  })
  @ApiZodBody(RegisterDevice)
  @ApiZodResponse(TrustedDevice, 201)
  registerDevice(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(registerDeviceSchema)) dto: RegisterDeviceDto,
  ): Promise<TrustedDeviceDto> {
    return this.auth.registerDevice(principal, dto);
  }

  @Post('pin/set')
  @HttpCode(204)
  @ApiOperation({ summary: 'Fijar el PIN corto del usuario' })
  @ApiZodBody(SetPin)
  setPin(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(setPinSchema)) dto: SetPinDto,
  ): Promise<void> {
    return this.auth.setPin(principal, dto.pin);
  }
}
