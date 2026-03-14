// DEMO FILE: Remediated version of the secret leak example.
// All secret values are loaded from environment variables instead of source code.

const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const DB_CONNECTION = process.env.DATABASE_URL || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';

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
