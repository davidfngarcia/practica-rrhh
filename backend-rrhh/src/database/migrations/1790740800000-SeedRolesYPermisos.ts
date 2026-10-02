import { MigrationInterface, QueryRunner } from 'typeorm';

// Catalogos con identificadores FIJOS. Asi la migracion es idempotente y un reintento
// tras un fallo parcial reproduce exactamente los mismos IDs, en lugar de generar
// UUIDs nuevos que dejarian filas huerfanas.
//
//   a0000000-...  permisos
//   b0000000-...  roles
const idPermiso = (i: number): string =>
  `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const idRol = (i: number): string =>
  `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const MODULOS = [
  'empresa',
  'departamento',
  'puesto',
  'persona',
  'empleado',
  'usuario',
  'rol',
];
const ACCIONES = ['leer', 'crear', 'actualizar', 'eliminar'];

const ETIQUETA_ACCION: Record<string, string> = {
  leer: 'Consulta',
  crear: 'Creacion',
  actualizar: 'Actualizacion',
  eliminar: 'Eliminacion',
};

interface Permiso {
  codigo: string;
  modulo: string;
  descripcion: string;
}

const catalogo: Permiso[] = MODULOS.flatMap((modulo) =>
  ACCIONES.map((accion) => ({
    codigo: `${modulo}.${accion}`,
    modulo,
    descripcion: `${ETIQUETA_ACCION[accion]} de ${modulo}`,
  })),
);
catalogo.push({
  codigo: 'auditoria.leer',
  modulo: 'auditoria',
  descripcion: 'Consulta de auditoria',
});

interface Rol {
  codigo: string;
  nombre: string;
  descripcion: string;
  permisos: string[];
}

const roles: Rol[] = [
  {
    codigo: 'ADMIN_EMPRESA',
    nombre: 'Administrador de empresa',
    descripcion: 'Control total sobre los datos de su empresa',
    permisos: catalogo.map((p) => p.codigo),
  },
  {
    codigo: 'RRHH',
    nombre: 'Recursos Humanos',
    descripcion: 'Gestiona estructura, personal y catalogos de la empresa',
    permisos: catalogo
      .filter(
        (p) =>
          p.codigo.startsWith('departamento.') ||
          p.codigo.startsWith('puesto.') ||
          p.codigo.startsWith('persona.') ||
          p.codigo.startsWith('empleado.') ||
          p.codigo === 'empresa.leer' ||
          p.codigo === 'usuario.leer' ||
          p.codigo === 'auditoria.leer',
      )
      .map((p) => p.codigo),
  },
  {
    codigo: 'EMPLEADO',
    nombre: 'Empleado',
    descripcion: 'Acceso de solo lectura a su empresa y a sus propios datos',
    permisos: ['empresa.leer', 'persona.leer', 'empleado.leer'],
  },
];

export class SeedRolesYPermisos1790740800000 implements MigrationInterface {
  name = 'SeedRolesYPermisos1790740800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [i, permiso] of catalogo.entries()) {
      await queryRunner.query(
        [
          'INSERT INTO `permiso` (`id`, `codigo`, `modulo`, `descripcion`)',
          'SELECT ?, ?, ?, ? FROM DUAL',
          'WHERE NOT EXISTS (SELECT 1 FROM `permiso` WHERE `codigo` = ?)',
        ].join('\n'),
        [
          idPermiso(i),
          permiso.codigo,
          permiso.modulo,
          permiso.descripcion,
          permiso.codigo,
        ],
      );
    }

    const idDePermiso = new Map(
      catalogo.map((p, i) => [p.codigo, idPermiso(i)]),
    );

    for (const [i, rol] of roles.entries()) {
      await queryRunner.query(
        [
          'INSERT INTO `rol` (`id`, `codigo`, `nombre`, `descripcion`, `es_sistema`)',
          'SELECT ?, ?, ?, ?, 1 FROM DUAL',
          'WHERE NOT EXISTS (SELECT 1 FROM `rol` WHERE `codigo` = ?)',
        ].join('\n'),
        [idRol(i), rol.codigo, rol.nombre, rol.descripcion, rol.codigo],
      );

      for (const codigo of rol.permisos) {
        const permisoId = idDePermiso.get(codigo);
        if (!permisoId) {
          throw new Error(
            `El rol ${rol.codigo} referencia el permiso desconocido: ${codigo}`,
          );
        }
        await queryRunner.query(
          [
            'INSERT INTO `rol_permiso` (`rol_id`, `permiso_id`)',
            'SELECT ?, ? FROM DUAL',
            'WHERE NOT EXISTS (SELECT 1 FROM `rol_permiso` WHERE `rol_id` = ? AND `permiso_id` = ?)',
          ].join('\n'),
          [idRol(i), permisoId, idRol(i), permisoId],
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Solo se borran filas sembradas, por prefijo de id. Si una membresia en
    // `usuario_empresa` ya apunta a uno de estos roles, el DELETE fallara por FK
    // RESTRICT: es el comportamiento correcto, no se destruyen datos reales.
    await queryRunner.query(
      "DELETE FROM `rol_permiso` WHERE `rol_id` LIKE 'b0000000-%'",
    );
    await queryRunner.query("DELETE FROM `rol` WHERE `id` LIKE 'b0000000-%'");
    await queryRunner.query(
      "DELETE FROM `permiso` WHERE `id` LIKE 'a0000000-%'",
    );
  }
}
