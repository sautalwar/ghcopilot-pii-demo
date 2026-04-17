#!/usr/bin/env node
// Creates the ghas-vulnerable-demo repo with intentionally vulnerable files
require('dotenv').config();
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = 'sautalwar';
const repo = 'ghas-vulnerable-demo';

const files = {};

files['README.md'] = `# CustomerHub API — Intentionally Vulnerable Demo

> **WARNING: This repository is INTENTIONALLY VULNERABLE.** It contains fake secrets, outdated dependencies with known CVEs, and insecure code patterns. It exists solely to demonstrate GitHub Advanced Security (GHAS) scanning capabilities.

## Purpose
This repo is a test target for the [GHAS Security Scanner](https://github.com/sautalwar/ghcopilot-pii-demo) dashboard. It demonstrates detection of:
- Hardcoded secrets and credentials
- Vulnerable dependencies with known CVEs
- Code vulnerabilities (SQL injection, XSS, command injection)
- Security misconfigurations

## All Credentials Are FAKE
Every secret, key, and password in this repo is a fabricated example value. No real credentials are exposed.

## Stack
- Node.js / Express
- MongoDB
- Redis
- Docker Compose
`;

files['package.json'] = JSON.stringify({
  name: 'customerhub-api',
  version: '1.0.0',
  description: 'Customer management API (intentionally vulnerable demo)',
  main: 'src/server.js',
  scripts: {
    start: 'node src/server.js',
    dev: 'nodemon src/server.js',
    test: 'jest'
  },
  dependencies: {
    'express': '4.16.0',
    'lodash': '4.17.11',
    'axios': '0.19.0',
    'jsonwebtoken': '8.3.0',
    'mongoose': '5.7.5',
    'node-fetch': '2.6.0',
    'tar': '4.4.8',
    'minimist': '1.2.0',
    'glob-parent': '5.1.0',
    'qs': '6.5.2',
    'cors': '2.8.5',
    'body-parser': '1.18.3',
    'helmet': '3.15.0',
    'morgan': '1.9.1',
    'dotenv': '6.2.0',
    'bcrypt': '3.0.0'
  },
  devDependencies: {
    'jest': '24.0.0',
    'supertest': '3.4.0'
  }
}, null, 2);

files['.env'] = `# THIS FILE IS COMMITTED INTENTIONALLY FOR DEMO PURPOSES
# All values are FAKE/EXAMPLE — no real credentials

# Database
MONGODB_URI=mongodb://admin:SuperSecret123!@db.customerhub.internal:27017/customerhub
REDIS_URL=redis://default:r3d1s_p@ssw0rd@cache.customerhub.internal:6379

# AWS (fake demo keys - not real AWS format to avoid push protection)
AWS_ACCESS_KEY=DEMO_AKIA_FAKE_ACCESS_KEY_1234567890
AWS_SECRET_KEY=DEMO_wJalrXUt_FAKE_SECRET_KEY_1234567890abcdef
AWS_REGION=us-east-1
S3_BUCKET=customerhub-uploads

# Auth
JWT_SECRET=my-super-secret-jwt-key-do-not-share-2024
SESSION_SECRET=keyboard-cat-session-secret

# Third-party
STRIPE_KEY=sk_demo_51ABC123DEF456GHI789JKL0MNO
SENDGRID_KEY=SG.DEMO.aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890
SLACK_TOKEN=xoxb-demo-1234567890-AbCdEfGhIjKlMnOp

# API Keys
OPENAI_KEY=sk-demo-abcdef1234567890abcdef1234567890
GITHUB_PAT=ghp_DEMO_FAKE_TOKEN_abcdefghijklm

# Server
PORT=3000
NODE_ENV=development
DEBUG=true
password=SuperSecret123!
api_key=demo-api-key-1234567890abcdef
`;

