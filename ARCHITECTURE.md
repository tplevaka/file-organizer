# File Organizer - Architecture & Implementation Guide

## 🏗️ Architecture Overview

The File Organizer implements three key architectural patterns for robust, scalable CLI tool development:

### 1. EventEmitter-Based Architecture
### 2. Comprehensive Error Handling with Specific Error Codes  
### 3. Stream-Based Processing for Large Files

---

## 1️⃣ EventEmitter Architecture

### Pattern

Each operation (scan, duplicates, organize, cleanup) is implemented as a class that extends `EventEmitter`:

```javascript
import { EventEmitter } from 'events';

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });
    // ... do work ...
    this.emit('scan-complete', statistics);
  }
}
```

### Benefits

✅ **Decoupled**: Business logic separated from UI/display
✅ **Composable**: Easy to add/remove listeners at runtime
✅ **Testable**: Can mock listeners and verify events
✅ **Observable**: Enables real-time progress tracking
✅ **Extensible**: New listeners can be added without code changes

### Event Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│ file-organizer.js (Main Entry Point)                │
│  - Parses command-line arguments                    │
│  - Creates appropriate class instance               │
│  - Attaches event listeners                         │
└──────────────┬──────────────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────────────┐
│ Scanner / DuplicateFinder / Organizer / Cleanup     │
│ (EventEmitter Classes)                              │
│                                                      │
│  async scan() / find() / organize() / cleanup()     │
│    ├─ emit('start')                                 │
│    ├─ emit('progress')  [multiple times]            │
│    ├─ emit('error')     [if issues]                 │
│    └─ emit('complete')                              │
└──────────────┬──────────────────────────────────────┘
               │
               ↓
    ┌──────────────────────┐
    │ Event Listeners      │
    ├──────────────────────┤
    │ on('start')          │ → log "Starting..."
    │ on('progress')       │ → update progress bar
    │ on('error')          │ → log warning
    │ on('complete')       │ → show results
    └──────────────────────┘
```

### Event Types by Operation

#### Scanner Events
```javascript
scanner.on('scan-start', ({ directory }) => {});
scanner.on('file-found', ({ filePath, index, totalFiles }) => {});
scanner.on('scan-error', ({ filePath, code, message }) => {});
scanner.on('scan-complete', (statistics) => {});
```

#### DuplicateFinder Events
```javascript
finder.on('search-start', ({ directory }) => {});
finder.on('file-processed', ({ filePath, hash, index, totalFiles }) => {});
finder.on('hash-error', ({ filePath, code, message }) => {});
finder.on('duplicates-found', ({ duplicates, totalWastedSize }) => {});
```

#### Organizer Events
```javascript
organizer.on('organize-start', ({ source, target }) => {});
organizer.on('folder-created', ({ category, path }) => {});
organizer.on('organize-error', ({ category, code, message }) => {});
organizer.on('copy-start', ({ index, totalFiles }) => {});
organizer.on('copy-error', ({ filePath, code, message }) => {});
organizer.on('organize-complete', ({ summary, totalFiles, totalSize }) => {});
```

#### Cleanup Events
```javascript
cleanup.on('cleanup-start', ({ directory, olderThanDays }) => {});
cleanup.on('file-found', ({ filePath, size, mtime, daysOld }) => {});
cleanup.on('delete-error', ({ filePath, code, message }) => {});
cleanup.on('cleanup-complete', ({ totalFiles, totalSize, confirm }) => {});
```

---

## 2️⃣ Comprehensive Error Handling

### Pattern: Error Code Mapping

Each class includes `formatErrorMessage()` method that maps Node.js error codes to user-friendly messages:

```javascript
class MyClass extends EventEmitter {
  formatErrorMessage(error, filePath) {
    switch (error.code) {
      case 'ENOENT':
        return `File not found: ${filePath}`;
      case 'EACCES':
        return `Permission denied: ${filePath}`;
      // ... etc
      default:
        return `${error.message} (${error.code}) at ${filePath}`;
    }
  }
}
```

### Supported Error Codes

| Code | Meaning | Example Scenario | User Message |
|------|---------|------------------|--------------|
| **ENOENT** | File not found | Path doesn't exist | "Directory not found: /path" |
| **EACCES** | Permission denied | No read/write access | "Permission denied: /path" |
| **EISDIR** | Expected file, got dir | Trying to read as file | "Expected file, got directory: /path" |
| **ENOTDIR** | Expected dir, got file | Trying to traverse as dir | "Expected directory, got file: /path" |
| **EBUSY** | File in use | Process has file locked | "File is in use and cannot be deleted" |
| **ENOSPC** | No space left | Disk full during copy | "No space left on device" |
| **EMFILE** | Too many open files | Resource limit hit | "Too many open files - try smaller dir" |

### Implementation Pattern

#### Level 1: Try-Catch at File Operation
```javascript
for (const filePath of filePaths) {
  try {
    const stats = await fs.stat(filePath);
    // Process file
  } catch (error) {
    this.emit('error-event', {
      error,
      filePath,
      code: error.code,
      message: this.formatErrorMessage(error, filePath)
    });
  }
}
```

#### Level 2: Stream Error Handling
```javascript
const stream = fs.createReadStream(filePath);
stream.on('error', (error) => {
  const message = this.formatErrorMessage(error, filePath);
  const err = new Error(message);
  err.code = error.code;
  reject(err);
});
```

#### Level 3: Main Error Handler
```javascript
try {
  await scanner.scan(directory);
} catch (error) {
  handleFsError(error, directory);
  // Logs: ? Error (ENOENT): Directory not found: /path
  //       → Check that the path exists and you typed it correctly
}
```

### Error Event Flow

```
File Operation
    ↓
    ├─ Error occurs (e.g., ENOENT)
    ↓
