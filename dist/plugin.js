// embedded:native-bridge
var native_bridge_default = 'var N=require("node:child_process"),j=require("node:fs"),u=require("node:fs/promises"),I=require("node:os"),c=require("node:path"),H=require("node:string_decoder");var G=require("node:path"),b=class extends Error{};function v(e,r=process.env){let t=Object.entries(r).find(([n])=>n.toLowerCase()==="systemroot")?.[1];if(typeof t!="string"||!/^[A-Za-z]:[\\\\/]/.test(t)||/[\\x00-\\x1f\\x7f]/.test(t)||t.split(/[\\\\/]/).includes(".."))throw new b("Windows SystemRoot is unavailable or invalid. Restart Buzz from your normal Windows desktop environment.");let i={powershell:["WindowsPowerShell","v1.0","powershell.exe"],icacls:["icacls.exe"]};if(!Object.hasOwn(i,e))throw new b("Unsupported Windows system helper.");return G.win32.join(t,"System32",...i[e])}var oe="kvncrw.buzz-claude-subscription",se="oauth-token",ae=String.raw`\n$ErrorActionPreference = \'Stop\'\n[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\ntry {\n  Add-Type -TypeDefinition @\'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class BuzzCredential {\n  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]\n  public struct Credential {\n    public UInt32 Flags, Type;\n    public string TargetName, Comment;\n    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;\n    public UInt32 CredentialBlobSize;\n    public IntPtr CredentialBlob;\n    public UInt32 Persist, AttributeCount;\n    public IntPtr Attributes;\n    public string TargetAlias, UserName;\n  }\n  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);\n  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern bool Write(ref Credential credential, UInt32 flags);\n  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern bool Delete(string target, UInt32 type, UInt32 flags);\n  [DllImport("advapi32.dll")]\n  public static extern void CredFree(IntPtr credential);\n}\n\'@\n  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json\n  $target = [string]$request.service + \'/\' + [string]$request.account\n  if ($request.action -eq \'lookup\') {\n    $pointer = [IntPtr]::Zero\n    if (-not [BuzzCredential]::Read($target, 1, 0, [ref]$pointer)) {\n      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 44 }\n      exit 1\n    }\n    try {\n      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][BuzzCredential+Credential])\n      if ($credential.CredentialBlobSize -gt 8192) { exit 1 }\n      $bytes = New-Object byte[] $credential.CredentialBlobSize\n      [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)\n      [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))\n      [Array]::Clear($bytes, 0, $bytes.Length)\n    } finally { [BuzzCredential]::CredFree($pointer) }\n  } elseif ($request.action -eq \'save\') {\n    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.token)\n    if ($bytes.Length -gt 2560) { exit 1 }\n    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)\n    try {\n      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)\n      $credential = New-Object BuzzCredential+Credential\n      $credential.Type = 1\n      $credential.TargetName = $target\n      $credential.UserName = [string]$request.account\n      $credential.Persist = 2\n      $credential.CredentialBlobSize = $bytes.Length\n      $credential.CredentialBlob = $pointer\n      if (-not [BuzzCredential]::Write([ref]$credential, 0)) { exit 1 }\n    } finally {\n      [Array]::Clear($bytes, 0, $bytes.Length)\n      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)\n      [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)\n    }\n  } elseif ($request.action -eq \'remove\') {\n    if (-not [BuzzCredential]::Delete($target, 1, 0)) {\n      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { exit 1 }\n    }\n  } else { exit 1 }\n  exit 0\n} catch { [Console]::Error.Write(\'Windows Credential Manager operation failed.\'); exit 1 }\n`;function O(e){return["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(e,"utf16le").toString("base64")]}function F(e,r,t,{service:i=oe,account:n=se,env:a=process.env}={}){if(!["linux","darwin","win32"].includes(e))throw new b("Unsupported credential platform. Supported platforms are Linux/WSL, macOS, and Windows.");if(![i,n].every(s=>typeof s=="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s)))throw new b("Invalid credential namespace.");let d=["application",i,"account",n];if(!["lookup","save","remove"].includes(r))throw new b("Invalid credential operation.");if(r==="save"&&(typeof t!="string"||t.length>8192||!/^sk-ant-oat\\d{2}-[A-Za-z0-9_-]{16,}$/.test(t)))throw new b("Enter a valid long-lived Claude OAuth token beginning sk-ant-oat, without whitespace.");if(e==="win32"){if(r==="save"&&Buffer.byteLength(t)>2560)throw new b("Token exceeds the Windows Credential Manager size limit.");return{binary:v("powershell",a),args:O(ae),input:JSON.stringify({action:r,service:i,account:n,...r==="save"?{token:t}:{}}),missing:44}}if(e==="darwin"){if(r==="save"){let s=`add-generic-password -U -a ${n} -s ${i} -l "Buzz Claude subscription OAuth token" -w ${t}\n`;if(Buffer.byteLength(s)>=4096)throw new b("Token exceeds the macOS Keychain helper input limit.");return{binary:"/usr/bin/security",args:["-i"],input:s,missing:44}}return{binary:"/usr/bin/security",args:[r==="lookup"?"find-generic-password":"delete-generic-password","-a",n,"-s",i,...r==="lookup"?["-w"]:[]],input:"",missing:44}}return{binary:"secret-tool",args:r==="save"?["store","--label=Buzz Claude subscription OAuth token",...d]:[r==="lookup"?"lookup":"clear",...d],input:r==="save"?t:"",missing:1}}var x=Object.freeze({request:4*1024*1024,token:8192,line:4*1024*1024,output:128*1024*1024,secretTimeout:12e3}),ce=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,k=/^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[a-zA-Z0-9.-]+)?$/,Z="2.1.267",le=1440*60*1e3,o=e=>{throw new b(e)};function R(e){return e instanceof b?e.message:"The bridge operation failed. Check Claude Code and your operating system credential store availability."}function $(e){return(typeof e!="string"||e.length>x.token||!/^sk-ant-oat\\d{2}-[A-Za-z0-9_-]{16,}$/.test(e))&&o("Enter a valid long-lived Claude OAuth token beginning sk-ant-oat, without whitespace."),e}function B(e,r=(0,I.homedir)()){return(typeof e!="string"||e.length===0||e.length>4096||/[\\x00-\\x1f\\x7f]/.test(e))&&o("Paths must be absolute paths or start with ~/."),e==="~"?r:e.startsWith("~/")||process.platform==="win32"&&e.startsWith("~\\\\")?(0,c.normalize)((0,c.join)(r,e.slice(2))):((0,c.isAbsolute)(e)||o("Paths must be absolute paths or start with ~/."),(0,c.normalize)(e))}function _(e=process.env,r){let t={};for(let[i,n]of Object.entries(e))/^(?:ANTHROPIC|CLAUDE|AWS|AMAZON|BEDROCK|GOOGLE|GCLOUD|GCP|VERTEX|AZURE|FOUNDRY|OPENAI|LITELLM|OTEL)(?:_|$)/i.test(i)||/^CLAUDECODE$/i.test(i)||/^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*)$/i.test(i)||n!==void 0&&(t[i]=n);return r!==void 0&&(t.CLAUDE_CODE_OAUTH_TOKEN=$(r)),t}function P(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}function A(e,r,t=!1){return typeof e=="string"&&Buffer.byteLength(e)<=r&&(!t||e.length>0)&&!e.includes("\\0")}function J(e){(!P(e)||!["status","save","remove","run"].includes(e.action))&&o("Invalid bridge request.");let r=e.action==="run"?["action","binary","model","prompt","systemPrompt","sessionId","resume","mcp","permissionMode","cwd"]:e.action==="save"?["action","token","binary"]:["action","binary"];if(Object.keys(e).some(n=>!r.includes(n))&&o("Unexpected bridge request field."),e.binary!==void 0&&e.binary!==""&&e.binary!=="claude"&&B(e.binary),e.binary!==void 0&&typeof e.binary!="string"&&o("Invalid Claude executable path."),e.action==="save"&&$(e.token),e.action!=="run")return e;(!A(e.prompt,2*1024*1024,!0)||!A(e.systemPrompt,1024*1024))&&o("Invalid or oversized prompt."),(!ce.test(e.sessionId??"")||typeof e.sessionId!="string"||typeof e.resume!="boolean")&&o("A valid session UUID and explicit resume flag are required."),["default","acceptEdits"].includes(e.permissionMode)||o("Only default and acceptEdits permission modes are supported."),e.model!==void 0&&(typeof e.model!="string"||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}(?:\\[1m\\])?$/.test(e.model))&&o("Invalid Claude model."),B(e.cwd),(!P(e.mcp)||Object.keys(e.mcp).some(n=>!["url","headers"].includes(n)))&&o("Invalid Buzz MCP configuration.");let t;try{t=new URL(e.mcp.url)}catch{o("Invalid Buzz MCP URL.")}(!A(e.mcp.url,8192,!0)||!["http:","https:"].includes(t.protocol)||!["127.0.0.1","localhost","[::1]"].includes(t.hostname)||t.username||t.password||t.hash)&&o("Buzz MCP must use a loopback HTTP endpoint without URL credentials."),(!Array.isArray(e.mcp.headers)||e.mcp.headers.length>32)&&o("Invalid Buzz MCP headers.");let i=new Set;for(let n of e.mcp.headers){(!P(n)||Object.keys(n).some(d=>!["name","value"].includes(d))||!A(n.name,128,!0)||!/^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$/.test(n.name)||!A(n.value,16384)||/[\\x00-\\x1f\\x7f]/.test(n.value))&&o("Invalid Buzz MCP header.");let a=n.name.toLowerCase();(i.has(a)||["host","content-length","transfer-encoding","connection"].includes(a))&&o("Invalid or duplicate Buzz MCP header."),i.add(a)}return e}async function V(e,{signal:r,timeout:t=15e3}={}){let i=0,n=[],a=()=>e.destroy(new b("Bridge request cancelled.")),d=setTimeout(()=>e.destroy(new b("Timed out waiting for a complete bridge request.")),t);r?.addEventListener("abort",a,{once:!0});try{r?.aborted&&o("Bridge request cancelled.");for await(let l of e){let m=Buffer.isBuffer(l)?l:Buffer.from(l);i+=m.length,i>x.request&&o("Bridge request exceeds the size limit."),n.push(m)}let s;try{s=JSON.parse(Buffer.concat(n,i).toString("utf8"))}catch{o("Bridge input must contain exactly one JSON request.")}return s}finally{clearTimeout(d),r?.removeEventListener("abort",a)}}function K(e,r){let t,i=()=>{e.exitCode!==null||e.signalCode!==null||(e.kill("SIGTERM"),t??=setTimeout(()=>e.kill("SIGKILL"),1500))},n=new Promise(a=>{e.once("error",()=>a({code:null,failed:!0})),e.once("close",d=>a({code:d,failed:!1}))});return r?.addEventListener("abort",i,{once:!0}),r?.aborted&&i(),{stop:i,closed:n,dispose(){clearTimeout(t),r?.removeEventListener("abort",i)}}}async function T(e,r,{input:t="",env:i=_(),timeout:n=x.secretTimeout,limit:a=16384,signal:d}={}){d?.aborted&&o("Bridge operation cancelled.");let s=(0,N.spawn)(e,r,{env:i,stdio:["pipe","pipe","pipe"],windowsHide:!0}),l=K(s,d),m=[],p=0,w=0,f=!1,y=!1;s.stdout.on("data",g=>{p+=g.length,p>a?(f=!0,l.stop()):m.push(g)}),s.stderr.on("data",g=>{w+=g.length,w>a&&(f=!0,l.stop())}),s.stdin.on("error",()=>{}),s.stdin.end(t);let C=setTimeout(()=>{y=!0,l.stop()},n);try{let g=await l.closed;return d?.aborted&&o("Bridge operation cancelled."),y&&o("Credential or CLI operation timed out. Unlock your desktop keyring and confirm Claude Code is installed, then retry."),f&&o("Credential or CLI response exceeded the size limit."),g.failed&&o("Unable to launch a required executable. Check Claude Code and your OS credential helper (secret-tool on Linux, security on macOS, PowerShell on Windows)."),{code:g.code,output:Buffer.concat(m).toString("utf8"),hasStderr:w>0}}finally{clearTimeout(C),l.dispose()}}async function D(e,{token:r,signal:t,platform:i=process.platform,service:n,account:a}={}){e==="save"&&$(r);let d=F(i,e,r,{service:n,account:a}),s=await T(d.binary,d.args,{input:d.input,signal:t,limit:x.token+1024,timeout:i==="win32"?2e4:x.secretTimeout});return s.code===d.missing&&(i==="darwin"||i==="win32"||!s.hasStderr&&s.output==="")&&e!=="save"?null:(s.code!==0&&o("Cannot access the OS credential store. Unlock your keyring or Keychain, or check Windows Credential Manager. Linux and WSL require a desktop Secret Service and secret-tool."),e==="lookup"?s.output.replace(/\\r?\\n$/,"")||null:(e==="save"&&i==="darwin"&&await D("lookup",{signal:t,platform:i,service:n,account:a})!==r&&o("Keychain did not save the token. Unlock your login Keychain and approve credential access, then retry."),null))}async function X(e={}){let r=await D("lookup",e);if(r===null)return null;try{return $(r)}catch{o("The stored OAuth token is invalid. Replace it in the harness settings.")}}async function de(e,r={}){await D("save",{...r,token:e})}async function ue(e={}){await D("remove",e)}async function Y(e,r){let t=await(0,u.open)(e,"r");try{if(!(await t.stat()).isFile())return null;let i=Buffer.alloc(r+1),{bytesRead:n}=await t.read(i,0,i.length,0);return n<=r?i.subarray(0,n).toString("utf8"):null}finally{await t.close()}}function pe(e){if(!k.test(e))return!1;let r=e.split("-")[0].split(".").map(Number),t=Z.split(".").map(Number);for(let i=0;i<t.length;i++)if(r[i]!==t[i])return r[i]>t[i];return!e.includes("-")}async function Q(e,{env:r=process.env,home:t=(0,I.homedir)(),signal:i}={}){let n=e!==void 0&&e!==""&&e!=="claude",a=[];if(n)a.push(B(e,t));else{let s=process.platform==="win32"?"claude.exe":"claude",l=Object.entries(r).find(([p])=>p.toUpperCase()==="PATH")?.[1]??"";for(let p of l.split(c.delimiter))(0,c.isAbsolute)(p)&&a.push((0,c.join)(p,s));a.push((0,c.join)(t,".local","bin",s),(0,c.join)(t,".claude","local",s));let m=process.platform==="darwin"?[(0,c.join)(t,"Library","Application Support","Buzz","claude-code"),(0,c.join)(t,"Library","Application Support","buzz","claude-code")]:process.platform==="win32"?[(0,c.join)(r.LOCALAPPDATA||(0,c.join)(t,"AppData","Local"),"Buzz","claude-code"),(0,c.join)(r.APPDATA||(0,c.join)(t,"AppData","Roaming"),"Buzz","claude-code")]:[(0,c.join)(r.XDG_DATA_HOME&&(0,c.isAbsolute)(r.XDG_DATA_HOME)?r.XDG_DATA_HOME:(0,c.join)(t,".local","share"),"buzz","claude-code")];if(process.platform==="win32"){let p=r.LOCALAPPDATA||(0,c.join)(t,"AppData","Local");a.push((0,c.join)(p,"Microsoft","WinGet","Links",s));try{let w=(0,c.join)(p,"Microsoft","WinGet","Packages"),f=(await(0,u.readdir)(w,{withFileTypes:!0})).filter(y=>y.isDirectory()&&/^Anthropic\\.ClaudeCode_/.test(y.name)).slice(0,16);for(let y of f)a.push((0,c.join)(w,y.name,s))}catch{}}for(let p of m){try{let w=(await Y((0,c.join)(p,"current"),128))?.trim();w&&k.test(w)&&a.push((0,c.join)(p,w,s))}catch{}try{let w=(await(0,u.readdir)(p,{withFileTypes:!0})).filter(f=>f.isDirectory()&&k.test(f.name)).map(f=>f.name);w.sort((f,y)=>y.localeCompare(f,"en",{numeric:!0}));for(let f of w.slice(0,32))a.push((0,c.join)(p,f,s))}catch{}}}let d;for(let s of new Set(a)){i?.aborted&&o("Bridge operation cancelled.");try{if(await(0,u.access)(s,j.constants.X_OK),!(await(0,u.stat)(s)).isFile())continue;let l=await(0,u.realpath)(s),m=await T(l,["--version"],{env:_(r),signal:i,timeout:8e3,limit:4096}),p=m.output.trim().match(/^(\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?)(?:\\s+\\(Claude Code\\))?$/);if(m.code===0&&p&&k.test(p[1])){if(pe(p[1]))return{binary:l,version:p[1]};d??=p[1]}}catch{i?.aborted&&o("Bridge operation cancelled.")}}return d&&o(`${n?"The configured Claude executable reports":"Only outdated Claude Code executables were found; detected"} ${d}. Install Claude Code ${Z} or newer for dynamic system-prompt support.`),n&&o("The configured Claude executable is unavailable or did not report a valid version."),null}async function fe({root:e=(0,I.tmpdir)(),now:r=Date.now(),signal:t}={}){let i;try{i=await(0,u.readdir)(e,{withFileTypes:!0})}catch{return}let n=r-le,a=process.getuid?.();for(let d of i){if(t?.aborted)return;if(!/^buzz-claude-subscription-[A-Za-z0-9]{6}$/.test(d.name)||!d.isDirectory()||d.isSymbolicLink())continue;let s=(0,c.join)(e,d.name);try{let l=await(0,u.lstat)(s);if(!l.isDirectory()||l.isSymbolicLink()||l.mtimeMs>=n||a!==void 0&&l.uid!==a)continue;let m=await(0,u.readdir)(s);if(m.some(f=>!["system.txt","mcp.json","run-owner.json"].includes(f)))continue;let p=!0;for(let f of m){let y=await(0,u.lstat)((0,c.join)(s,f));if(!y.isFile()||y.isSymbolicLink()||y.nlink!==1||y.mtimeMs>=n||a!==void 0&&y.uid!==a){p=!1;break}}if(!p)continue;if(m.includes("run-owner.json")){let f=JSON.parse(await Y((0,c.join)(s,"run-owner.json"),256));if(!Number.isSafeInteger(f?.pid)||f.pid<=0)continue;try{process.kill(f.pid,0);continue}catch(y){if(y.code!=="ESRCH")continue}}if(process.platform==="win32"){let f=await T(v("powershell"),O(`\n$ErrorActionPreference = \'Stop\'\ntry {\n  $paths = [Console]::In.ReadToEnd() | ConvertFrom-Json\n  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n  foreach ($path in $paths) {\n    $item = Get-Item -LiteralPath $path -Force\n    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }\n    $owner = (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value\n    if ($owner -ne $sid) { exit 1 }\n  }\n  [Console]::Out.Write(\'owned\')\n} catch { exit 1 }\n`),{input:JSON.stringify([s,...m.map(y=>(0,c.join)(s,y))]),signal:t,limit:256});if(f.code!==0||f.output!=="owned")continue}else if(a===void 0)continue;let w=await(0,u.lstat)(s);if(w.dev!==l.dev||w.ino!==l.ino||w.mtimeMs!==l.mtimeMs||w.isSymbolicLink())continue;await(0,u.rm)(s,{recursive:!0,force:!0})}catch{}}}async function me(e,{root:r=(0,I.tmpdir)(),signal:t}={}){let i=await(0,u.mkdtemp)((0,c.join)(r,"buzz-claude-subscription-"));try{if(process.platform==="win32"){let s=await T(v("powershell"),O("[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"),{limit:4096,signal:t}),l=s.output.trim();(s.code!==0||!/^S-1-\\d+(?:-\\d+)+$/.test(l))&&o("Cannot determine the Windows account for private temporary files."),(await T(v("icacls"),[i,"/inheritance:r","/grant:r",`*${l}:(OI)(CI)F`,"/q"],{limit:4096,signal:t})).code!==0&&o("Cannot secure private temporary files with Windows ACLs.")}else await(0,u.chmod)(i,448);t?.aborted&&o("Claude run cancelled."),await(0,u.writeFile)((0,c.join)(i,"run-owner.json"),JSON.stringify({pid:process.pid}),{mode:384,flag:"wx"});let n=(0,c.join)(i,"system.txt"),a=(0,c.join)(i,"mcp.json"),d=Object.fromEntries(e.mcp.headers.map(({name:s,value:l})=>[s,l]));return await(0,u.writeFile)(n,e.systemPrompt,{mode:384,flag:"wx"}),await(0,u.writeFile)(a,JSON.stringify({mcpServers:{buzz:{type:"http",url:e.mcp.url,headers:d}}}),{mode:384,flag:"wx"}),{directory:i,system:n,mcp:a,cleanup:()=>(0,u.rm)(i,{recursive:!0,force:!0})}}catch(n){throw await(0,u.rm)(i,{recursive:!0,force:!0}),n}}function ye(e,r){let t=["-p","--output-format","stream-json","--verbose","--setting-sources","","--system-prompt-snapshot","off","--strict-mcp-config","--mcp-config",r.mcp,"--append-system-prompt-file",r.system,"--permission-prompts","none","--allowedTools","mcp__buzz__*"];return t.push("--permission-mode",e.permissionMode==="acceptEdits"?"acceptEdits":"manual"),e.model&&t.push("--model",e.model),t.push(e.resume?"--resume":"--session-id",e.sessionId),t}async function we(e,{binary:r,token:t,emit:i,signal:n,tempRoot:a}={}){J(e),$(t);let d=B(e.cwd);try{(await(0,u.stat)(d)).isDirectory()||o("The requested working directory does not exist.")}catch{o("The requested working directory does not exist or is inaccessible.")}n?.aborted&&o("Claude run cancelled."),await fe({root:a,signal:n});let s=await me(e,{root:a,signal:n}),l;try{n?.aborted&&o("Claude run cancelled.");let m=(0,N.spawn)(r,ye(e,s),{cwd:d,env:_(process.env,t),stdio:["pipe","pipe","pipe"],windowsHide:!0});l=K(m,n);let p=0,w=!1;m.stderr.on("data",h=>{p+=h.length,p>1024*1024&&(w=!0,l.stop())}),m.stdin.on("error",()=>{}),await new Promise(h=>{m.once("spawn",()=>h(!0)),m.once("error",()=>h(!1))})||o("Unable to start the Claude executable."),await i({type:"bridge_started"}),m.stdin.end(e.prompt);let y=new H.StringDecoder("utf8"),C="",g=0,M=!1,ne=[t,...e.mcp.headers.map(({value:h})=>h).filter(h=>h.length>=8)],W=async h=>{if(h.trim()==="")return;Buffer.byteLength(h)>x.line&&o("Claude output exceeded the event size limit."),ne.some(L=>h.includes(L)||h.includes(JSON.stringify(L).slice(1,-1)))&&o("Sensitive credential material in Claude output was withheld.");let S;try{S=JSON.parse(h)}catch{o("Claude returned invalid stream output. Confirm the installed CLI supports stream-json.")}(!P(S)||typeof S.type!="string")&&o("Claude returned an invalid stream event."),S.type==="result"&&(M=!0),await i(S)};for await(let h of m.stdout){g+=h.length,g>x.output&&o("Claude output exceeded the run size limit."),C+=y.write(h);let S;for(;(S=C.indexOf(`\n`))>=0;){let L=C.slice(0,S);C=C.slice(S+1),await W(L)}Buffer.byteLength(C)>x.line&&o("Claude output exceeded the event size limit.")}C+=y.end(),C&&await W(C);let z=await l.closed;return n?.aborted&&o("Claude run cancelled."),w&&o("Claude diagnostic output exceeded the size limit."),z.failed&&o("Unable to start the Claude executable."),M||o(z.code===0?"Claude exited without a final result event.":"Claude exited unsuccessfully without a final result. Check your OAuth subscription and CLI compatibility."),Number.isInteger(z.code)||o("Claude was terminated before it could exit normally."),z.code}finally{l&&(l.stop(),await l.closed,l.dispose()),await s.cleanup()}}async function he(e,{signal:r,tokenLookup:t=X,cliLookup:i=Q}={}){let n={tokenStored:!1,binary:null,version:null};return await Promise.all([(async()=>{try{n.tokenStored=await t({signal:r})!==null}catch(a){n.credentialError=R(a)}})(),(async()=>{try{let a=await i(e,{signal:r});n.binary=a?.binary??null,n.version=a?.version??null,a||(n.cliError="Claude Code was not found. Install Claude Code or configure its absolute executable path.")}catch(a){n.cliError=R(a)}})()]),r?.aborted&&o("Bridge operation cancelled."),n}async function q(e,{emit:r,signal:t}={}){if(J(e),e.action==="save")await de(e.token,{signal:t}),await r({type:"bridge_saved",tokenStored:!0});else if(e.action==="remove")await ue({signal:t}),await r({type:"bridge_saved",tokenStored:!1});else if(e.action==="status")await r({type:"bridge_status",...await he(e.binary,{signal:t})});else{let i=await X({signal:t});i||o("No OAuth token is stored. Save a Claude subscription token in the harness settings first.");let n=await Q(e.binary,{signal:t});return n||o("Claude Code was not found. Install Claude Code or configure its absolute executable path."),await we(e,{binary:n.binary,token:i,emit:r,signal:t})}return 0}var E=new AbortController,U,te=e=>{U=e==="SIGINT"?130:143,E.abort()},re=()=>te("SIGTERM"),ie=()=>te("SIGINT"),be=()=>E.abort();process.on("SIGTERM",re);process.on("SIGINT",ie);process.stdout.on("error",be);function ee(e){return new Promise((r,t)=>{let i=setTimeout(()=>{E.abort(),t(new Error("Output unavailable."))},15e3);process.stdout.write(`${JSON.stringify(e)}\n`,n=>{clearTimeout(i),n?t(n):r()})})}async function Ce(){try{let e=await V(process.stdin,{signal:E.signal});process.exitCode=await q(e,{emit:ee,signal:E.signal})}catch(e){if(process.exitCode=U??1,!process.stdout.destroyed)try{await ee({type:"bridge_error",message:R(e)})}catch{}}finally{U&&(process.exitCode=U),process.removeListener("SIGTERM",re),process.removeListener("SIGINT",ie),process.stdin.destroy()}}Ce();\n';

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
    let value;
    try {
      value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    } catch {
      this.error = new Error("Claude returned invalid stream JSON. Update Claude Code and try again.");
      return;
    }
    this.accept(value);
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
        for (const block of content) if (block.type === "tool_use") this.step(toolName(block.name));
      }
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
    const denials = [...new Set(denied.map((item) => toolName(item?.tool_name)))];
    if (this.result.is_error || code !== 0) {
      const permissions = denials.length ? ` Permission denied: ${denials.join(", ").slice(0, 300)}. This harness cannot answer interactive approvals.` : "";
      const detail = typeof this.result.result === "string" ? safeMessage(this.result.result).trim().slice(0, 900) : "";
      const subtype = safeMessage(this.result.subtype || "process error").slice(0, 100);
      throw new Error(`Claude could not complete this turn (${subtype}; exit ${code ?? "signal"}).${permissions}${detail ? ` ${detail}` : ""}`);
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
    let removeAbort = () => {
    };
    let started = false;
    const cancelled = new Promise((_, reject) => {
      const abort = () => {
        if (!started) reject(signal.reason || abortError());
      };
      signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) abort();
    });
    const queued = prior.then(() => {
      signal.throwIfAborted();
      started = true;
      removeAbort();
      return action();
    });
    const settled = queued.then(() => {
    }, () => {
    });
    this.lanes.set(key, settled);
    void settled.then(() => {
      if (this.lanes.get(key) === settled) this.lanes.delete(key);
    });
    return Promise.race([queued, cancelled]).finally(removeAbort);
  }
};
async function bridgeRequest(host, source, request, { signal, onEvent = () => {
} } = {}) {
  if (!host.spawn) throw new Error("Buzz desktop process access is unavailable. Install this plugin in Buzz desktop with the Node process grant.");
  signal?.throwIfAborted();
  let process;
  let failure;
  let stopped = false;
  const parser = new JsonLines((event) => {
    if (event.type === "bridge_error") failure = new Error(safeMessage(event.message || "Claude bridge failed."));
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
        // The bridge itself holds credentials, before the native child env exists.
        env: {
          NODE_OPTIONS: null,
          NODE_PATH: null,
          LD_PRELOAD: null,
          LD_LIBRARY_PATH: null,
          LD_AUDIT: null,
          DYLD_INSERT_LIBRARIES: null,
          DYLD_LIBRARY_PATH: null,
          DYLD_FRAMEWORK_PATH: null,
          DYLD_FALLBACK_LIBRARY_PATH: null,
          DYLD_FALLBACK_FRAMEWORK_PATH: null,
          DYLD_ROOT_PATH: null,
          DYLD_IMAGE_SUFFIX: null,
          DYLD_VERSIONED_LIBRARY_PATH: null,
          DYLD_VERSIONED_FRAMEWORK_PATH: null
        },
        onStdout: (chunk) => {
          if (failure) return;
          try {
            parser.push(chunk);
            if (parser.error) throw parser.error;
          } catch (error) {
            failure = error;
            stop();
          }
        },
        // Never render unstructured stderr; it can contain credentials.
        onStderr: () => {
        }
      });
    } catch (error) {
      if (failure) throw failure;
      throw new Error(`Cannot start the Node bridge: ${safeMessage(error)}. Check Node.js 20+ on the desktop PATH and the plugin process grant.`);
    }
    if (failure) throw failure;
    if (stopped || signal?.aborted) throw signal?.reason || abortError();
    await process.write(JSON.stringify(request));
    if (request.action === "save") delete request.token;
    signal?.throwIfAborted();
    await process.end();
    const code = await process.exited;
    signal?.throwIfAborted();
    if (failure) throw failure;
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
    this.writes = Promise.resolve();
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
  mutate(action) {
    const result = this.writes.then(action);
    this.writes = result.catch(() => {
    });
    return result;
  }
  put(key, value) {
    return this.mutate(async () => {
      await this.storage.set(PREFIX + key, JSON.stringify(value));
      const agentKey = JSON.parse(key)[0];
      const entries = await this.storage.scan(PREFIX);
      const matching = Object.entries(entries).flatMap(([storedKey, raw]) => {
        try {
          if (JSON.parse(storedKey.slice(PREFIX.length))[0] !== agentKey) return [];
          const saved = JSON.parse(raw);
          return [{ key: storedKey, at: Number.isFinite(saved.at) ? saved.at : 0 }];
        } catch {
          return [];
        }
      }).sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
      for (const old of matching.slice(200)) await this.storage.set(old.key, null);
    });
  }
  remove(key) {
    return this.mutate(() => this.storage.set(PREFIX + key, null));
  }
  clear(agentKey) {
    return this.mutate(async () => {
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
    });
  }
  async prune(snapshot) {
    if (snapshot?.status !== "ready") return;
    const removed = new Set((snapshot.agents || []).filter((agent) => agent.deleting).map((agent) => agent.key));
    for (const key of removed) await this.clear(key);
  }
};
function toolName(name) {
  return safeMessage(typeof name === "string" ? name.replace(/^mcp__buzz__/, "") : "a tool");
}
function finalReply(text, postedTexts) {
  if (postedTexts.size || typeof text !== "string" || !text.trim()) return void 0;
  return text;
}

