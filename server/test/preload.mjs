import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

process.env.NODE_ENV = 'development';
process.env.DATA_DIR = path.join(root, 'data-test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'clave-local-desarrollo-no-usar-en-produccion';
process.env.SUPERADMIN_EMAILS = 'admin@test.local';
process.env.BACKUP_ENABLED = 'false';
