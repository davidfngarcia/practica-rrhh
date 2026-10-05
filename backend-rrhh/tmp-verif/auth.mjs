/**
 * Verificacion del flujo de autenticacion contra la base real.
 *
 * Levanta la app en proceso, sobre un puerto efimero, y la cierra al terminar.
 * Asi no depende de que haya otra instancia ocupando el puerto 3000.
 *
 * Espera los datos de `tmp-verif/semilla.mjs`: usuario `prueba_auth` con membresia
 * RRHH en la empresa A y solo lectura en la B.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { createConnection } from 'mysql2/promise';

// La suite hace decenas de logins seguidos, muy por encima del limite de
// produccion de 5 por minuto. Se sube el tope para que las comprobaciones de
// limite se centren en su propia seccion y no contamnen el resto.
process.env.THROTTLE_LOGIN ??= '500';
process.env.THROTTLE_GLOBAL ??= '2000';

// `AppModule` valida la configuracion al importarse, asi que se importa de forma
// dinamica: los limites anteriores tienen que estar puestos antes.
const { AppModule } = await import('../dist/app.module.js');

// Se usan las piezas reales de `main.ts` y no una reconstruccion: si el pipe, el
// filtro o el parser se rompen, esta suite tiene que notarlo.
const { configurarCuerpoJson } = await import('../dist/common/cuerpo.js');
const { FiltroErrores, pipeValidacion } =
  await import('../dist/common/errores.js');
// El prefijo tambien se importa del codigo real y no se escribe aqui: si las rutas de
// esta suite y las de `main.ts` dejaran de coincidir, todas las comprobaciones darian 404
// sin que ninguna dijera por que.
const { configurarPrefijo } = await import('../dist/common/prefijo.js');

let pasadas = 0;
let fallos = 0;
let omitidas = 0;

function comprobar(titulo, condicion, detalle = '') {
  if (condicion) {
    pasadas++;
    console.log(`  OK     ${titulo}${detalle ? ` â€” ${detalle}` : ''}`);
  } else {
    fallos++;
    console.log(`  FALLA  ${titulo}${detalle ? ` â€” ${detalle}` : ''}`);
  }
}

function omitir(motivo) {
  omitidas++;
  console.log(`  OMITIDA ${motivo}`);
}

/** Frases tipicas de Nest y `class-validator` que no deben llegar al cliente. */
const EN_INGLES = [
  'must be',
  'should be',
  'should not',
  'property ',
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'ThrottlerException',
  'Cannot ',
  'Unexpected token',
];

/** Un texto no vacio que no contiene ninguna de las frases en ingles de arriba. */
function esTextoCastellano(texto) {
  return (
    typeof texto === 'string' &&
    texto.length > 0 &&
    !EN_INGLES.some((frase) => texto.includes(frase))
  );
}

const app = await NestFactory.create(AppModule, {
  logger: false,
  bodyParser: false,
});
configurarCuerpoJson(app);
app.useGlobalPipes(pipeValidacion());
app.useGlobalFilters(new FiltroErrores());
configurarPrefijo(app);
await app.listen(0);

const { port } = app.getHttpServer().address();
const url = `http://127.0.0.1:${port}`;

/**
 * Las consultas de verificacion van por una conexion mysql2 propia, no por el
 * pool de la app: asi una comprobacion del test nunca se confunde con el estado
 * de una conexion reutilizada.
 */
const conexion = await createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false },
});

/** Ejecuta una consulta y devuelve solo las filas, como hace `DataSource.query`. */
async function consultar(sql, parametros = []) {
  const [filas] = await conexion.query(sql, parametros);
  return filas;
}

/**
 * Prefijo de version de la API.
 *
 * El script escribe las rutas como las ve undeveloper en el controlador (`/auth/me`) y
 * el prefijo se anade aqui, igual que en `src/common/prefijo.ts`. Escribir `/api/v1` en
 * cada llamada haria que subir de version fuese cambiar 47 lineas de este fichero.
 */
const PREFIJO = '/api/v1';

/** Rutas fuera del prefijo: las sondas las consulta el orquestador, no el frontend. */
const SIN_VERSION = ['/health', '/ready'];

