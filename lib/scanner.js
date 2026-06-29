import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });

    const filePaths = [];
    await this.collectFiles(directory, filePaths);

    const totalFiles = filePaths.length;
    const typeMap = new Map();
    const ageGroups = { last7: 0, last30: 0, older90: 0 };
    const fileEntries = [];
    let totalSize = 0;

    for (let index = 0; index < filePaths.length; index += 1) {
      const filePath = filePaths[index];
      try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          continue;
        }

        const extension = path.extname(filePath).toLowerCase() || '(other)';
        const size = stats.size;
        const mtime = stats.mtime;
        const ageDays = (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);

        totalSize += size;

        const typeKey = extension || '(other)';
        const existing = typeMap.get(typeKey) ?? { count: 0, totalSize: 0 };
        existing.count += 1;
        existing.totalSize += size;
        typeMap.set(typeKey, existing);

        if (ageDays <= 7) {
          ageGroups.last7 += 1;
        }
        if (ageDays <= 30) {
          ageGroups.last30 += 1;
        }
        if (ageDays > 90) {
          ageGroups.older90 += 1;
        }

        fileEntries.push({ filePath, size, mtime, ageDays });
        this.emit('file-found', { filePath, index: index + 1, totalFiles, size, mtime, extension: typeKey });
      } catch (error) {
        const message = this.formatErrorMessage(error, filePath);
        this.emit('scan-error', {
          error,
          filePath,
          code: error.code,
          message,
        });
      }
    }

    const typeGroups = Array.from(typeMap.entries())
      .map(([extension, data]) => ({ extension, count: data.count, totalSize: data.totalSize }))
      .sort((a, b) => b.totalSize - a.totalSize);

    const topLargest = fileEntries
      .slice()
      .sort((a, b) => b.size - a.size)
      .slice(0, 3);

    const oldestFile = fileEntries
      .slice()
      .sort((a, b) => a.mtime.getTime() - b.mtime.getTime())[0] ?? null;

    this.emit('scan-complete', {
      directory,
      totalFiles: fileEntries.length,
      totalSize,
      typeGroups,
      ageGroups,
      topLargest,
      oldestFile,
    });
  }

  async collectFiles(directory, filePaths) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
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

  formatErrorMessage(error, filePath) {
    switch (error.code) {
      case 'ENOENT':
        return `Directory not found: ${filePath}`;
      case 'EACCES':
        return `Permission denied: ${filePath}`;
      case 'EISDIR':
        return `Expected file, got directory: ${filePath}`;
      case 'ENOTDIR':
        return `Expected directory, got file: ${filePath}`;
      default:
        return `${error.message} (${error.code}) at ${filePath}`;
    }
  }
}
