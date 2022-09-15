import chalk from 'chalk';
import fs from 'fs-extra';
import _ from 'lodash';
import moment from 'moment';
import path from 'node:path';
import process from 'node:process';
import psList from 'ps-list';
import { dumpsPath } from './dirname.mjs';

export const lockFile = path.resolve(dumpsPath, 'build-lock.json');

/**
 * 
 * @returns {{start:{pid:number,timestamp:string},error?:{pid:number,timestamp:string}} | null} 
 */
function readLockFile() {
  return fs.existsSync(lockFile) ?
    JSON.parse(fs.readFileSync(lockFile).toString()) :
    null;
}

/**
 * For concurrency reasons, the last process to lock is granted permission to unlock.
 * If the process died the next process to try to unlock will be granted permission.
 */
export async function unlock() {
  const lock = readLockFile();
  if (!lock) return;
  const lockPID = lock.start.pid;
  // the process that locked last is allowed to unlock for concurrency reasons
  const hasPermissionToUnlock =
    process.pid === lockPID ||
    !(await psList()).find(({ pid }) => pid === lockPID);
  try {
    hasPermissionToUnlock && fs.unlinkSync(lockFile);
  } catch (error) {}
}

export function isLocked() {
  return fs.existsSync(lockFile);
}

export function awaitBuild() {
  return new Promise((resolve) => {
    if (isLocked()) {
      console.log(chalk.cyanBright('> waiting for build to finish...'));
      const watcher = hook((locked) => {
        if (!locked) {
          watcher.close();
          resolve();
        }
      }, 500);
    } else {
      resolve();
    }
  });
}

/**
 * Subscribe to build start/completion
 * 
 * @param {(locked: boolean) => any} cb
 * @param {number} [debounce]
 * @returns
 */
export function hook(cb, debounce) {
  return fs.watch(
    path.dirname(lockFile),
    _.debounce((type, file) => {
      if (type === 'rename' && file === path.basename(lockFile)) {
        cb(isLocked());
      }
    }, debounce)
  );
}

/**
 * 
 * @param {'start'|'error'|'end'} type 
 * @param {*} [data] 
 */
export function report(type, data) {
  switch (type) {
    case 'start':
      fs.writeFileSync(lockFile, JSON.stringify({
        start: {
          timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
          pid: process.pid,
        }
      }, null, '\t'));
      break;
    case 'error':
      fs.writeFileSync(lockFile, JSON.stringify({
        ...readLockFile(),
        error: {
          timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
          pid: process.pid,
          data
        },
      }, null, '\t'));
      break;
    case 'end':
      !readLockFile().error && unlock();
  }
}