// src/runtime.mjs
var defaults = () => ({
  model: "sonnet",
  cwd: "~/.buzz/claude-subscription-workspace",
  permissionMode: "default",
  instructions: "",
  scope: "thread",
  binary: ""
});
function configOf(config) {
  const value = { ...defaults(), ...config };
  for (const name of ["model", "cwd", "binary", "instructions"]) value[name] = String(value[name] ?? "").trim();
  return value;
}
var configReady = (config) => Boolean(configOf(config).cwd && configOf(config).model);
async function saveSettings(save, draft) {
  const config = configOf(draft);
  if (!configReady(config)) throw new Error("Enter a model and working folder before saving.");
  await save(config);
}
var FALLBACK_INSTRUCTIONS = "Publication rule for this harness: if no Buzz message was successfully sent with a tool this turn, your final nonempty message WILL be posted to the conversation; write it for that audience, and leave it empty for intentional silence on a non-mention wake.";
function createRuntime(ctx, source) {
  const kit = ctx.agents.harness;
  const store = new SessionStore(ctx.agents.storage);
  const lanes = new SessionLanes();
  const active = /* @__PURE__ */ new Set();
  const retiring = /* @__PURE__ */ new Map();
  let disposed = false;
  function cancel(operation, reason) {
    if (operation.controller.signal.aborted) return;
    operation.reason = reason;
    operation.controller.abort(reason === "deadline" ? new Error("Claude turn exceeded its run deadline, including time waiting for this conversation. Please try again.") : abortError());
  }
  async function perform(delivery, conversation, operation) {
    const signal = operation.controller.signal;
    const config = configOf(delivery.config);
    const key = sessionKey(delivery.agent, conversation);
    let prompt;
    let started = false;
    let server;
    const current = () => {
      if (disposed || !delivery.current()) cancel(operation, "lifetime");
      signal.throwIfAborted();
    };
    try {
      current();
      if (!ctx.host.resolveDirectory || !ctx.host.readFile || !ctx.host.serveMcp) throw new Error("This harness requires Buzz desktop file and MCP access. Review the plugin host grants.");
      if (!config.cwd) throw new Error("Enter a working folder in this agent\u2019s Settings.");
      if (!["default", "acceptEdits"].includes(config.permissionMode)) throw new Error("Unsupported permissions setting. Select Default or Accept edits in this agent\u2019s Settings.");
      const cwd = await ctx.host.resolveDirectory(config.cwd, { create: config.cwd === defaults().cwd });
      current();
      const instructions = [config.instructions, FALLBACK_INSTRUCTIONS].filter(Boolean).join("\n\n");
      const systemPrompt = await kit.systemPrompt(delivery, { scope: config.scope, cwd, instructions, tools: true });
      current();
      const fingerprint = JSON.stringify([cwd, config.binary, config.scope]);
      const previous = await store.get(key, fingerprint);
      current();
      prompt = await kit.turnPrompt(delivery, conversation, previous ? { cursor: previous.cursor } : {});
      current();
      const id = previous?.id || crypto.randomUUID();
      const postedTexts = /* @__PURE__ */ new Set();
      const agent = { ...delivery.agent, publish: async (event) => {
        current();
        const result2 = await delivery.agent.publish(event);
        if (event.kind === 9) postedTexts.add((event.content || "").trim());
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
        return tools(message);
      });
      current();
      await store.put(key, { id, cursor: prompt.cursor, fingerprint, inFlight: true, at: Date.now() });
      current();
      const output = new TurnOutput((tool) => delivery.step?.(tool));
      const code = await bridgeRequest(ctx.host, source, {
        action: "run",
        binary: config.binary || void 0,
        model: delivery.model?.trim() || config.model || void 0,
        prompt: prompt.text,
        systemPrompt,
        sessionId: id,
        resume: Boolean(previous),
        mcp: { url: server.url, headers: server.headers },
        permissionMode: config.permissionMode,
        cwd
      }, { signal, onEvent: (event) => {
        if (event.type === "bridge_started") started = true;
        output.accept(event);
      } });
      current();
      const result = output.finish(code);
      if (result.sessionId !== id) throw new Error("Claude returned an unexpected session identity. The saved association has been cleared to prevent mixing conversations.");
      const answer = finalReply(result.text, postedTexts);
      if (answer) {
        current();
        await kit.reply(delivery.agent, conversation, answer);
      }
      if (result.denials.length) {
        current();
        await kit.reply(
          delivery.agent,
          conversation,
          `Claude permission denied: ${result.denials.join(", ")}. This headless harness cannot answer interactive approvals. Review the requested action and the agent's permission setting; no permission bypass is enabled.`,
          { notifyOwner: true }
        );
      } else if (!postedTexts.size && !result.text?.trim() && delivery.trigger.type === "mention") {
        throw new Error("Claude finished without a reply or a successful Buzz message. Ask again with a specific request.");
      }
      current();
      await store.put(key, { id, cursor: prompt.cursor, fingerprint, at: Date.now() });
    } catch (error) {
      if (!started) prompt?.restore();
      await store.remove(key);
      throw error;
    } finally {
      if (server) await server.close();
    }
  }
  function run(delivery) {
    if (retiring.has(delivery.agent.key) || disposed) {
      delivery.ignored?.();
      return;
    }
    const operation = { controller: new AbortController(), agentKey: delivery.agent.key };
    active.add(operation);
    const abort = () => cancel(operation, delivery.current() ? "deadline" : "lifetime");
    delivery.signal.addEventListener("abort", abort, { once: true });
    if (delivery.signal.aborted) abort();
    let conversation;
    const done = (async () => {
      conversation = await kit.conversation(delivery, configOf(delivery.config).scope);
      if (!conversation) {
        delivery.ignored?.();
        return { ok: true };
      }
      delivery.acknowledged?.();
      delivery.interruptible?.(async () => {
        cancel(operation, "owner-stop");
        await operation.done;
      });
      await lanes.run(
        sessionKey(delivery.agent, conversation),
        operation.controller.signal,
        () => perform(delivery, conversation, operation)
      );
      return { ok: true };
    })().catch(async (error) => {
      if (operation.reason === "owner-stop") return { ok: true, stopped: true };
      if (operation.reason && operation.reason !== "deadline") {
        return { ok: false, error: operation.reason === "reset" ? "Saved conversations were reset." : "The agent is no longer active." };
      }
      const message = safeMessage(operation.reason === "deadline" ? operation.controller.signal.reason : error);
      if (conversation && !disposed && delivery.current()) {
        try {
          await kit.reply(delivery.agent, conversation, `Claude subscription: ${message}`, { notifyOwner: true });
        } catch (replyError) {
          return { ok: false, error: `${message} The error reply also failed: ${safeMessage(replyError)}` };
        }
      }
      return { ok: false, error: message };
    }).finally(() => {
      delivery.signal.removeEventListener("abort", abort);
      active.delete(operation);
    });
    operation.done = done;
    delivery.workingUntil(done);
  }
  function retire(key) {
    if (retiring.has(key)) return retiring.get(key);
    const done = Promise.resolve().then(async () => {
      const pending = [...active].filter((operation) => operation.agentKey === key);
      for (const operation of pending) cancel(operation, "reset");
      await Promise.all(pending.map((operation) => operation.done));
      await store.clear(key);
    }).finally(() => retiring.delete(key));
    retiring.set(key, done);
    return done;
  }
  return {
    run,
    retire,
    prune: (snapshot) => store.prune(snapshot),
    dispose() {
      disposed = true;
      for (const operation of active) cancel(operation, "lifetime");
    }
  };
}

