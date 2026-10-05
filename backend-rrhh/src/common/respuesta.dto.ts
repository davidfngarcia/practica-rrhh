/**
 * DTOs de respuesta de los controladores.
 *
 * Son clases y no `interface` a proposito: las `interface` desaparecen al compilar, asi que
 * la documentacion OpenAPI se generaria sin ningun esquema y los clientes verian un
 * `object` vacio en lugar de la forma real.
 *
 * Los decoradores `@ApiProperty` repiten lo que ya dicen las entidades, pero hace falta:
 * Nest no adivina los tipos de un retorno, los lee del decorador.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Respuesta de un puesto. */
export class PuestoRespuestaDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador del puesto.' })
  id: string;

  @ApiProperty({
    description:
      'Codigo unico dentro de la empresa. Se puede reutilizar tras una baja logica.',
  })
  codigo: string;

  @ApiProperty({ description: 'Nombre del puesto.' })
  nombre: string;

  @ApiPropertyOptional({ nullable: true, description: 'Descripcion libre.' })
  descripcion: string | null;

  @ApiProperty({ description: 'Si el puesto admite nuevas contrataciones.' })
  activo: boolean;

  @ApiProperty({ description: 'Alta del registro, en UTC.' })
  created_at: Date;

  @ApiProperty({ description: 'Ultima modificacion, en UTC.' })
  updated_at: Date;
}

/** Respuesta de un departamento. */
export class DepartamentoRespuestaDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Identificador del departamento.',
  })
  id: string;

  @ApiProperty({ description: 'Codigo unico dentro de la empresa.' })
  codigo: string;

  @ApiProperty({ description: 'Nombre del departamento.' })
  nombre: string;

  @ApiPropertyOptional({ nullable: true, description: 'Descripcion libre.' })
  descripcion: string | null;

  @ApiProperty({ description: 'Si el departamento admite nuevos empleados.' })
  activo: boolean;

  @ApiProperty({ description: 'Alta del registro, en UTC.' })
  created_at: Date;

  @ApiProperty({ description: 'Ultima modificacion, en UTC.' })
  updated_at: Date;
}

/**
 * Respuesta de una persona.
 *
 * El documento llega descifrado: la API lo necesita para que el frontend pueda mostrarlo, y
 * el filtro por documento usa el indice HMAC, no una busqueda en claro. Lo que no se expone
 * sin permiso es el salario y el IBAN, que son de la contratacion.
 */
export class PersonaRespuestaDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador de la persona.' })
  id: string;

  @ApiProperty({ description: 'Tipo de documento: CC, CE, NIT...' })
  tipo_documento: string;

  @ApiProperty({
    description:
      'Documento de identidad, descifrado. Unico en todo el catalogo, no por empresa.',
  })
  numero_documento: string;

  @ApiProperty({ description: 'Nombres.' })
  nombres: string;

  @ApiProperty({ description: 'Apellidos.' })
  apellidos: string;

  @ApiPropertyOptional({ nullable: true, description: 'Fecha de nacimiento.' })
  fecha_nacimiento: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['F', 'M', 'O', 'N'],
    description: 'Genero. `N` es "no informado".',
  })
  genero: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Correo electronico.' })
  email: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Telefono.' })
  telefono: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Direccion.' })
  direccion: string | null;

  @ApiProperty({ description: 'Si la persona esta activa.' })
  activo: boolean;

  @ApiProperty({ description: 'Alta del registro, en UTC.' })
  created_at: Date;

  @ApiProperty({ description: 'Ultima modificacion, en UTC.' })
  updated_at: Date;
}

/**
 * Respuesta de un empleado, que es una contratacion dentro de una empresa.
 *
 * `salario` e `iban` solo aparecen si la sesion tiene `empleado.sensible.leer`. Son
 * opcionales porque no es que valgan `null`: es que la propiedad no esta en la respuesta.
 * `null` significaria "este empleado no tiene salario", que es una afirmacion sobre la
 * fila, mientras que ausente significa "no puedes verlo", que es una afirmacion sobre
 * quien pregunta.
 */
