const fs = require('fs');
const path = require('path');
const assert = require('assert');

const sdkPath = path.resolve(__dirname, '..', 'sdk.js');
const src = fs.readFileSync(sdkPath, 'utf8');

assert(src.includes('window.YourSDK'), 'sdk.js must expose window.YourSDK');
console.log('Basic check passed: window.YourSDK found in sdk.js');