// src/setup.mjs
function createSetup(host, source) {
  const listeners = /* @__PURE__ */ new Set();
  const controllers = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  const cache = /* @__PURE__ */ new Map();
  let epoch = 0;
  let checking;
  let disposed = false;
  let credentialBusy = false;
  let state = {
    revision: 0,
    status: void 0,
    error: "",
    connection: { readiness: "checking", attentionDescription: "Checking local Claude subscription setup\u2026" }
  };
  const update = (change2) => {
    if (disposed) return;
    state = { ...state, ...change2 };
    for (const listener of listeners) listener();
  };
  async function inspect(binary = "") {
    binary = binary.trim();
    const generation = epoch;
    if (cache.has(binary)) return cache.get(binary);
    const existing = pending.get(binary);
    if (existing) {
      if (existing.epoch === generation) {
        const answer2 = await existing.done;
        return generation === epoch ? answer2 : inspect(binary);
      }
      await existing.done.catch(() => {
      });
      return inspect(binary);
    }
    if (disposed) throw new Error("Subscription setup is closed.");
    const controller = new AbortController();
    controllers.add(controller);
    const operation = { epoch: generation };
    operation.done = (async () => {
      let answer2;
      const code = await bridgeRequest(host, source, { action: "status", ...binary ? { binary } : {} }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "bridge_status") answer2 = event;
        }
      });
      if (code !== 0 || !answer2) throw new Error("The subscription bridge did not return installation status. Check Node.js 20+, the OS credential store and Claude Code.");
      if (generation === epoch) cache.set(binary, answer2);
      return answer2;
    })().finally(() => {
      controllers.delete(controller);
      if (pending.get(binary) === operation) pending.delete(binary);
    });
    pending.set(binary, operation);
    const answer = await operation.done;
    return generation === epoch ? answer : inspect(binary);
  }
  function check() {
    if (checking) return checking;
    update({ connection: { ...state.connection, readiness: "checking" } });
    checking = inspect().then((status) => {
      const error = [status.credentialError, status.cliError].filter(Boolean).map(safeMessage).join(" ");
      const ready = Boolean(status.tokenStored && status.binary && status.version && !error);
      update({ status, error, revision: state.revision + 1, connection: {
        readiness: ready ? "ready" : "attention",
        blocking: credentialBusy,
        attentionLabel: "Set up subscription",
        attentionDescription: error || (!status.tokenStored ? "Save your Claude subscription token." : !ready ? "Install Claude Code or select its executable in the agent settings." : `Claude ${status.version}; subscription token configured (not remotely validated).`)
      } });
    }, (error) => update({
      status: void 0,
      error: safeMessage(error),
      revision: state.revision + 1,
      connection: { readiness: "attention", blocking: credentialBusy, attentionLabel: "Fix subscription setup", attentionDescription: safeMessage(error) }
    })).finally(() => {
      checking = void 0;
    });
    return checking;
  }
  async function refresh() {
    await checking;
    epoch++;
    cache.clear();
    await check();
  }
  async function change(action, token, signal) {
    if (credentialBusy) throw new Error("A credential change is already in progress.");
    if (disposed) throw new Error("Subscription setup is closed.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    controllers.add(controller);
    credentialBusy = true;
    update({ connection: { ...state.connection, blocking: true } });
    try {
      let saved;
      const code = await bridgeRequest(host, source, { action, ...action === "save" ? { token: token.trim() } : {} }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "bridge_saved") saved = event;
        }
      });
      if (code !== 0 || !saved) throw new Error("The credential store did not confirm this change. Check status before trying again.");
      await refresh();
      return saved;
    } finally {
      signal?.removeEventListener("abort", abort);
      controllers.delete(controller);
      credentialBusy = false;
      update({ connection: { ...state.connection, blocking: false } });
    }
  }
  return {
    inspect,
    check,
    refresh,
    change,
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      listeners.clear();
    }
  };
}

