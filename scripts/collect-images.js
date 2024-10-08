// Note: requires Node.js 12
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const child_process = require('child_process');

// Regex for finding image tags and markdown images
const rexImgTag = /<img\s+([^>]*)[/]?>/;
const regImgSrcAttribute = /src=\"([^"]+)"/;
const regImgAltAttribute = /alt=\"([^"]+)"/;
const regImgWidthAttribute = /width=\"([^"]+)"/;
const rexMarkdownImage = /\!\[([^\]]*)\]\(([^\)]+)\)/;

/**
 * moveFileSafeSync - Move src to dest, ensuring the destination folder exists.
 *
 * @param {string} src - The source file path.
 * @param {string} dest - The destination file path.
 */
function moveFileSafeSync(src, dest) {
  if (!fs.existsSync(src) && fs.existsSync(dest)) return; // Skip if file already moved

  const directory = path.dirname(dest);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  
  fs.copyFileSync(src, dest);
  fs.unlinkSync(src);
}

/**
 * downloadFile - Download a file from the web to the destination folder.
 *
 * @param {string} src - The URL of the file.
 * @param {string} dest - The destination path.
 */
function downloadFile(src, dest) {
  const directory = path.dirname(dest);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  
  const command = `wget "${src}" -P "${directory}"`;
  return child_process.execSync(command);
}

/**
 * findInDir - Recursively find all files in a directory matching the filter.
 *
 * @param {string} dir - The directory to search.
 * @param {RegExp} filter - Regex to filter files.
 * @param {Array} fileList - Accumulator for matching files.
 * @returns {Array} List of matching file paths.
 */
function findInDir(dir, filter, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const fileStat = fs.lstatSync(filePath);

    if (fileStat.isDirectory()) {
      findInDir(filePath, filter, fileList);
    } else if (filter.test(filePath)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * processPost - Process a blog post and co-locate image files.
 *
 * @param {string} rootPath - The root directory for the blog.
 * @param {string} postPath - The path to the blog post file.
 * @returns {Promise<void>} A promise that resolves when processing is complete.
 */
function processPost(rootPath, postPath) {
  return new Promise((resolve, reject) => {
    const postDirectory = path.dirname(postPath);
    const postFileName = path.basename(postPath);
    console.log(`Processing: ${postFileName}`);

    const updatedPostPath = `${postPath}.updated`;
    const inputStream = fs.createReadStream(postPath);
    const outputStream = fs.createWriteStream(updatedPostPath, { encoding: 'utf8' });
    let changed = false;

    const rl = readline.createInterface({ input: inputStream, terminal: false });

    rl.on('line', (line) => {
      // Process HTML image tags
      if (rexImgTag.test(line)) {
        const [, imageTagInner] = rexImgTag.exec(line) || [];
        const src = regImgSrcAttribute.exec(imageTagInner)?.[1];
        const alt = regImgAltAttribute.exec(imageTagInner)?.[1];
        const width = regImgWidthAttribute.exec(imageTagInner)?.[1];

        if (/^images\//.test(src)) {
          outputStream.write(line + os.EOL);
          return;
        }

        const imageFileName = path.basename(src);
        const newRelativePath = path.join('images', imageFileName);
        const newAbsolutePath = path.join(postDirectory, newRelativePath);

        if (/^http/.test(src)) {
          downloadFile(src, newAbsolutePath);
        } else {
          moveFileSafeSync(path.join(rootPath, src), newAbsolutePath);
        }

        const newImgTag = `<img src="${newRelativePath}"${alt ? ` alt="${alt}"` : ''}${width ? ` width="${width}"` : ''} />`;
        line = line.replace(rexImgTag, newImgTag);
        changed = true;
      }

      // Process Markdown image tags
      if (rexMarkdownImage.test(line)) {
        const [markdownImage, markdownAlt, markdownSrc] = rexMarkdownImage.exec(line) || [];
        
        if (/^images\//.test(markdownSrc)) {
          outputStream.write(line + os.EOL);
          return;
        }

        const imageFileName = path.basename(markdownSrc);
        const newRelativePath = path.join('images', imageFileName);
        const newAbsolutePath = path.join(postDirectory, newRelativePath);

        if (/^http/.test(markdownSrc)) {
          downloadFile(markdownSrc, newAbsolutePath);
        } else {
          moveFileSafeSync(path.join(rootPath, markdownSrc), newAbsolutePath);
        }

        const newMarkdownImage = `![${markdownAlt}](${newRelativePath})`;
        line = line.replace(markdownImage, newMarkdownImage);
        changed = true;
      }

      outputStream.write(line + os.EOL);
    });

    rl.on('error', (err) => reject(err));
    rl.on('close', () => {
      if (changed) {
        moveFileSafeSync(updatedPostPath, postPath);
      } else {
        fs.unlinkSync(updatedPostPath);
      }
      resolve();
    });
  });
}

console.log("collect-images: Tool to co-locate blog post images");

// Get the directories to search
const sourceDirectory = process.argv[2] || process.cwd();
const rootDirectory = process.argv[3] || sourceDirectory;
console.log(`Source Directory: ${sourceDirectory}`);
console.log(`Root Directory: ${rootDirectory}`);

// Find all blog posts
const postPaths = findInDir(sourceDirectory, /\.md$/);

// Process each post
postPaths.forEach(postPath => processPost(rootDirectory, postPath));

// Done
console.log(`Completed processing ${postPaths.length} file(s)`);

