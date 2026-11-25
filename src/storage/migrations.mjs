import fs from 'node:fs';
import path from 'node:path';
import {check, sha256} from './common.mjs';

const MIGRATION_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export function discoverMigrations(migrationsDir) {
  check(fs.existsSync(migrationsDir), 'MIGRATIONS_MISSING', 'Diretório de migrations ausente.');
  const migrations = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = MIGRATION_PATTERN.exec(name);
      check(match, 'MIGRATION_INVALID', `Nome de migration inválido: ${name}.`);
      const version = Number(match[1]);
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
      check(sql.trim().length > 0 && Buffer.byteLength(sql) <= 1048576, 'MIGRATION_INVALID', `Migration vazia ou grande demais: ${name}.`);
      return {version, name, sql, checksum: sha256(sql)};
    })
    .sort((left, right) => left.version - right.version);
  check(migrations.length > 0, 'MIGRATIONS_MISSING', 'Nenhuma migration encontrada.');
  check(new Set(migrations.map((migration) => migration.version)).size === migrations.length, 'MIGRATION_INVALID', 'Versões de migration duplicadas.');
  return migrations;
}

export function runMigrations(db, migrationsDir, {now = () => new Date().toISOString()} = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const migrations = discoverMigrations(migrationsDir);
  const applied = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
  const byVersion = new Map(applied.map((row) => [row.version, row]));
  const executed = [];
  for (const migration of migrations) {
    const existing = byVersion.get(migration.version);
    if (existing) {
      check(existing.name === migration.name && existing.checksum === migration.checksum, 'MIGRATION_CONFLICT', `Migration ${migration.version} foi alterada após aplicação.`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        migration.version,
        migration.name,
        migration.checksum,
        now(),
      );
      db.pragma(`user_version=${migration.version}`);
      db.exec('COMMIT');
      executed.push({version: migration.version, name: migration.name});
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  const expected = migrations[migrations.length - 1].version;
  const current = Number(db.pragma('user_version', {simple: true}));
  check(current === expected, 'MIGRATION_STATE', 'Versão do schema diverge das migrations disponíveis.');
  return {applied: executed, version: current, total: applied.length + executed.length};
}
