const { spawn, exec } = require('child_process');
const net = require('net');

const defaultCommand = 'node server.js';
const command = process.env.RESTART_CHILD_COMMAND || defaultCommand;
const restartDelayMs = Number(process.env.RESTART_DELAY_MS || 2000);
const maxRestarts = Number(process.env.MAX_RESTARTS || 10);
const port = Number(process.env.PORT || 3000);

let child = null;
let restartCount = 0;
let shuttingDown = false;

function isPortBusy(portNumber) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => resolve(err && err.code === 'EADDRINUSE'));
    tester.once('listening', () => {
      tester.once('close', () => resolve(false));
      tester.close();
    });
    tester.listen(portNumber, '0.0.0.0');
  });
}

function freePortIfBusy(portNumber) {
  return new Promise(async (resolve) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const busy = await isPortBusy(portNumber);
      if (!busy) {
        resolve(true);
        return;
      }

      if (process.platform === 'win32') {
        const cmd = `
          $procIds = Get-NetTCPConnection -LocalPort ${portNumber} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique;
          foreach ($procId in $procIds) {
            if ($procId -and $procId -gt 0) {
              Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue;
            }
          }
        `;
        exec(`powershell -NoProfile -Command "${cmd.replace(/\r?\n/g, ' ')}"`, () => {});
      }

      await new Promise((next) => setTimeout(next, 500));
    }

    resolve(false);
  });
}

function parseCommand(commandLine) {
  const trimmed = commandLine.trim();
  if (!trimmed) return { command: 'node', args: ['server.js'] };

  const match = trimmed.match(/^"([^"]+)"\s+(.+)$|^'([^']+)'\s+(.+)$|^([^\s]+)(?:\s+(.+))?$/);
  if (!match) {
    return { command: 'node', args: ['server.js'] };
  }

  const fullCommand = match[1] || match[3] || match[5];
  const remainder = match[2] || match[4] || match[6] || '';
  const args = remainder ? remainder.match(/"[^"]+"|'[^']+'|\S+/g) || [] : [];
  return { command: fullCommand, args: args.map((value) => value.replace(/^['"]|['"]$/g, '')) };
}

async function startChild() {
  const { command: execPath, args } = parseCommand(command);

  const portCleared = await freePortIfBusy(port);
  if (!portCleared) {
    console.error(`❌ port ${port} remains busy. monitor will not loop forever.`);
    process.exit(1);
    return;
  }

  child = spawn(execPath, args, {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd()
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    const exitMessage = `⚠️ child exited (code=${code}, signal=${signal})`;
    restartCount += 1;
    console.log(`${exitMessage}. restarting in ${restartDelayMs}ms...`);

    if (restartCount <= maxRestarts) {
      setTimeout(() => startChild(), restartDelayMs);
      return;
    }

    console.error(`❌ maximum restarts reached (${maxRestarts}). stopping monitor.`);
    process.exit(1);
  });

  child.on('error', (err) => {
    console.error('❌ child process error:', err.message);
    if (!shuttingDown) {
      process.exit(1);
    }
  });
}

function stop() {
  shuttingDown = true;
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(`🟢 server monitor started for: ${command}`);
startChild();
