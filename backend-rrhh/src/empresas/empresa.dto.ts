/**
 * Datos de entrada de la empresa.
 *
 * No hay `ListarEmpresasDto` ni `CrearEmpresaDto`, y es deliberado: en el diseño
 * multiempresa la empresa sale del token, asi que la unica empresa que esta API puede
 * operar es la de la sesion. Ver `empresa.service.ts` para el detalle de por que no hay
 * alta ni listado.
 */
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Longitudes tomadas de `empresa.entity.ts`. */
const MAX_RAZON_SOCIAL = 200;
const MAX_NOMBRE_COMERCIAL = 150;
const MAX_EMAIL = 150;
const MAX_TELEFONO = 30;
const MAX_DIRECCION = 255;

/**
 * Modificacion de la empresa.
 *
 * Se declara a mano, como los otros DTO de actualizacion, en vez de derivarla con
 * `PartialType`: ese paquete llega como dependencia indirecta y no esta declarado.
 *
 * `codigo` e `identificacion_tributaria` no se pueden cambiar por esta via. El codigo
 * identifica a la empresa en integraciones y en la nomina; la identificacion tributaria
 * tiene consecuencias legales. Dejarlos editables por API permitiria rehacer una factura
 * bajo un codigo distinto del que ya se emitio.
 */
export class ActualizarEmpresaDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOMBRE_COMERCIAL)
  nombre_comercial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RAZON_SOCIAL)
  razon_social?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo debe tener un formato valido' })
  @MaxLength(MAX_EMAIL)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TELEFONO)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DIRECCION)
  direccion?: string;
}
