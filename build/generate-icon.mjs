import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, 'icon.svg');
const pngPath = join(__dirname, 'icon.png');
const icoPath = join(__dirname, 'icon.ico');

const svgBuffer = readFileSync(svgPath);

// Generate PNG at 256x256
await sharp(svgBuffer).resize(256, 256).png().toFile(pngPath);
console.log('Generated icon.png (256x256)');

// Generate multiple sizes for ICO
const sizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  sizes.map(size => sharp(svgBuffer).resize(size, size).png().toBuffer())
);

// Build ICO file manually (ICO format)
function createIco(images) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);        // reserved
  header.writeUInt16LE(1, 2);        // type: 1 = ICO
  header.writeUInt16LE(images.length, 4); // count

  // Directory entries: 16 bytes each
  const dirSize = images.length * 16;
  let dataOffset = 6 + dirSize;
  const entries = [];
  const dataBuffers = [];

  for (let i = 0; i < images.length; i++) {
    const size = sizes[i];
    const png = images[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);  // width (0 = 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1);  // height (0 = 256)
    entry.writeUInt8(0, 2);          // color palette
    entry.writeUInt8(0, 3);          // reserved
    entry.writeUInt16LE(1, 4);       // color planes
    entry.writeUInt16LE(32, 6);      // bits per pixel
    entry.writeUInt32LE(png.length, 8);  // size of image data
    entry.writeUInt32LE(dataOffset, 12); // offset to image data
    entries.push(entry);
    dataBuffers.push(png);
    dataOffset += png.length;
  }

  return Buffer.concat([header, ...entries, ...dataBuffers]);
}

const icoBuffer = createIco(pngBuffers);
writeFileSync(icoPath, icoBuffer);
console.log(`Generated icon.ico (${sizes.join(', ')}px sizes)`);
