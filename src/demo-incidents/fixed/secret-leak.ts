const githubToken = process.env.GITHUB_TOKEN ?? "";

export function getGitHubToken(): string {
  return githubToken;
}
