# WorkIQ MCP Troubleshooting Log

**Package**: `@microsoft/workiq` v0.4.0  
**Account**: `sautalwar@microsoft.com` (MSIT tenant)  
**Goal**: Get WorkIQ MCP server working in VS Code to query M365 calendar  
**Session Duration**: 5+ hours  

---

## ✅ CONFIRMED ROOT CAUSE (Session 2 - Deep Dive)

### 1. `.workiq.json` disappears because workiq DELETES IT on auth failure
Confirmed via `--log-level Trace` output. When MSAL silent auth fails, workiq:
1. Logs `MsalUiRequiredException: wam_no_account_for_id`
2. Launches interactive auth flow (`AcquireTokenInteractive`)
3. Shows **Windows Account Picker** (WAM dialog)
4. If no HWND available (background process) → auth fails → workiq **deletes `.workiq.json`** and exits

### 2. MSAL error: `wam_no_account_for_id`
This happens when the workiq app's MSAL token cache is invalidated (e.g., after PRT refresh at Azure AD level). Even with a valid system PRT (`AzureAdPrt: YES`, expiry: 2026-04-03), the **app-specific** WAM account entry becomes stale.

### 3. Fix requires Windows Account Picker interaction
workiq DOES fall back to `AcquireTokenInteractive` → shows Windows Account Picker. This requires a **visible window with HWND**. Running in a background process prevents this.

### 4. Device is AAD-joined to Microsoft tenant ✅
- `AzureAdJoined: YES`, `TenantName: Microsoft`
- `AzureAdPrt: YES` (valid, updated 2026-03-20)
- This should enable SSO via WAM once account is selected once

---

## Previous Symptom (SOLVED)

**MCP server cannot start**: `Process exited with code 1`  
**CLI behavior**: `npx @microsoft/workiq ask -q "question" -v 2>&1` → exits `1`, zero stdout, zero stderr  
**MCP tool call**: `mcp_workiq_ask_work_iq` → `ERROR: MCP server could not be started: Process exited with code 1`

This was caused by missing `.workiq.json`. Now SOLVED by:
- Switching from `npx` to globally installed `workiq` command in mcp.json
- Recreating `.workiq.json` as compact UTF-8 JSON

## Current Symptom (Auth Required)

**MCP tool call**: `mcp_workiq_ask_work_iq` → `{"response":null,"error":"An error occurred while processing your request."}`

**Root cause**: MSAL WAM `wam_no_account_for_id` — needs fresh Windows Account Picker interaction

---

## The Fix (What Actually Needs Done)

1. Open a **visible terminal** (PowerShell window, not VS Code background terminal)
2. Run: `workiq ask -q "hello"`
3. Click through the **Windows Account Picker** that appears
4. Select `sautalwar@microsoft.com`
5. After this succeeds, MCP tool calls will work (MSAL caches the account silently after first auth)

**One-liner to do this**:
```powershell
Start-Process powershell -ArgumentList "-NoProfile -Command workiq ask -q hello" -WindowStyle Normal -Wait
```

---

## Old Root Cause Section (Historical)

**`.workiq.json` keeps disappearing from `C:\Users\sautalwar\.workiq.json`**

✅ NOW UNDERSTOOD: WorkIQ deletes the file itself on failed auth. It is NOT being deleted by Windows or other apps.

The file keeps disappearing because:
- Auth fails (MSAL WAM account not found)
- workiq deletes `.workiq.json` as cleanup
- Next session: file missing → exit code 1

**Solution**: Make file read-only AFTER auth is working (to prevent deletion after network hiccups). Or accept that you need to run `workiq ask` interactively after each OS/PRT update.

---

## Config Files

### `C:\Users\sautalwar\AppData\Roaming\Code\User\mcp.json` ✅ VALID
```json
{
  "servers": {
    "workiq": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@microsoft/workiq", "mcp", "--verbose"],
      "env": {
        "DEBUG": "*",
        "LOG_LEVEL": "debug",
        "NODE_DEBUG": "http,https,net",
        "DOTNET_CLI_TELEMETRY_VERBOSE": "1"
      }
    }
  }
}
```

