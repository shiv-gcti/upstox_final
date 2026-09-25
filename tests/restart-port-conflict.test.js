const { spawn } = require('child_process');
const assert = require('assert');

const port = 4100;
const monitor = spawn(process.execPath, ['serverMonitor.js'], {
  cwd: __dirname + '/..',
  env: {
    ...process.env,
    PORT: String(port),
    RESTART_CHILD_COMMAND: `node -e "require('net').createServer().listen(${port}, '127.0.0.1'); console.log('port busy child'); setTimeout(() => process.exit(1), 250);"`,
    RESTART_DELAY_MS: '50',
    MAX_RESTARTS: '3'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
monitor.stdout.on('data', (chunk) => { output += chunk.toString(); });
monitor.stderr.on('data', (chunk) => { output += chunk.toString(); });

setTimeout(() => {
  const ended = monitor.exitCode !== null || !monitor.killed;
  setTimeout(() => {
    try {
      assert(output.includes('port'), 'expected port-conflict handling message');
      console.log('restart port conflict test passed');
      process.exit(0);
    } catch (err) {
      console.error(output);
      console.error(err.stack || err.message);
      process.exit(1);
    }
  }, 500);
}, 800);
