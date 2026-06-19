// Run once: node generate-icons.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 512;

  // Background rounded rect
  const r = 100 * s;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size); ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = '#059669';
  ctx.fill();

  ctx.strokeStyle = 'white';
  ctx.lineCap = 'round';

  // Antenna pole
  ctx.lineWidth = 18 * s;
  ctx.beginPath();
  ctx.moveTo(256 * s, 254 * s);
  ctx.lineTo(256 * s, 180 * s);
  ctx.stroke();

  // Signal arcs
  const arcs = [
    { x1: 180, y1: 210, cx: 256, cy: 140, x2: 332, y2: 210 },
    { x1: 140, y1: 170, cx: 256, cy:  80, x2: 372, y2: 170 },
    { x1: 100, y1: 130, cx: 256, cy:  20, x2: 412, y2: 130 },
  ];
  arcs.forEach(a => {
    ctx.beginPath();
    ctx.moveTo(a.x1 * s, a.y1 * s);
    ctx.quadraticCurveTo(a.cx * s, a.cy * s, a.x2 * s, a.y2 * s);
    ctx.stroke();
  });

  // Base circle
  ctx.beginPath();
  ctx.arc(256 * s, 290 * s, 36 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();

  // "FP" text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${72 * s}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FP', 256 * s, 390 * s);

  return canvas;
}

const outDir = path.join(__dirname, 'frontend', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

[192, 512].forEach(size => {
  const buf = drawIcon(size).toBuffer('image/png');
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`✅ Created ${file}`);
});
