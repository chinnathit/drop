class PersistentStorage {
    constructor() {
        PersistentStorage._open().then(db => db.close()).catch(() => PersistentStorage.logBrowserNotCapable());
    }

    static _open() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('pairdrop_store', 5);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('keyval')) db.createObjectStore('keyval');
                if (!db.objectStoreNames.contains('room_secrets')) {
                    const store = db.createObjectStore('room_secrets', {autoIncrement: true});
                    store.createIndex('secret', 'secret', {unique: true});
                    store.createIndex('display_name', 'display_name');
                    store.createIndex('auto_accept', 'auto_accept');
                }
                if (!db.objectStoreNames.contains('share_target_files')) {
                    db.createObjectStore('share_target_files', {autoIncrement: true});
                }
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
        });
    }

    static async _run(storeName, mode, operation) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            let result;
            let transaction;
            try {
                transaction = db.transaction(storeName, mode);
                transaction.oncomplete = () => {
                    db.close();
                    resolve(result);
                };
                transaction.onabort = () => {
                    db.close();
                    reject(transaction.error || new Error('Storage transaction aborted'));
                };
                operation(transaction.objectStore(storeName), value => { result = value; });
            } catch (error) {
                if (transaction) transaction.abort();
                db.close();
                reject(error);
            }
        });
    }

    static logBrowserNotCapable() {
        console.log('Persistent storage is unavailable. Pairing cannot be saved.');
    }

    static set(key, value) {
        return this._run('keyval', 'readwrite', (store, done) => {
            store.put(value, key);
            done(value);
        }).catch(() => value);
    }

    static get(key) {
        return this._run('keyval', 'readonly', (store, done) => {
            store.get(key).onsuccess = e => done(e.target.result);
        }).catch(() => null);
    }

    static delete(key) {
        return this._run('keyval', 'readwrite', store => store.delete(key)).catch(() => {});
    }

    static addRoomSecret(secret, display_name, device_name) {
        return this._run('room_secrets', 'readwrite', store => {
            store.index('secret').getKey(secret).onsuccess = e => {
                if (e.target.result !== undefined) return;
                store.add({secret, display_name, device_name, auto_accept: false});
            };
        });
    }

    static async getAllRoomSecrets() {
        const entries = await this.getAllRoomSecretEntries();
        return entries.map(entry => entry.secret).filter(Boolean);
    }

    static getAllRoomSecretEntries() {
        return this._run('room_secrets', 'readonly', (store, done) => {
            store.getAll().onsuccess = e => done(e.target.result || []);
        }).catch(() => []);
    }

    static getRoomSecretEntry(secret) {
        return this._run('room_secrets', 'readonly', (store, done) => {
            store.index('secret').getKey(secret).onsuccess = e => {
                const key = e.target.result;
                if (key === undefined) return done(null);
                store.get(key).onsuccess = e => done({entry: e.target.result, key});
            };
        }).catch(() => null);
    }

    static deleteRoomSecret(secret) {
        return this._run('room_secrets', 'readwrite', (store, done) => {
            store.index('secret').getKey(secret).onsuccess = e => {
                if (e.target.result !== undefined) store.delete(e.target.result);
                done(secret);
            };
        });
    }

    static clearRoomSecrets() {
        return this._run('room_secrets', 'readwrite', store => store.clear());
    }

    static updateRoomSecretNames(secret, displayName, deviceName) {
        return this.updateRoomSecret(secret, undefined, displayName, deviceName);
    }

    static updateRoomSecretAutoAccept(secret, autoAccept) {
        return this.updateRoomSecret(secret, undefined, undefined, undefined, autoAccept);
    }

    static updateRoomSecret(secret, updatedSecret, displayName, deviceName, autoAccept) {
        return this._run('room_secrets', 'readwrite', (store, done) => {
            store.index('secret').getKey(secret).onsuccess = e => {
                const key = e.target.result;
                if (key === undefined) return done(false);
                store.get(key).onsuccess = e => {
                    const entry = e.target.result;
                    if (updatedSecret !== undefined) entry.secret = updatedSecret;
                    if (displayName !== undefined) entry.display_name = displayName;
                    if (deviceName !== undefined) entry.device_name = deviceName;
                    if (autoAccept !== undefined) entry.auto_accept = autoAccept;
                    store.put(entry, key);
                    done({entry, key});
                };
            };
        });
    }
}
