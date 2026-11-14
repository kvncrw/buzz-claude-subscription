import { BridgeError, windowsHelper } from './native-platform.mjs';

// OS credential APIs only. No plaintext persistence or credential-bearing arguments.
export const SERVICE = 'kvncrw.buzz-claude-subscription';
export const ACCOUNT = 'oauth-token';

export const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BuzzCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags, Type;
    public string TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Write(ref Credential credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Delete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);
}
'@
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $target = [string]$request.service + '/' + [string]$request.account
  if ($request.action -eq 'lookup') {
    $pointer = [IntPtr]::Zero
    if (-not [BuzzCredential]::Read($target, 1, 0, [ref]$pointer)) {
      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 44 }
      exit 1
    }
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][BuzzCredential+Credential])
      if ($credential.CredentialBlobSize -gt 8192) { exit 1 }
      $bytes = New-Object byte[] $credential.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
      [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
      [Array]::Clear($bytes, 0, $bytes.Length)
    } finally { [BuzzCredential]::CredFree($pointer) }
  } elseif ($request.action -eq 'save') {
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.token)
    if ($bytes.Length -gt 2560) { exit 1 }
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
      $credential = New-Object BuzzCredential+Credential
      $credential.Type = 1
      $credential.TargetName = $target
      $credential.UserName = [string]$request.account
      $credential.Persist = 2
      $credential.CredentialBlobSize = $bytes.Length
      $credential.CredentialBlob = $pointer
      if (-not [BuzzCredential]::Write([ref]$credential, 0)) { exit 1 }
    } finally {
      [Array]::Clear($bytes, 0, $bytes.Length)
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
      [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
    }
  } elseif ($request.action -eq 'remove') {
    if (-not [BuzzCredential]::Delete($target, 1, 0)) {
      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { exit 1 }
    }
  } else { exit 1 }
  exit 0
} catch { [Console]::Error.Write('Windows Credential Manager operation failed.'); exit 1 }
`;

export function powershellArguments(script) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

export function credentialCommand(platform, action, token, { service = SERVICE, account = ACCOUNT, env = process.env } = {}) {
  if (!['linux', 'darwin', 'win32'].includes(platform)) throw new BridgeError('Unsupported credential platform. Supported platforms are Linux/WSL, macOS, and Windows.');
  if (![service, account].every((value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))) throw new BridgeError('Invalid credential namespace.');
  const attributes = ['application', service, 'account', account];
  if (!['lookup', 'save', 'remove'].includes(action)) throw new BridgeError('Invalid credential operation.');
  // This validation also makes the macOS interactive command unambiguous.
  if (action === 'save' && (typeof token !== 'string' || token.length > 8192 || !/^sk-ant-oat\d{2}-[A-Za-z0-9_-]{16,}$/.test(token))) throw new BridgeError('Enter a valid long-lived Claude OAuth token beginning sk-ant-oat, without whitespace.');
  if (platform === 'win32') {
    if (action === 'save' && Buffer.byteLength(token) > 2560) throw new BridgeError('Token exceeds the Windows Credential Manager size limit.');
    return { binary: windowsHelper('powershell', env), args: powershellArguments(WINDOWS_CREDENTIAL_SCRIPT), input: JSON.stringify({ action, service, account, ...(action === 'save' ? { token } : {}) }), missing: 44 };
  }
  if (platform === 'darwin') {
    if (action === 'save') {
      const input = `add-generic-password -U -a ${account} -s ${service} -l "Buzz Claude subscription OAuth token" -w ${token}\n`;
      // security -i exits on EOF, not "quit"; its input buffer is 4096 bytes.
      if (Buffer.byteLength(input) >= 4096) throw new BridgeError('Token exceeds the macOS Keychain helper input limit.');
      return { binary: '/usr/bin/security', args: ['-i'], input, missing: 44 };
    }
    return { binary: '/usr/bin/security', args: [action === 'lookup' ? 'find-generic-password' : 'delete-generic-password', '-a', account, '-s', service, ...(action === 'lookup' ? ['-w'] : [])], input: '', missing: 44 };
  }
  return {
    binary: 'secret-tool',
    args: action === 'save' ? ['store', '--label=Buzz Claude subscription OAuth token', ...attributes] : [action === 'lookup' ? 'lookup' : 'clear', ...attributes],
    input: action === 'save' ? token : '', missing: 1,
  };
}