// src/ui.jsx
function createUI(React, setup, runtime) {
  function Form({ children }) {
    return /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 16, minWidth: 0 } }, /* @__PURE__ */ React.createElement("style", null, `
        .kvncrw-claude-control {
          box-sizing: border-box; min-width: 0; padding: 9px 11px;
          border: 1px solid color-mix(in srgb,currentColor 25%,transparent);
          border-radius: 9px; background: color-mix(in srgb,currentColor 5%,transparent);
          color: inherit; font: inherit;
        }
        :is(input,textarea,select).kvncrw-claude-control { display: block; width: 100%; margin-top: 6px; }
        button.kvncrw-claude-control { cursor: pointer; }
        .kvncrw-claude-control:disabled { opacity: .5; cursor: not-allowed; }
        .kvncrw-claude-control:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        .kvncrw-claude-copy { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
      `), children);
  }
  const Button = (props) => /* @__PURE__ */ React.createElement("button", { className: "kvncrw-claude-control", ...props });
  const Copy = (props) => /* @__PURE__ */ React.createElement("p", { className: "kvncrw-claude-copy", ...props });
  function Connection({ active: isActive = () => true }) {
    const { connection, status, error } = React.useSyncExternalStore(setup.subscribe, setup.snapshot);
    const [token, setToken] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState("");
    const [confirmRemove, setConfirmRemove] = React.useState(false);
    const controller = React.useRef();
    React.useEffect(() => {
      void setup.check();
      return () => controller.current?.abort();
    }, []);
    async function change(action) {
      if (!isActive() || busy || connection.blocking) return;
      const value = token.trim();
      setToken("");
      setConfirmRemove(false);
      setMessage("");
      setBusy(true);
      const cancel = new AbortController();
      controller.current = cancel;
      try {
        const saved = await setup.change(action, value, cancel.signal);
        setMessage(saved.tokenStored ? "Token saved in the operating system credential store." : "Stored token removed. Already running turns may still finish.");
      } catch (error2) {
        setMessage(cancel.signal.aborted ? "Operation cancelled. Check status to determine whether the credential change completed." : safeMessage(error2));
      } finally {
        controller.current = void 0;
        setBusy(false);
      }
    }
    return /* @__PURE__ */ React.createElement(Form, null, /* @__PURE__ */ React.createElement("section", { className: "ui-card", style: { padding: 16, display: "grid", gap: 12 } }, /* @__PURE__ */ React.createElement("h2", null, "Claude Code (subscription)"), /* @__PURE__ */ React.createElement(Copy, null, "Uses your Claude subscription, not an Anthropic API key or Buzz's built-in Claude sign-in."), /* @__PURE__ */ React.createElement("dl", { style: { overflowWrap: "anywhere" } }, /* @__PURE__ */ React.createElement("dt", null, "Automatically detected Claude binary"), /* @__PURE__ */ React.createElement("dd", null, status?.binary || "Not detected"), /* @__PURE__ */ React.createElement("dt", null, "Version"), /* @__PURE__ */ React.createElement("dd", null, status?.version || "Not detected"), /* @__PURE__ */ React.createElement("dt", null, "Subscription token"), /* @__PURE__ */ React.createElement("dd", null, status ? status.tokenStored ? "Configured; validity checked when a turn runs" : "Not configured" : "Unknown")), /* @__PURE__ */ React.createElement(Copy, { role: error ? "alert" : "status" }, error || connection.attentionDescription), /* @__PURE__ */ React.createElement(Copy, null, "Device status uses automatic executable detection. A custom per-agent executable is checked separately when you leave its field. Install Node.js 20+ and Claude Code 2.1.267+ on the same system as Buzz, then restart Buzz so its desktop PATH includes node."), /* @__PURE__ */ React.createElement(Copy, null, "Linux and WSL require secret-tool and an unlocked Secret Service session; macOS uses Keychain; Windows uses the bridge's Windows credential store. WSL and Windows keep separate credentials."), /* @__PURE__ */ React.createElement("label", null, "Subscription token", /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "kvncrw-claude-control",
        type: "password",
        autoComplete: "off",
        spellCheck: false,
        value: token,
        disabled: busy || connection.blocking,
        onChange: (event) => setToken(event.target.value)
      }
    )), /* @__PURE__ */ React.createElement(Copy, null, "Paste only here, never in chat. The field clears on Save, even if saving fails. The token travels through private process stdin, never agent settings, browser storage or command arguments."), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(Button, { disabled: busy || connection.blocking || !token.trim(), onClick: () => void change("save") }, status?.tokenStored ? "Replace token" : "Save token"), " ", /* @__PURE__ */ React.createElement(Button, { disabled: busy || connection.blocking || connection.readiness === "checking", onClick: () => void setup.refresh() }, "Check status"), " ", /* @__PURE__ */ React.createElement(Button, { disabled: busy || connection.blocking || !status?.tokenStored, onClick: () => setConfirmRemove(true) }, "Remove token\u2026"), " ", busy && /* @__PURE__ */ React.createElement(Button, { onClick: () => controller.current?.abort() }, "Cancel")), confirmRemove && /* @__PURE__ */ React.createElement("div", { role: "alert" }, /* @__PURE__ */ React.createElement(Copy, null, "Remove the saved token from this device? Future turns require another saved token."), /* @__PURE__ */ React.createElement(Button, { onClick: () => void change("remove") }, "Confirm removal"), " ", /* @__PURE__ */ React.createElement(Button, { onClick: () => setConfirmRemove(false) }, "Keep token")), message && /* @__PURE__ */ React.createElement(Copy, { role: "status" }, message), /* @__PURE__ */ React.createElement(Copy, null, "Claude's tool permissions are not an OS sandbox. This trusted plugin, Claude and approved tools can access this account's files and network. No Buzz protection or permission bypass is enabled.")));
  }
  function Fields({ config, onChange, disabled, onBinaryBlur }) {
    const value = { ...defaults(), ...config };
    const field = (name, next) => onChange({ ...value, [name]: next });
    return /* @__PURE__ */ React.createElement(Form, null, /* @__PURE__ */ React.createElement("fieldset", { disabled, style: { display: "grid", gap: 16 } }, /* @__PURE__ */ React.createElement("label", null, "Model alias or ID", /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "kvncrw-claude-control",
        value: value.model,
        placeholder: "sonnet, opus, haiku, fable, or a full Claude model ID",
        onChange: (event) => field("model", event.target.value)
      }
    )), /* @__PURE__ */ React.createElement("label", null, "Working folder", /* @__PURE__ */ React.createElement("input", { className: "kvncrw-claude-control", value: value.cwd, onChange: (event) => field("cwd", event.target.value) })), /* @__PURE__ */ React.createElement(Copy, null, "Use an absolute path or ~/\u2026 on the system running Buzz. The default folder is created automatically; a custom folder must exist. This is a working directory, not filesystem containment."), /* @__PURE__ */ React.createElement("label", null, "Claude executable (optional)", /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "kvncrw-claude-control",
        value: value.binary,
        placeholder: "Auto-detect, or absolute path to Claude",
        onChange: (event) => field("binary", event.target.value),
        onBlur: onBinaryBlur
      }
    )), /* @__PURE__ */ React.createElement("label", null, "Permissions", /* @__PURE__ */ React.createElement("select", { className: "kvncrw-claude-control", value: value.permissionMode, onChange: (event) => field("permissionMode", event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "default" }, "Default \u2014 standard Claude permissions"), /* @__PURE__ */ React.createElement("option", { value: "acceptEdits" }, "Accept edits \u2014 automatically approve file edits"))), /* @__PURE__ */ React.createElement(Copy, null, "Buzz MCP tools are explicitly allowed, including reading and uploading local files. Other actions follow Claude's standard permissions. Requests needing interactive approval are denied, not silently approved. Accept edits authorizes file changes, not every shell command. Neither mode is an OS sandbox."), /* @__PURE__ */ React.createElement("label", null, "Conversation sessions", /* @__PURE__ */ React.createElement("select", { className: "kvncrw-claude-control", value: value.scope, onChange: (event) => field("scope", event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "thread" }, "One per thread (DMs and Solo chats stay whole)"), /* @__PURE__ */ React.createElement("option", { value: "channel" }, "One per channel"))), /* @__PURE__ */ React.createElement("label", null, "Agent instructions", /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "kvncrw-claude-control",
        value: value.instructions,
        rows: 6,
        onChange: (event) => field("instructions", event.target.value)
      }
    ))));
  }
  function Create(props) {
    const { revision, connection } = React.useSyncExternalStore(setup.subscribe, setup.snapshot);
    const [binary, setBinary] = React.useState(() => configOf(props.config).binary);
    const [checked, setChecked] = React.useState();
    const [problem, setProblem] = React.useState("");
    React.useEffect(() => {
      let active = true;
      setChecked(void 0);
      setProblem("");
      void setup.inspect(binary).then((value) => {
        if (!active) return;
        setChecked({ binary, revision, ready: Boolean(value.tokenStored && value.binary && value.version && !value.credentialError && !value.cliError) });
        setProblem([value.credentialError, value.cliError].filter(Boolean).map(safeMessage).join(" "));
      }, (error) => {
        if (active) setProblem(safeMessage(error));
      });
      return () => {
        active = false;
      };
    }, [binary, revision]);
    const ready = Boolean(checked?.ready && checked.binary === configOf(props.config).binary && checked.revision === revision && configReady(props.config) && !connection.blocking);
    React.useEffect(() => {
      props.onReadyChange?.(ready);
    }, [ready, props.onReadyChange]);
    return /* @__PURE__ */ React.createElement(Form, null, props.harnessControl, /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", { className: "kvncrw-claude-control" }, "Subscription token setup"), /* @__PURE__ */ React.createElement(Connection, null)), /* @__PURE__ */ React.createElement(Fields, { ...props, onBinaryBlur: () => setBinary(configOf(props.config).binary) }), /* @__PURE__ */ React.createElement(Copy, { role: problem ? "alert" : "status" }, problem || (ready ? "Subscription setup is ready." : "Enter a model and working folder, then leave the executable field to check it. Open Subscription token setup to save a token.")));
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
        await saveSettings(save, draft);
        setMessage("Settings saved for future turns. Active turns continue; model and instruction changes preserve conversations.");
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
        await runtime.retire(agent.key);
        setConfirmReset(false);
        setMessage("Saved conversation associations cleared. Claude transcript files are not deleted.");
      } catch (error) {
        setMessage(safeMessage(error));
      } finally {
        setBusy(false);
      }
    }
    return /* @__PURE__ */ React.createElement(Form, null, settingsContent, settingsHost?.typeControl?.(JSON.stringify(draft) !== JSON.stringify(configOf(agent.config))), /* @__PURE__ */ React.createElement(Fields, { config: draft, onChange: setDraft, disabled: busy }), /* @__PURE__ */ React.createElement(Button, { disabled: busy || !configReady(draft), onClick: () => void commit() }, "Save settings"), /* @__PURE__ */ React.createElement(Button, { disabled: busy, onClick: () => setConfirmReset(true) }, "Reset saved conversations\u2026"), confirmReset && /* @__PURE__ */ React.createElement("div", { role: "alert" }, /* @__PURE__ */ React.createElement(Copy, null, "Stop this agent's active turns and forget its session associations? New arrivals are ignored during reset. The next turn receives Buzz conversation history; previous tool actions are not undone."), /* @__PURE__ */ React.createElement(Button, { disabled: busy, onClick: () => void reset() }, "Confirm reset"), " ", /* @__PURE__ */ React.createElement(Button, { onClick: () => setConfirmReset(false) }, "Cancel")), message && /* @__PURE__ */ React.createElement(Copy, { role: "status" }, message));
  }
  return { Connection, Create, Settings };
}

