# File Organizer

Multi-command CLI tool for scanning, duplicate detection, file organization, and cleanup.

## Features

### Architecture
- **EventEmitter-based design**: Each command is a separate class extending EventEmitter for progress tracking
- **Comprehensive error handling**: All file operations use try...catch with specific error codes (ENOENT, EACCES, EISDIR, etc.)
- **Stream-based file operations**: Large files (≥10 MB) are processed using Node.js streams instead of loading into memory

### Commands Available
1. **scan** - Recursively scan directory with detailed statistics
2. **duplicates** - Find duplicate files by SHA-256 hash
3. **organize** - Copy files into category folders
4. **cleanup** - Find and remove old files with confirmation

## Installation

1. Install dependencies (if needed):
   ```bash
   npm install
   ```
2. Run commands with `npm run <command> -- <args>`.

## Usage

### Scan

Recursively scan a directory and show detailed file statistics.

```bash
npm run scan -- /path/to/directory
```

**Output includes:**
- Total file count and size
- Files grouped by extension
- Age distribution (last 7 days, last 30 days, older than 90 days)
- Top 3 largest files
- Oldest file in directory

### Duplicates

Search for duplicate files by SHA-256 hash.

```bash
npm run duplicates -- /path/to/directory
```

**Output includes:**
- Duplicate groups with hash values
- File paths for each duplicate
- Wasted disk space calculation
- Total wasted space across all duplicates

### Organize

Copy files from a source directory into category folders in a target directory.

```bash
npm run organize -- /source/directory --output /target/directory
```

**File categories:**
- **Documents**: PDF, DOCX, DOC, TXT, MD, XLSX, PPTX
- **Images**: PNG, JPG, JPEG, GIF, SVG, WEBP, BMP
- **Archives**: ZIP, RAR, TAR, GZ, 7Z
- **Code**: JS, PY, JAVA, CPP, HTML, CSS, JSON
- **Videos**: MP4, AVI, MKV, MOV, WEBM
- **Other**: Uncategorized files

**Large file handling:**
- Files ≥10 MB use streaming (pipeline) for efficient memory usage
- Smaller files use standard copy for speed

### Cleanup

List files older than a threshold in days. Use `--confirm` to delete them.

Dry run mode (no files deleted):
```bash
npm run cleanup -- /path/to/directory --older-than 90
```

Delete mode (removes files):
```bash
npm run cleanup -- /path/to/directory --older-than 90 --confirm
```

## Error Handling

All operations include detailed error messages for:

| Error Code | Meaning | Suggestion |
|-----------|---------|-----------|
| ENOENT | Path not found | Check path exists and spelling |
| EACCES | Permission denied | Check file permissions or use elevated privileges |
| EISDIR | Expected file, got directory | Verify path points to a file |
| ENOTDIR | Expected directory, got file | Verify path points to a directory |
| ENOSPC | No space left | Free up disk space |
| EMFILE | Too many open files | Process smaller directory |
| EBUSY | File in use | File is locked by another process |

## Implementation Details

### EventEmitter Pattern
Each operation (Scanner, DuplicateFinder, Organizer, Cleanup) extends EventEmitter for progress tracking:

```javascript
scanner.on('scan-start', (data) => {});
scanner.on('file-found', (data) => {});
scanner.on('scan-error', (data) => {});
scanner.on('scan-complete', (statistics) => {});
```

### Stream Processing
Large files use Node.js stream APIs:

```javascript
if (stats.size >= 10 * 1024 * 1024) { // 10 MB
  await pipeline(
    fs.createReadStream(source),
    fs.createWriteStream(destination)
  );
}
```

### Error Messages
Each error includes:
- Error code (ENOENT, EACCES, etc.)
- Context (affected file/directory path)
- Helpful suggestion for resolution

## Example Workflow

```bash
# 1. Scan directory
npm run scan -- ./downloads

# 2. Find duplicates
npm run duplicates -- ./downloads

# 3. Organize files
npm run organize -- ./downloads --output ./organized

# 4. Clean up old files
npm run cleanup -- ./downloads --older-than 90
npm run cleanup -- ./downloads --older-than 90 --confirm
```

## Technical Stack

- **Node.js ES6 modules** (ESM)
- **Built-in APIs only** - No external dependencies:
  - `fs` / `fs/promises` - File system operations
  - `path` - Path utilities
  - `crypto` - SHA-256 hashing
  - `stream/promises` - Efficient file streaming
  - `events` - EventEmitter base class

## Performance Considerations

- ✅ Recursive directory traversal with proper error handling
- ✅ Stream-based processing for large files
- ✅ Non-blocking async/await pattern
- ✅ Progress tracking via EventEmitter
- ✅ Graceful error recovery with detailed messages

## Project structure

```
file-organizer/
+-- package.json
+-- .gitignore
+-- README.md
+-- file-organizer.js
L-- lib/
    +-- scanner.js
    +-- duplicates.js
    +-- organizer.js
    L-- cleanup.js
```