async function llamar(metodo, ruta, { token, cookie, cuerpo, crudo } = {}) {
  const cabeceras = { 'content-type': 'application/json' };
  if (token) cabeceras.authorization = `Bearer ${token}`;
  if (cookie) cabeceras.cookie = cookie;

  const completa = SIN_VERSION.includes(ruta) ? ruta : `${PREFIJO}${ruta}`;
  const respuesta = await fetch(`${url}${completa}`, {
    method: metodo,
    headers: cabeceras,
    // `crudo` permite enviar un cuerpo invalido a proposito, que es justo lo que
    // hay que probar para el parseo de JSON.
    body: crudo ?? (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });

  const texto = await respuesta.text();
  let cuerpoRespuesta = texto;
  try {
    cuerpoRespuesta = JSON.parse(texto);
  } catch {
    /* respuesta no-JSON */
  }

  return {
    estado: respuesta.status,
    cuerpo: cuerpoRespuesta,
    cabeceras: respuesta.headers,
  };
}

/** Valor de la cookie `rt` en un `set-cookie`. */
function valorRt(cabeceras) {
  const cookie = cabeceras.get('set-cookie') ?? '';
  return decodeURIComponent((/rt=([^;]+)/.exec(cookie) ?? [])[1] ?? '');
}

/** Claims de un access token, sin verificar la firma: aqui solo se inspeccionan. */
function claimsDe(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const usuarioPrueba = process.env.USUARIO_PRUEBA ?? 'prueba_auth';
const password = process.env.PASSWORD ?? 'Auth-de-prueba-2026';

console.log(`\nApp escuchando en ${url}\n`);

console.log('1. Guard global: rutas publicas y protegidas');
{
    // `/health`, y no `/`: la comprobaba el `AppController` del andamiaje de Nest, que se
    // elimino. La sonda sigue siendo lavia publica y sin token, que es lo que hay que
    // verificar: que el guard global la deja pasar.
    const sonda = await llamar('GET', '/health');
    comprobar(
      'GET /health es publico y responde 200',
      sonda.estado === 200,
      `estado ${sonda.estado}`,
    );

  const me = await llamar('GET', '/auth/me');
  comprobar(
    'GET /auth/me sin token responde 401',
    me.estado === 401,
    `estado ${me.estado}`,
  );

  const falso = await llamar('GET', '/auth/me', { token: 'no.es.un.jwt' });
  comprobar(
    'GET /auth/me con token invalido responde 401',
    falso.estado === 401,
    `estado ${falso.estado}`,
  );
}

console.log('\n2. Validacion del DTO (ValidationPipe global)');
{
  const vacio = await llamar('POST', '/auth/login', { cuerpo: {} });
  comprobar(
    'login sin cuerpo responde 400 y no 500',
    vacio.estado === 400,
    `estado ${vacio.estado}`,
  );

  const sobra = await llamar('POST', '/auth/login', {
    cuerpo: { usuario: 'x', password: 'x', inyectado: 'no-declarado' },
  });
  comprobar(
    'login con propiedad no declarada responde 400',
    sobra.estado === 400,
    `estado ${sobra.estado}`,
  );

  const tipoRaro = await llamar('POST', '/auth/login', {
    cuerpo: { usuario: { no: 'es una cadena' }, password: ['array'] },
  });
  comprobar(
    'login con tipos incorrectos responde 400',
    tipoRaro.estado === 400,
    `estado ${tipoRaro.estado}`,
  );
}

console.log('\n3. Credenciales');
{
  const mala = await llamar('POST', '/auth/login', {
    cuerpo: {
      usuario: usuarioPrueba,
      password: 'contrasena-equivocada',
      empresa_id: 'e0000000-0000-4000-8000-00000000000a',
    },
  });
  comprobar(
    'login con password incorrecto responde 401',
    mala.estado === 401,
    `estado ${mala.estado}`,
  );

  const inexistente = await llamar('POST', '/auth/login', {
    cuerpo: {
      usuario: 'no-existe-este-usuario',
      password: 'lo-que-sea',
      empresa_id: 'e0000000-0000-4000-8000-00000000000a',
    },
  });
  comprobar(
    'usuario inexistente produce el mismo 401 que password incorrecto (no enumera cuentas)',
    inexistente.estado === 401 &&
      JSON.stringify(mala.cuerpo) === JSON.stringify(inexistente.cuerpo),
    `ambos: ${JSON.stringify(mala.cuerpo)}`,
  );
}

console.log('\n4. Refresh invalido');
{
  const sinNada = await llamar('POST', '/auth/refresh', { cuerpo: {} });
  comprobar(
    'refresh sin token responde 401',
    sinNada.estado === 401,
    `estado ${sinNada.estado}`,
  );

  const basura = await llamar('POST', '/auth/refresh', {
    cuerpo: { refresh_token: 'token-inventado' },
  });
  comprobar(
    'refresh con token desconocido responde 401',
    basura.estado === 401,
    `estado ${basura.estado}`,
  );

  const cookieFalsa = await llamar('POST', '/auth/refresh', {
    cookie: 'rt=inventado',
    cuerpo: {},
  });
  comprobar(
    'refresh con cookie desconocida responde 401',
    cookieFalsa.estado === 401,
    `estado ${cookieFalsa.estado}`,
  );
}

console.log('\n5. Auditoria de intentos fallidos');
{
  const antes = await consultar(
    "SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'LOGIN_FALLIDO'",
  );
  await llamar('POST', '/auth/login', {
    cuerpo: {
      usuario: 'no-existe-este-usuario',
      password: 'x',
      empresa_id: 'e0000000-0000-4000-8000-00000000000a',
    },
  });
  const despues = await consultar(
    "SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'LOGIN_FALLIDO'",
  );
  comprobar(
    'el intento fallido queda registrado',
    Number(despues[0].n) === Number(antes[0].n) + 1,
    `${antes[0].n} -> ${despues[0].n}`,
  );

  const muestra = await consultar(
    'SELECT accion, usuario_id, ip FROM auditoria WHERE accion = ? ORDER BY creado_en DESC LIMIT 1',
    ['LOGIN_FALLIDO'],
  );
  comprobar(
    'el registro conserva la IP y deja usuario_id nulo',
    Boolean(muestra[0]) &&
      muestra[0].usuario_id === null &&
      muestra[0].ip !== null,
    JSON.stringify(muestra[0]),
  );
}

console.log('\n6. Login correcto');
const EMPRESA_A = 'e0000000-0000-4000-8000-00000000000a';
const EMPRESA_B = 'e0000000-0000-4000-8000-00000000000b';

const login = await llamar('POST', '/auth/login', {
  cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_A },
});

if (login.estado !== 200) {
  comprobar(
    'login correcto responde 200',
    false,
    `estado ${login.estado} ${JSON.stringify(login.cuerpo)}`,
  );
} else {
  comprobar('login correcto responde 200', true);

  const claims = claimsDe(login.cuerpo.access_token);
  const USUARIO_ID = claims?.sub;
  comprobar(
    'el token identifica al usuario por UUID, no por nombre',
    /^[0-9a-f]{8}-/.test(String(claims?.sub ?? '')) &&
      claims.sub !== usuarioPrueba &&
      claims.empresa_id === EMPRESA_A,
    `sub=${claims?.sub} empresa_id=${claims?.empresa_id}`,
  );
  comprobar(
    'la respuesta incluye las dos empresas con su rol',
    login.cuerpo.empresas?.length === 2,
    login.cuerpo.empresas?.map((e) => `${e.nombre}:${e.rol}`).join(' | '),
  );
  comprobar(
    'la empresa elegida es la solicitada',
    login.cuerpo.empresa?.id === EMPRESA_A &&
      login.cuerpo.rol?.codigo === 'RRHH',
    `${login.cuerpo.empresa?.nombre} / ${login.cuerpo.rol?.codigo}`,
  );

  const cookie = login.cabeceras.get('set-cookie') ?? '';
  comprobar(
    'la cookie de refresh es httpOnly y SameSite=Lax',
    /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie),
    cookie.split(';').slice(1, 3).join(';'),
  );
  comprobar(
    'el refresh no viaja en el cuerpo de la respuesta',
    !('refresh_token' in login.cuerpo),
    `claves: ${Object.keys(login.cuerpo).join(', ')}`,
  );

  const refresh1 = valorRt(login.cabeceras);
  const hashes = await consultar(
    'SELECT token_hash FROM refresh_token ORDER BY creado_en DESC LIMIT 1',
  );
  comprobar(
    'en la base solo se guarda el HMAC de 64 hex, nunca el token',
    hashes[0]?.token_hash !== refresh1 &&
      /^[0-9a-f]{64}$/.test(hashes[0]?.token_hash ?? ''),
    `hash ${String(hashes[0]?.token_hash).slice(0, 16)}â€¦`,
  );

  const me = await llamar('GET', '/auth/me', {
    token: login.cuerpo.access_token,
  });
  comprobar(
    '/auth/me devuelve empresa, rol y permisos coherentes',
    me.estado === 200 &&
      me.cuerpo.empresa?.id === EMPRESA_A &&
      me.cuerpo.rol?.codigo === 'RRHH' &&
      me.cuerpo.permisos?.includes('empleado.crear'),
    `rol=${me.cuerpo?.rol?.codigo} permisos=${me.cuerpo?.permisos?.length}`,
  );

  const empresas = await llamar('GET', '/auth/empresas', {
    token: login.cuerpo.access_token,
  });
  comprobar(
    '/auth/empresas lista solo empresas con membresia activa',
    empresas.estado === 200 && empresas.cuerpo.length === 2,
    `n=${empresas.cuerpo?.length}`,
  );

  console.log('\n7. Cambiar de empresa');
  const cambio = await llamar('POST', '/auth/cambiar-empresa', {
    token: login.cuerpo.access_token,
    cuerpo: { empresa_id: EMPRESA_B },
  });
  comprobar(
    'cambiar de empresa entrega token con el rol de esa empresa',
    cambio.estado === 200 &&
      cambio.cuerpo.empresa?.id === EMPRESA_B &&
      cambio.cuerpo.rol?.codigo === 'EMPLEADO',
    `${cambio.cuerpo?.empresa?.nombre} / ${cambio.cuerpo?.rol?.codigo}`,
  );

  const meB = await llamar('GET', '/auth/me', {
    token: cambio.cuerpo.access_token,
  });
  comprobar(
    'los permisos del token B son mas reducidos que los de A',
    meB.estado === 200 &&
      meB.cuerpo.permisos.includes('empleado.leer') &&
      !meB.cuerpo.permisos.includes('empleado.eliminar'),
    `permisos B=${meB.cuerpo?.permisos?.length} vs A=${me.cuerpo?.permisos?.length}`,
  );

  const ajena = await llamar('POST', '/auth/cambiar-empresa', {
    token: login.cuerpo.access_token,
    cuerpo: { empresa_id: 'd0000000-0000-4000-8000-0000000000ff' },
  });
  comprobar(
    'no se puede cambiar a una empresa de la que no es miembro',
    ajena.estado === 401,
    `estado ${ajena.estado}`,
  );

  // El cambio de empresa se audita con su propia accion y no como `LOGOUT`: si se
  // confundieran, el log no podria distinguir un cambio de empresa de un cierre de
  // sesion, y la revocacion del refresh anterior es solo un efecto del cambio.
  const [eventoCambio] = await consultar(
    "SELECT accion FROM auditoria WHERE usuario_id = ? AND entidad = 'usuario_empresa' AND entidad_id = ? ORDER BY creado_en DESC LIMIT 1",
    [USUARIO_ID, EMPRESA_B],
  );
  comprobar(
    'el cambio de empresa se audita como CAMBIO_EMPRESA, no como LOGOUT',
    eventoCambio?.accion === 'CAMBIO_EMPRESA',
    `accion=${eventoCambio?.accion}`,
  );

  const [logoutReal] = await consultar(
    "SELECT accion FROM auditoria WHERE usuario_id = ? AND accion = 'LOGOUT' ORDER BY creado_en DESC LIMIT 1",
    [USUARIO_ID],
  );
  comprobar(
    'LOGOUT sigue reservandose para el cierre de sesion explicito',
    logoutReal?.accion === 'LOGOUT',
    `accion=${logoutReal?.accion}`,
  );

  console.log('\n8. Rotacion del refresh');
  const renovado = await llamar('POST', '/auth/refresh', {
    cookie: `rt=${encodeURIComponent(refresh1)}`,
    cuerpo: {},
  });
  comprobar(
    'refresh responde 200',
    renovado.estado === 200,
    `estado ${renovado.estado}`,
  );

  const refresh2 = valorRt(renovado.cabeceras);
  comprobar(
    'la rotacion entrega un token distinto',
    Boolean(refresh2) && refresh2 !== refresh1,
  );

  const meRenovado = await llamar('GET', '/auth/me', {
    token: renovado.cuerpo.access_token,
  });
  comprobar(
    'el access token renovado conserva la empresa y el rol',
    meRenovado.estado === 200 &&
      meRenovado.cuerpo.empresa?.id === EMPRESA_A &&
      meRenovado.cuerpo.rol?.codigo === 'RRHH',
    `${meRenovado.cuerpo?.empresa?.nombre} / ${meRenovado.cuerpo?.rol?.codigo}`,
  );

  console.log('\n9. Deteccion de reuso');
  const reutilizado = await llamar('POST', '/auth/refresh', {
    cookie: `rt=${encodeURIComponent(refresh1)}`,
    cuerpo: {},
  });
  comprobar(
    'reusar el refresh ya gastado responde 401',
    reutilizado.estado === 401,
    `estado ${reutilizado.estado}`,
  );

  const hijoMuerto = await llamar('POST', '/auth/refresh', {
    cookie: `rt=${encodeURIComponent(refresh2)}`,
    cuerpo: {},
  });
  comprobar(
    'el reuso invalida la familia entera, incluido el token legitimo',
    hijoMuerto.estado === 401,
    `estado ${hijoMuerto.estado}`,
  );

  const familia = await consultar(
    `SELECT revocado_motivo, COUNT(*) AS n FROM refresh_token
     WHERE familia = (SELECT familia FROM refresh_token ORDER BY creado_en DESC LIMIT 1)
     GROUP BY revocado_motivo`,
  );
  comprobar(
    'los tokens de la familia quedan marcados como revocados',
    familia.every((f) => f.revocado_motivo !== null),
    JSON.stringify(familia),
  );

  console.log('\n10. Logout');
  const sesion = await llamar('POST', '/auth/login', {
    cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_A },
  });
  const rtLogout = valorRt(sesion.cabeceras);

  const logout = await llamar('POST', '/auth/logout', {
    cookie: `rt=${encodeURIComponent(rtLogout)}`,
    token: sesion.cuerpo.access_token,
    cuerpo: {},
  });
  comprobar(
    'logout responde 204',
    logout.estado === 204,
    `estado ${logout.estado}`,
  );

  const trasLogout = await llamar('POST', '/auth/refresh', {
    cookie: `rt=${encodeURIComponent(rtLogout)}`,
    cuerpo: {},
  });
  comprobar(
    'tras el logout el refresh ya no sirve',
    trasLogout.estado === 401,
    `estado ${trasLogout.estado}`,
  );

  console.log('\n11. Usuario desactivado pierde el acceso');
  {
    const tokenAntes = login.cuerpo.access_token;
    await consultar('UPDATE usuarios SET activo = 0 WHERE id = ?', [
      USUARIO_ID,
    ]);

    const meInactivo = await llamar('GET', '/auth/me', { token: tokenAntes });
    comprobar(
      'un token ya emitido deja de valer al desactivar la cuenta',
      meInactivo.estado === 401,
      `estado ${meInactivo.estado}`,
    );

    const loginInactivo = await llamar('POST', '/auth/login', {
      cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_A },
    });
    comprobar(
      'un usuario desactivado no puede iniciar sesion',
      loginInactivo.estado === 401,
      `estado ${loginInactivo.estado}`,
    );

    await consultar('UPDATE usuarios SET activo = 1 WHERE id = ?', [
      USUARIO_ID,
    ]);
  }

  console.log('\n12. Membresia desactivada');
  {
    await consultar(
      'UPDATE usuario_empresa SET activo = 0 WHERE empresa_id = ? AND usuario_id = ?',
      [EMPRESA_B, USUARIO_ID],
    );

    const soloA = await llamar('POST', '/auth/login', {
      cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_A },
    });
    comprobar(
      'con una sola membresia activa el login sin empresa_id ya funciona',
      soloA.estado === 200 && soloA.cuerpo.empresa?.id === EMPRESA_A,
      `estado ${soloA.estado}`,
    );

    const haciaB = await llamar('POST', '/auth/login', {
      cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_B },
    });
    comprobar(
      'la empresa sin membresia activa ya no es elegible',
      haciaB.estado === 401,
      `estado ${haciaB.estado}`,
    );

    await consultar(
      'UPDATE usuario_empresa SET activo = 1 WHERE empresa_id = ? AND usuario_id = ?',
      [EMPRESA_B, USUARIO_ID],
    );
  }

  console.log('\n12b. Un token de empresa sin membresia deja de valer');
  {
    const enB = await llamar('POST', '/auth/login', {
      cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_B },
    });
    const tokenB = enB.cuerpo?.access_token;
    const meBAntes = await llamar('GET', '/auth/me', { token: tokenB });
    comprobar(
      'el token de B funciona con la membresia activa',
      meBAntes.estado === 200,
      `estado ${meBAntes.estado}`,
    );

    await consultar(
      'UPDATE usuario_empresa SET activo = 0 WHERE empresa_id = ? AND usuario_id = ?',
      [EMPRESA_B, USUARIO_ID],
    );

    const meBDespues = await llamar('GET', '/auth/me', { token: tokenB });
    comprobar(
      'al desactivar la membresia, el token de B deja de valer sin esperar a que expire',
      meBDespues.estado === 401,
      `estado ${meBDespues.estado}`,
    );

    await consultar(
      'UPDATE usuario_empresa SET activo = 1 WHERE empresa_id = ? AND usuario_id = ?',
      [EMPRESA_B, USUARIO_ID],
    );
  }

  console.log('\n12c. Cambio de rol invalida el token emitido');
  {
    const tokenRRHH = claimsDe(login.cuerpo.access_token)?.rol_id;
    const rolAdmin = await consultar(
      "SELECT id FROM rol WHERE codigo = 'ADMIN_EMPRESA' LIMIT 1",
    );

    if (!rolAdmin[0]?.id) {
      omitir('no hay rol ADMIN_EMPRESA para probar el cambio de rol');
    } else {
      await consultar(
        'UPDATE usuario_empresa SET rol_id = ? WHERE empresa_id = ? AND usuario_id = ?',
        [rolAdmin[0].id, EMPRESA_A, USUARIO_ID],
      );

      const trasCambio = await llamar('GET', '/auth/me', {
        token: login.cuerpo.access_token,
      });
      comprobar(
        'al cambiar el rol, el token con el rol anterior deja de valer',
        trasCambio.estado === 401,
        `estado ${trasCambio.estado}`,
      );

      await consultar(
        'UPDATE usuario_empresa SET rol_id = ? WHERE empresa_id = ? AND usuario_id = ?',
        [tokenRRHH, EMPRESA_A, USUARIO_ID],
      );
    }
  }

  console.log('\n12d. Cambio de empresa invalida el refresh anterior');
  {
    const sesionPrevia = await llamar('POST', '/auth/login', {
      cuerpo: { usuario: usuarioPrueba, password, empresa_id: EMPRESA_A },
    });
    const rtPrevio = valorRt(sesionPrevia.cabeceras);

    await llamar('POST', '/auth/cambiar-empresa', {
      token: sesionPrevia.cuerpo.access_token,
      cookie: `rt=${encodeURIComponent(rtPrevio)}`,
      cuerpo: { empresa_id: EMPRESA_B },
    });

    const conElViejo = await llamar('POST', '/auth/refresh', {
      cookie: `rt=${encodeURIComponent(rtPrevio)}`,
      cuerpo: {},
    });
    comprobar(
      'el refresh de la empresa anterior deja de servir tras cambiar',
      conElViejo.estado === 401,
      `estado ${conElViejo.estado}`,
    );
  }

  // El limite global se comprueba al final, en la seccion 15: al agotarlo aqui,
  // todas las peticiones posteriores de la suite responderian 429.
}