### `C:\Users\sautalwar\.workiq.json` ❌ KEEPS DISAPPEARING
Required compact format:
```json
{"defaultAccount":"sautalwar@microsoft.com","isMSITTenant":true,"I-accept-EULA":true}
```
Issue: `ConvertTo-Json` writes pretty-printed JSON (4-space indented) — WorkIQ may require compact format.

---

## Attempted Approaches (DO NOT REPEAT)

### 1. ❌ Basic CLI invocation
```powershell
npx @microsoft/workiq ask -q "What are my meetings today?" 2>&1
```
**Result**: Exit code 1, zero output  
**When**: Multiple times across sessions

### 2. ❌ Positional args (no -q flag)
```powershell
npx @microsoft/workiq ask "What are my meetings today?" 2>&1
```
**Result**: "Unrecognized command or argument" — WorkIQ DOES output text here  
**Learning**: Without -q flag, WorkIQ outputs text. With -q flag + missing config, it's completely silent.

### 3. ❌ Start-Process with output redirection
```powershell
Start-Process -FilePath "npx" -ArgumentList "@microsoft/workiq","ask","-q","test" `
  -RedirectStandardOutput "$env:TEMP\wiq_out.txt" `
  -RedirectStandardError "$env:TEMP\wiq_err.txt" -Wait -NoNewWindow
```
**Result**: Output files never created (truly zero bytes of output), exit code 1  
**Learning**: The silence is real — not a terminal piping issue

### 4. ❌ Tee-Object to capture output
```powershell
npx @microsoft/workiq ask -q "test" 2>&1 | Tee-Object -FilePath "$env:TEMP\wiq_out.txt"
```
**Result**: File never created  
**Learning**: Same as above — genuinely produces zero output

### 5. ❌ Adding debug environment variables to mcp.json
Added: `DEBUG=*`, `LOG_LEVEL=debug`, `NODE_DEBUG=http,https,net`, `DOTNET_CLI_TELEMETRY_VERBOSE=1`  
**Result**: No additional output visible at all  
**Learning**: WorkIQ (.NET wrapped in Node) likely ignores standard Node debug env vars

### 6. ❌ Browser EULA acceptance
Accepted EULA in browser via Microsoft's WorkIQ page  
**Result**: WorkIQ still exits code 1  
**Learning**: Browser EULA ≠ `mcp_workiq_accept_eula` MCP tool acceptance

### 7. ❌ Recreating .workiq.json with ConvertTo-Json (pretty-printed)
```powershell
$config = @{defaultAccount="sautalwar@microsoft.com"; isMSITTenant=$true; "I-accept-EULA"=$true}
$config | ConvertTo-Json | Out-File "$env:USERPROFILE\.workiq.json" -Encoding utf8 -Force
```
**Result**: File recreated but WorkIQ still exits code 1  
**Issue**: `ConvertTo-Json` outputs indented JSON, WorkIQ may want compact format  
**Also**: File disappeared again in the next session

### 8. ❌ Calling mcp_workiq_ask_work_iq directly
```
Result: ERROR while calling tool: MCP server could not be started: Process exited with code 1
```
**Result**: Same as above — MCP server never starts

### 9. ❌ Windows Event Log check
```powershell
Get-EventLog -LogName Application -Newest 20 | Where-Object {$_.Source -match "workiq|node|npm"}
```
**Result**: Old cached terminal output returned; no workiq crash entries found

### 10. ❌ Searching npx cache for binary
```powershell
Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter "*.exe" | Select-Object -First 10
```
**Result**: 16KB cached output — binary location found but WorkIQ still fails

### 11. ❌ Checking all known config locations
Checked: `~/.workiq.json`, `~/.workiq/`, `%APPDATA%\workiq`, `%LOCALAPPDATA%\workiq`  
**Result**: Most were NOT FOUND; `.workiq.json` only appeared transiently

---

## Untried Approaches (Next Steps)

### HIGH PRIORITY (likely to fix the issue)

1. **Clear npm/npx cache** — Stale/corrupt cached package may be root cause
   ```powershell
   npm cache clean --force
   Remove-Item "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Force -ErrorAction SilentlyContinue
   npx --yes @microsoft/workiq ask -q "test" 2>&1
   ```

