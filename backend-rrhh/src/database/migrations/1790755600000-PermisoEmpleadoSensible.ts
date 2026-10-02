import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permiso `empleado.sensible.leer`, que controla el acceso a salario e IBAN.
 *
 * Hasta aqui, `empleado.leer` bastaba para verlos. Eso hacia que cualquiera con permiso
 * de listado de empleados tuviera tambien la nomina completa y las cuentas bancarias de
 * toda la empresa, sin que el permiso que se concedio dijera nada de eso: se concedio
 * "leer empleados" y resulto que incluia secretos bancarios.
 *
 * El permiso va aparte en vez de colgar de `empleado.leer` por dos razones. Por un lado,
 * hay roles que necesitan ver quien esta dado de alta y en que puesto sin que el salario
 * les corresponda. Por otro, un permiso que significa mas de lo que dice no se puede
 * revocar: quitar `empleado.leer` para tapar un salario deja a la gente sin ver la
 * propia lista de empleados.
 *
 * Se crea en una migracion nueva y no se toca `SeedRolesYPermisos`, que ya esta aplicada:
 * editarla no volveria a ejecutarse, y el permiso se perderia en toda base ya montada.
 *
 * Lo recibe `RRHH`, que necesita la nomina, y `ADMIN_EMPRESA`, que es control total. El
 * rol `EMPLEADO` no lo recibe: puede listar empleados pero no ver sus salarios ni sus
 * cuentas.
 */

// Identificador fijo, como los del seed, para que un reintento no duplique el permiso.
const ID_PERMISO = 'a0000000-0000-4000-8000-000000000029';

// `ADMIN_EMPRESA` y `RRHH` son los dos primeros del seed. Se referencian por codigo y
// no por id fijo para no depender de la numeracion interna de esa migracion.
const ROLES_CON_ACCESO = ['ADMIN_EMPRESA', 'RRHH'];

export class PermisoEmpleadoSensible1790755600000 implements MigrationInterface {
  name = 'PermisoEmpleadoSensible1790755600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO \`permiso\` (\`id\`, \`codigo\`, \`modulo\`, \`descripcion\`)
       VALUES (?, 'empleado.sensible.leer', 'empleado',
               'Consulta de salario e IBAN de los empleados')
       ON DUPLICATE KEY UPDATE \`descripcion\` = VALUES(\`descripcion\`)`,
      [ID_PERMISO],
    );

    for (const rol of ROLES_CON_ACCESO) {
      await queryRunner.query(
        `INSERT INTO \`rol_permiso\` (\`rol_id\`, \`permiso_id\`)
         SELECT r.\`id\`, ? FROM \`rol\` r
          WHERE r.\`codigo\` = ?
            AND NOT EXISTS (
              SELECT 1 FROM \`rol_permiso\` rp
               WHERE rp.\`rol_id\` = r.\`id\` AND rp.\`permiso_id\` = ?
            )`,
        [ID_PERMISO, rol, ID_PERMISO],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE rp FROM \`rol_permiso\` rp
         JOIN \`rol\` r ON r.\`id\` = rp.\`rol_id\`
        WHERE rp.\`permiso_id\` = ?
          AND r.\`codigo\` IN (?)`,
      [ID_PERMISO, ROLES_CON_ACCESO],
    );

    await queryRunner.query('DELETE FROM `permiso` WHERE `id` = ?', [
      ID_PERMISO,
    ]);
  }
}