console.log('\n13. Errores en castellano y con formato unico');
{
  const formaUniforme = (cuerpo, estado) =>
    cuerpo !== null &&
    typeof cuerpo === 'object' &&
    cuerpo.statusCode === estado &&
    typeof cuerpo.error === 'string' &&
    typeof cuerpo.message === 'string';

  // 404 de Nest: llega por el filtro global, no por el controlador.
  const noExiste = await llamar('GET', '/auth/ruta-inexistente');
  comprobar(
    'un 404 responde 404 con mensaje en castellano',
    noExiste.estado === 404 &&
      formaUniforme(noExiste.cuerpo, 404) &&
      esTextoCastellano(noExiste.cuerpo?.message),
    `estado ${noExiste.estado} â€” ${JSON.stringify(noExiste.cuerpo)}`,
  );

  // Validacion: cuerpo vacio contra LoginDto.
  const vacio = await llamar('POST', '/auth/login', { cuerpo: {} });
  const errores = vacio.cuerpo?.errores;
  comprobar(
    'un cuerpo vacio responde 400 listando los campos que faltan',
    vacio.estado === 400 &&
      Array.isArray(errores) &&
      errores.length === 2 &&
      errores.every(
        (e) => typeof e.campo === 'string' && typeof e.mensaje === 'string',
      ) &&
      esTextoCastellano(vacio.cuerpo?.message),
    `estado ${vacio.estado} â€” ${JSON.stringify(vacio.cuerpo)}`,
  );

  comprobar(
    'los campos ausentes se dicen "es obligatorio" y no con reglas de longitud',
    Array.isArray(errores) &&
      errores.every((e) => e.mensaje === 'es obligatorio') &&
      errores
        .map((e) => e.campo)
        .sort()
        .join(',') === 'password,usuario',
    JSON.stringify(errores),
  );

  // Propiedad no declarada en el DTO.
  const intruso = await llamar('POST', '/auth/login', {
    cuerpo: { usuario: 'x', password: 'x', rol_id: 'inyectado' },
  });
  comprobar(
    'una propiedad no declarada se rechaza en castellano',
    intruso.estado === 400 &&
      intruso.cuerpo?.errores?.[0]?.campo === 'rol_id' &&
      esTextoCastellano(intruso.cuerpo?.errores?.[0]?.mensaje),
    `estado ${intruso.estado} â€” ${JSON.stringify(intruso.cuerpo?.errores)}`,
  );

  // Tipo incorrecto: el mensaje de longitud ya no debe colarse.
  const tipoMalo = await llamar('POST', '/auth/login', {
    cuerpo: { usuario: ['array'], password: 'x'.repeat(300) },
  });
  const mensajesTipo = (tipoMalo.cuerpo?.errores ?? []).map((e) => e.mensaje);
  comprobar(
    'un tipo incorrecto responde con motivos ya traducidos',
    tipoMalo.estado === 400 &&
      mensajesTipo.length > 0 &&
      mensajesTipo.every(esTextoCastellano) &&
      mensajesTipo.includes('no puede superar los 128 caracteres'),
    `estado ${tipoMalo.estado} â€” ${JSON.stringify(tipoMalo.cuerpo?.errores)}`,
  );

  // JSON mal formado: error de body-parser, no de HttpException.
  const jsonRoto = await llamar('POST', '/auth/login', {
    crudo: '{"usuario": "x", "password":',
  });
  comprobar(
    'un JSON mal formado responde 400, no 500',
    jsonRoto.estado === 400 &&
      formaUniforme(jsonRoto.cuerpo, 400) &&
      esTextoCastellano(jsonRoto.cuerpo?.message),
    `estado ${jsonRoto.estado} â€” ${JSON.stringify(jsonRoto.cuerpo)}`,
  );

  // 401 sin cabecera de autorizacion.
  const sinToken = await llamar('GET', '/auth/me');
  comprobar(
    'un 401 sin token responde en castellano',
    sinToken.estado === 401 &&
      formaUniforme(sinToken.cuerpo, 401) &&
      esTextoCastellano(sinToken.cuerpo?.message),
    `estado ${sinToken.estado} â€” ${JSON.stringify(sinToken.cuerpo)}`,
  );

  // 401 con un token que no es un JWT.
  const tokenFalso = await llamar('GET', '/auth/me', { token: 'no.es.un.jwt' });
  comprobar(
    'un token invalido responde 401 en castellano',
    tokenFalso.estado === 401 &&
      formaUniforme(tokenFalso.cuerpo, 401) &&
      esTextoCastellano(tokenFalso.cuerpo?.message),
    `estado ${tokenFalso.estado} â€” ${JSON.stringify(tokenFalso.cuerpo)}`,
  );

  // Login con credenciales erroneas: 401 explicito del controlador.
  const credenciales = await llamar('POST', '/auth/login', {
    cuerpo: { usuario: usuarioPrueba, password: 'incorrecta' },
  });
  comprobar(
    'unas credenciales erroneas responden 401 en castellano',
    credenciales.estado === 401 &&
      formaUniforme(credenciales.cuerpo, 401) &&
      esTextoCastellano(credenciales.cuerpo?.message),
    `estado ${credenciales.estado} â€” ${JSON.stringify(credenciales.cuerpo)}`,
  );

  // El frontend depende de que `statusCode`, `error` y `message` esten siempre.
  // `errores` es lo unico opcional: solo lo llevan los 400 de validacion, que son
  // los unicos que pueden decir que campo concreto ha fallado.
  const obligatorio = (cuerpo) => {
    const claves = Object.keys(cuerpo ?? {}).sort();
    return ['error', 'message', 'statusCode'].every((k) => claves.includes(k));
  };

  comprobar(
    'todos los errores incluyen statusCode, error y message',
    [
      noExiste,
      vacio,
      intruso,
      jsonRoto,
      sinToken,
      tokenFalso,
      credenciales,
    ].every((r) => obligatorio(r.cuerpo)),
    [noExiste, vacio, intruso, jsonRoto, sinToken, tokenFalso, credenciales]
      .map((r) =>
        Object.keys(r.cuerpo ?? {})
          .sort()
          .join(','),
      )
      .join(' | '),
  );

  const conDetalle = [vacio, intruso, tipoMalo].every((r) =>
    Array.isArray(r.cuerpo?.errores),
  );
  const sinDetalle = [noExiste, jsonRoto, sinToken, credenciales].every(
    (r) => r.cuerpo?.errores === undefined,
  );

  comprobar(
    'la lista de errores aparece solo en los rechazos de validacion',
    conDetalle && sinDetalle,
    `con errores: ${[vacio, intruso, tipoMalo]
      .map((r) => Array.isArray(r.cuerpo?.errores))
      .join(',')} | sin errores: ${[noExiste, jsonRoto, sinToken, credenciales]
      .map((r) => r.cuerpo?.errores === undefined)
      .join(',')}`,
  );
}

