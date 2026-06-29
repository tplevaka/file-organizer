import path from 'path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';

const [,, command, ...args] = process.argv;

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function drawProgressBar(current, total, width = 20) {
  const percentage = total === 0 ? 0 : current / total;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

function formatAge(days) {
  const count = Math.floor(days);
  return `${count} day${count === 1 ? '' : 's'} ago`;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function printUsage() {
  console.log('Usage: node file-organizer.js <command> <args>');
  console.log('Commands:');
  console.log('  scan <directory>');
  console.log('  duplicates <directory>');
  console.log('  organize <source> --output <target>');
  console.log('  cleanup <directory> --older-than <days> [--confirm]');
}

function handleFsError(error, message) {
  if (!error) {
    console.error(`? Error: ${message || 'Unknown error'}`);
    process.exit(1);
  }

  const code = error.code || 'UNKNOWN';
  const errorMsg = error.message || String(error);
  
  console.error(`\n? Error (${code}): ${errorMsg}`);
  if (message) {
    console.error(`  Context: ${message}`);
  }
  
  // Provide helpful suggestions based on error code
  switch (code) {
    case 'ENOENT':
      console.error('  → Check that the path exists and you typed it correctly');
      break;
    case 'EACCES':
      console.error('  → Check file/folder permissions or try running with elevated privileges');
      break;
    case 'EISDIR':
      console.error('  → This is a directory, not a file. Check your path.');
      break;
    case 'ENOTDIR':
      console.error('  → This is a file, not a directory. Check your path.');
      break;
    case 'ENOSPC':
      console.error('  → No space left on device. Free up some disk space.');
      break;
    case 'EMFILE':
      console.error('  → Too many open files. Try processing a smaller directory.');
      break;
  }
  
  process.exit(1);
}

function parseOrganizeArgs(args) {
  const source = args[0];
  const outputIndex = args.indexOf('--output');
  const target = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  return { source, target };
}

function parseCleanupArgs(args) {
  const directory = args[0];
  const olderIndex = args.indexOf('--older-than');
  const olderThan = olderIndex >= 0 ? Number(args[olderIndex + 1]) : NaN;
  const confirm = args.includes('--confirm');
  return { directory, olderThan, confirm };
}

async function main() {
  if (!command) {
    printUsage();
    process.exit(0);
  }

  if (command === 'scan') {
    const directory = args[0];
    if (!directory) {
      printUsage();
      process.exit(1);
    }

    const scanner = new Scanner();
    scanner.on('scan-start', ({ directory: dir }) => {
      console.log(`?? Scanning: ${dir}`);
    });

    scanner.on('file-found', ({ index, totalFiles }) => {
      process.stdout.write(`\rProcessing... ${drawProgressBar(index, totalFiles)}`);
    });

    scanner.on('scan-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning: ${message}`);
    });

    scanner.on('scan-complete', (statistics) => {
      process.stdout.write('\n\n');
      const { totalFiles, totalSize, typeGroups, ageGroups, topLargest, oldestFile } = statistics;

      console.log('?? Scan Results:');
      console.log('??????????????????????????????????');
      console.log(`Total files: ${totalFiles}`);
      console.log(`Total size: ${formatSize(totalSize)}`);
      console.log('\nBy File Type:');

      for (const { extension, count, totalSize: size } of typeGroups) {
        console.log(`  ${extension.padEnd(7)} ${String(count).padStart(3)} files   ${formatSize(size)}`);
      }

      console.log('\nFile Age:');
      console.log(`  Last 7 days:    ${ageGroups.last7} files`);
      console.log(`  Last 30 days:   ${ageGroups.last30} files`);
      console.log(`  Older than 90:  ${ageGroups.older90} files`);

      console.log('\nLargest files:');
      for (let i = 0; i < topLargest.length; i++) {
        const item = topLargest[i];
        console.log(`  ${i + 1}. ${path.basename(item.filePath).padEnd(25)} ${formatSize(item.size)}`);
      }

      if (oldestFile) {
        const ageDays = Math.floor(oldestFile.ageDays);
        console.log('\nOldest file:', `${path.basename(oldestFile.filePath)} (modified ${ageDays} days ago)`);
      }
    });

    try {
      await scanner.scan(directory);
    } catch (error) {
      handleFsError(error, directory);
    }
    return;
  }

  if (command === 'duplicates') {
    const directory = args[0];
    if (!directory) {
      printUsage();
      process.exit(1);
    }

    const finder = new DuplicateFinder();
    finder.on('search-start', ({ directory: dir }) => {
      console.log(`?? Searching for duplicates in: ${dir}`);
    });

    finder.on('file-processed', ({ index, totalFiles }) => {
      process.stdout.write(`\rCalculating hashes... ${drawProgressBar(index, totalFiles)}`);
    });

    finder.on('hash-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning: ${message}`);
    });

    finder.on('scan-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning (directory scan): ${message}`);
    });

    finder.on('duplicates-found', ({ duplicates, totalWastedSize }) => {
      process.stdout.write('\n\n');
      if (!duplicates.length) {
        console.log('No duplicate groups found.');
        return;
      }

      console.log(`Found ${duplicates.length} duplicate groups (${formatSize(totalWastedSize)} wasted):\n`);
      for (let i = 0; i < duplicates.length; i++) {
        const group = duplicates[i];
        console.log('??????????????????????????????????');
        console.log(`Group ${i + 1} (${group.paths.length} copies, ${formatSize(group.size)} each):`);
        console.log(`  SHA-256: ${group.hash}`);
        console.log('');
        for (const filePath of group.paths) {
          console.log(`  ?? ${filePath}`);
        }
        console.log('');
        console.log(`  Wasted space: ${formatSize(group.size * (group.paths.length - 1))}`);
        console.log('');
      }
      console.log('??????????????????????????????????');
      console.log(`?? Total wasted space: ${formatSize(totalWastedSize)}`);
    });

    try {
      await finder.find(directory);
    } catch (error) {
      handleFsError(error, directory);
    }
    return;
  }

  if (command === 'organize') {
    const { source, target } = parseOrganizeArgs(args);
    if (!source || !target) {
      printUsage();
      process.exit(1);
    }

    const organizer = new Organizer();
    organizer.on('organize-start', ({ source: src, target: tgt }) => {
      console.log(`?? Organizing: ${src}`);
      console.log(`Target: ${tgt}\n`);
      console.log('Creating folders...');
    });

    organizer.on('folder-created', ({ category, path: folderPath }) => {
      console.log(`  ? ${category}/`);
    });

    organizer.on('organize-error', ({ category, message }) => {
      console.warn(`  ⚠ Warning: Failed to create category folder ${category}: ${message}`);
    });

    organizer.on('copy-start', ({ index, totalFiles }) => {
      process.stdout.write(`\rCopying files... ${drawProgressBar(index, totalFiles)}`);
    });

    organizer.on('copy-complete', ({ filePath }) => {
      // no-op
    });

    organizer.on('copy-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning: Failed to copy ${path.basename(filePath)}: ${message}`);
    });

    organizer.on('collect-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning (file scan): ${message}`);
    });

    organizer.on('organize-complete', ({ summary, totalFiles, totalSize }) => {
      process.stdout.write('\n\n');
      console.log('? Organization complete!\n');
      console.log('Summary:');
      for (const category of Object.keys(summary)) {
        const count = summary[category];
        console.log(`  ${category.padEnd(10)} ${String(count).padStart(3)} files > Organized/${category}/`);
      }
      console.log(`\nTotal copied: ${totalFiles} files (${formatSize(totalSize)})`);
    });

    try {
      await organizer.organize(source, target);
    } catch (error) {
      handleFsError(error, `${source} or ${target}`);
    }
    return;
  }

  if (command === 'cleanup') {
    const { directory, olderThan, confirm } = parseCleanupArgs(args);
    if (!directory || Number.isNaN(olderThan)) {
      printUsage();
      process.exit(1);
    }

    const cleanup = new Cleanup();

    console.log(`?? Cleanup: ${directory}`);
    console.log(`Looking for files older than ${olderThan} days...\n`);

    cleanup.on('file-found', ({ filePath, size, mtime, daysOld }) => {
      const ageLabel = formatAge(daysOld);
      console.log(`  ${path.basename(filePath)}`);
      console.log(`    Size: ${formatSize(size)}`);
      console.log(`    Modified: ${ageLabel} (${formatDate(mtime)})\n`);
    });

    cleanup.on('file-deleted', ({ index, total }) => {
      process.stdout.write(`\rDeleting... ${drawProgressBar(index, total)}`);
    });

    cleanup.on('delete-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning: Failed to delete ${path.basename(filePath)}: ${message}`);
    });

    cleanup.on('file-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning: Cannot process file ${path.basename(filePath)}: ${message}`);
    });

    cleanup.on('scan-error', ({ filePath, message }) => {
      console.warn(`  ⚠ Warning (directory scan): ${message}`);
    });

    cleanup.on('cleanup-complete', ({ totalFiles, totalSize, confirm: didDelete }) => {
      console.log('\n');
      if (!didDelete) {
        console.log(`Total: ${totalFiles} files (${formatSize(totalSize)})`);
        console.log('\n🧹  DRY RUN MODE: No files were deleted.');
        console.log('To actually delete these files, run with --confirm flag.');
      } else {
        console.log('✅ Cleanup complete!');
        console.log(`Deleted: ${totalFiles} files (${formatSize(totalSize)} freed)`);
      }
    });

    try {
      await cleanup.cleanup(directory, olderThan, confirm);
    } catch (error) {
      handleFsError(error, directory);
    }
    return;
  }

  printUsage();
  process.exit(1);
}

await main();
