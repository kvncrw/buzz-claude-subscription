import { win32 } from 'node:path';

// Only deliberate, credential-free diagnostics cross the bridge boundary.
export class BridgeError extends Error {}

export function windowsHelper(name, env = process.env) {
  const root = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1];
  if (typeof root !== 'string' || !/^[A-Za-z]:[\\/]/.test(root) || /[\x00-\x1f\x7f]/.test(root) || root.split(/[\\/]/).includes('..')) {
    throw new BridgeError('Windows SystemRoot is unavailable or invalid. Restart Buzz from your normal Windows desktop environment.');
  }
  const helpers = { powershell: ['WindowsPowerShell', 'v1.0', 'powershell.exe'], icacls: ['icacls.exe'] };
  if (!Object.hasOwn(helpers, name)) throw new BridgeError('Unsupported Windows system helper.');
  return win32.join(root, 'System32', ...helpers[name]);
}