console.log('\n14. Aislamiento multiempresa');
{
  const membresias = await consultar(
    'SELECT COUNT(*) AS n FROM usuario_empresa WHERE activo = 1 AND deleted_at IS NULL',
  );
  const varias = await consultar(
    `SELECT usuario_id, COUNT(*) AS n FROM usuario_empresa
     WHERE activo = 1 AND deleted_at IS NULL GROUP BY usuario_id HAVING n > 1`,
  );
  comprobar(
    'hay membresias activas de prueba para validar el aislamiento',
    Number(membresias[0].n) >= 2 && varias.length >= 1,
    `${membresias[0].n} membresias, ${varias.length} usuario(s) multiempresa`,
  );

  const tokensDistintos = new Set();
  for (const empresaId of [EMPRESA_A, EMPRESA_B]) {
    const r = await llamar('POST', '/auth/login', {
      cuerpo: { usuario: usuarioPrueba, password, empresa_id: empresaId },
    });
    if (r.estado === 200) tokensDistintos.add(r.cuerpo.access_token);
  }
  comprobar(
    'cada empresa produce un token distinto',
    tokensDistintos.size === 2,
    `${tokensDistintos.size} tokens`,
  );
}

console.log('\n15. Limite global de peticiones');
{
  // La suite corre con THROTTLE_LOGIN muy alto, asi que aqui se agota el limite
  // GLOBAL, que es el unico que queda activo. Va al final a proposito: una vez
  // agotado, cualquier peticion posterior de la suite responderia 429.
  const limite = Number(process.env.THROTTLE_GLOBAL ?? 120);
  let saw429 = false;
  let limite429 = null;

  for (let i = 0; i < limite + 40; i++) {
    const r = await llamar('GET', '/auth/me', { token: 'no.es.un.jwt' });
    if (r.estado === 429) {
      saw429 = true;
      limite429 = r;
      break;
    }
  }

  comprobar(
    'el limite global por IP responde 429 al superarlo',
    saw429,
    saw429
      ? '429 recibido tras el limite'
      : `nunca llego a 429 tras ${limite + 40} peticiones`,
  );

  if (saw429) {
    comprobar(
      'el 429 explica el motivo en castellano, en vez del texto del framework',
      esTextoCastellano(limite429.cuerpo?.message) &&
        !limite429.cuerpo?.message?.includes('ThrottlerException'),
      `message: ${JSON.stringify(limite429.cuerpo?.message)}`,
    );
  }
}

await conexion.end();
await app.close();

console.log(
  `\nResultado: ${pasadas} OK, ${fallos} fallos, ${omitidas} omitidas`,
);
process.exit(fallos > 0 ? 1 : 0);