export class EmpleadoRespuestaDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Identificador de la contratacion.',
  })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Empresa de la contratacion.' })
  empresa_id: string;

  @ApiProperty({ format: 'uuid', description: 'Persona contratada.' })
  persona_id: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Departamento asignado.',
  })
  departamento_id: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Puesto asignado.',
  })
  puesto_id: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Codigo del empleado, unico dentro de la empresa.',
  })
  codigo: string | null;

  @ApiProperty({
    description: 'Tipo de contrato: indefinido, temporal, practicas...',
  })
  tipo_contrato: string;

  @ApiProperty({ description: 'Fecha de inicio, en UTC.' })
  fecha_ingreso: string;

  @ApiPropertyOptional({ nullable: true, description: 'Fecha de fin, en UTC.' })
  fecha_fin: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Salario anual. Solo con `empleado.sensible.leer`.',
  })
  salario?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'IBAN de la cuenta. Solo con `empleado.sensible.leer`.',
  })
  iban?: string | null;

  @ApiProperty({ description: 'Si la contratacion esta vigente.' })
  activo: boolean;

  @ApiProperty({
    description:
      'Version de la fila. Mandala en el siguiente PATCH para detectar conflictos.',
  })
  version: number;

  @ApiProperty({ description: 'Alta del registro, en UTC.' })
  created_at: Date;

  @ApiProperty({ description: 'Ultima modificacion, en UTC.' })
  updated_at: Date;
}

/** Empresa y rol con el que se abre la sesion. */
export class EmpresaSesionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  nombre: string;
}

/** Rol con el que se abre la sesion. */
export class RolSesionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Codigo del rol: ADMIN, EMPLEADO...' })
  codigo: string;

  @ApiPropertyOptional({
    description:
      'Nombre del rol. No viaja en `GET /auth/me` porque los claims del token no lo ' +
      'llevan: se forma parte de la sesion, no del permiso.',
  })
  nombre?: string;
}

/** Una empresa a la que el usuario tiene acceso, con el rol que tiene en ella. */
export class EmpresaAccesoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  nombre: string;

  @ApiProperty({ description: 'Rol del usuario en esta empresa.' })
  rol: string;
}

/**
 * Respuesta de login y de cambio de empresa.
 *
 * El refresh token no viaja aqui: va en una cookie httpOnly. Ponerlo en el cuerpo lo
 * entregaria al JavaScript de la pagina, que es justo lo que se quiere evitar.
 */
export class LoginRespuestaDto {
  @ApiProperty({
    description: 'Token de acceso. Se envia como `Authorization: Bearer`.',
  })
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: 'Bearer';

  @ApiProperty({ description: 'Segundos de validez del token de acceso.' })
  expires_in: number;

  @ApiProperty({ description: 'Empresa con la que se ha abierto la sesion.' })
  empresa: EmpresaSesionDto;

  @ApiProperty({ description: 'Rol con el que se ha abierto la sesion.' })
  rol: RolSesionDto;

  @ApiProperty({
    type: [EmpresaAccesoDto],
    description:
      'Todas las empresas disponibles. Si hay mas de una, el login siguiente exige ' +
      '`empresa_id`: elegir en el servidor seria abrir la sesion sobre una empresa que ' +
      'el cliente no ha pedido.',
  })
  empresas: EmpresaAccesoDto[];
}

/** Respuesta de `POST /auth/refresh`. */
export class TokenRespuestaDto {
  @ApiProperty({ description: 'Token de acceso renovado.' })
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: 'Bearer';

  @ApiProperty({ description: 'Segundos de validez del token de acceso.' })
  expires_in: number;
}

/** Respuesta de `GET /auth/me`. */
export class SesionRespuestaDto {
  @ApiProperty({ description: 'Nombre de usuario.' })
  usuario: string;

  @ApiProperty({ format: 'uuid', description: 'Identificador del usuario.' })
  usuario_id: string;

  @ApiProperty({ description: 'Empresa activa de la sesion.' })
  empresa: EmpresaSesionDto;

  @ApiProperty({ description: 'Rol activo de la sesion.' })
  rol: RolSesionDto;

  @ApiProperty({
    type: [String],
    description:
      'Permisos efectivos del rol en esta empresa. El frontend los usa para ocultar ' +
      'acciones, no para decidir acceso: la API los vuelve a comprobar.',
  })
  permisos: string[];
}

/**
 * Listados paginados concretos.
 *
 * `PaginadoDto<T>` de `common/openapi.ts` es generico, y Swagger no resuelve `T[]` dentro
 * de un tipo generico: al documentar un listado con el, el esquema salia vacio y el
 * generador de clientes del frontend se encontraba un `object` sin propiedades. Estas
 * clases concretas si se describen bien.
 *
 * Hay una por recurso en vez de un constructor parametrizado a proposito: son cuatro, y
 * una clase mas dinamica obligaria al cliente a resolver el tipo por su cuenta.
 */
