const fs = require('fs');
const path = require('path');

const src = 'C:\\Users\\18229\\.gemini\\antigravity\\brain\\6ed17d82-4d21-47ad-b1fb-7a78ba9ea418\\casino_background_1775627129958.png';
const destDir = path.join(__dirname, 'public');
const dest = path.join(destDir, 'bg.png');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log('图片已成功复制到 public/bg.png');
console.log('现在您可以在 style.css 中使用 background-image: url("/bg.png") 了！');