2. **Compact JSON for .workiq.json + make read-only**
   ```powershell
   '{"defaultAccount":"sautalwar@microsoft.com","isMSITTenant":true,"I-accept-EULA":true}' | 
     Out-File -FilePath "$env:USERPROFILE\.workiq.json" -Encoding utf8NoBOM -NoNewline -Force
   Set-ItemProperty "$env:USERPROFILE\.workiq.json" -Name IsReadOnly -Value $true
   ```

3. **Call `mcp_workiq_accept_eula` MCP tool** (NEVER TRIED in VS Code — browser EULA is different)

4. **VS Code Developer Tools (F12 → Console)** — Shows exact error VS Code sees when MCP server starts  
   `Help → Toggle Developer Tools → Console → filter "workiq" or "MCP"`

5. **Windows Credential Manager** — WorkIQ (.NET/MSAL) stores auth tokens here; stale = auth fail
   ```powershell
   cmdkey /list | Select-String "microsoft|workiq|365|graph|msal" -CaseSensitive:$false
   ```

6. **Find WorkIQ `login` or `auth` subcommand**
   ```powershell
   npx @microsoft/workiq 2>&1 | Out-File "$env:TEMP\wiq_help.txt"
   Get-Content "$env:TEMP\wiq_help.txt"
   ```

7. **Inspect WorkIQ binary** — Read actual .NET DLL embedded in npm package  
   ```powershell
   Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse | Where-Object {$_.Name -match "workiq"}
   ```

### MEDIUM PRIORITY

8. **Node.js version compatibility check**
   ```powershell
   node --version  # WorkIQ may require specific version
   ```

9. **Run `npx @microsoft/workiq mcp` directly in VS Code Integrated Terminal**  
   MCP server runs with stdio — running in VS Code terminal may reveal output that VS Code MCP host misses

10. **Force fresh download with `--prefer-online`**
    ```powershell
    npx --prefer-online @microsoft/workiq ask -q "test" 2>&1
    ```

11. **WorkIQ VS Code Extension** — May exist separately and require its own sign-in flow  
    Check VS Code Extensions panel: search "workiq" or "work iq"

12. **MSAL token cache**
    ```powershell
    Get-ChildItem "$env:LOCALAPPDATA\Microsoft" -Recurse -Filter "*.cache" | Select-String "workiq" -l
    Get-ChildItem "$env:LOCALAPPDATA\Microsoft" -Recurse | Where-Object {$_.Name -match "workiq|msal"}
    ```

13. **Process Monitor (Sysinternals)** — Would show every file/registry access WorkIQ makes before dying  
    Reveals exactly what it reads and where it fails (requires manual installation)

### LOW PRIORITY (if all else fails)

14. **Install globally instead of npx**
    ```powershell
    npm install -g @microsoft/workiq
    workiq ask -q "test" 2>&1
    # Then update mcp.json to use "command": "workiq" instead of npx
    ```

15. **Run as different user** — Rule out profile-specific config corruption

16. **Check proxy/network** — MSAL auth requires internet; corporate proxy may block token endpoint

---

## Key Technical Facts

- WorkIQ is a **.NET application** wrapped as an npm package — Node debug env vars don't affect the .NET process
- Auth uses **MSAL.NET** → requires Windows Credential Manager or cached token
- MCP stdio mode **cannot launch browser** for interactive auth — must authenticate separately first
- WorkIQ reads `.workiq.json` from user home directory (`$env:USERPROFILE`)
- `I-accept-EULA: true` key in `.workiq.json` is required (case-sensitive JSON key)
- When .workiq.json is missing: **completely silent exit 1** (not even "config not found" message)
- When wrong args: produces text output (e.g., "Unrecognized command or argument")

---

## Timeline of Sessions

| Session | What Happened |
|---------|---------------|
| Session 1-3 | Basic CLI testing, discovered -q flag required |
| Session 4 | Added debug env vars to mcp.json, no effect |
| Session 5 | Confirmed .workiq.json keeps disappearing |
| Session 6 | Recreated .workiq.json with ConvertTo-Json (pretty-printed), still fails |
| Current | Root cause confirmed: .workiq.json disappearance + possible format issue |

---

*Last updated: 2026-03-19*
