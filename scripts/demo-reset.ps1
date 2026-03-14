[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Owner = 'sautalwar'
$Repo = 'ghcopilot-pii-demo'
$RepoSlug = "$Owner/$Repo"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TotalSteps = 3
$locationPushed = $false
$summary = [ordered]@{
    DemoBranchesDeleted = 0
    DemoIssuesClosed = 0
    DemoPullRequestsClosed = 0
}

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
    Write-Progress -Activity 'GitHub Copilot demo reset' -Status $Status -PercentComplete $percent
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
        [Parameter(Mandatory)] [scriptblock]$Command,
        [switch]$AllowFailure
    )

    Write-Info $Description
    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        $formattedOutput = ($output | Out-String).Trim()
        if ($AllowFailure) {
            if ($formattedOutput) {
                Write-WarningMessage $formattedOutput
            }

            return $false
        }

        if ($formattedOutput) {
            throw "$Description failed.`n$formattedOutput"
        }

        throw "$Description failed with exit code $exitCode."
    }

    return $true
}

function Get-Lines {
    param([scriptblock]$Command)

    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $formattedOutput = ($output | Out-String).Trim()
        if ($formattedOutput) {
            throw $formattedOutput
        }

        throw 'The GitHub CLI command failed.'
    }

    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.ToString().Trim() })
}

try {
    Push-Location $RepoRoot
    $locationPushed = $true
    $env:GH_PAGER = ''

    Update-StepProgress -Step 1 -Status 'Checking prerequisites'
    Write-Step 'Checking GitHub CLI prerequisites'
    Assert-Command -Name 'gh' -InstallHint 'Install GitHub CLI from https://cli.github.com/'
    Invoke-Checked -Description 'Checking gh auth status' -Command { gh auth status } | Out-Null
    Invoke-Checked -Description "Confirming access to $RepoSlug" -Command { gh repo view $RepoSlug --json nameWithOwner --jq '.nameWithOwner' } | Out-Null
    Write-Success 'GitHub CLI authentication is ready.'

    Update-StepProgress -Step 2 -Status 'Deleting demo branches'
    Write-Step 'Deleting demo branches'
    $branches = @(Get-Lines { gh api --paginate "repos/$Owner/$Repo/git/refs" --jq '.[].ref' } | Where-Object { $_ -match '^refs/heads/demo/' })

    if ($branches.Count -eq 0) {
        Write-WarningMessage 'No demo branches were found.'
    }
    else {
        foreach ($branch in $branches) {
            $refPath = $branch -replace '^refs/', ''
            if (Invoke-Checked -Description "Deleting $refPath" -Command { gh api "repos/$Owner/$Repo/git/refs/$refPath" -X DELETE } -AllowFailure) {
                $summary.DemoBranchesDeleted++
            }
        }

        Write-Success "Deleted $($summary.DemoBranchesDeleted) demo branch(es)."
    }

    Update-StepProgress -Step 3 -Status 'Closing demo issues and pull requests'
    Write-Step 'Closing demo issues'
    $issues = @(Get-Lines { gh issue list --repo $RepoSlug --label demo --state open --limit 200 --json number --jq '.[].number' })

    if ($issues.Count -eq 0) {
        Write-WarningMessage 'No open demo issues were found.'
    }
    else {
        foreach ($issue in $issues) {
            if (Invoke-Checked -Description "Closing issue #$issue" -Command { gh issue close $issue --repo $RepoSlug }) {
                $summary.DemoIssuesClosed++
            }
        }

        Write-Success "Closed $($summary.DemoIssuesClosed) demo issue(s)."
    }

    Write-Step 'Closing demo pull requests'
    $prs = @(Get-Lines { gh pr list --repo $RepoSlug --state open --limit 200 --json number,headRefName --jq '.[] | select(.headRefName | startswith("demo/")) | .number' })

    if ($prs.Count -eq 0) {
        Write-WarningMessage 'No open demo pull requests were found.'
    }
    else {
        foreach ($pr in $prs) {
            $closed = Invoke-Checked -Description "Closing pull request #$pr and deleting its branch" -Command { gh pr close $pr --repo $RepoSlug --delete-branch } -AllowFailure
            if (-not $closed) {
                $closed = Invoke-Checked -Description "Retrying pull request #$pr without branch deletion" -Command { gh pr close $pr --repo $RepoSlug } -AllowFailure
            }

            if ($closed) {
                $summary.DemoPullRequestsClosed++
            }
        }

        Write-Success "Closed $($summary.DemoPullRequestsClosed) demo pull request(s)."
    }

    Write-Progress -Activity 'GitHub Copilot demo reset' -Completed
    Write-Host "`nDemo reset complete for $RepoSlug." -ForegroundColor Green
    Write-Host 'Cleanup summary:' -ForegroundColor Cyan
    foreach ($entry in $summary.GetEnumerator()) {
        Write-Host ("  {0}: {1}" -f $entry.Key, $entry.Value) -ForegroundColor White
    }
}
catch {
    Write-Progress -Activity 'GitHub Copilot demo reset' -Completed
    Write-Host "`nDemo reset failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
}
