import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const [chrome, url, width, height, output] = process.argv.slice(2);
if (!chrome || !url || !width || !height || !output) {
  console.error('Uso: node tools/capture-screenshot.mjs <chrome> <url> <largura> <altura> <arquivo>');
  process.exit(2);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-chrome-capture-'));
const child = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-sandbox',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});

let stderr = '';
const endpoint = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Chrome não iniciou: ${stderr.slice(-1000)}`)), 15000);
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  child.once('exit', (code) => {
    clearTimeout(timeout);
    reject(new Error(`Chrome encerrou antes do CDP: ${code}.`));
  });
});

const browserUrl = new URL(endpoint);
const target = await fetch(`http://${browserUrl.host}/json/new?${encodeURIComponent(url)}`, {method: 'PUT'}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once: true});
  socket.addEventListener('error', reject, {once: true});
});

let nextId = 0;
const pending = new Map();
const listeners = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const {resolve, reject} = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  for (const listener of listeners.get(message.method) || []) listener(message.params);
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({id, method, params}));
  return new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
}

function once(method) {
  return new Promise((resolve) => {
    const listener = (params) => {
      listeners.set(method, (listeners.get(method) || []).filter((item) => item !== listener));
      resolve(params);
    };
    listeners.set(method, [...(listeners.get(method) || []), listener]);
  });
}

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width),
    height: Number(height),
    deviceScaleFactor: 1,
    mobile: Number(width) <= 680,
  });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', {url});
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const screenshot = await send('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false});
  fs.mkdirSync(path.dirname(path.resolve(output)), {recursive: true});
  fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
} finally {
  socket.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  fs.rmSync(profile, {recursive: true, force: true});
}
