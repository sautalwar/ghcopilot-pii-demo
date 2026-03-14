[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Owner = 'sautalwar'
$Repo = 'ghcopilot-pii-demo'
$RepoSlug = "$Owner/$Repo"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TotalSteps = 6
$locationPushed = $false

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Info {
    param([string]$Message)
    Write-Host "  • $Message" -ForegroundColor Gray
}

function Write-Success {
    param([string]$Message)
    Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-WarningMessage {
    param([string]$Message)
    Write-Host "  ! $Message" -ForegroundColor Yellow
}

function Update-StepProgress {
    param(
        [int]$Step,
        [string]$Status
    )

    $percent = [Math]::Min([int](($Step / $TotalSteps) * 100), 100)
    Write-Progress -Activity 'GitHub Copilot security demo setup' -Status $Status -PercentComplete $percent
}

function Assert-Command {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing prerequisite '$Name'. $InstallHint"
    }

    Write-Success "$Name is available."
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string]$Description,
        [Parameter(Mandatory)] [scriptblock]$Command
    )

    Write-Info $Description
    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        $formattedOutput = ($output | Out-String).Trim()
        if ($formattedOutput) {
            throw "$Description failed.`n$formattedOutput"
        }

        throw "$Description failed with exit code $exitCode."
    }

    return $output
}

function Test-HasCommits {
    & git rev-parse --verify HEAD *> $null
    return ($LASTEXITCODE -eq 0)
}

function Ensure-MainBranch {
    $currentBranch = (& git branch --show-current).Trim()
    if ([string]::IsNullOrWhiteSpace($currentBranch)) {
        $currentBranch = 'main'
    }

    if ($currentBranch -eq 'master') {
        Invoke-Checked -Description "Renaming local branch 'master' to 'main'" -Command { git branch -M main } | Out-Null
        return 'main'
    }

    return $currentBranch
}

