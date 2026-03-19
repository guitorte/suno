/**
 * Node.js script to generate simple PNG icons for the extension.
 * Run once: node generate-icons.js
 * Requires: npm install canvas (or use the output PNGs as-is after running).
 *
 * If you can't run this, the extension still loads — Chrome uses the default
 * puzzle-piece icon when icons are missing.
 */
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background — dark purple circle
  ctx.fillStyle = '#6d28d9';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Microphone symbol (simple rectangle + stand)
  const s = size / 16; // scale factor
  ctx.fillStyle = '#fff';

  // Mic body
  const bw = 4 * s, bh = 6 * s;
  const bx = (size - bw) / 2, by = 3 * s;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, s);
  ctx.fill();

  // Mic stand arc — only for larger sizes
  if (size >= 48) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.arc(size / 2, by + bh, 3 * s, 0, Math.PI, true);
    ctx.stroke();
    // Stem
    ctx.beginPath();
    ctx.moveTo(size / 2, by + bh + 3 * s);
    ctx.lineTo(size / 2, by + bh + 5 * s);
    ctx.stroke();
    // Base
    ctx.beginPath();
    ctx.moveTo(size / 2 - 3 * s, by + bh + 5 * s);
    ctx.lineTo(size / 2 + 3 * s, by + bh + 5 * s);
    ctx.stroke();
  }

  const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`Written ${outPath}`);
}
