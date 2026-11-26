import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ensure, hash, readInput, safeId, EditorialError } from './schema.mjs';
import { verifyRecord } from './lifecycle.mjs';
import { deleteOperationalRecord, operationalActive, readOperationalRecord, readOperationalRecords, writeOperationalRecords } from '../storage/operational.mjs';

export function confined(root, relative) {
  ensure(typeof relative === 'string' && !relative.includes('\\') && !relative.includes('\0') && !path.posix.isAbsolute(relative) && !relative.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)), 'UNSAFE_PATH', 'Caminho fora dos diretórios autorizados.');
  const target = path.resolve(root, relative);
  ensure(target.startsWith(root + path.sep), 'UNSAFE_PATH', 'Caminho fora da raiz autorizada.');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    let info;
    try { info=fs.lstatSync(current); } catch(e) { if(e.code!=='ENOENT')throw e; }
    if(info)ensure(!info.isSymbolicLink(), 'SYMLINK', 'Links simbólicos/junções não são aceitos no fluxo editorial.');
  }
  return target;
}
export function readJson(file, max = 8388608) {
  ensure(fs.lstatSync(file).isFile() && fs.statSync(file).size <= max, 'FILE_LIMIT', 'Arquivo não regular ou acima do limite.');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new EditorialError('INVALID_JSON', 'JSON armazenado inválido.'); }
}
export function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    try { const directory = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } } catch (e) { if (!['EPERM', 'EISDIR', 'EINVAL', 'EACCES', 'ENOTSUP'].includes(e.code)) throw e; }
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const fileHash = file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
export function filesUnder(root, folder = '') {
  const base = folder ? confined(root, folder) : root;
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap(entry => {
    const relative = folder ? folder + '/' + entry.name : entry.name;
    const file = confined(root, relative);
    ensure(!entry.isSymbolicLink(), 'SYMLINK', 'Árvore com link simbólico não permitida.');
    return entry.isDirectory() ? filesUnder(root, relative) : (ensure(entry.isFile(), 'FILE_TYPE', 'Arquivo não regular.'), [{ relative, file }]);
  });
}