Try-Catch Block
    ├─ Catches error
    ├─ Determines error.code
    ├─ Calls formatErrorMessage()
    ↓
Emit Error Event
    ├─ emit('scan-error', { error, code, message, filePath })
    ↓
Event Listener (main)
    ├─ Logs warning with code + message
    ├─ Operation continues (non-fatal)
    ├─ Final summary shows what completed
```

### Example: Full Error Handling Flow

**Scenario**: Trying to organize from non-existent directory

```
$ npm run organize -- nonexistent --output output

?? Organizing: nonexistent
Target: output

Creating folders...
  ? Documents/
  ? Images/
  ? Archives/
  ? Code/
  ? Videos/
  ? Other/

? Error (ENOENT): Path not found: nonexistent
  Context: nonexistent or output
  → Check that the path exists and you typed it correctly

Command exited with code 1
```

**What happened**:
1. Organizer tries to read `nonexistent` directory
2. `fs.readdir()` throws error with code `ENOENT`
3. `catch` block calls `formatErrorMessage(error, 'nonexistent')`
4. `handleFsError()` receives error in main
5. Comprehensive message displayed with helpful suggestion
6. Process exits with code 1

---

## 3️⃣ Stream-Based Processing for Large Files

### Problem: Reading Entire Files Into Memory

❌ **Inefficient Approach**
```javascript
const data = await fs.readFile(largeFile);      // Loads entire file into RAM!
const hash = crypto.createHash('sha256');
hash.update(data);
const digest = hash.digest('hex');
```

For a 1 GB file:
- Uses 1 GB of RAM
- Blocks event loop while reading
- Slow on slow I/O devices

### Solution: Stream Processing

✅ **Efficient Approach with Streams**
```javascript
const stream = fs.createReadStream(largeFile);
const hash = crypto.createHash('sha256');

stream.on('data', (chunk) => {
  hash.update(chunk);           // Process chunk by chunk (64KB default)
});

stream.on('end', () => {
  const digest = hash.digest('hex');
});
```

Benefits:
- Constant memory usage (~64 KB for chunks)
- Non-blocking I/O
- Can process files of any size

### Implementation in File Organizer

#### 1. Hash Calculation (lib/duplicates.js)

```javascript
calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
```

**Usage**: Even small files are streamed for consistency

#### 2. Large File Copy (lib/organizer.js)

```javascript
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

