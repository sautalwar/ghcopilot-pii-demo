// DEMO FILE: This intentionally contains fake secrets for demo purposes
// DO NOT use real credentials in source control.

// Fake AWS Access Key (matches AKIA shape for scanners, but is not real)
const AWS_ACCESS_KEY = "REDACTED_AWS_ACCESS_KEY";
const AWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

// Fake database connection string for live-demo secret scanning
const DB_CONNECTION = "Server=demo-server;Database=citizens;User Id=admin;Password=REDACTED_PASSWORD";

// Fake API tokens
const GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12";
const SLACK_WEBHOOK = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export function getConfig() {
  return {
    aws: {
      accessKey: AWS_ACCESS_KEY,
      secretKey: AWS_SECRET_KEY
    },
    db: DB_CONNECTION,
    github: GITHUB_TOKEN,
    slack: SLACK_WEBHOOK
  };
}
