import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { requireValue } from './plan.mjs';

export async function withJournal(path, fingerprint, writable, work) {
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(path + '.lock', 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Файл состояния занят. Убедитесь, что другой запуск завершён: ' + path);
    throw error;
  }
  try {
    let state;
    try {
      state = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { fingerprint, objects: {}, steps: {} };
    }
    requireValue(state.fingerprint === fingerprint, 'План или вложения изменились. Используйте первоначальный план или новый файл состояния с проверенными URL.');
    async function save() {
      requireValue(writable, 'Проверка не изменяет состояние.');
      const temp = path + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      await rename(temp, path);
    }
    return await work(state, save);
  } finally {
    await lock.close();
    await unlink(path + '.lock');
  }
}

export function retryAllows(retry, key) {
  return (Array.isArray(retry) ? retry : [retry]).includes(key);
}

export async function ensureStep(state, save, key, find, action, retry) {
  const existing = await find();
  if (existing) {
    if (state.steps[key] !== 'verified') {
      state.steps[key] = 'verified';
      await save();
    }
    return existing;
  }
  requireValue(!state.steps[key] || retryAllows(retry, key),
    'Проверьте исход шага «' + key + '». Если результат точно отсутствует, повторите с --retry ' + key + '.');
  state.steps[key] = 'pending';
  await save();
  await action();
  const confirmed = await find();
  requireValue(confirmed, 'Результат шага «' + key + '» пока не подтверждён.');
  state.steps[key] = 'verified';
  await save();
  return confirmed;
}
