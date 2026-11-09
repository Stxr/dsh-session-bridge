import {
  chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { field, OPEN_PATH } from '../shared/protocol.js';
import type { DiscoveryRecord } from '../shared/protocol.js';
import type { Dispose } from './context.js';

interface DiscoveryOptions {
  dataDir: string;
  instanceId: string;
  origin: string;
  token: string;
}

/** Publish one private desktop record; an older generation cannot delete a replacement. */
export function publishDiscovery({ dataDir, instanceId, origin, token }: DiscoveryOptions, disposeBridge: Dispose): Dispose {
  const directory = join(dataDir, 'huantai-bridge');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error('Huantai discovery directory must not be a symlink');
  }
  chmodSync(directory, 0o700);
  const discovery = join(directory, 'desktop.json');
  const temporary = join(directory, instanceId + '.tmp');
  const record: DiscoveryRecord = { protocolVersion: 1, instanceId, pid: process.pid, profile: 'desktop', dataDir,
    endpoint: origin + OPEN_PATH, token, startedAt: Date.now() };
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(record) + '\n'); } finally { closeSync(fd); }
  // Both absolute paths are children of the verified private directory, never external input.
  if (dirname(temporary) !== directory || dirname(discovery) !== directory) throw new Error('Invalid discovery path');
  renameSync(temporary, discovery);
  return () => {
    disposeBridge();
    if (dirname(discovery) !== directory || !existsSync(discovery) || lstatSync(discovery).isSymbolicLink()) return;
    try {
      const value: unknown = JSON.parse(readFileSync(discovery, 'utf8'));
      if (field(value, 'instanceId') === instanceId) unlinkSync(discovery);
    } catch { /* An absent/replaced discovery record is already cleaned up. */ }
  };
}
