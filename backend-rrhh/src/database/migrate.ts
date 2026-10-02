import {
  asegurarTablaMetadata,
  sincronizarColumnasGeneradas,
} from './asegurar-tabla-metadata.js';
import { dataSource } from './data-source.js';

async function main(): Promise<void> {
  const comando = process.argv[2] ?? 'run';

  dataSource.setOptions({ migrationsRun: false });
  await dataSource.initialize();

  await asegurarTablaMetadata(dataSource);
  await sincronizarColumnasGeneradas(dataSource);

  if (comando === 'revert') {
    await dataSource.undoLastMigration();
    console.log('Se deshizo la ultima migracion.');
  } else if (comando === 'show') {
    const hayPendientes = await dataSource.showMigrations();
    console.log(
      hayPendientes
        ? 'Hay migraciones pendientes.'
        : 'No hay migraciones pendientes.',
    );
  } else {
    const aplicadas = await dataSource.runMigrations({ transaction: 'all' });
    console.log(`Migraciones aplicadas: ${aplicadas.length}`);
    aplicadas.forEach((m) => console.log(`  - ${m.name}`));
  }

  await dataSource.destroy();
}

main().catch((error: unknown) => {
  console.error('Error al ejecutar migraciones:', error);
  process.exit(1);
});