files['src/server.js'] = `const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const { connectDB } = require('./database');
const authRoutes = require('./auth');
const webhookRoutes = require('./webhooks');

const app = express();

// SECURITY ISSUE: CORS wildcard allows any origin
app.use(cors({ origin: '*', credentials: true }));

// SECURITY ISSUE: Debug mode enabled in production
app.set('env', 'development');

app.use(bodyParser.json({ limit: '50mb' }));
app.use(morgan('combined'));

// SECURITY ISSUE: Verbose error details exposed
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: err.message,
    stack: err.stack,
    env: process.env
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', debug: true, version: '1.0.0' });
});

// SECURITY ISSUE: Exposes environment variables
app.get('/api/debug/env', (req, res) => {
  res.json(process.env);
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('CustomerHub API listening on port ' + PORT);
  });
});

module.exports = app;
`;

files['src/config.js'] = `// INTENTIONALLY VULNERABLE — Demo purposes only
// All credentials are FAKE example values

// SECURITY ISSUE: Hardcoded AWS credentials
const AWS_CONFIG = {
  accessKeyId: 'DEMO_AKIA_FAKE_ACCESS_KEY_1234567890',
  secretAccessKey: 'DEMO_wJalrXUt_FAKE_SECRET_KEY_1234567890abcdef',
  region: 'us-east-1',
};

// SECURITY ISSUE: Hardcoded GitHub PAT
const GITHUB_TOKEN = 'ghp_DEMO_FAKE_TOKEN_abcdefghijklm';

// SECURITY ISSUE: Hardcoded Slack token
const SLACK_TOKEN = 'xoxb-demo-1234567890-AbCdEfGhIjKlMnOp';

// SECURITY ISSUE: Hardcoded JWT signing secret
const JWT_SECRET = 'my-super-secret-jwt-key-do-not-share-2024';

// SECURITY ISSUE: Hardcoded API key
const api_key = 'demo-api-key-1234567890abcdef';

// SECURITY ISSUE: Hardcoded database password
const DB_PASSWORD = 'SuperSecret123!';

module.exports = {
  AWS_CONFIG,
  GITHUB_TOKEN,
  SLACK_TOKEN,
  JWT_SECRET,
  api_key,
  DB_PASSWORD,
  MONGO_URI: 'mongodb://admin:' + DB_PASSWORD + '@db.customerhub.internal:27017/customerhub',
  REDIS_URI: 'redis://default:r3d1s_p@ssw0rd@cache.customerhub.internal:6379',
};
`;

files['src/auth.js'] = `const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();

// SECURITY ISSUE: Hardcoded JWT secret
const SECRET = 'my-super-secret-jwt-key-do-not-share-2024';

// SECURITY ISSUE: Hardcoded password for admin account
const ADMIN_PASSWORD = 'admin123!';

// Fake user store
const users = [
  { id: 1, email: 'admin@customerhub.io', password: '$2b$10$examplehash', role: 'admin' },
  { id: 2, email: 'user@customerhub.io', password: '$2b$10$examplehash2', role: 'user' },
];

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // SECURITY ISSUE: SQL-like string concatenation
  const query = "SELECT * FROM users WHERE email = '" + email + "' AND active = 1";
  console.log('Auth query:', query);

  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: user.id, email: user.email } });
});

// SECURITY ISSUE: eval() used for template processing
router.get('/profile/:id', (req, res) => {
  const template = req.query.template || '{}';
  // TODO: fix security vulnerability in template rendering
  const result = eval('(' + template + ')');
  res.json(result);
});

// SECURITY ISSUE: No rate limiting, no input validation
router.post('/reset-password', (req, res) => {
  const { email, newPassword } = req.body;
  const user = users.find(u => u.email === email);
  if (user) {
    // SECURITY ISSUE: Password logged in plaintext
    console.log('Password reset for ' + email + ': ' + newPassword);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

module.exports = router;
`;

