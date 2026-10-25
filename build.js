// Nukopijuoja public/ į dist/ ir sukuria sveikatos patikros failą.
const fs = require('node:fs');
fs.rmSync('dist', { recursive: true, force: true });
fs.cpSync('public', 'dist', { recursive: true });
fs.writeFileSync('dist/health', 'ok\n');
