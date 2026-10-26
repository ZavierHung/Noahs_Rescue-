import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit', env: { ...process.env, ...(process.argv.includes('--mock') ? { GAME_LLM_MODE: 'mock' } : {}) } }),
  spawn('npm', ['--prefix', 'app', 'run', 'dev'], { stdio: 'inherit' }),
];

function stop(signal) {
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const exits = children.map((child) => new Promise((resolve) => child.once('exit', resolve)));
await Promise.race(exits);
stop('SIGTERM');
