const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const files = [...walk(path.join(__dirname, '..', 'server')), ...walk(path.join(__dirname, '..', 'public', 'js')), ...walk(__dirname)]
  .filter((file) => file.endsWith('.js'));
files.forEach((file) => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }));
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
