import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

const CATEGORIES = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;

export class Organizer extends EventEmitter {
  constructor(categories = CATEGORIES) {
    super();
    this.categories = categories;
    this.categoryPaths = {};
  }

  formatErrorMessage(error, context = '') {
    switch (error.code) {
      case 'ENOENT':
        return `Path not found: ${context}`;
      case 'EACCES':
        return `Permission denied: ${context}`;
      case 'EISDIR':
        return `Expected file, got directory: ${context}`;
      case 'ENOTDIR':
        return `Expected directory, got file: ${context}`;
      case 'EEXIST':
        return `Path already exists: ${context}`;
      case 'ENOSPC':
        return `No space left on device: ${context}`;
      case 'EMFILE':
        return `Too many open files`;
      default:
        return `${error.message} (${error.code}) at ${context}`;
    }
  }

  async organize(sourceDirectory, targetDirectory) {
    this.emit('organize-start', { source: sourceDirectory, target: targetDirectory });

    for (const category of Object.keys(this.categories)) {
      const categoryPath = path.join(targetDirectory, category);
      this.categoryPaths[category] = categoryPath;
      try {
        await fsPromises.mkdir(categoryPath, { recursive: true });
        this.emit('folder-created', { category, path: categoryPath });
      } catch (error) {
        const message = this.formatErrorMessage(error, categoryPath);
        this.emit('organize-error', {
          error,
          category,
          path: categoryPath,
          code: error.code,
          message,
        });
      }
    }

    const filePaths = [];
    await this.collectFiles(sourceDirectory, filePaths, targetDirectory);

    let copiedFiles = 0;
    let totalSize = 0;
    const summary = {
      Documents: 0,
      Images: 0,
      Archives: 0,
      Code: 0,
      Videos: 0,
      Other: 0,
    };

    for (let index = 0; index < filePaths.length; index += 1) {
      const sourcePath = filePaths[index];
      try {
        const stats = await fsPromises.stat(sourcePath);
        if (!stats.isFile()) {
          continue;
        }

        const extension = path.extname(sourcePath).toLowerCase();
        const category = this.determineCategory(extension);
        const targetFolder = this.categoryPaths[category];
        const fileName = path.basename(sourcePath);
        const destination = await this.getUniqueDestination(targetFolder, fileName);

        this.emit('copy-start', { filePath: sourcePath, index: index + 1, totalFiles: filePaths.length });

        try {
          if (stats.size >= LARGE_FILE_THRESHOLD) {
            await pipeline(
              fs.createReadStream(sourcePath),
              fs.createWriteStream(destination),
            );
          } else {
            await fsPromises.copyFile(sourcePath, destination);
          }
        } catch (copyError) {
          const message = this.formatErrorMessage(copyError, `${sourcePath} -> ${destination}`);
          throw Object.assign(copyError, { message, context: 'copy' });
        }

        copiedFiles += 1;
        totalSize += stats.size;
        summary[category] += 1;
        this.emit('copy-complete', { filePath: sourcePath, destination });
      } catch (error) {
        const code = error.code || 'UNKNOWN';
        const message = error.message || String(error);
        this.emit('copy-error', {
          error,
          filePath: sourcePath,
          code,
          message,
          context: error.context,
        });
      }
    }

    this.emit('organize-complete', {
      summary,
      totalFiles: copiedFiles,
      totalSize,
    });
  }

  determineCategory(extension) {
    for (const [category, extensions] of Object.entries(this.categories)) {
      if (extensions.includes(extension)) {
        return category;
      }
    }
    return 'Other';
  }

  async getUniqueDestination(folder, filename) {
    const parsed = path.parse(filename);
    let candidate = path.join(folder, filename);
    let counter = 1;

    while (true) {
      try {
        await fsPromises.access(candidate);
        candidate = path.join(folder, `${parsed.name}(${counter})${parsed.ext}`);
        counter += 1;
      } catch (error) {
        if (error.code === 'ENOENT') {
          return candidate;
        }
        const message = this.formatErrorMessage(error, candidate);
        const err = new Error(message);
        err.code = error.code;
        throw err;
      }
    }
  }

  async collectFiles(directory, filePaths, outputDirectory) {
    try {
      const entries = await fsPromises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (outputDirectory && this.isSubpath(fullPath, outputDirectory)) {
          continue;
        }
        if (entry.isDirectory()) {
          try {
            await this.collectFiles(fullPath, filePaths, outputDirectory);
          } catch (error) {
            this.emit('collect-error', {
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

  isSubpath(candidate, base) {
    const relative = path.relative(base, candidate);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  }
}