// src/plugin.jsx
var inject = ["react", "agents", "settingsCards", "host"];
function apply(ctx) {
  if (!ctx.agents.harness || !ctx.agents.storage) {
    throw new Error("Claude subscription requires Buzz 1.0.2 with the external harness kit and agent storage.");
  }
  const runtime = createRuntime(ctx, native_bridge_default);
  const setup = createSetup(ctx.host, native_bridge_default);
  const { Connection, Create, Settings } = createUI(ctx.react, setup, runtime);
  ctx.settingsCards.register({
    id: "subscription",
    title: "Claude Code (subscription)",
    personal: true,
    component: Connection
  });
  ctx.agents.register({
    id: "claude-subscription",
    title: "Claude Code (subscription)",
    description: "Your Claude subscription through an independent local CLI harness.",
    defaults: () => ({ config: defaults() }),
    summary: (agent) => `${configOf(agent.config).model} \xB7 subscription`,
    CreateConfiguration: Create,
    tabs: [{ id: "settings", title: "Settings", role: "settings", component: Settings }],
    provider: {
      snapshot: () => setup.snapshot().connection,
      subscribe: setup.subscribe,
      check: setup.refresh,
      DialogBody: Connection
    },
    models: (agent) => ({
      current: configOf(agent.config).model,
      models: [.../* @__PURE__ */ new Set([configOf(agent.config).model, "sonnet", "opus", "haiku", "fable"])].filter(Boolean).map((id) => ({ id, label: id, efforts: [] }))
    }),
    protectionUnavailable: "Standard Claude tool permissions only; this harness does not implement Buzz protection or OS sandboxing.",
    retire: runtime.retire,
    timeoutMs: 30 * 60 * 1e3,
    run: runtime.run
  });
  ctx.effect(() => {
    void setup.check();
    const prune = () => {
      void runtime.prune(ctx.agents.snapshot?.()).catch(() => {
      });
    };
    const unsubscribe = ctx.agents.subscribe?.(prune);
    prune();
    return () => {
      unsubscribe?.();
      runtime.dispose();
      setup.dispose();
    };
  });
}
export {
  apply,
  inject
};
