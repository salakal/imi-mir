// Open the built app at phone width, select each reproduced group and inspect
// the rendered Monday cards. Uses the Chrome installed on GitHub's runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'imi-chrome-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--remote-allow-origins=*', '--remote-debugging-port=9222',
  `--user-data-dir=${directory}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(action, label, limit = 45000) {
  const end = Date.now() + limit;
  let last;
  while (Date.now() < end) {
    try { const result = await action(); if (result) return result; }
    catch (error) { last = error; }
    await sleep(450);
  }
  throw new Error(`Ожидание ${label} истекло${last ? `: ${last.message}` : ''}`);
}
let socket;
try {
  const target = await until(async () => {
    const response = await fetch('http://127.0.0.1:9222/json', { signal: AbortSignal.timeout(1000) });
    return (await response.json()).find((item) => item.type === 'page');
  }, 'Chrome');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const promise = pending.get(message.id);
    if (promise) { pending.delete(message.id); message.error ? promise.reject(Error(message.error.message)) : promise.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:3018/' });
  await until(() => evaluate('document.readyState === "complete"'), 'главной страницы');
  for (const [group, subject, room] of [
    ['К-ТЭ-19-1', 'Информатика', '412'], ['К-ИИ-19', 'Разговоры о важном', '521'],
  ]) {
    await evaluate(`localStorage.setItem('mir:group', ${JSON.stringify(`college:${group}`)})`);
    await send('Page.reload', { ignoreCache: true });
    await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(group)})`), `группы ${group}`);
    await until(() => evaluate(`Boolean([...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes('Расписание')))`), 'вкладки расписания');
    await evaluate(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes('Расписание')).click()`);
    const monday = await until(() => evaluate(`(() => {
      const text = document.querySelector('.day-card')?.innerText;
      return text?.includes(${JSON.stringify(subject)}) && text?.includes(${JSON.stringify(room)}) ? text : null;
    })()`), `пар ${group}`, 65000);
    assert.ok(monday.includes(subject) && monday.includes(room));
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), `${group}: горизонтальная прокрутка на 390 px`);
    await evaluate('document.querySelector(".day-card").scrollIntoView()');
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(process.env.RUNNER_TEMP ?? tmpdir(), `mobile-${group}.png`), Buffer.from(screenshot.data, 'base64'));
    console.log(group, 'mobile schedule rendered:', monday.split('\n').filter(Boolean).slice(0, 13).join(' | '));
  }
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  rmSync(directory, { recursive: true, force: true });
}
