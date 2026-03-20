// Run: node scripts/gen-icons.js
// Creates icon16.png, icon48.png, icon128.png in icons/
// Requires: npm install canvas (optional — skip if you provide your own PNGs)

const fs = require("fs");
const path = require("path");

// Simple green "T" on dark background as base64 PNGs
// Generated programmatically — replace with real design later

function createIconData(size) {
  // Create a minimal valid PNG with green T on #171717
  // For now, create a placeholder notice
  console.log(`[Icons] Create ${size}x${size} icon at icons/icon${size}.png`);
  console.log(`[Icons] Use any image editor or https://favicon.io/`);
}

// If canvas is available, generate real icons
try {
  const { createCanvas } = require("canvas");

  [16, 48, 128].forEach((size) => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, size, size);

    // Accent border
    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = Math.max(1, size / 16);
    ctx.strokeRect(0, 0, size, size);

    // "T" letter
    ctx.fillStyle = "#10B981";
    ctx.font = `bold ${Math.floor(size * 0.6)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("T", size / 2, size / 2 + 1);

    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync(path.join(__dirname, "..", "icons", `icon${size}.png`), buffer);
    console.log(`[Icons] Created icon${size}.png`);
  });
} catch {
  console.log("[Icons] 'canvas' package not found. Creating placeholder instructions.");
  console.log("[Icons] To generate icons:");
  console.log("[Icons]   npm install canvas");
  console.log("[Icons]   node scripts/gen-icons.js");
  console.log("[Icons] Or manually place icon16.png, icon48.png, icon128.png in icons/");

  // Create minimal 1x1 PNGs so the extension loads
  // This is the smallest valid PNG: 8-byte header + IHDR + IDAT + IEND
  const png1x1 = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000a49444154789c626000000002000198e195280000000049454e44ae426082",
    "hex"
  );

  [16, 48, 128].forEach((size) => {
    const p = path.join(__dirname, "..", "icons", `icon${size}.png`);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, png1x1);
      console.log(`[Icons] Placeholder icon${size}.png created`);
    }
  });
}