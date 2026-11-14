// embedded:native-bridge
var native_bridge_default = 'var R=require("node:child_process"),F=require("node:fs"),p=require("node:fs/promises"),x=require("node:os"),c=require("node:path"),H=require("node:string_decoder");var ee="kvncrw.buzz-claude-subscription",te="oauth-token",re=String.raw`\n$ErrorActionPreference = \'Stop\'\n[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\ntry {\n  Add-Type -TypeDefinition @\'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class BuzzCredential {\n  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]\n  public struct Credential {\n    public UInt32 Flags, Type;\n    public string TargetName, Comment;\n    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;\n    public UInt32 CredentialBlobSize;\n    public IntPtr CredentialBlob;\n    public UInt32 Persist, AttributeCount;\n    public IntPtr Attributes;\n    public string TargetAlias, UserName;\n  }\n  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);\n  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern bool Write(ref Credential credential, UInt32 flags);\n  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern bool Delete(string target, UInt32 type, UInt32 flags);\n  [DllImport("advapi32.dll")]\n  public static extern void CredFree(IntPtr credential);\n}\n\'@\n  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json\n  $target = [string]$request.service + \'/\' + [string]$request.account\n  if ($request.action -eq \'lookup\') {\n    $pointer = [IntPtr]::Zero\n    if (-not [BuzzCredential]::Read($target, 1, 0, [ref]$pointer)) {\n      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 44 }\n      exit 1\n    }\n    try {\n      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][BuzzCredential+Credential])\n      if ($credential.CredentialBlobSize -gt 8192) { exit 1 }\n      $bytes = New-Object byte[] $credential.CredentialBlobSize\n      [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)\n      [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))\n      [Array]::Clear($bytes, 0, $bytes.Length)\n    } finally { [BuzzCredential]::CredFree($pointer) }\n  } elseif ($request.action -eq \'save\') {\n    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.token)\n    if ($bytes.Length -gt 2560) { exit 1 }\n    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)\n    try {\n      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)\n      $credential = New-Object BuzzCredential+Credential\n      $credential.Type = 1\n      $credential.TargetName = $target\n      $credential.UserName = [string]$request.account\n      $credential.Persist = 2\n      $credential.CredentialBlobSize = $bytes.Length\n      $credential.CredentialBlob = $pointer\n      if (-not [BuzzCredential]::Write([ref]$credential, 0)) { exit 1 }\n    } finally {\n      [Array]::Clear($bytes, 0, $bytes.Length)\n      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)\n      [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)\n    }\n  } elseif ($request.action -eq \'remove\') {\n    if (-not [BuzzCredential]::Delete($target, 1, 0)) {\n      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { exit 1 }\n    }\n  } else { exit 1 }\n  exit 0\n} catch { [Console]::Error.Write(\'Windows Credential Manager operation failed.\'); exit 1 }\n`;function P(e){return["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(e,"utf16le").toString("base64")]}function M(e,r,t,{service:i=ee,account:n=te}={}){if(!["linux","darwin","win32"].includes(e))throw new Error("Unsupported credential platform. Supported platforms are Linux/WSL, macOS, and Windows.");if(![i,n].every(a=>typeof a=="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(a)))throw new Error("Invalid credential namespace.");let s=["application",i,"account",n];if(!["lookup","save","remove"].includes(r))throw new Error("Invalid credential operation.");if(r==="save"&&(typeof t!="string"||t.length>8192||!/^sk-ant-oat\\d{2}-[A-Za-z0-9_-]{16,}$/.test(t)))throw new Error("Invalid OAuth token.");if(e==="win32"){if(r==="save"&&Buffer.byteLength(t)>2560)throw new Error("Token exceeds the Windows Credential Manager size limit.");return{binary:"powershell.exe",args:P(re),input:JSON.stringify({action:r,service:i,account:n,...r==="save"?{token:t}:{}}),missing:44}}if(e==="darwin"){if(r==="save"){let a=`add-generic-password -U -a ${n} -s ${i} -l "Buzz Claude subscription OAuth token" -w ${t}\n`;if(Buffer.byteLength(a)>=4096)throw new Error("Token exceeds the macOS Keychain helper input limit.");return{binary:"/usr/bin/security",args:["-i"],input:a,missing:44}}return{binary:"/usr/bin/security",args:[r==="lookup"?"find-generic-password":"delete-generic-password","-a",n,"-s",i,...r==="lookup"?["-w"]:[]],input:"",missing:44}}return{binary:"secret-tool",args:r==="save"?["store","--label=Buzz Claude subscription OAuth token",...s]:[r==="lookup"?"lookup":"clear",...s],input:r==="save"?t:"",missing:1}}var g=Object.freeze({request:4*1024*1024,token:8192,line:4*1024*1024,output:128*1024*1024,secretTimeout:12e3}),ie=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,B=/^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[a-zA-Z0-9.-]+)?$/,S=class extends Error{},o=e=>{throw new S(e)};function j(e){return e instanceof S?e.message:"The bridge operation failed. Check Claude Code and your operating system credential store availability."}function I(e){return(typeof e!="string"||e.length>g.token||!/^sk-ant-oat\\d{2}-[A-Za-z0-9_-]{16,}$/.test(e))&&o("Enter a valid long-lived Claude OAuth token beginning sk-ant-oat, without whitespace."),e}function L(e,r=(0,x.homedir)()){return(typeof e!="string"||e.length===0||e.length>4096||/[\\x00-\\x1f\\x7f]/.test(e))&&o("Paths must be absolute paths or start with ~/."),e==="~"?r:e.startsWith("~/")||process.platform==="win32"&&e.startsWith("~\\\\")?(0,c.normalize)((0,c.join)(r,e.slice(2))):((0,c.isAbsolute)(e)||o("Paths must be absolute paths or start with ~/."),(0,c.normalize)(e))}function D(e=process.env,r){let t={};for(let[i,n]of Object.entries(e))/^(?:ANTHROPIC|CLAUDE|AWS|AMAZON|BEDROCK|GOOGLE|GCLOUD|GCP|VERTEX|AZURE|FOUNDRY|OPENAI|LITELLM|OTEL)(?:_|$)/i.test(i)||/^CLAUDECODE$/i.test(i)||/^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*)$/i.test(i)||n!==void 0&&(t[i]=n);return r!==void 0&&(t.CLAUDE_CODE_OAUTH_TOKEN=I(r)),t}function z(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}function v(e,r,t=!1){return typeof e=="string"&&Buffer.byteLength(e)<=r&&(!t||e.length>0)&&!e.includes("\\0")}function U(e){(!z(e)||!["status","save","remove","run"].includes(e.action))&&o("Invalid bridge request.");let r=e.action==="run"?["action","binary","model","prompt","systemPrompt","sessionId","resume","mcp","permissionMode","cwd"]:e.action==="save"?["action","token","binary"]:["action","binary"];if(Object.keys(e).some(n=>!r.includes(n))&&o("Unexpected bridge request field."),e.binary!==void 0&&e.binary!==""&&e.binary!=="claude"&&L(e.binary),e.binary!==void 0&&typeof e.binary!="string"&&o("Invalid Claude executable path."),e.action==="save"&&I(e.token),e.action!=="run")return e;(!v(e.prompt,2*1024*1024,!0)||!v(e.systemPrompt,1024*1024))&&o("Invalid or oversized prompt."),(!ie.test(e.sessionId??"")||typeof e.sessionId!="string"||typeof e.resume!="boolean")&&o("A valid session UUID and explicit resume flag are required."),["default","acceptEdits"].includes(e.permissionMode)||o("Only default and acceptEdits permission modes are supported."),e.model!==void 0&&(typeof e.model!="string"||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(e.model))&&o("Invalid Claude model."),L(e.cwd),(!z(e.mcp)||Object.keys(e.mcp).some(n=>!["url","headers"].includes(n)))&&o("Invalid Buzz MCP configuration.");let t;try{t=new URL(e.mcp.url)}catch{o("Invalid Buzz MCP URL.")}(!v(e.mcp.url,8192,!0)||!["http:","https:"].includes(t.protocol)||!["127.0.0.1","localhost","[::1]"].includes(t.hostname)||t.username||t.password||t.hash)&&o("Buzz MCP must use a loopback HTTP endpoint without URL credentials."),(!Array.isArray(e.mcp.headers)||e.mcp.headers.length>32)&&o("Invalid Buzz MCP headers.");let i=new Set;for(let n of e.mcp.headers){(!z(n)||Object.keys(n).some(a=>!["name","value"].includes(a))||!v(n.name,128,!0)||!/^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$/.test(n.name)||!v(n.value,16384)||/[\\x00-\\x1f\\x7f]/.test(n.value))&&o("Invalid Buzz MCP header.");let s=n.name.toLowerCase();(i.has(s)||["host","content-length","transfer-encoding","connection"].includes(s))&&o("Invalid or duplicate Buzz MCP header."),i.add(s)}return e}async function Z(e,{signal:r,timeout:t=15e3}={}){let i=0,n=[],s=()=>e.destroy(new S("Bridge request cancelled.")),a=setTimeout(()=>e.destroy(new S("Timed out waiting for a complete bridge request.")),t);r?.addEventListener("abort",s,{once:!0});try{r?.aborted&&o("Bridge request cancelled.");for await(let d of e){let l=Buffer.isBuffer(d)?d:Buffer.from(d);i+=l.length,i>g.request&&o("Bridge request exceeds the size limit."),n.push(l)}let u;try{u=JSON.parse(Buffer.concat(n,i).toString("utf8"))}catch{o("Bridge input must contain exactly one JSON request.")}return U(u)}finally{clearTimeout(a),r?.removeEventListener("abort",s)}}function K(e,r){let t,i=()=>{e.exitCode!==null||e.signalCode!==null||(e.kill("SIGTERM"),t??=setTimeout(()=>e.kill("SIGKILL"),1500))},n=new Promise(s=>{e.once("error",()=>s({code:null,failed:!0})),e.once("close",a=>s({code:a,failed:!1}))});return r?.addEventListener("abort",i,{once:!0}),r?.aborted&&i(),{stop:i,closed:n,dispose(){clearTimeout(t),r?.removeEventListener("abort",i)}}}async function $(e,r,{input:t="",env:i=D(),timeout:n=g.secretTimeout,limit:s=16384,signal:a}={}){a?.aborted&&o("Bridge operation cancelled.");let u=(0,R.spawn)(e,r,{env:i,stdio:["pipe","pipe","pipe"],windowsHide:!0}),d=K(u,a),l=[],m=0,f=0,h=!1,b=!1;u.stdout.on("data",w=>{m+=w.length,m>s?(h=!0,d.stop()):l.push(w)}),u.stderr.on("data",w=>{f+=w.length,f>s&&(h=!0,d.stop())}),u.stdin.on("error",()=>{}),u.stdin.end(t);let A=setTimeout(()=>{b=!0,d.stop()},n);try{let w=await d.closed;return a?.aborted&&o("Bridge operation cancelled."),b&&o("Credential or CLI operation timed out. Unlock your desktop keyring and confirm Claude Code is installed, then retry."),h&&o("Credential or CLI response exceeded the size limit."),w.failed&&o("Unable to launch a required executable. Check Claude Code and your OS credential helper (secret-tool on Linux, security on macOS, PowerShell on Windows)."),{code:w.code,output:Buffer.concat(l).toString("utf8"),hasStderr:f>0}}finally{clearTimeout(A),d.dispose()}}async function O(e,{token:r,signal:t,platform:i=process.platform,service:n,account:s}={}){e==="save"&&I(r);let a=M(i,e,r,{service:n,account:s}),u=await $(a.binary,a.args,{input:a.input,signal:t,limit:g.token+1024,timeout:i==="win32"?2e4:g.secretTimeout});return u.code===a.missing&&(i==="darwin"||i==="win32"||!u.hasStderr&&u.output==="")&&e!=="save"?null:(u.code!==0&&o("Cannot access the OS credential store. Unlock your keyring or Keychain, or check Windows Credential Manager. Linux and WSL require a desktop Secret Service and secret-tool."),e==="lookup"?u.output.replace(/\\r?\\n$/,"")||null:(e==="save"&&i==="darwin"&&await O("lookup",{signal:t,platform:i,service:n,account:s})!==r&&o("Keychain did not save the token. Unlock your login Keychain and approve credential access, then retry."),null))}async function W(e={}){let r=await O("lookup",e);if(r===null)return null;try{return I(r)}catch{o("The stored OAuth token is invalid. Replace it in the harness settings.")}}async function ne(e,r={}){await O("save",{...r,token:e})}async function oe(e={}){await O("remove",e)}async function ae(e,r){let t=await(0,p.open)(e,"r");try{if(!(await t.stat()).isFile())return null;let i=Buffer.alloc(r+1),{bytesRead:n}=await t.read(i,0,i.length,0);return n<=r?i.subarray(0,n).toString("utf8"):null}finally{await t.close()}}async function G(e,{env:r=process.env,home:t=(0,x.homedir)(),signal:i}={}){let n=e!==void 0&&e!==""&&e!=="claude",s=[];if(n)s.push(L(e,t));else{let a=process.platform==="win32"?"claude.exe":"claude",u=Object.entries(r).find(([l])=>l.toUpperCase()==="PATH")?.[1]??"";for(let l of u.split(c.delimiter))(0,c.isAbsolute)(l)&&s.push((0,c.join)(l,a));s.push((0,c.join)(t,".local","bin",a),(0,c.join)(t,".claude","local",a));let d=process.platform==="darwin"?[(0,c.join)(t,"Library","Application Support","Buzz","claude-code"),(0,c.join)(t,"Library","Application Support","buzz","claude-code")]:process.platform==="win32"?[(0,c.join)(r.LOCALAPPDATA||(0,c.join)(t,"AppData","Local"),"Buzz","claude-code"),(0,c.join)(r.APPDATA||(0,c.join)(t,"AppData","Roaming"),"Buzz","claude-code")]:[(0,c.join)(r.XDG_DATA_HOME&&(0,c.isAbsolute)(r.XDG_DATA_HOME)?r.XDG_DATA_HOME:(0,c.join)(t,".local","share"),"buzz","claude-code")];if(process.platform==="win32"){let l=r.LOCALAPPDATA||(0,c.join)(t,"AppData","Local");s.push((0,c.join)(l,"Microsoft","WinGet","Links",a));try{let m=(0,c.join)(l,"Microsoft","WinGet","Packages"),f=(await(0,p.readdir)(m,{withFileTypes:!0})).filter(h=>h.isDirectory()&&/^Anthropic\\.ClaudeCode_/.test(h.name)).slice(0,16);for(let h of f)s.push((0,c.join)(m,h.name,a))}catch{}}for(let l of d){try{let m=(await ae((0,c.join)(l,"current"),128))?.trim();m&&B.test(m)&&s.push((0,c.join)(l,m,a))}catch{}try{let m=(await(0,p.readdir)(l,{withFileTypes:!0})).filter(f=>f.isDirectory()&&B.test(f.name)).map(f=>f.name);m.sort((f,h)=>h.localeCompare(f,"en",{numeric:!0}));for(let f of m.slice(0,32))s.push((0,c.join)(l,f,a))}catch{}}}for(let a of new Set(s)){i?.aborted&&o("Bridge operation cancelled.");try{if(await(0,p.access)(a,F.constants.X_OK),!(await(0,p.stat)(a)).isFile())continue;let u=await(0,p.realpath)(a),d=await $(u,["--version"],{env:D(r),signal:i,timeout:8e3,limit:4096}),l=d.output.trim().match(/^(\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?)(?:\\s+\\(Claude Code\\))?$/);if(d.code===0&&l&&B.test(l[1]))return{binary:u,version:l[1]}}catch{i?.aborted&&o("Bridge operation cancelled.")}}return n&&o("The configured Claude executable is unavailable or did not report a valid version."),null}async function se(e,{root:r=(0,x.tmpdir)(),signal:t}={}){let i=await(0,p.mkdtemp)((0,c.join)(r,"buzz-claude-subscription-"));try{if(process.platform==="win32"){let u=await $("powershell.exe",P("[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"),{limit:4096,signal:t}),d=u.output.trim();(u.code!==0||!/^S-1-\\d+(?:-\\d+)+$/.test(d))&&o("Cannot determine the Windows account for private temporary files."),(await $("icacls.exe",[i,"/inheritance:r","/grant:r",`*${d}:(OI)(CI)F`,"/q"],{limit:4096,signal:t})).code!==0&&o("Cannot secure private temporary files with Windows ACLs.")}else await(0,p.chmod)(i,448);t?.aborted&&o("Claude run cancelled.");let n=(0,c.join)(i,"system.txt"),s=(0,c.join)(i,"mcp.json"),a=Object.fromEntries(e.mcp.headers.map(({name:u,value:d})=>[u,d]));return await(0,p.writeFile)(n,e.systemPrompt,{mode:384,flag:"wx"}),await(0,p.writeFile)(s,JSON.stringify({mcpServers:{buzz:{type:"http",url:e.mcp.url,headers:a}}}),{mode:384,flag:"wx"}),{directory:i,system:n,mcp:s,cleanup:()=>(0,p.rm)(i,{recursive:!0,force:!0})}}catch(n){throw await(0,p.rm)(i,{recursive:!0,force:!0}),n}}function ce(e,r){let t=["-p","--output-format","stream-json","--verbose","--include-partial-messages","--setting-sources","","--strict-mcp-config","--mcp-config",r.mcp,"--append-system-prompt-file",r.system,"--permission-prompts","none","--allowedTools","mcp__buzz__*"];return t.push("--permission-mode",e.permissionMode==="acceptEdits"?"acceptEdits":"manual"),e.model&&t.push("--model",e.model),t.push(e.resume?"--resume":"--session-id",e.sessionId),t}async function le(e,{binary:r,token:t,emit:i,signal:n,tempRoot:s}={}){U(e),I(t);let a=L(e.cwd);try{(await(0,p.stat)(a)).isDirectory()||o("The requested working directory does not exist.")}catch{o("The requested working directory does not exist or is inaccessible.")}n?.aborted&&o("Claude run cancelled.");let u=await se(e,{root:s,signal:n}),d;try{n?.aborted&&o("Claude run cancelled.");let l=(0,R.spawn)(r,ce(e,u),{cwd:a,env:D(process.env,t),stdio:["pipe","pipe","pipe"],windowsHide:!0});d=K(l,n);let m=0,f=!1;l.stderr.on("data",y=>{m+=y.length,m>1024*1024&&(f=!0,d.stop())}),l.stdin.on("error",()=>{}),l.stdin.end(e.prompt);let h=new H.StringDecoder("utf8"),b="",A=0,w=!1,q=[t,...e.mcp.headers.map(({value:y})=>y).filter(y=>y.length>=8)],_=async y=>{if(y.trim()==="")return;Buffer.byteLength(y)>g.line&&o("Claude output exceeded the event size limit."),q.some(E=>y.includes(E)||y.includes(JSON.stringify(E).slice(1,-1)))&&o("Sensitive credential material in Claude output was withheld.");let C;try{C=JSON.parse(y)}catch{o("Claude returned invalid stream output. Confirm the installed CLI supports stream-json.")}(!z(C)||typeof C.type!="string")&&o("Claude returned an invalid stream event."),C.type==="result"&&(w=!0),await i(C)};for await(let y of l.stdout){A+=y.length,A>g.output&&o("Claude output exceeded the run size limit."),b+=h.write(y);let C;for(;(C=b.indexOf(`\n`))>=0;){let E=b.slice(0,C);b=b.slice(C+1),await _(E)}Buffer.byteLength(b)>g.line&&o("Claude output exceeded the event size limit.")}b+=h.end(),b&&await _(b);let N=await d.closed;n?.aborted&&o("Claude run cancelled."),f&&o("Claude diagnostic output exceeded the size limit."),N.failed&&o("Unable to start the Claude executable."),N.code!==0&&o("Claude exited unsuccessfully. Check the result event, OAuth subscription, and CLI compatibility."),w||o("Claude exited without a final result event.")}finally{d&&(d.stop(),await d.closed,d.dispose()),await u.cleanup()}}async function X(e,{emit:r,signal:t}={}){if(U(e),e.action==="save")await ne(e.token,{signal:t}),await r({type:"bridge_saved",tokenStored:!0});else if(e.action==="remove")await oe({signal:t}),await r({type:"bridge_saved",tokenStored:!1});else if(e.action==="status"){let i=await W({signal:t}),n=await G(e.binary,{signal:t});await r({type:"bridge_status",tokenStored:i!==null,binary:n?.binary??null,version:n?.version??null})}else{let i=await W({signal:t});i||o("No OAuth token is stored. Save a Claude subscription token in the harness settings first.");let n=await G(e.binary,{signal:t});n||o("Claude Code was not found. Install Claude Code or configure its absolute executable path."),await le(e,{binary:n.binary,token:i,emit:r,signal:t})}}var T=new AbortController,k,V=e=>{k=e==="SIGINT"?130:143,T.abort()},Y=()=>V("SIGTERM"),Q=()=>V("SIGINT"),de=()=>T.abort();process.on("SIGTERM",Y);process.on("SIGINT",Q);process.stdout.on("error",de);function J(e){return new Promise((r,t)=>{let i=setTimeout(()=>{T.abort(),t(new Error("Output unavailable."))},15e3);process.stdout.write(`${JSON.stringify(e)}\n`,n=>{clearTimeout(i),n?t(n):r()})})}async function ue(){try{let e=await Z(process.stdin,{signal:T.signal});await X(e,{emit:J,signal:T.signal})}catch(e){if(process.exitCode=k??1,!process.stdout.destroyed)try{await J({type:"bridge_error",message:j(e)})}catch{}}finally{k&&(process.exitCode=k),process.removeListener("SIGTERM",Y),process.removeListener("SIGINT",Q),process.stdin.destroy()}}ue();\n';

