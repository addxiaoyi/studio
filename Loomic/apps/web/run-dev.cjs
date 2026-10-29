const { spawn } = require('child_process');
const rawArgs = process.argv.slice(2);
const mappedArgs = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--host') {
    mappedArgs.push('--hostname');
  } else {
    mappedArgs.push(rawArgs[i]);
  }
}
const hasPort = mappedArgs.some(a => a === '-p' || a === '--port');
if (!hasPort) {
  mappedArgs.push('-p', '3000');
}

const child = spawn('npx', ['next', 'dev', ...mappedArgs], {
  stdio: 'inherit',
  shell: true
});
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