export class PaginadoDepartamentosDto {
  @ApiProperty({ type: [DepartamentoRespuestaDto] })
  datos: DepartamentoRespuestaDto[];

  @ApiProperty({
    description:
      'Numero total de elementos que cumplen el filtro, no solo los de esta pagina.',
  })
  total: number;
}

export class PaginadoPuestosDto {
  @ApiProperty({ type: [PuestoRespuestaDto] })
  datos: PuestoRespuestaDto[];

  @ApiProperty({
    description:
      'Numero total de elementos que cumplen el filtro, no solo los de esta pagina.',
  })
  total: number;
}

export class PaginadoPersonasDto {
  @ApiProperty({ type: [PersonaRespuestaDto] })
  datos: PersonaRespuestaDto[];

  @ApiProperty({
    description:
      'Numero total de elementos que cumplen el filtro, no solo los de esta pagina.',
  })
  total: number;
}

export class PaginadoEmpleadosDto {
  @ApiProperty({ type: [EmpleadoRespuestaDto] })
  datos: EmpleadoRespuestaDto[];

  @ApiProperty({
    description:
      'Numero total de elementos que cumplen el filtro, no solo los de esta pagina.',
  })
  total: number;
}

/**
 * Respuesta de la empresa de la sesion.
 *
 * `codigo` e `identificacion_tributaria` salen siempre y no se pueden cambiar por la API:
 * identifican a la empresa donde ya no se puede deshacer, como una nomina emitida o una
 * factura.
 */
export class EmpresaRespuestaDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador de la empresa.' })
  id: string;

  @ApiProperty({
    description:
      'Codigo de la empresa. Solo lectura: cambiarlo reescribiria la identidad que ' +
      'figura en integraciones y nominas ya emitidas.',
  })
  codigo: string;

  @ApiProperty({ description: 'Nombre de la empresa.' })
  nombre: string;

  @ApiPropertyOptional({ nullable: true, description: 'Razon social.' })
  razon_social: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Nombre comercial, si es distinto del nombre legal.',
  })
  nombre_comercial: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Identificacion tributaria. Solo lectura por la misma razon que el codigo.',
  })
  identificacion_tributaria: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Correo de contacto.' })
  email: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Telefono de contacto.' })
  telefono: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Direccion fiscal.' })
  direccion: string | null;

  @ApiProperty({
    description:
      'Si la empresa esta activa. Solo lectura: desactivarla por la API dejaria al ' +
      'usuario sin poder volver a entrar.',
  })
  activo: boolean;

  @ApiProperty({ description: 'Alta del registro, en UTC.' })
  created_at: Date;

  @ApiProperty({ description: 'Ultima modificacion, en UTC.' })
  updated_at: Date;
}
/** Respuesta de un rol, con los codigos de permiso que tiene concedidos. */
export class RolRespuestaDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'Codigo del rol, unico dentro de la empresa.',
  })
  codigo: string;

  @ApiProperty({ description: 'Nombre legible del rol.' })
  nombre: string;

  @ApiPropertyOptional({ nullable: true, description: 'Descripcion del rol.' })
  descripcion: string | null;

  @ApiProperty({
    description:
      'Si el rol viene de la plantilla del sistema. Los de plantilla no se pueden ' +
      'renombrar ni dar de baja, pero sus permisos si se pueden ajustar.',
  })
  es_sistema: boolean;

  @ApiProperty({ description: 'Si el rol esta activo y admite membresias.' })
  activo: boolean;

  @ApiProperty({
    type: [String],
    description: 'Codigos de los permisos concedidos al rol.',
  })
  permisos: string[];

  @ApiProperty({ description: 'Alta del registro, en UTC.' })
  created_at: Date;

  @ApiProperty({ description: 'Ultima modificacion, en UTC.' })
  updated_at: Date;
}

/** Respuesta de un permiso del catalogo global. */
export class PermisoRespuestaDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'Codigo del permiso, con la forma modulo.accion.',
  })
  codigo: string;

  @ApiProperty({ description: 'Modulo al que pertenece el permiso.' })
  modulo: string;

  @ApiPropertyOptional({ nullable: true, description: 'Que permite hacer.' })
  descripcion: string | null;
}

/** Listado paginado de roles. */
export class PaginadoRolesDto {
  @ApiProperty({ type: [RolRespuestaDto] })
  datos: RolRespuestaDto[];

  @ApiProperty({
    description:
      'Numero total de elementos que cumplen el filtro, no solo los de esta pagina.',
  })
  total: number;
}