files['src/database.js'] = `const mongoose = require('mongoose');

// SECURITY ISSUE: Hardcoded connection string with credentials
const MONGO_URI = 'mongodb://admin:SuperSecret123!@db.customerhub.internal:27017/customerhub';

// SECURITY ISSUE: Hardcoded Redis password
const REDIS_CONFIG = {
  host: 'cache.customerhub.internal',
  port: 6379,
  password: 'r3d1s_p@ssw0rd',
};

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// SECURITY ISSUE: SQL injection via string concatenation
function findCustomerById(db, customerId) {
  const query = "SELECT * FROM customers WHERE id = " + customerId;
  return db.query(query);
}

// SECURITY ISSUE: NoSQL injection risk
function findCustomerByEmail(email) {
  return mongoose.model('Customer').findOne({ email: email });
}

// SECURITY ISSUE: Mass assignment — no field filtering
function updateCustomer(customerId, data) {
  return mongoose.model('Customer').findByIdAndUpdate(customerId, data, { new: true });
}

module.exports = { connectDB, findCustomerById, findCustomerByEmail, updateCustomer, MONGO_URI };
`;

files['src/webhooks.js'] = `const express = require('express');
const { exec, execFile } = require('child_process');
const axios = require('axios');
const router = express.Router();

// SECURITY ISSUE: Hardcoded IP addresses
const WEBHOOK_SERVER = '192.168.1.100';
const INTERNAL_API = '10.0.0.50';
const BACKUP_SERVER = '172.16.0.25';

// SECURITY ISSUE: Hardcoded API secret
const api_secret = 'whsec_MIGfMA0GCSqGSIb3DQEBAQUAA4GNAD';

// SECURITY ISSUE: Shell command injection
router.post('/deploy', (req, res) => {
  const { branch, environment } = req.body;
  exec('git checkout ' + branch + ' && npm run build', (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ output: stdout });
  });
});

// SECURITY ISSUE: SSRF — user-controlled URL
router.post('/fetch-url', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await axios.get(url);
    res.json({ data: response.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SECURITY ISSUE: Command injection via hostname
router.get('/ping/:host', (req, res) => {
  exec('ping -c 4 ' + req.params.host, (error, stdout) => {
    res.json({ result: stdout || (error && error.message) });
  });
});

// SECURITY ISSUE: Path traversal
router.get('/logs/:filename', (req, res) => {
  const path = '/var/log/customerhub/' + req.params.filename;
  res.sendFile(path);
});

module.exports = router;
`;

files['src/utils.js'] = `const _ = require('lodash');

// SECURITY ISSUE: Generic API key hardcoded
const api_key = 'AIzaSyDEMO-api-key-for-testing-purposes-only';

// SECURITY ISSUE: innerHTML usage (XSS vector)
function renderUserProfile(element, userData) {
  element.innerHTML = '<div class="profile">' +
    '<h2>' + userData.name + '</h2>' +
    '<p>' + userData.bio + '</p>' +
    '</div>';
}

// SECURITY ISSUE: innerHTML with user content
function displayNotification(container, message) {
  container.innerHTML = '<div class="alert">' + message + '</div>';
}

// SECURITY ISSUE: eval for JSON parsing
function parseConfig(configString) {
  return eval('(' + configString + ')');
}

// SECURITY ISSUE: Insecure random token generation
function generateToken() {
  return Math.random().toString(36).substring(2);
}

// SECURITY ISSUE: Prototype pollution via lodash merge
function mergeDefaults(userConfig) {
  return _.merge({}, { role: 'user', active: true }, userConfig);
}

module.exports = { renderUserProfile, displayNotification, parseConfig, generateToken, mergeDefaults, api_key };
`;

files['docker-compose.yml'] = `version: '3.8'
services:
  api:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=development
      - MONGODB_URI=mongodb://admin:SuperSecret123!@mongo:27017/customerhub
      - REDIS_URL=redis://default:r3d1s_p@ssw0rd@redis:6379
      - JWT_SECRET=my-super-secret-jwt-key-do-not-share-2024
      - AWS_ACCESS_KEY=DEMO_AKIA_FAKE_ACCESS_KEY_1234567890
      - AWS_SECRET_KEY=DEMO_wJalrXUt_FAKE_SECRET_KEY_1234567890abcdef
      - password=SuperSecret123!
      - api_key=demo-api-key-1234567890abcdef
    depends_on:
      - mongo
      - redis

  mongo:
    image: mongo:4.4
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: SuperSecret123!
    ports:
      - '27017:27017'
    volumes:
      - mongo-data:/data/db

  redis:
    image: redis:6-alpine
    command: redis-server --requirepass r3d1s_p@ssw0rd
    ports:
      - '6379:6379'

volumes:
  mongo-data:
`;