if (stats.size >= LARGE_FILE_THRESHOLD) {
  // Use streams for large files
  await pipeline(
    fs.createReadStream(sourcePath),
    fs.createWriteStream(destination)
  );
} else {
  // Use copyFile for small files (faster)
  await fsPromises.copyFile(sourcePath, destination);
}
```

**Benefits**:
- Files < 10 MB: Use `copyFile` (fastest)
- Files ≥ 10 MB: Use streams (memory efficient)
- Hybrid approach for optimal performance

### Stream Error Handling

```javascript
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
    stream.destroy();           // Stop stream
    reject(new Error(`Hash update failed: ${error.message}`));
  }
});
```

### Pipeline Pattern for File Transfer

```javascript
import { pipeline } from 'stream/promises';

// Ensures proper cleanup on error
// Automatically destroys streams
// No manual error handling needed for stream errors
await pipeline(
  fs.createReadStream(source),
  fs.createWriteStream(destination)
);
```

---

## 📊 Architecture Comparison

### Before: Basic Implementation
```
❌ Simple function calls
❌ No progress tracking
❌ Basic error messages
❌ Files loaded entirely into memory
```

### After: Enterprise Pattern
```
✅ EventEmitter for decoupled progress
✅ Detailed error codes with user guidance
✅ Stream processing for large files
✅ Graceful error recovery
✅ Real-time progress visibility
```

---

## 🔄 Complete Request Lifecycle

### Example: `npm run organize -- ./source --output ./dest`

```
1. PARSING (file-organizer.js)
   └─ Parse "organize", "./source", "--output", "./dest"

2. INSTANTIATION
   └─ organizer = new Organizer()
   └─ Attach listeners for all events

3. FOLDER CREATION (organizer.js)
   try {
     await mkdir(dest/Documents, { recursive: true })
     emit('folder-created', { category: 'Documents' })
   } catch (error) {
     emit('organize-error', { code, message })
   }

4. FILE COLLECTION
   try {
     filePaths = await collectFiles(source)
   } catch (error) {
     emit('collect-error', { code, message })

5. FILE PROCESSING
   for each file:
     try {
       stats = await fs.stat(filePath)
       if size >= 10MB:
         await pipeline(createReadStream, createWriteStream)
       else:
         await copyFile(source, dest)
       emit('copy-complete')
     } catch (error) {
       emit('copy-error', { code, message })
       continue to next file

6. COMPLETION
   emit('organize-complete', { summary, totalFiles, totalSize })

7. DISPLAY (file-organizer.js listener)
   console.log results
   process.exit(0)
```

---

## 🧪 Testing Strategy

### Unit Testing Each Event
```javascript
const scanner = new Scanner();
let eventsFired = [];

scanner.on('scan-start', () => eventsFired.push('start'));
scanner.on('file-found', () => eventsFired.push('found'));
scanner.on('scan-complete', () => eventsFired.push('complete'));

await scanner.scan('./test-dir');

assert(eventsFired.includes('start'));
assert(eventsFired.includes('complete'));
```

### Error Scenario Testing
```javascript
// Test ENOENT handling
try {
  await scanner.scan('/nonexistent');
} catch (error) {
  assert(error.code === 'ENOENT');
  assert(error.message.includes('not found'));
}
```

### Stream Testing
```javascript
// Test large file handling uses streams
const stat = fs.statSync('./large-file.bin');
// Verify memory usage stays constant
const memBefore = process.memoryUsage().heapUsed;
await organizer.copyLargeFile();
const memAfter = process.memoryUsage().heapUsed;
assert(memAfter - memBefore < 100 * 1024); // Less than 100KB increase
```

---

## 📚 References

### Node.js APIs Used

| API | Purpose | Docs |
|-----|---------|------|
| `EventEmitter` | Event-driven architecture | https://nodejs.org/api/events.html |
| `fs/promises` | Async file operations | https://nodejs.org/api/fs.html |
| `fs.createReadStream()` | Large file reading | https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options |
| `stream/promises.pipeline()` | Stream composition | https://nodejs.org/api/stream.html#stream_stream_pipeline_source_transforms_destination_options_callback |
| `crypto.createHash()` | SHA-256 hashing | https://nodejs.org/api/crypto.html |

---

## ✨ Key Takeaways

1. **EventEmitter Pattern** decouples business logic from presentation
2. **Specific Error Codes** with helpful messages improve user experience
3. **Streams** enable processing files of any size efficiently
4. **Graceful degradation** allows operations to continue despite errors
5. **Real-time events** enable progress tracking and responsiveness

This architecture scales from CLI tools to production microservices!
