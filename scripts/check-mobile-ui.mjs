// Open the built app at phone width, select each reproduced group and inspect
// the rendered Monday cards. Uses the Chrome installed on GitHub's runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  console.log('Chrome connected');
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning')
      console.log('Browser warning:', JSON.stringify(message.params.args.map((arg) => arg.value ?? arg.description)).slice(0, 2300));
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
    console.log('Selecting', group);
    await evaluate(`localStorage.setItem('mir:group', ${JSON.stringify(`college:${group}`)})`);
    await send('Page.reload', { ignoreCache: true });
    await until(() => evaluate(`document.querySelector('.group-field select')?.value === ${JSON.stringify(`college:${group}`)}`), `выбора группы ${group}`);
    await until(() => evaluate(`Boolean([...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes('Расписание')))`), 'вкладки расписания');
    const position = await evaluate(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes('Расписание'));
      tab.scrollIntoView({block:'center'});
      const rect = tab.getBoundingClientRect();
      return {x:rect.left + rect.width/2, y:rect.top + rect.height/2};
    })()`);
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:position.x, y:position.y, button:'left', clickCount:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:position.x, y:position.y, button:'left', clickCount:1 });
    console.log('Selected tab:', await evaluate(`[...document.querySelectorAll('[role="tab"]')].map(t => [t.textContent, t.getAttribute('aria-selected')])`));
    const monday = await until(() => evaluate(`(() => {
      const text = document.querySelector('.day-card')?.innerText;
      return text?.includes(${JSON.stringify(subject)}) && text?.includes(${JSON.stringify(room)}) ? text : null;
    })()`), `пар ${group}`, 65000).catch(async (error) => {
      console.log('UI state:', (await evaluate('document.body.innerText')).slice(0, 1400));
      const screenshot = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      writeFileSync(join(process.env.RUNNER_TEMP ?? tmpdir(), `mobile-failure-${group}.png`), Buffer.from(screenshot.data, 'base64'));
      throw error;
    });
    assert.ok(monday.includes(subject) && monday.includes(room));
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), `${group}: горизонтальная прокрутка на 390 px`);
    await evaluate('document.querySelector(".day-card").scrollIntoView()');
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(process.env.RUNNER_TEMP ?? tmpdir(), `mobile-${group}.png`), Buffer.from(screenshot.data, 'base64'));
    console.log(group, 'mobile schedule rendered:', monday.split('\n').filter(Boolean).slice(0, 13).join(' | '));
  }
  if (process.env.IMI_AUDIT_EXPECTATIONS) {
    const expectations = JSON.parse(readFileSync(process.env.IMI_AUDIT_EXPECTATIONS));
    for (const {group,institution,days} of expectations) {
      await evaluate(`localStorage.setItem('mir:group', ${JSON.stringify(`${institution}:${group}`)})`);
      await send('Page.reload', {ignoreCache:true});
      await until(() => evaluate(`document.querySelector('.group-field select')?.value === ${JSON.stringify(`${institution}:${group}`)}`), `выбора группы ${group}`);
      const tab = await evaluate(`(() => {const t=[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.includes('Расписание'));if(!t)return null;t.scrollIntoView({block:'center'});const r=t.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      assert.ok(tab, `${group}: вкладка расписания отсутствует`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:tab.x,y:tab.y,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:tab.x,y:tab.y,button:'left',clickCount:1});
      const actual=await until(() => evaluate(`(() => {const cards=[...document.querySelectorAll('.day-card')];if(cards.length!==6)return null;return cards.map(c=>({count:c.querySelectorAll('.pair').length,empty:!!c.querySelector('.rest'),bad:[...c.querySelectorAll('.pair')].some(p=>!p.querySelector('.pair-body strong')?.textContent.trim()||!p.querySelector('.pair-body span:last-child')?.textContent.trim()||!p.querySelector('.room,.remote-badge')||/(?:^|\\s)(?:ауд|каб)\\.?\\s/i.test(p.querySelector('.pair-body strong')?.textContent+' '+p.querySelector('.pair-body span:last-child')?.textContent))}))})()`), `расписания ${group}`, 65000).catch(async error=>{
        console.log('Failed group UI:',group,(await evaluate('document.body.innerText')).slice(0,1800));
        const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(process.env.RUNNER_TEMP??tmpdir(),`mobile-failure-${group}.png`),Buffer.from(screenshot.data,'base64'));
        throw error;
      });
      assert.deepEqual(actual.map(x=>x.count),days,`${group}: UI потерял пары или общую лекцию`);
      assert.ok(actual.every((x,i)=>x.empty===(days[i]===0)&&!x.bad),`${group}: пустой день или поля пары неверны`);
      assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'),`${group}: горизонтальная прокрутка на 390 px`);
      console.log('UI verified',institution,group,days.join(','));
    }
  }
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
  catch { /* Chrome can still be writing to its profile while shutting down. */ }
}
