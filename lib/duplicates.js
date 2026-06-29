import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    this.emit('search-start', { directory });

    const filePaths = [];
    await this.collectFiles(directory, filePaths);
    const totalFiles = filePaths.length;
    const hashMap = new Map();
    let index = 0;

    for (const filePath of filePaths) {
      index += 1;
      try {
        const stats = await fsPromises.stat(filePath);
        if (!stats.isFile()) {
          continue;
        }

        const hash = await this.calculateHash(filePath);
        const existing = hashMap.get(hash) ?? { paths: [], size: stats.size };
        existing.paths.push(filePath);
        hashMap.set(hash, existing);
        this.emit('file-processed', { filePath, hash, index, totalFiles });
      } catch (error) {
        const code = error.code || 'UNKNOWN';
        const message = error.message || String(error);
        this.emit('hash-error', {
          error,
          filePath,
          code,
          message,
        });
      }
    }

    const duplicates = [];
    for (const [hash, data] of hashMap.entries()) {
      if (data.paths.length > 1) {
        duplicates.push({ hash, paths: data.paths, size: data.size });
      }
    }

    const totalWastedSize = duplicates.reduce(
      (sum, group) => sum + group.size * (group.paths.length - 1),
      0,
    );

    this.emit('duplicates-found', { directory, duplicates, totalWastedSize });
  }

  calculateHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('error', (error) => {
        const message = this.formatErrorMessage(error, filePath);
        const err = new Error(message);
        err.code = error.code;
        err.originalError = error;
        reject(err);
      });

      stream.on('data', (chunk) => {
        try {
          hash.update(chunk);
        } catch (error) {
          stream.destroy();
          const err = new Error(`Hash update failed for ${filePath}: ${error.message}`);
          reject(err);
        }
      });

      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  formatErrorMessage(error, filePath) {
    switch (error.code) {
      case 'ENOENT':
        return `File not found: ${filePath}`;
      case 'EACCES':
        return `Permission denied reading file: ${filePath}`;
      case 'EISDIR':
        return `Expected file, got directory: ${filePath}`;
      case 'EMFILE':
        return `Too many open files - try running on smaller directory`;
      default:
        return `Failed to hash ${filePath}: ${error.message} (${error.code})`;
    }
  }

  async collectFiles(directory, filePaths) {
    try {
      const entries = await fsPromises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          try {
            await this.collectFiles(fullPath, filePaths);
          } catch (error) {
            this.emit('scan-error', {
              error,
              filePath: fullPath,
              code: error.code,
              message: this.formatErrorMessage(error, fullPath),
            });
          }
        } else if (entry.isFile()) {
          filePaths.push(fullPath);
        }
      }
    } catch (error) {
      const message = this.formatErrorMessage(error, directory);
      const err = new Error(message);
      err.code = error.code;
      throw err;
    }
  }
}
