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
};
