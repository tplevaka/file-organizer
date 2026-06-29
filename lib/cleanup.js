import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class Cleanup extends EventEmitter {
  formatErrorMessage(error, filePath) {
    switch (error.code) {
      case 'ENOENT':
        return `File not found: ${filePath}`;
      case 'EACCES':
        return `Permission denied: ${filePath}`;
      case 'EISDIR':
        return `Expected file, got directory: ${filePath}`;
      case 'ENOTDIR':
        return `Expected directory, got file: ${filePath}`;
      case 'EBUSY':
        return `File is in use and cannot be deleted: ${filePath}`;
      default:
        return `${error.message} (${error.code}) at ${filePath}`;
    }
  }

  async cleanup(directory, olderThanDays, confirm = false) {
    this.emit('cleanup-start', { directory, olderThanDays, confirm });

    const filesToRemove = [];
    try {
      await this.collectOldFiles(directory, olderThanDays, filesToRemove);
    } catch (error) {
      const message = this.formatErrorMessage(error, directory);
      this.emit('cleanup-error', {
        error,
        filePath: directory,
        code: error.code,
        message,
      });
      throw error;
    }

    const totalSize = filesToRemove.reduce((sum, item) => sum + item.size, 0);

    for (const item of filesToRemove) {
      this.emit('file-found', { filePath: item.path, size: item.size, mtime: item.mtime, daysOld: item.daysOld });
    }

    if (!confirm) {
      this.emit('cleanup-complete', {
        totalFiles: filesToRemove.length,
        totalSize,
        confirm: false,
      });
      return;
    }

    let deletedFiles = 0;
    let freedBytes = 0;

    for (let index = 0; index < filesToRemove.length; index += 1) {
      const item = filesToRemove[index];
      try {
        await fs.unlink(item.path);
        deletedFiles += 1;
        freedBytes += item.size;
        this.emit('file-deleted', { filePath: item.path, index: index + 1, total: filesToRemove.length, size: item.size });
      } catch (error) {
        const message = this.formatErrorMessage(error, item.path);
        this.emit('delete-error', {
          error,
          filePath: item.path,
          code: error.code,
          message,
        });
      }
    }

    this.emit('cleanup-complete', {
      totalFiles: deletedFiles,
      totalSize: freedBytes,
      confirm: true,
    });
  }

  async collectOldFiles(directory, olderThanDays, results) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          try {
            await this.collectOldFiles(fullPath, olderThanDays, results);
          } catch (error) {
            this.emit('scan-error', {
              error,
              filePath: fullPath,
              code: error.code,
              message: this.formatErrorMessage(error, fullPath),
            });
          }
        } else if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            const ageDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays > olderThanDays) {
              results.push({ path: fullPath, size: stats.size, mtime: stats.mtime, daysOld: ageDays });
            }
          } catch (error) {
            this.emit('file-error', {
              error,
              filePath: fullPath,
              code: error.code,
              message: this.formatErrorMessage(error, fullPath),
            });
          }
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
