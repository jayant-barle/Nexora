// ============================================================================
// Nexora — Application Icon Generator
// Creates high-resolution brand icon (PNG & Windows ICO) using Sharp
// ============================================================================

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function generateBrandIcons() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // 512x512 SVG with Nexora's cinematic black & neon-lime brand identity
  const svg = `
  <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#141414" />
        <stop offset="100%" stop-color="#050505" />
      </linearGradient>
      <linearGradient id="neonLime" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#d4ff66" />
        <stop offset="100%" stop-color="#b4ff32" />
      </linearGradient>
      <linearGradient id="facetGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#80cc14" />
        <stop offset="100%" stop-color="#b4ff32" />
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="16" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <!-- Outer Rounded Base -->
    <rect x="24" y="24" width="464" height="464" rx="100" fill="url(#bgGrad)" stroke="#222222" stroke-width="6" />

    <!-- Subtle Inner Glow Ring -->
    <rect x="36" y="36" width="440" height="440" rx="88" fill="none" stroke="#b4ff32" stroke-width="2" stroke-opacity="0.15" />

    <!-- Glowing Accent Element in Background -->
    <path d="M 140 120 L 220 120 L 372 392 L 292 392 Z" fill="#b4ff32" opacity="0.08" filter="url(#glow)" />

    <!-- Stylized Geometric "N" Structure -->
    <!-- Left Pillar -->
    <path d="M 140 120 L 210 120 L 210 392 L 140 392 Z" fill="url(#neonLime)" />

    <!-- Diagonal Beam -->
    <path d="M 210 120 L 290 120 L 372 392 L 292 392 Z" fill="url(#facetGrad)" />

    <!-- Right Pillar -->
    <path d="M 302 120 L 372 120 L 372 392 L 302 392 Z" fill="url(#neonLime)" />

    <!-- Tech/AI Vertex Accent -->
    <circle cx="140" cy="120" r="14" fill="#ffffff" />
    <circle cx="372" cy="392" r="14" fill="#ffffff" />
    <circle cx="210" cy="120" r="10" fill="#b4ff32" />
    <circle cx="302" cy="392" r="10" fill="#b4ff32" />
  </svg>
  `;

  const png256Buffer = await sharp(Buffer.from(svg))
    .resize(256, 256)
    .png()
    .toBuffer();

  const png512Buffer = await sharp(Buffer.from(svg))
    .resize(512, 512)
    .png()
    .toBuffer();

  const pngPath = path.join(assetsDir, 'icon.png');
  fs.writeFileSync(pngPath, png512Buffer);
  console.log(`Saved brand PNG: ${pngPath} (${png512Buffer.length} bytes)`);

  // Build standard 256x256 Windows ICO file containing PNG payload
  const icoHeader = Buffer.alloc(22);
  // ICONDIR header (6 bytes)
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // 1 image

  // ICONDIRENTRY (16 bytes)
  icoHeader.writeUInt8(0, 6);   // width: 0 means 256
  icoHeader.writeUInt8(0, 7);   // height: 0 means 256
  icoHeader.writeUInt8(0, 8);   // colors (0 = no palette)
  icoHeader.writeUInt8(0, 9);   // reserved
  icoHeader.writeUInt16LE(1, 10); // color planes
  icoHeader.writeUInt16LE(32, 12); // bits per pixel
  icoHeader.writeUInt32LE(png256Buffer.length, 14); // image size
  icoHeader.writeUInt32LE(22, 18); // offset where image data starts

  const icoBuffer = Buffer.concat([icoHeader, png256Buffer]);
  const icoPath = path.join(assetsDir, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`Saved brand ICO: ${icoPath} (${icoBuffer.length} bytes)`);
}

generateBrandIcons().catch(err => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
