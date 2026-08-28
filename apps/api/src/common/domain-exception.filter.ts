import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  CyclicRecipeError,
  DivisionByZeroError,
  DomainError,
  IncompatibleUnitsError,
  InvalidValueError,
  InvalidYieldError,
  MissingConversionFactorError,
  MissingPurchasePriceError,
  UnknownItemError,
  UnknownRecipeError,
} from '@warekai/domain';
import type { Response } from 'express';

/**
 * Traduce los errores del motor de costes a respuestas HTTP.
 *
 * El motor no sabe nada de HTTP -- ni debe -- asi que la traduccion vive aqui.
 * El `code` del error viaja tal cual al cliente: el frontend distingue un ciclo
 * de una densidad ausente sin leer el texto del mensaje.
 *
 * Casi todos son 422 y no 500: son datos del usuario que no cuadran, no fallos
 * del servidor. Un escandallo con un ciclo es un error de quien lo escribio, y
 * el mensaje lleva la ruta del ciclo para que pueda arreglarlo.
 */
const STATUS_BY_ERROR = new Map<new (...args: never[]) => DomainError, HttpStatus>([
  [UnknownItemError, HttpStatus.NOT_FOUND],
  [UnknownRecipeError, HttpStatus.NOT_FOUND],
  [CyclicRecipeError, HttpStatus.UNPROCESSABLE_ENTITY],
  [InvalidYieldError, HttpStatus.UNPROCESSABLE_ENTITY],
  [InvalidValueError, HttpStatus.UNPROCESSABLE_ENTITY],
  [IncompatibleUnitsError, HttpStatus.UNPROCESSABLE_ENTITY],
  [MissingConversionFactorError, HttpStatus.UNPROCESSABLE_ENTITY],
  [MissingPurchasePriceError, HttpStatus.UNPROCESSABLE_ENTITY],
  [DivisionByZeroError, HttpStatus.UNPROCESSABLE_ENTITY],
]);

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status =
        [...STATUS_BY_ERROR.entries()].find(([type]) => exception instanceof type)?.[1] ??
        HttpStatus.UNPROCESSABLE_ENTITY;

      response.status(status).json({
        code: exception.code,
        message: exception.message,
        ...(exception instanceof CyclicRecipeError ? { details: { cycle: exception.cycle } } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(
          typeof body === 'object' && body !== null && 'code' in body
            ? body
            : { code: httpCodeFor(exception.getStatus()), message: exception.message },
        );
      return;
    }

    this.logger.error(
      'Error no controlado',
      exception instanceof Error ? exception.stack : exception,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor.',
    });
  }
}

function httpCodeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    default:
      return 'ERROR';
  }
}