// src/session.mjs
function sessionKey(agent, conversation) {
  return JSON.stringify([agent.key, agent.relay, conversation.key]);
}
function abortError() {
  return new DOMException("Claude turn stopped.", "AbortError");
}
function safeMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1500);
}
var JsonLines = class {
  constructor(accept, maxLine = 8 * 1024 * 1024) {
    this.accept = accept;
    this.maxLine = maxLine;
    this.buffer = "";
    this.error = void 0;
  }
  push(chunk) {
    if (this.error) return;
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
      if (this.error) return;
    }
    if (this.buffer.length > this.maxLine) this.error = new Error("Claude output exceeded the protocol line limit.");
  }
  line(line) {
    if (!line.trim()) return;
    if (line.length > this.maxLine) {
      this.error = new Error("Claude output exceeded the protocol line limit.");
      return;
    }
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      this.accept(value);
    } catch {
      this.error = new Error("Claude returned invalid stream JSON. Update Claude Code and try again.");
    }
  }
  finish() {
    if (!this.error && this.buffer.trim()) this.line(this.buffer);
    this.buffer = "";
    if (this.error) throw this.error;
  }
};
var TurnOutput = class {
  constructor(step = () => {
  }) {
    this.step = step;
    this.result = void 0;
    this.failure = void 0;
    this.lastText = "";
  }
  accept(event) {
    if (event.type === "bridge_error") this.failure = new Error(safeMessage(event.message || "Claude bridge failed."));
    if (event.type === "assistant") {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        const text = content.filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
        if (text) this.lastText = text;
        for (const block of content) if (block.type === "tool_use") this.step(block.name || "Tool");
      }
    }
    if (event.type === "stream_event" && event.event?.type === "content_block_start") {
      const block = event.event.content_block;
      if (block?.type === "tool_use") this.step(block.name || "Tool");
    }
    if (event.type === "result") {
      if (this.result) this.failure = new Error("Claude returned multiple terminal results.");
      this.result = event;
    }
  }
  finish(code, cancelled = false) {
    if (cancelled) throw abortError();
    if (this.failure) throw this.failure;
    if (!this.result) throw new Error(`Claude exited without a result (${code ?? "signal"}). Check the subscription token and Claude installation in Settings.`);
    const denied = Array.isArray(this.result.permission_denials) ? this.result.permission_denials : [];
    const denials = [...new Set(denied.map((item) => typeof item.tool_name === "string" ? item.tool_name : "a tool"))];
    if (this.result.is_error || code !== 0) {
      const permissions = denials.length ? ` Permission denied: ${denials.join(", ")}. This harness cannot answer interactive approvals.` : "";
      throw new Error(`Claude could not complete this turn (${this.result.subtype || "process error"}). Check subscription access, usage limits and the selected model; then try again.${permissions}`);
    }
    return {
      sessionId: this.result.session_id,
      text: typeof this.result.result === "string" ? this.result.result : this.lastText,
      denials
    };
  }
};
var SessionLanes = class {
  constructor() {
    this.lanes = /* @__PURE__ */ new Map();
  }
  run(key, signal, action) {
    const prior = this.lanes.get(key) || Promise.resolve();
    const result = prior.catch(() => {
    }).then(() => {
      if (signal.aborted) throw abortError();
      return action();
    });
    const settled = result.then(() => {
    }, () => {
    });
    this.lanes.set(key, settled);
    void settled.then(() => {
      if (this.lanes.get(key) === settled) this.lanes.delete(key);
    });
    return result;
  }
};
async function bridgeRequest(host, source, request, { signal, onEvent = () => {
}, onSent = () => {
} } = {}) {
  if (!host.spawn) throw new Error("Buzz desktop process access is unavailable. Install this plugin in Buzz desktop with the Node process grant.");
  signal?.throwIfAborted();
  let process;
  let failure;
  let stopped = false;
  const parser = new JsonLines((event) => {
    if (event.type === "bridge_error") failure = new Error(safeMessage(event.message));
    onEvent(event);
  });
  const stop = () => {
    stopped = true;
    if (process) void process.kill().catch(() => {
    });
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    try {
      process = await host.spawn("bridge", {
        args: ["-e", source],
        onStdout: (chunk) => {
          parser.push(chunk);
          if (parser.error) {
            failure = parser.error;
            stop();
          }
        },
        // Never render unstructured stderr; it can contain credentials.
        onStderr: () => {
        }
      });
    } catch {
      throw new Error("Cannot start the Node bridge. Install Node.js 20 or newer on the same system as Buzz and make node available on the desktop application PATH; restart Buzz. Also check the plugin process grant.");
    }
    if (stopped || signal?.aborted) {
      await process.kill().catch(() => {
      });
      throw abortError();
    }
    for (const chunk of jsonChunks(JSON.stringify(request))) {
      signal?.throwIfAborted();
      await process.write(chunk);
    }
    if (request.action === "save") delete request.token;
    await process.end();
    onSent();
    const code = await process.exited;
    if (signal?.aborted) throw abortError();
    parser.finish();
    if (failure) throw failure;
    return code;
  } finally {
    if (request.action === "save") delete request.token;
    signal?.removeEventListener("abort", stop);
    if (process) await process.kill().catch(() => {
    });
  }
}
var PREFIX = "kvncrw.buzz-claude-subscription/session/v1/";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var SessionStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  async get(key, fingerprint) {
    const raw = await this.storage.read(PREFIX + key);
    if (!raw) return void 0;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      await this.remove(key);
      return void 0;
    }
    if (!UUID.test(value?.id || "") || typeof value.cursor !== "string" || value.fingerprint !== fingerprint || value.inFlight) {
      await this.remove(key);
      return void 0;
    }
    return value;
  }
  put(key, value) {
    return this.storage.set(PREFIX + key, JSON.stringify(value));
  }
  remove(key) {
    return this.storage.set(PREFIX + key, null);
  }
  async clear(agentKey) {
    const entries = await this.storage.scan(PREFIX);
    for (const storedKey of Object.keys(entries)) {
      let identity;
      try {
        identity = JSON.parse(storedKey.slice(PREFIX.length));
      } catch {
        continue;
      }
      if (identity[0] === agentKey) await this.storage.set(storedKey, null);
    }
  }
};
function finalReply(text, postedTexts, finalPosted) {
  if (typeof text !== "string" || !text.trim() || finalPosted) return void 0;
  return postedTexts.has(text.trim()) ? void 0 : text;
}
function* jsonChunks(json) {
  for (let start = 0; start < json.length; ) {
    let end = Math.min(start + 32 * 1024, json.length);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 55296 && last <= 56319) end--;
    yield json.slice(start, end);
    start = end;
  }
}

