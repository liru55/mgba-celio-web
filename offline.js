/* Mozilla Public License 2.0; see ../LICENSE. */
(() => {
  const $ = id => document.getElementById(id);
  const status = $('offline-status'), prepare = $('offline-prepare'), clear = $('cache-clear');
  const clearMain = $('cache-clear-main'), clearStatus = $('cache-clear-status');
  let registration, busy = false;
  function show(result) {
    if (result.error) throw new Error(result.error);
    status.textContent = result.ready ? '準備完了：機内モードでも起動できます。ROMは端末から選び直してください。' : `未準備（${result.count}/${result.total}）：通信できる場所で「オフライン用に保存・更新」を押してください。`;
  }
  async function request(type) {
    registration ||= await navigator.serviceWorker.register('sw.js');
    if (!registration.active) registration = await navigator.serviceWorker.ready;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('応答がありません。通信状態を確認して再度お試しください。')); }, 120000);
      channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); };
      registration.active.postMessage(type, [channel.port2]);
    });
  }
  async function run(type) {
    if (busy) return;
    busy = true; prepare.disabled = clear.disabled = clearMain.disabled = true;
    status.textContent = type === 'PREPARE' ? 'オフライン用のファイルを保存中…' : 'キャッシュを削除中…';
    if (type === 'CLEAR') clearStatus.textContent = 'キャッシュを削除中…';
    try {
      if (type === 'CLEAR') {
        if(!navigator.onLine)throw new Error('再読み込みのためインターネットに接続してください。');
        await window.prepareCacheReload?.();
      }
      if (type === 'PREPARE') { try { await navigator.storage?.persist?.(); } catch (_) {} }
      show(await request(type));
      if (type === 'CLEAR') {
        clearStatus.textContent = 'キャッシュを削除しました。再読み込みしています…';
        location.reload();
      }
    } catch (error) {
      status.textContent = `${type === 'CLEAR' ? 'キャッシュを削除できませんでした' : '準備できませんでした'}：${error.message}`;
      if (type === 'CLEAR') clearStatus.textContent = status.textContent;
    }
    finally { busy = false; prepare.disabled = clear.disabled = clearMain.disabled = false; }
  }
  if (!('serviceWorker' in navigator)) {
    status.textContent = 'このブラウザではオフライン保存に対応していません。'; prepare.disabled = clear.disabled = clearMain.disabled = true; return;
  }
  prepare.onclick = () => run('PREPARE');
  clear.onclick = () => run('CLEAR');
  clearMain.onclick = () => run('CLEAR');
  request('STATUS').then(show).catch(error => { status.textContent = `準備状況を確認できません：${error.message}`; });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!busy) request('STATUS').then(show).catch(() => {}); });
})();
