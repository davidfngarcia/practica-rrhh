import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
  ValidateIf,
} from 'class-validator';
import { EsFecha } from '../common/fechas.js';
import { PaginadoDto } from '../common/paginacion.js';
import { aBooleano } from '../common/transformaciones.js';

/**
 * Valores admitidos por `tipo_contrato`.
 *
 * Son los del CHECK `ck_empleado_tipo_contrato`. La lista se declara aqui para que un
 * valor inventado se rechace con un 400 que dice cuales son los validos, en vez de
 * llegar hasta MySQL y volver como un error de constraint en ingles.
 */
export const TIPOS_CONTRATO = [
  'SERVICIOS',
  'PLANTA',
  'CONTRATO',
  'PRACTICAS',
  'TEMPORAL',
] as const;

export type TipoContrato = (typeof TIPOS_CONTRATO)[number];

const MENSAJE_TIPO_CONTRATO = `El tipo de contrato debe ser uno de: ${TIPOS_CONTRATO.join(', ')}`;
const MENSAJE_ACTIVO = 'activo debe ser true o false';
const MENSAJE_UUID = 'debe ser un identificador UUID';

const MAX_TIPO_CONTRATO = 20;

/** Longitud de `empleado.codigo`, la misma que la columna. */
export const MAX_CODIGO_EMPLEADO = 50;

/** Formato de un IBAN: dos letras de pais, dos cifras de control y hasta 30 alfanumericos. */
export const PATRON_IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/;

const MENSAJE_IBAN =
  'debe ser un IBAN valido: dos letras de pais, dos cifras y hasta 30 caracteres alfanumericos, sin espacios';

/** Salario anual en euros. Se guarda cifrado, pero se valida antes de cifrarlo. */
const MENSAJE_SALARIO = 'debe ser un numero mayor o igual que cero';
const MAX_SALARIO = 1e12;

/**
 * Documento de identidad, para filtrar empleados por el de su persona.
 *
 * Es un filtro exacto y no una busqueda de texto porque `persona.numero_documento` esta
 * cifrado. El servicio lo resuelve contra `persona.documento_indice`, que si es
 * determinista.
 */
const PATRON_DOCUMENTO = /^[A-Za-z0-9-]{3,50}$/;

/**
 * Listado de empleados.
 *
 * A diferencia de `ListarPersonasDto`, aqui los filtros propios son ids: la persona, el
 * departamento y el puesto. Son consultas exactas, no busquedas de texto, porque un
 * listado de empleados se filtra por "quien es", "de que departamento es" o "que puesto
 * ocupa", no por coincidencias dentro de un nombre.
 */
export class ListarEmpleadosDto extends PaginadoDto {
  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  persona_id?: string;

  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  departamento_id?: string;

  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  puesto_id?: string;

  @IsOptional()
  @IsString()
  @IsIn(TIPOS_CONTRATO, { message: MENSAJE_TIPO_CONTRATO })
  tipo_contrato?: TipoContrato;

  /**
   * Solo empleados con contrato en vigor en una fecha dada.
   *
   * No se filtra por `activo`: un empleado con contrato terminado sigue siendo parte
   * del historico y se puede querer localizar. Lo que se decide es si estaba dado de
   * alta en la empresa en esa fecha.
   */
  @IsOptional()
  @EsFecha()
  vigente_en?: string;

  /**
   * Filtra por el documento de identidad de la persona vinculada.
   *
   * Va contra el indice ciego de `persona`, no contra el documento: cifrado con IV
   * aleatorio, no admite busqueda por fragmento ni por igualdad. Quien necesite
   * coincidencias parciales tiene `buscar`, que solo recorre nombre y apellidos.
   */
  @IsOptional()
  @IsString()
  @Matches(PATRON_DOCUMENTO, {
    message: 'debe ser un documento de identidad sin espacios',
  })
  numero_documento?: string;

  /** Filtra por el codigo de empleado dentro de la empresa. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODIGO_EMPLEADO)
  codigo?: string;

  /**
   * Filtra por la cuenta de pago, de forma exacta.
   *
   * Va contra `empleado.iban_indice`, no contra `iban_cifrado`: el IBAN esta cifrado
   * con un IV aleatorio, asi que en esa columna no hay igualdad posible y un `LIKE`
   * devolveria un cero silencioso. Sin este filtro, `iban_indice` seria una columna que
   * se escribe y no se lee nunca.
   */
  @IsOptional()
  @IsString()
  @Matches(PATRON_IBAN, { message: MENSAJE_IBAN })
  iban?: string;
}