$copilotIgnoreContent = @'
# GitHub Copilot content exclusions for the security demo
*.env
**/secrets/**
**/credentials/**
src/demo-incidents/secret-leak.ts
'@

$copilotInstructions = @'
# GitHub Copilot Instructions

## ⚠️ IMPORTANT: This file is NOT a security boundary

These instructions guide Copilot's behavior but are NOT deterministic.
The LLM may ignore, misinterpret, or bypass these rules.
**DO NOT rely on this file for security enforcement.**

Use code-level controls (redaction services, content exclusion, MCP output filtering)
for actual security guarantees.

---

## PII Handling Rules (Best-Effort)

1. **Never output raw Social Security Numbers** in suggestions or chat responses.
2. **Always use parameterized queries** when writing SQL — never concatenate user input.
3. **Prefer the redaction service** when working with citizen data — import from `services/redaction-service`.
4. **Do not hardcode credentials** in source files — use environment variables from `.env`.
5. **When suggesting test data**, use obviously fake values (e.g., SSN: 000-00-0000).
6. **Log all PII access** through the audit logger at `security/audit-logger`.

## Code Patterns to Prefer

- Use `getAllCitizensRedacted()` over `getAllCitizens()` for external-facing code
- Use `maskSSN()`, `maskEmail()`, `maskPhone()` from `services/redaction-service`
- Wrap data access with audit logging from `security/audit-logger`

## Code Patterns to Avoid

- Direct SQL queries without parameterization
- Logging PII values to console in production code
- Returning raw citizen records from API endpoints without redaction option
- Storing PII in plain text configuration files
'@

try {
    Push-Location $RepoRoot
    $locationPushed = $true
    $env:GH_PAGER = ''

    Update-StepProgress -Step 1 -Status 'Checking prerequisites'
    Write-Step 'Checking prerequisites'
    Assert-Command -Name 'gh' -InstallHint 'Install GitHub CLI from https://cli.github.com/'
    Assert-Command -Name 'git' -InstallHint 'Install Git from https://git-scm.com/downloads'
    Assert-Command -Name 'node' -InstallHint 'Install Node.js from https://nodejs.org/'
    Assert-Command -Name 'npm' -InstallHint 'Install npm by installing Node.js from https://nodejs.org/'

    Update-StepProgress -Step 2 -Status 'Verifying GitHub authentication'
    Write-Step 'Verifying GitHub authentication and repository access'
    Invoke-Checked -Description 'Checking gh auth status' -Command { gh auth status } | Out-Null
    Invoke-Checked -Description "Confirming access to $RepoSlug" -Command { gh repo view $RepoSlug --json nameWithOwner --jq '.nameWithOwner' } | Out-Null
    Write-Success 'GitHub CLI authentication is ready.'

    Update-StepProgress -Step 3 -Status 'Enabling GHAS features'
    Write-Step 'Enabling GitHub Advanced Security features'
    Invoke-Checked -Description 'Applying GHAS, secret scanning, and push protection settings' -Command {
        gh api "repos/$Owner/$Repo" -X PATCH `
            -f "security_and_analysis[advanced_security][status]=enabled" `
            -f "security_and_analysis[secret_scanning][status]=enabled" `
            -f "security_and_analysis[secret_scanning_push_protection][status]=enabled"
    } | Out-Null
    Write-Success 'GHAS settings are enabled.'

    Update-StepProgress -Step 4 -Status 'Refreshing demo guardrail files'
    Write-Step 'Refreshing .copilotignore and Copilot instructions'
    Set-Content -Path (Join-Path $RepoRoot '.copilotignore') -Value $copilotIgnoreContent -Encoding UTF8

    $githubDirectory = Join-Path $RepoRoot '.github'
    if (-not (Test-Path $githubDirectory)) {
        New-Item -ItemType Directory -Path $githubDirectory | Out-Null
        Write-Info 'Created .github directory.'
    }

    Set-Content -Path (Join-Path $githubDirectory 'copilot-instructions.md') -Value $copilotInstructions -Encoding UTF8
    Write-Success 'Copilot guardrail files are in place.'

    Update-StepProgress -Step 5 -Status 'Installing dependencies'
    Write-Step 'Installing npm dependencies'
    if (Test-Path (Join-Path $RepoRoot 'package.json')) {
        Invoke-Checked -Description 'Running npm install' -Command { npm install } | Out-Null
        Write-Success 'npm install completed.'
    }
    else {
        Write-WarningMessage 'package.json was not found in the repository root. Skipping npm install.'
    }

    Update-StepProgress -Step 6 -Status 'Creating initial commit if needed'
    Write-Step 'Ensuring the repository has an initial push to main'
    Invoke-Checked -Description 'Verifying origin remote' -Command { git remote get-url origin } | Out-Null

    $hasCommits = Test-HasCommits
    $currentBranch = Ensure-MainBranch

    if (-not $hasCommits) {
        Invoke-Checked -Description 'Staging repository contents' -Command { git add --all } | Out-Null
        $pendingChanges = @(& git status --porcelain)

        if ($pendingChanges.Count -gt 0) {
            Invoke-Checked -Description 'Creating initial commit' -Command { git commit -m 'Initial demo setup' } | Out-Null
            Invoke-Checked -Description 'Pushing initial commit to origin/main' -Command { git push -u origin main } | Out-Null
            Write-Success 'Initial commit created and pushed to origin/main.'
        }
        else {
            Write-WarningMessage 'No tracked changes were found for the initial commit.'
        }
    }
    else {
        & git ls-remote --exit-code --heads origin main *> $null
        $remoteMainExists = ($LASTEXITCODE -eq 0)

        if ($remoteMainExists) {
            Write-Success 'origin/main already exists. No bootstrap push was required.'
        }
        else {
            if ($currentBranch -eq 'main') {
                Invoke-Checked -Description 'Pushing existing history to origin/main' -Command { git push -u origin main } | Out-Null
            }
            else {
                Invoke-Checked -Description "Pushing existing history from '$currentBranch' to origin/main" -Command { git push -u origin HEAD:main } | Out-Null
            }

            Write-Success 'Existing history pushed to origin/main.'
        }
    }

    Write-Progress -Activity 'GitHub Copilot security demo setup' -Completed
    Write-Host "`nSetup complete for $RepoSlug." -ForegroundColor Green
    Write-Host 'Next steps:' -ForegroundColor Cyan
    Write-Host '  1. Create or push a demo/* branch to trigger the security scenarios.' -ForegroundColor White
    Write-Host '  2. Use scripts\demo-reset.ps1 between demo runs for a fast cleanup.' -ForegroundColor White
    Write-Host '  3. Use scripts\teardown.ps1 when you want a full repository cleanup.' -ForegroundColor White
}
catch {
    Write-Progress -Activity 'GitHub Copilot security demo setup' -Completed
    Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
}