export class Repository {
  constructor(root, { now = () => new Date().toISOString(), fault = () => {} } = {}) {
    this.root = fs.realpathSync(path.resolve(root)); this.now = now; this.fault = fault;
    this.heldLock=false;
    ensure(readJson(confined(this.root, 'package.json')).name === 'pulso-digital', 'PROJECT_ROOT', 'Selecione uma raiz do Pulso Digital.');
    this.config = readJson(confined(this.root, 'editorial/config.json'));
    this.data = confined(this.root, 'editorial/data');
    this.lock = confined(this.root, 'editorial/data/lock');
    this.journal = confined(this.root, 'editorial/data/transaction.json');
    ensure(this.config.schemaVersion === '1.0' && this.config.limits.inputBytes > 0 && this.config.limits.inputBytes <= 1048576 && this.config.limits.assetBytes <= 10485760 && this.config.limits.stateBytes <= 16777216 && this.config.limits.stagedBytes <= 104857600, 'CONFIG', 'Limites de configuração inválidos.');
    ensure(Object.values(this.config.limits).every(n=>Number.isInteger(n)&&n>0)&&typeof this.config.allowSyntheticPublication==='boolean'&&this.config.deduplication.titleSimilarity>0&&this.config.deduplication.titleSimilarity<=1&&Number.isInteger(this.config.deduplication.recommendedSources)&&this.config.deduplication.recommendedSources>0,'CONFIG','Configuração editorial inválida.');
  }
  file(relative) { return confined(this.root, relative); }
  read(relative) { return readJson(this.file(relative), this.config.limits.stateBytes); }
  recordPath(id) { ensure(safeId(id), 'UNSAFE_ID', 'Identificador inválido.'); return this.file(`editorial/data/records/${id}.json`); }
  available(){ensure(this.heldLock||(!fs.existsSync(this.lock)&&!fs.existsSync(this.journal)),'RECOVERY_REQUIRED','Leitura consistente indisponível durante operação/recuperação; consulte status.');}
  exists(id) { ensure(safeId(id), 'UNSAFE_ID', 'Identificador inválido.'); if (operationalActive(this.root)) return Boolean(readOperationalRecord(this.root, id)); return fs.existsSync(this.recordPath(id)); }
  get(id) { this.available();if(operationalActive(this.root)){const record=readOperationalRecord(this.root,id);ensure(record,'NOT_FOUND','Registro editorial não encontrado.');return verifyRecord(record);}return verifyRecord(readJson(this.recordPath(id), this.config.limits.stateBytes)); }
  list() {
    this.available();
    if (operationalActive(this.root)) return Object.values(readOperationalRecords(this.root)).map(verifyRecord);
    if (!fs.existsSync(this.file('editorial/data/records'))) return [];
    return filesUnder(this.root, 'editorial/data/records').map(({ relative }) => verifyRecord(this.read(relative)));
  }
  save(record) {
    ensure(this.heldLock,'LOCK_REQUIRED','Gravação exige o bloqueio editorial.');
    verifyRecord(record);
    const bytes = jsonBytes(record);
    ensure(bytes.length <= this.config.limits.stateBytes, 'STATE_LIMIT', 'Histórico acima do limite; arquivamento explícito necessário.');
    if (operationalActive(this.root)) writeOperationalRecords(this.root, [record]);
    else atomicWrite(this.recordPath(record.input.id), bytes);
  }
  input(relative) {
    const normalized = relative.replaceAll(path.sep, '/');
    ensure(normalized.startsWith('editorial/fixtures/') || normalized.startsWith('editorial/data/incoming/'), 'INPUT_DIRECTORY', 'Importe somente de editorial/fixtures/ ou editorial/data/incoming/.');
    return readInput(this.file(normalized), this.config.limits.inputBytes);
  }
  withLock(fn, { recovery = false } = {}) {
    fs.mkdirSync(this.data, { recursive: true });
    try { fs.mkdirSync(this.lock); } catch (e) { if (e.code === 'EEXIST') throw new EditorialError('LOCK_BUSY', 'Outra operação editorial está ativa. Use status/recover para diagnosticar uma interrupção.'); throw e; }
    const token = crypto.randomUUID();
    try {
      atomicWrite(this.file('editorial/data/lock/owner.json'), jsonBytes({ pid: process.pid, host: os.hostname(), token, at: this.now() }));
      this.heldLock=true;
      ensure(recovery || !fs.existsSync(this.journal), 'RECOVERY_REQUIRED', 'Há uma publicação interrompida. Execute editorial recover antes de alterar dados.');
      return fn();
    } finally {
      this.heldLock=false;
      const owner = this.file('editorial/data/lock/owner.json');
      if (fs.existsSync(owner) && readJson(owner).token === token) { fs.unlinkSync(owner); fs.rmdirSync(this.lock); }
    }
  }
  breakOrphanLock(reason) {
    ensure(typeof reason === 'string' && reason.trim().length >= 5, 'REASON_REQUIRED', 'Justifique a recuperação do lock.');
    if (!fs.existsSync(this.lock)) return;
    const file = this.file('editorial/data/lock/owner.json');
    if (fs.existsSync(file)) {
      const owner = readJson(file);
      ensure(owner.host === os.hostname() && Number.isInteger(owner.pid) && owner.pid > 0, 'LOCK_BUSY', 'Lock de outra máquina ou inválido: exige inspeção administrativa.');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
      ensure(!alive, 'LOCK_BUSY', 'O processo proprietário ainda está ativo; lock preservado.');
      atomicWrite(this.file(`editorial/data/lock-recovery-${crypto.randomUUID()}.json`), jsonBytes({ owner, reason, at: this.now() }));
      fs.unlinkSync(file);
    } else atomicWrite(this.file(`editorial/data/lock-recovery-${crypto.randomUUID()}.json`), jsonBytes({ reason, at: this.now(), note: 'Lock sem proprietário após interrupção.' }));
    fs.rmdirSync(this.lock);
  }
  fingerprint() {
    if (operationalActive(this.root)) {
      const records = Object.values(readOperationalRecords(this.root));
      const names = ['content/articles.json', 'content/images.json', 'config.json', 'package.json', 'editorial/config.json', 'src/build.mjs', 'src/art.mjs', ...filesUnder(this.root, 'public').map(f => f.relative)];
      return hash([...records.sort((left,right)=>left.input.id.localeCompare(right.input.id)).map(record=>hash(record)), ...names.sort().map(relative => [relative, fileHash(this.file(relative))])]);
    }
    const names = ['content/articles.json', 'content/images.json', 'config.json', 'package.json', 'editorial/config.json', 'src/build.mjs', 'src/art.mjs', ...filesUnder(this.root, 'public').map(f => f.relative), ...filesUnder(this.root, 'editorial/data/records').map(f => f.relative)];
    return hash(names.sort().map(relative => [relative, fileHash(this.file(relative))]));
  }
  transaction(changes) {
    if (operationalActive(this.root)) {
      const recordPattern = /^editorial\/data\/records\/([a-z0-9-]+)\.json$/;
      const recordChanges = changes.filter(({ relative }) => recordPattern.test(relative));
      if (recordChanges.length) {
        const records = recordChanges.map(({ relative, bytes }) => {
          const match = recordPattern.exec(relative);
          const record = JSON.parse(bytes.toString('utf8'));
          verifyRecord(record);
          ensure(record.input?.id === match[1], 'JOURNAL_PATH', 'Registro não corresponde ao caminho do diário.');
          return record;
        });
        const expectedHashes = {};
        for (const record of records) {
          const current = readOperationalRecord(this.root, record.input.id);
          expectedHashes[record.input.id] = current ? hash(current) : null;
        }
        const fileChanges = changes.filter(({ relative }) => !recordPattern.test(relative));
        const result = this._transactionFiles(fileChanges, {
          afterApply: () => writeOperationalRecords(this.root, records, { expectedHashes }),
        });
        return { ...result, files: [...result.files, ...recordChanges.map(({ relative }) => relative)] };
      }
    }
    return this._transactionFiles(changes);
  }
  _transactionFiles(changes, { afterApply = null } = {}) {
    ensure(this.heldLock,'LOCK_REQUIRED','Publicação exige o bloqueio editorial.');
    const id = crypto.randomUUID(), prefix = `editorial/data/transactions/${id}`;
    const entries = changes.map(({ relative, bytes }, i) => {
      this.assertTransactionPath(relative);
      const target = this.file(relative), beforeHash = fileHash(target), afterHash = hash(bytes);
      const backup = `${prefix}/${i}.before`, prepared = `${prefix}/${i}.after`;
      if (beforeHash) atomicWrite(this.file(backup), fs.readFileSync(target));
      atomicWrite(this.file(prepared), bytes);
      return { relative, beforeHash, afterHash, backup, prepared };
    });
    let manifest = { version: '1.0', id, phase: 'prepared', at: this.now(), entries };
    atomicWrite(this.journal, jsonBytes(manifest));
    try {
      manifest.phase = 'applying'; atomicWrite(this.journal, jsonBytes(manifest));
      entries.forEach((entry, index) => {
        ensure(fileHash(this.file(entry.relative)) === entry.beforeHash, 'WRITE_CONFLICT', 'Arquivo alterado durante a preparação.', { file: entry.relative });
        this.fault('before-write', { index, entry });
        atomicWrite(this.file(entry.relative), fs.readFileSync(this.file(entry.prepared)));
        this.fault('after-write', { index, entry });
      });
      if (afterApply) afterApply();
      manifest.phase = 'committed'; atomicWrite(this.journal, jsonBytes(manifest));
      this.fault('committed', manifest);
      atomicWrite(this.file(`${prefix}/manifest.json`),jsonBytes(manifest));
      fs.unlinkSync(this.journal);
      return { transaction: id, files: entries.map(e => e.relative) };
    } catch (error) {
      if (!error.simulatedInterruption) {
        try { this.recover(); } catch (recovery) { throw new EditorialError('RECOVERY_REQUIRED', 'Falha de escrita e recuperação incompleta; diário preservado.', { original: error.message, recovery: recovery.message }); }
      }
      throw error;
    }
  }
  assertTransactionPath(relative) {
    ensure(relative === 'content/articles.json' || relative === 'content/images.json' || relative.startsWith('public/') || /^editorial\/data\/records\/[a-z0-9-]+\.json$/.test(relative), 'JOURNAL_PATH', 'Destino inválido no diário.');
    this.file(relative);
  }
  recover() {
    ensure(this.heldLock,'LOCK_REQUIRED','Recuperação exige o bloqueio editorial.');
    if (!fs.existsSync(this.journal)) return { recovered: false };
    const manifest = readJson(this.journal, this.config.limits.stateBytes);
    ensure(manifest.version === '1.0' && /^[a-f0-9-]{36}$/.test(manifest.id) && ['prepared', 'applying', 'committed'].includes(manifest.phase) && Array.isArray(manifest.entries), 'JOURNAL_INTEGRITY', 'Diário inválido; intervenção administrativa necessária.');
    for (const [index, entry] of manifest.entries.entries()) {
      this.assertTransactionPath(entry.relative);
      ensure(entry.backup === `editorial/data/transactions/${manifest.id}/${index}.before` && entry.prepared === `editorial/data/transactions/${manifest.id}/${index}.after`, 'JOURNAL_INTEGRITY', 'Caminho de backup inválido.');
      const current = fileHash(this.file(entry.relative));
      ensure(current === entry.beforeHash || current === entry.afterHash, 'RECOVERY_CONFLICT', 'Arquivo alterado externamente; recuperação não sobrescreverá esse arquivo.', { file: entry.relative });
      ensure(fileHash(this.file(entry.prepared)) === entry.afterHash && (!entry.beforeHash || fileHash(this.file(entry.backup)) === entry.beforeHash), 'JOURNAL_INTEGRITY', 'Backup ou arquivo preparado corrompido.');
      if (manifest.phase === 'committed') ensure(current === entry.afterHash, 'RECOVERY_CONFLICT', 'Publicação marcada como concluída possui arquivo divergente.');
    }
    if (manifest.phase !== 'committed') for (const entry of [...manifest.entries].reverse()) {
      if (fileHash(this.file(entry.relative)) === entry.afterHash) {
        if (entry.beforeHash) atomicWrite(this.file(entry.relative), fs.readFileSync(this.file(entry.backup)));
        else fs.unlinkSync(this.file(entry.relative));
      }
    }
    atomicWrite(this.file(`editorial/data/transactions/${manifest.id}/manifest.json`),jsonBytes({...manifest,recovery:{at:this.now(),action:manifest.phase==='committed'?'confirmed':'rolled-back'}}));
    fs.unlinkSync(this.journal);
    return { recovered: true, transaction: manifest.id, action: manifest.phase === 'committed' ? 'confirmed' : 'rolled-back' };
  }
}
