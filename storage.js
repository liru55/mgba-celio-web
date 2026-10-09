/* Mozilla Public License 2.0; see ../LICENSE. */
window.LocalSaveStore = class LocalSaveStore {
  async open() {
    if (!this.pending) {
      this.pending = new Promise((resolve,reject) => {
        const request = indexedDB.open('mgba-local-saves',1);
        request.onupgradeneeded = () => request.result.createObjectStore('saves');
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.pending = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('保存先を開けません'));
      }).catch(error => { this.pending = null; throw error; });
    }
    return this.pending;
  }
  async read(key) {
    const db = await this.open();
    return new Promise((resolve,reject) => {
      const request = db.transaction('saves').objectStore('saves').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async change(action) {
    const db = await this.open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('saves','readwrite');
      action(tx.objectStore('saves'));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  write(key,value) { return this.change(store => store.put(value,key)); }
  remove(key) { return this.change(store => store.delete(key)); }
  async backups(key) { return await this.read('backups:'+key) || []; }
  readBackup(key,id) { return this.read('backup:'+key+':'+id); }
  async backup(key,value) {
    const db = await this.open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('saves','readwrite'), store = tx.objectStore('saves');
      const request = store.get('backups:'+key);
      let result;
      request.onsuccess = () => {
        const previous = request.result || [];
        const id = Math.max(value.updated,(previous[0]?.id || 0)+1);
        const entry = {id,updated:value.updated,filename:value.filename,size:value.bytes.byteLength};
        store.put(value,'backup:'+key+':'+id);
        result = [entry,...previous].slice(0,10);
        store.put(result,'backups:'+key);
        for (const old of previous.slice(9)) store.delete('backup:'+key+':'+old.id);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
};
