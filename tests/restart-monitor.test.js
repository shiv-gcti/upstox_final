const { spawn } = require('child_process');
const assert = require('assert');

const port = 4500;
const env = {
  ...process.env,
  PORT: String(port),
  RESTART_CHILD_COMMAND: `node -e "console.log('child started'); setTimeout(() => process.exit(1), 250);"`,
  RESTART_DELAY_MS: '200',
  MAX_RESTARTS: '3'
};

const monitor = spawn(process.execPath, ['serverMonitor.js'], {
  cwd: __dirname + '/..',
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
monitor.stdout.on('data', (chunk) => { output += chunk.toString(); });
monitor.stderr.on('data', (chunk) => { output += chunk.toString(); });

setTimeout(() => {
  monitor.kill('SIGTERM');
  setTimeout(() => {
    try {
      assert(output.includes('child started'), 'expected child to start at least once');
      assert(output.includes('restarting'), 'expected restart message');
      console.log('restart monitor test passed');
      process.exit(0);
    } catch (err) {
      console.error(output);
      console.error(err.stack || err.message);
      process.exit(1);
    }
  }, 800);
}, 1500);
