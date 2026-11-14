import { handleRequest, publicError, readRequest } from './bridge.mjs';

const controller = new AbortController();
let signalExit;
const terminate = (signal) => {
  signalExit = signal === 'SIGINT' ? 130 : 143;
  controller.abort();
};
const onTerm = () => terminate('SIGTERM');
const onInt = () => terminate('SIGINT');
const onPipeError = () => controller.abort();
process.on('SIGTERM', onTerm);
process.on('SIGINT', onInt);
process.stdout.on('error', onPipeError);

function emit(event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Output unavailable.'));
    }, 15000);
    process.stdout.write(`${JSON.stringify(event)}\n`, (error) => {
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    });
  });
}

async function main() {
  try {
    const request = await readRequest(process.stdin, { signal: controller.signal });
    process.exitCode = await handleRequest(request, { emit, signal: controller.signal });
  } catch (error) {
    process.exitCode = signalExit ?? 1;
    if (!process.stdout.destroyed) {
      try { await emit({ type: 'bridge_error', message: publicError(error) }); } catch { /* The host has closed the output pipe. */ }
    }
  } finally {
    if (signalExit) process.exitCode = signalExit;
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
    process.stdin.destroy();
  }
}

void main();
