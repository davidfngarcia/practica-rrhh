import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `/auth/login` devuelve el token de la primera empresa activa del usuario, junto
 * con la lista completa para que el frontend pueda ofrecer cambiar de empresa.
 */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  usuario: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;

  /**
   * Empresa con la que se abre sesion. Opcional: si se omite y el usuario
   * pertenece a varias, la eleccion es un error explicito en vez de un token
   * para una empresa arbitraria.
   *
   * `@IsOptional()` es imprescindible: sin el, los validadores se ejecutan
   * tambien sobre `undefined` y un campo opcional nunca puede omitirse.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  empresa_id?: string;
}

/** Emite un token para otra empresa en la que el usuario ya es miembro. */
export class CambiarEmpresaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  empresa_id: string;
}

/** El refresh token viaja en cookie httpOnly, no en el cuerpo. */
export class RefreshDto {
  /**
   * Solo para clientes que no puedan usar cookies. Si viene, tiene prioridad sobre
   * la cookie, lo que permite probar con curl.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refresh_token?: string;
}
