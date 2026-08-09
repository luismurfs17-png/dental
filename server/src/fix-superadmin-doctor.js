import { config } from './config.js';
import { db } from './db.js';
import { createSnapshot } from './backup.js';

const emails = config.adminEmails;
if (!emails.length) {
  console.error('SUPERADMIN_EMAILS está vacío; no hay nada que corregir.');
  process.exit(1);
}

console.log('Correos superadmin:', emails.join(', '));
console.log('Buscando cuentas con rol paciente para esos correos…');

const found = db.prepare(`SELECT id, email, nombre, rol, estado, consultorio_id, google_sub
  FROM usuarios WHERE email COLLATE NOCASE IN (${emails.map(() => '?').join(', ')})
  ORDER BY id`).all(...emails);

for (const user of found) {
  console.log(`  #${user.id} ${user.email} | rol=${user.rol} | estado=${user.estado} | consultorio=${user.consultorio_id} | sub=${user.google_sub || '—'}`);
}

const toFix = found.filter((user) => user.rol === 'paciente' && user.estado !== 'suspendido');
if (!toFix.length) {
  console.log('\nNinguna cuenta de superadmin está como paciente. Nada que corregir.');
  process.exit(0);
}

const snapshot = await createSnapshot('fix-superadmin-doctor');
console.log(`\nBackup previo en: ${snapshot}`);

const fix = db.transaction(() => {
  let count = 0;
  for (const user of toFix) {
    db.prepare(`UPDATE usuarios SET rol = 'doctor', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(user.id);
    console.log(`  → #${user.id} ${user.email} ahora es doctor (consultorio ${user.consultorio_id})`);
    count++;
  }
  return count;
})();

console.log(`\nCorrecciones aplicadas: ${fix}`);
console.log('Con Google, la próxima vez iniciará sesión dentro del portal de doctor con panel de superadmin disponible.');
console.log('El login también corrige esto automáticamente desde la versión actual del código (auth.js).');