#!/usr/bin/env node
import { Pinglet } from '../dist/pinglet.js';

const analytics = new Pinglet({
  packageName: 'example-cli',
  packageVersion: '0.0.0',
  endpoint: process.env.PINGLET_ENDPOINT || 'http://127.0.0.1:3456/ping',
  askConsent: false,
  silent: true,
});

const command = process.argv[2] || 'help';

await analytics.track('run');
await analytics.track(`command:${command.replace(/[^a-z0-9_-]/gi, '_')}`);

console.log(`example-cli ran command: ${command}`);