// src/plugin.jsx
var inject = ["react", "agents", "settingsCards", "host"];
function apply(ctx) {
  const React = ctx.react;
  const kit = ctx.agents.harness;
  if (!kit || !ctx.agents.storage) throw new Error("Claude subscription requires Buzz 1.0.2 with the external harness kit and agent storage.");
  const store = new SessionStore(ctx.agents.storage);
  const lanes = new SessionLanes();
  const active = /* @__PURE__ */ new Set();
  const listeners = /* @__PURE__ */ new Set();
  let disposed = false;
  let connection = { readiness: "checking", attentionDescription: "Checking local Claude subscription setup\u2026" };
  let status;
  let statusError = "";
  let checking;
  let credentialBusy = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const defaults = () => ({ model: "sonnet", cwd: "~/.buzz/claude-subscription-workspace", permissionMode: "default", instructions: "", scope: "thread", binary: "" });
  const configOf = (config) => ({ ...defaults(), ...config });
  function Form({ children }) {
    return /* @__PURE__ */ React.createElement("div", { className: "kvncrw-claude", style: { display: "grid", gap: 16, minWidth: 0 } }, /* @__PURE__ */ React.createElement("style", null, `
        .kvncrw-claude :is(input,textarea,select) { display:block; box-sizing:border-box; width:100%; min-width:0; margin-top:6px; padding:9px 11px; border:1px solid color-mix(in srgb,currentColor 25%,transparent); border-radius:9px; background:color-mix(in srgb,currentColor 5%,transparent); color:inherit; font:inherit; }
        .kvncrw-claude button { padding:8px 12px; border:1px solid color-mix(in srgb,currentColor 25%,transparent); border-radius:9px; background:color-mix(in srgb,currentColor 8%,transparent); color:inherit; cursor:pointer; }
        .kvncrw-claude :disabled { opacity:.5; cursor:not-allowed; }
        .kvncrw-claude :is(input,textarea,select,button,summary):focus-visible { outline:2px solid currentColor; outline-offset:2px; }
        .kvncrw-claude p { font-size:13px; line-height:1.5; }
        .kvncrw-claude :is(dd,p) { overflow-wrap:anywhere; }
        .kvncrw-claude dt { margin-top:8px; font-weight:600; }
        .kvncrw-claude summary { cursor:pointer; padding:8px 0; font-weight:600; }
      `), children);
  }
  async function inspect(binary = "", signal) {
    let answer;
    const code = await bridgeRequest(ctx.host, native_bridge_default, { action: "status", ...binary ? { binary } : {} }, {
      signal,
      onEvent: (event) => {
        if (event.type === "bridge_status") answer = event;
      }
    });
    if (code !== 0 || !answer) throw new Error("The subscription bridge did not return installation status. Check Node.js 20+, the OS credential store and Claude Code.");
    return answer;
  }
  function check() {
    if (checking) return checking;
    const controller = new AbortController();
    const operation = { controller };
    active.add(operation);
    connection = { readiness: "checking", attentionDescription: "Checking local setup\u2026" };
    notify();
    checking = inspect("", controller.signal).then((value) => {
      status = value;
      statusError = "";
      connection = { readiness: value.tokenStored && value.binary && value.version ? "ready" : "attention", attentionLabel: "Set up subscription", attentionDescription: !value.tokenStored ? "Save your Claude subscription token." : !value.binary || !value.version ? "Install Claude Code or select its binary in the agent settings." : `Claude ${value.version}; subscription token configured (not remotely validated).` };
    }, (error) => {
      status = void 0;
      statusError = safeMessage(error);
      connection = { readiness: "attention", attentionLabel: "Fix subscription setup", attentionDescription: statusError };
    }).finally(() => {
      active.delete(operation);
      checking = void 0;
      if (!disposed) notify();
    });
    return checking;
  }
  function Connection({ active: isActive = () => true }) {
    React.useSyncExternalStore(subscribe, () => connection);
    const [token, setToken] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState("");
    const [confirmRemove, setConfirmRemove] = React.useState(false);
    const controller = React.useRef();
    React.useEffect(() => {
      void check();
      return () => controller.current?.abort();
    }, []);
    async function change(action) {
      if (!isActive() || busy || credentialBusy) return;
      const request = { action, ...action === "save" ? { token: token.trim() } : {} };
      setToken("");
      setConfirmRemove(false);
      setMessage("");
      setBusy(true);
      credentialBusy = true;
      connection = { ...connection, blocking: true };
      notify();
      const cancel = new AbortController();
      controller.current = cancel;
      const operation = { controller: cancel };
      active.add(operation);
      try {
        let saved;
        const code = await bridgeRequest(ctx.host, native_bridge_default, request, { signal: cancel.signal, onEvent: (event) => {
          if (event.type === "bridge_saved") saved = event;
        } });
        if (code !== 0 || !saved) throw new Error("The credential store did not confirm this change. Check status before trying again.");
        setMessage(saved.tokenStored ? "Token saved in the operating system credential store." : "Stored token removed. Already running turns may still finish.");
        await check();
      } catch (error) {
        setMessage(cancel.signal.aborted ? "Operation cancelled. Check status to determine whether the credential change completed." : safeMessage(error));
      } finally {
        active.delete(operation);
        controller.current = void 0;
        setBusy(false);
        credentialBusy = false;
        connection = { ...connection, blocking: false };
        if (!disposed) notify();
      }
    }
    return /* @__PURE__ */ React.createElement(Form, null, /* @__PURE__ */ React.createElement("section", { className: "ui-card", style: { padding: 16, display: "grid", gap: 12 } }, /* @__PURE__ */ React.createElement("h2", null, "Claude Code (subscription)"), /* @__PURE__ */ React.createElement("p", null, "Uses your Claude subscription, not an Anthropic API key or Buzz's built-in Claude sign-in."), /* @__PURE__ */ React.createElement("dl", null, /* @__PURE__ */ React.createElement("dt", null, "Claude binary"), /* @__PURE__ */ React.createElement("dd", null, status?.binary || "Not detected"), /* @__PURE__ */ React.createElement("dt", null, "Version"), /* @__PURE__ */ React.createElement("dd", null, status?.version || "Not detected"), /* @__PURE__ */ React.createElement("dt", null, "Subscription token"), /* @__PURE__ */ React.createElement("dd", null, status ? status.tokenStored ? "Configured; validity checked when a turn runs" : "Not configured" : "Unknown")), /* @__PURE__ */ React.createElement("p", { role: statusError ? "alert" : "status" }, statusError || connection.attentionDescription), /* @__PURE__ */ React.createElement("p", null, "Install Node.js 20+ and Claude Code on the same system as Buzz, then restart Buzz so its desktop PATH includes node. Linux and WSL require secret-tool and an unlocked Secret Service session; macOS uses Keychain; Windows uses the bridge's Windows credential store. WSL and Windows installations keep separate credentials."), /* @__PURE__ */ React.createElement("label", null, "Subscription token", /* @__PURE__ */ React.createElement("input", { type: "password", autoComplete: "off", spellCheck: false, value: token, disabled: busy, onChange: (event) => setToken(event.target.value), style: { display: "block", width: "100%" } })), /* @__PURE__ */ React.createElement("p", null, "Paste only here, never in chat. The field clears on Save, even if saving fails. The token is passed through private process stdin and never saved in agent settings, browser storage or command arguments."), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("button", { disabled: busy || !token.trim(), onClick: () => void change("save") }, status?.tokenStored ? "Replace token" : "Save token"), " ", /* @__PURE__ */ React.createElement("button", { disabled: busy || connection.readiness === "checking", onClick: () => void check() }, "Check status"), " ", /* @__PURE__ */ React.createElement("button", { disabled: busy || !status?.tokenStored, onClick: () => setConfirmRemove(true) }, "Remove token\u2026"), " ", busy && /* @__PURE__ */ React.createElement("button", { onClick: () => controller.current?.abort() }, "Cancel")), confirmRemove && /* @__PURE__ */ React.createElement("div", { role: "alert" }, /* @__PURE__ */ React.createElement("p", null, "Remove the saved subscription token from this device? Future turns will not run until you save another token."), /* @__PURE__ */ React.createElement("button", { onClick: () => void change("remove") }, "Confirm removal"), " ", /* @__PURE__ */ React.createElement("button", { onClick: () => setConfirmRemove(false) }, "Keep token")), message && /* @__PURE__ */ React.createElement("p", { role: "status" }, message), /* @__PURE__ */ React.createElement("p", null, "Claude's standard tool permissions are not an OS sandbox. This trusted plugin, Claude and approved tools can access this account's files and network. No Buzz protection capability or permission bypass is enabled.")));
  }
  function Fields({ config, onChange, disabled }) {
    const value = configOf(config);
    const field = (name, next) => onChange({ ...value, [name]: next });
    return /* @__PURE__ */ React.createElement(Form, null, /* @__PURE__ */ React.createElement("fieldset", { disabled, style: { display: "grid", gap: 16 } }, /* @__PURE__ */ React.createElement("label", null, "Model alias or ID", /* @__PURE__ */ React.createElement("input", { value: value.model, placeholder: "sonnet, opus, haiku, or a full Claude model ID", onChange: (event) => field("model", event.target.value), style: { display: "block", width: "100%" } })), /* @__PURE__ */ React.createElement("label", null, "Working folder", /* @__PURE__ */ React.createElement("input", { value: value.cwd, onChange: (event) => field("cwd", event.target.value), style: { display: "block", width: "100%" } })), /* @__PURE__ */ React.createElement("p", null, "Use an absolute path or ~/\u2026 on the system running Buzz. The default folder is created automatically; a custom folder must already exist. This is a working directory, not filesystem containment."), /* @__PURE__ */ React.createElement("label", null, "Claude executable (optional)", /* @__PURE__ */ React.createElement("input", { value: value.binary, placeholder: "Auto-detect, or absolute path to Claude", onChange: (event) => field("binary", event.target.value), style: { display: "block", width: "100%" } })), /* @__PURE__ */ React.createElement("label", null, "Permissions", /* @__PURE__ */ React.createElement("select", { value: value.permissionMode, onChange: (event) => field("permissionMode", event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "default" }, "Default \u2014 standard Claude permissions"), /* @__PURE__ */ React.createElement("option", { value: "acceptEdits" }, "Accept edits \u2014 automatically approve file edits"))), /* @__PURE__ */ React.createElement("p", null, "Buzz MCP tools are explicitly allowed. Other actions follow Claude's standard permissions. Requests needing interactive approval are denied, not silently approved. Accept edits authorizes file changes; it does not authorize every shell command. Neither mode provides an OS sandbox."), /* @__PURE__ */ React.createElement("label", null, "Conversation sessions", /* @__PURE__ */ React.createElement("select", { value: value.scope, onChange: (event) => field("scope", event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "thread" }, "One per thread (DMs and Solo chats stay whole)"), /* @__PURE__ */ React.createElement("option", { value: "channel" }, "One per channel"))), /* @__PURE__ */ React.createElement("label", null, "Agent instructions", /* @__PURE__ */ React.createElement("textarea", { value: value.instructions, onChange: (event) => field("instructions", event.target.value), rows: 6, style: { display: "block", width: "100%" } }))));
  }
  function Create(props) {
    React.useSyncExternalStore(subscribe, () => connection);
    const [ready, setReady] = React.useState(false);
    const [problem, setProblem] = React.useState("");
    React.useEffect(() => {
      const cancel = new AbortController();
      setReady(false);
      setProblem("");
      void inspect(configOf(props.config).binary, cancel.signal).then((value) => {
        if (!cancel.signal.aborted) setReady(Boolean(value.tokenStored && value.binary && value.version));
      }, (error) => {
        if (!cancel.signal.aborted) setProblem(safeMessage(error));
      });
      return () => cancel.abort();
    }, [props.config.binary, connection]);
    React.useEffect(() => {
      props.onReadyChange?.(ready);
    }, [ready, props.onReadyChange]);
    return /* @__PURE__ */ React.createElement(Form, null, props.harnessControl, /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", null, "Subscription token setup"), /* @__PURE__ */ React.createElement(Connection, null)), /* @__PURE__ */ React.createElement(Fields, { ...props }), /* @__PURE__ */ React.createElement("p", { role: problem ? "alert" : "status" }, problem || (ready ? "Subscription setup is ready." : "Open Subscription token setup above to save your token and check the executable.")));
  }
  async function retire(key) {
    const pending = [...active].filter((operation) => operation.agentKey === key);
    for (const operation of pending) operation.controller.abort();
    await Promise.all(pending.map((operation) => operation.done).filter(Boolean));
    await store.clear(key);
  }
  function Settings({ agent, save, settingsHost, settingsContent }) {
    const [draft, setDraft] = React.useState(() => configOf(agent.config));
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState("");
    const [confirmReset, setConfirmReset] = React.useState(false);
    async function commit() {
      setBusy(true);
      setMessage("");
      try {
        if (settingsHost?.pendingSave) await settingsHost.pendingSave(draft);
        else await save(draft);
        await retire(agent.key);
        setMessage("Settings saved. The next turn starts a new session with conversation history.");
      } catch (error) {
        setMessage(safeMessage(error));
      } finally {
        setBusy(false);
      }
    }
    async function reset() {
      setBusy(true);
      setMessage("");
      try {
        await retire(agent.key);
        setConfirmReset(false);
        setMessage("Saved conversation associations cleared. Claude transcript files are not deleted.");
      } catch (error) {
        setMessage(safeMessage(error));
      } finally {
        setBusy(false);
      }
    }
    return /* @__PURE__ */ React.createElement("section", { style: { display: "grid", gap: 12 } }, settingsContent, settingsHost?.typeControl?.(JSON.stringify(draft) !== JSON.stringify(configOf(agent.config))), /* @__PURE__ */ React.createElement(Fields, { config: draft, onChange: setDraft, disabled: busy }), /* @__PURE__ */ React.createElement("button", { disabled: busy || !draft.cwd.trim() || !draft.model.trim(), onClick: () => void commit() }, "Save settings"), /* @__PURE__ */ React.createElement("button", { disabled: busy, onClick: () => setConfirmReset(true) }, "Reset saved conversations\u2026"), confirmReset && /* @__PURE__ */ React.createElement("div", { role: "alert" }, /* @__PURE__ */ React.createElement("p", null, "Stop this agent's active turns and forget its session associations? The next turn receives full Buzz conversation history; previous tool actions are not undone."), /* @__PURE__ */ React.createElement("button", { disabled: busy, onClick: () => void reset() }, "Confirm reset"), " ", /* @__PURE__ */ React.createElement("button", { onClick: () => setConfirmReset(false) }, "Cancel")), message && /* @__PURE__ */ React.createElement("p", { role: "status" }, message));
  }
  async function perform(delivery, conversation, signal) {
    const config = configOf(delivery.config);
    const key = sessionKey(delivery.agent, conversation);
    let prompt;
    let sent = false;
    let server;
    const current = () => {
      signal.throwIfAborted();
      if (disposed || !delivery.current()) throw abortError();
    };
    try {
      current();
      if (!ctx.host.resolveDirectory || !ctx.host.readFile || !ctx.host.serveMcp) throw new Error("This harness requires Buzz desktop file and MCP access. Review the plugin host grants.");
      if (!["default", "acceptEdits"].includes(config.permissionMode)) throw new Error("Unsupported permissions setting. Select Default or Accept edits in this agent\u2019s Settings.");
      const cwd = await ctx.host.resolveDirectory(config.cwd.trim(), { create: config.cwd === defaults().cwd });
      current();
      const systemPrompt = await kit.systemPrompt(delivery, { scope: config.scope, cwd, instructions: config.instructions, tools: true });
      current();
      const settingsBytes = new TextEncoder().encode(JSON.stringify([cwd, config.binary, delivery.model || config.model, config.permissionMode, config.scope, systemPrompt]));
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", settingsBytes));
      const fingerprint = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const previous = await store.get(key, fingerprint);
      current();
      prompt = await kit.turnPrompt(delivery, conversation, previous ? { cursor: previous.cursor } : {});
      current();
      const id = previous?.id || crypto.randomUUID();
      const postedTexts = /* @__PURE__ */ new Set();
      let finalPosted = false;
      const agent = { ...delivery.agent, publish: async (event) => {
        current();
        const result2 = await delivery.agent.publish(event);
        if (event.kind === 9 && event.tags?.some((tag) => tag[0] === "h" && tag[1] === conversation.channel)) postedTexts.add((event.content || "").trim());
        return result2;
      } };
      const tools = kit.tools(agent, conversation, { read: async (path) => {
        current();
        const bytes = await ctx.host.readFile(path, { cwd });
        current();
        return bytes;
      } });
      server = await ctx.host.serveMcp(async (message) => {
        current();
        if (message?.method === "tools/call") delivery.step?.(message.params?.name || "Buzz tool");
        const response = await tools(message);
        const name = message?.params?.name;
        if (message?.method === "tools/call" && ["send", "reply_in_subthread"].includes(name) && message.params.arguments?.final === true && !response?.error && !response?.result?.isError && postedTexts.size) finalPosted = true;
        return response;
      });
      current();
      await store.put(key, { id, cursor: prompt.cursor, fingerprint, inFlight: true, channelId: conversation.channel, root: conversation.root });
      current();
      const output = new TurnOutput((tool) => delivery.step?.(tool));
      const code = await bridgeRequest(ctx.host, native_bridge_default, {
        action: "run",
        binary: config.binary || void 0,
        model: delivery.model || config.model,
        prompt: prompt.text,
        systemPrompt,
        sessionId: id,
        resume: Boolean(previous),
        mcp: { url: server.url, headers: server.headers },
        permissionMode: config.permissionMode,
        cwd
      }, { signal, onEvent: (event) => output.accept(event), onSent: () => {
        sent = true;
      } });
      current();
      const result = output.finish(code, signal.aborted);
      if (result.sessionId !== id) throw new Error("Claude returned an unexpected session identity. The saved association has been cleared to prevent mixing conversations.");
      const answer = finalReply(result.text, postedTexts, finalPosted);
      if (answer) {
        current();
        await kit.reply(delivery.agent, conversation, answer);
      }
      if (result.denials.length) {
        current();
        await kit.reply(delivery.agent, conversation, `Claude permission denied: ${result.denials.join(", ")}. This headless harness cannot answer interactive approvals. Review the requested action and the agent's permission setting; no permission bypass is enabled.`, { notifyOwner: true });
      } else if (!postedTexts.size && !result.text?.trim()) {
        throw new Error("Claude finished without a reply or a successful Buzz message. Ask again with a specific request.");
      }
      current();
      await store.put(key, { id, cursor: prompt.cursor, fingerprint, channelId: conversation.channel, root: conversation.root, at: Date.now() });
    } catch (error) {
      await store.remove(key);
      if (!sent) prompt?.restore();
      throw error;
    } finally {
      if (server) await server.close();
    }
  }
  async function run(delivery) {
    const conversation = await kit.conversation(delivery, configOf(delivery.config).scope);
    if (!conversation) {
      delivery.ignored?.();
      return;
    }
    delivery.signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    delivery.signal.addEventListener("abort", abort, { once: true });
    if (delivery.signal.aborted || disposed) controller.abort();
    const operation = { controller, agentKey: delivery.agent.key };
    active.add(operation);
    delivery.acknowledged?.();
    const done = lanes.run(sessionKey(delivery.agent, conversation), controller.signal, () => perform(delivery, conversation, controller.signal)).then(
      () => ({ ok: true }),
      async (error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return { ok: true, stopped: true };
        const message = safeMessage(error);
        try {
          await kit.reply(delivery.agent, conversation, `Claude subscription: ${message}`, { notifyOwner: true });
        } catch (replyError) {
          return { ok: false, error: `${message} The error reply also failed: ${safeMessage(replyError)}` };
        }
        return { ok: false, error: message };
      }
    ).finally(() => {
      delivery.signal.removeEventListener("abort", abort);
      active.delete(operation);
    });
    operation.done = done;
    delivery.interruptible?.(async () => {
      controller.abort();
      await done;
    });
    delivery.workingUntil(done);
  }
  ctx.settingsCards.register({ id: "subscription", title: "Claude Code (subscription)", personal: true, component: Connection });
  ctx.agents.register({
    id: "claude-subscription",
    title: "Claude Code (subscription)",
    description: "Your Claude subscription through an independent local CLI harness.",
    defaults: () => ({ config: defaults() }),
    summary: (agent) => `${configOf(agent.config).model} \xB7 subscription`,
    CreateConfiguration: Create,
    tabs: [{ id: "settings", title: "Settings", role: "settings", component: Settings }],
    provider: { snapshot: () => connection, subscribe, check, DialogBody: Connection },
    models: (agent) => ({ current: configOf(agent.config).model, models: [.../* @__PURE__ */ new Set([configOf(agent.config).model, "sonnet", "opus", "haiku"])].map((id) => ({ id, label: id, efforts: [] })) }),
    protectionUnavailable: "Standard Claude tool permissions only; this harness does not implement Buzz protection or OS sandboxing.",
    retire,
    timeoutMs: 30 * 60 * 1e3,
    run
  });
  ctx.effect(() => {
    void check();
    return () => {
      disposed = true;
      for (const operation of active) operation.controller.abort();
      listeners.clear();
    };
  });
}
export {
  apply,
  inject
};