/** Alta de un empleado. */
export class CrearEmpleadoDto {
  @IsUUID('4', { message: MENSAJE_UUID })
  persona_id: string;

  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  departamento_id?: string;

  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  puesto_id?: string;

  /**
   * Codigo del empleado dentro de la empresa, unico mientras la ficha esta viva.
   *
   * Opcional: no toda empresa numera a su plantilla, y exigirlo impediria dar de alta a
   * alguien en una empresa que todavia no tiene numeracion. Si se envia, se valida antes
   * de tocar la base.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODIGO_EMPLEADO)
  codigo?: string;

  /**
   * Salario anual en euros.
   *
   * Se valida aqui en claro y se cifra antes de llegar a la tabla: al cliente le llega
   * como numero, y nunca como texto cifrado.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: MENSAJE_SALARIO })
  @Min(0, { message: MENSAJE_SALARIO })
  @Max(MAX_SALARIO, { message: MENSAJE_SALARIO })
  salario?: number;

  /**
   * IBAN de la cuenta de pago.
   *
   * Se exige en mayusculas y sin espacios porque es la forma canonica segun ISO 13616 y
   * porque el indice ciego que permite localizarlo se calcula sobre el valor ya
   * normalizado: aceptar "es91 1234..." tal cual haria que dos escrituras del mismo IBAN
   * generaran dos indices distintos.
   */
  @IsOptional()
  @IsString()
  @Matches(PATRON_IBAN, { message: MENSAJE_IBAN })
  iban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TIPO_CONTRATO)
  @IsIn(TIPOS_CONTRATO, { message: MENSAJE_TIPO_CONTRATO })
  tipo_contrato?: TipoContrato;

  @EsFecha()
  fecha_ingreso: string;

  @IsOptional()
  @EsFecha()
  fecha_fin?: string;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: MENSAJE_ACTIVO })
  activo?: boolean;
}

/**
 * Modificacion de un empleado.
 *
 * `persona_id` no se puede cambiar: la persona es la identidad del empleado y moverlo de
 * fila seria reescribir el historico de una relacion que ya tiene fechas de ingreso.
 * Mandarlo devuelve el 400 habitual de "no es un campo permitido".
 *
 * Los campos opcionales si se pueden vaciar, y en esa distincion esta el unico detalle
 * que no coincide con el resto de DTO del proyecto: en departamentos y puestos, `null`
 * no tiene sentido, asi que un `PATCH` con `{ descripcion: null }` se rechaza. Aqui
 * `departamento_id`, `puesto_id` y `fecha_fin` tienen un valor "sin asignar" que el
 * cliente quiere poder expresar, asi que `null` se acepta y significa "dejarlo vacio".
 *
 * Lo que lo permite es `@IsOptional()`, que se salta el resto de validadores cuando el
 * valor es `null` o `undefined`. No hace falta un `@ValidateIf` extra para conseguir
 * eso: lo que no se debe admitir es `null` en un campo obligatorio, y en este DTO no hay
 * ninguno opcional que lo prohiba.
 */
export class ActualizarEmpleadoDto {
  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  departamento_id?: string | null;

  @IsOptional()
  @IsUUID('4', { message: MENSAJE_UUID })
  puesto_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODIGO_EMPLEADO)
  codigo?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: MENSAJE_SALARIO })
  @Min(0, { message: MENSAJE_SALARIO })
  @Max(MAX_SALARIO, { message: MENSAJE_SALARIO })
  salario?: number | null;

  @IsOptional()
  @IsString()
  @Matches(PATRON_IBAN, { message: MENSAJE_IBAN })
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TIPO_CONTRATO)
  @IsIn(TIPOS_CONTRATO, { message: MENSAJE_TIPO_CONTRATO })
  tipo_contrato?: TipoContrato;

  @IsOptional()
  @EsFecha()
  fecha_ingreso?: string;

  @IsOptional()
  @EsFecha()
  fecha_fin?: string | null;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: MENSAJE_ACTIVO })
  activo?: boolean;

  /**
   * Version de la fila que el cliente cree que va a modificar.
   *
   * Es el mecanismo del bloqueo optimista: si viene, la escritura solo se aplica si la
   * fila sigue en esa version. Si otra peticion ha escrito mientras tanto, el UPDATE no
   * afecta a ninguna fila y la API responde 409 en lugar de pisar el cambio ajeno.
   *
   * Opcional, porque hay clientes que no lo envian, y en ese caso el PATCH sigue
   * funcionando como "el ultimo que escribe gana", que es el comportamiento previo a
   * esto. Lo que no se permite es mandar la version como string.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'debe ser un numero entero' })
  @Min(0, { message: 'no puede ser negativo' })
  version?: number;
}
