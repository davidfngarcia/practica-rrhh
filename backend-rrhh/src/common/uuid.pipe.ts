import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

/**
 * Valida que un `:id` de la ruta sea un UUID.
 *
 * Sustituye a `ParseUUIDPipe` de Nest porque su mensaje es
 * "Validation failed (uuid is expected)", en ingles. Este responde en castellano.
 *
 * Se valida el formato antes de tocar la base de datos a proposito: sin esto, un
 * id con comillas produciria un error de MySQL en lugar de un 400 claro.
 */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(valor: string): string {
    if (!isUUID(valor)) {
      throw new BadRequestException(
        'El identificador de la ruta no es un UUID valido',
      );
    }

    return valor;
  }
}