files['deploy/config.yml'] = `# Deployment configuration
# INTENTIONALLY VULNERABLE — Demo only

server:
  host: 0.0.0.0
  port: 3000

database:
  primary: mongodb://admin:SuperSecret123!@prod-db.customerhub.io:27017/customerhub
  replica: mongodb://reader:ReadOnly456@prod-db-replica.customerhub.io:27017/customerhub

cache:
  url: redis://default:r3d1s_p@ssw0rd@prod-cache.customerhub.io:6379

# SECURITY ISSUE: Private key committed
ssl:
  key: |
    -----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA2a2rwplBQLGBkHNW5DEMOKEY1234567890
    ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
    0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop
    ExampleKeyDataForDemoPurposesOnlyNotARealKey12345678
    -----END RSA PRIVATE KEY-----
  cert: /etc/ssl/customerhub.crt

monitoring:
  datadog_key: 'demo-datadog-key-abcdef1234567890'
  sentry_dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0'

# SECURITY ISSUE: Hardcoded password
admin:
  password: SuperSecretAdmin2024!
  api_key: demo-monitoring-api-key-12345

notifications:
  slack_webhook: 'https://hooks.slack.com/services/TDEMO000/BDEMO000/DEMO_WEBHOOK_TOKEN_12345'
`;

files['.gitignore'] = `node_modules/
*.log
.DS_Store
coverage/
# NOTE: .env is NOT in .gitignore — this is intentional for the demo
`;

async function main() {
  // Check if repo exists
  let exists = false;
  try {
    await octokit.repos.get({ owner, repo });
    exists = true;
    console.log('Repo already exists, will update files');
  } catch (e) {
    if (e.status === 404) {
      await octokit.repos.createForAuthenticatedUser({
        name: repo,
        description: 'Intentionally vulnerable demo app for GHAS security scanning demonstration',
        private: false,
        auto_init: false,
      });
      console.log('Created repo: ' + owner + '/' + repo);
    } else {
      throw e;
    }
  }

  // Create blobs
  const blobs = {};
  for (const [path, content] of Object.entries(files)) {
    const { data } = await octokit.git.createBlob({
      owner, repo,
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    });
    blobs[path] = data.sha;
    console.log('Created blob: ' + path);
  }

  // Create tree
  const treeItems = Object.entries(blobs).map(([path, sha]) => ({
    path,
    mode: '100644',
    type: 'blob',
    sha,
  }));

  const { data: tree } = await octokit.git.createTree({
    owner, repo,
    tree: treeItems,
  });
  console.log('Created tree: ' + tree.sha);

  // Create commit (with or without parent)
  let parents = [];
  if (exists) {
    try {
      const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
      parents = [ref.object.sha];
    } catch (e) {
      // No main branch yet
    }
  }

  const { data: commit } = await octokit.git.createCommit({
    owner, repo,
    message: 'Initial commit: CustomerHub API (intentionally vulnerable demo)\n\nAll secrets are FAKE example values for GHAS scanning demo.',
    tree: tree.sha,
    parents,
  });
  console.log('Created commit: ' + commit.sha);

  // Create or update main branch
  try {
    await octokit.git.createRef({
      owner, repo,
      ref: 'refs/heads/main',
      sha: commit.sha,
    });
    console.log('Created main branch');
  } catch (e) {
    await octokit.git.updateRef({
      owner, repo,
      ref: 'heads/main',
      sha: commit.sha,
      force: true,
    });
    console.log('Updated main branch');
  }

  // Set default branch
  await octokit.repos.update({
    owner, repo,
    default_branch: 'main',
  });

  console.log('\nRepository ready: https://github.com/' + owner + '/' + repo);
  console.log('Files: ' + Object.keys(files).length);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
