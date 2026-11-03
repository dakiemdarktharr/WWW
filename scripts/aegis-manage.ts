import path from 'node:path';
import { Aegis } from '../server/aegis.ts';
import { Store } from '../server/store.ts';
import { privateDirectory } from '../server/security.ts';

const [command, directory] = process.argv.slice(2);
if (
  !['setup', 'status', 'deploy', 'recover'].includes(command) ||
  !directory ||
  !path.isAbsolute(directory)
)
  throw new Error(
    'Usage: node --import tsx scripts/aegis-manage.ts setup|status|deploy|recover ABSOLUTE_DATA_DIR',
  );
await privateDirectory(directory);
const store = new Store(path.join(directory, 'workspace.db'));
const aegis = new Aegis(store, directory);
try {
  await aegis.initialize();
  const result =
    command === 'setup'
      ? await aegis.setup()
      : command === 'deploy'
        ? await aegis.deploy()
        : command === 'recover'
          ? await aegis.recover()
          : await aegis.status();
  console.log(JSON.stringify(result, null, 2));
} finally {
  aegis.close();
  store.close();
}
