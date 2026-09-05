class PersistentStorage {
    constructor() {
        if (!('indexedDB' in window)) {
            PersistentStorage.logBrowserNotCapable();
            return;
        }
        const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
        DBOpenRequest.onerror = e => {
            PersistentStorage.logBrowserNotCapable();
            console.log('Error initializing database: ', e);
        };
        DBOpenRequest.onsuccess = _ => {
            console.log('Database initialised.');
        };
        DBOpenRequest.onupgradeneeded = async e => {
            const db = e.target.result;
            const txn = e.target.transaction;

            db.onerror = err => console.log('Error loading database: ' + err);

            console.log(`Upgrading IndexedDB database from version ${e.oldVersion} to version ${e.newVersion}`);

            if (!db.objectStoreNames.contains('keyval')) {
                db.createObjectStore('keyval');
            }
            if (!db.objectStoreNames.contains('room_secrets')) {
                let roomSecretsObjectStore = db.createObjectStore('room_secrets', {autoIncrement: true});
                roomSecretsObjectStore.createIndex('secret', 'secret', { unique: true });
                roomSecretsObjectStore.createIndex('display_name', 'display_name');
                roomSecretsObjectStore.createIndex('auto_accept', 'auto_accept');
            }
            if (!db.objectStoreNames.contains('share_target_files')) {
                db.createObjectStore('share_target_files', {autoIncrement: true});
            }
        }
    }

    static logBrowserNotCapable() {
        console.log("This browser does not support IndexedDB. Paired devices will be gone after the browser is closed.");
    }

    static set(key, value) {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('keyval')) {
                        resolve(value);
                        return;
                    }
                    const transaction = db.transaction('keyval', 'readwrite');
                    const objectStore = transaction.objectStore('keyval');
                    const objectStoreRequest = objectStore.put(value, key);
                    objectStoreRequest.onsuccess = _ => resolve(value);
                    objectStoreRequest.onerror = _ => resolve(value);
                }
                DBOpenRequest.onerror = _ => resolve(value);
            } catch (e) {
                resolve(value);
            }
        })
    }

    static get(key) {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('keyval')) {
                        resolve(null);
                        return;
                    }
                    const transaction = db.transaction('keyval', 'readonly');
                    const objectStore = transaction.objectStore('keyval');
                    const objectStoreRequest = objectStore.get(key);
                    objectStoreRequest.onsuccess = _ => resolve(objectStoreRequest.result);
                    objectStoreRequest.onerror = _ => resolve(null);
                }
                DBOpenRequest.onerror = _ => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    static delete(key) {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('keyval')) {
                        resolve();
                        return;
                    }
                    const transaction = db.transaction('keyval', 'readwrite');
                    const objectStore = transaction.objectStore('keyval');
                    const objectStoreRequest = objectStore.delete(key);
                    objectStoreRequest.onsuccess = _ => resolve();
                    objectStoreRequest.onerror = _ => resolve();
                }
                DBOpenRequest.onerror = _ => resolve();
            } catch (e) {
                resolve();
            }
        })
    }

    static addRoomSecret(roomSecret, displayName, deviceName) {
        return new Promise((resolve, reject) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('room_secrets')) {
                        resolve();
                        return;
                    }
                    const transaction = db.transaction('room_secrets', 'readwrite');
                    const objectStore = transaction.objectStore('room_secrets');
                    const objectStoreRequest = objectStore.add({
                        'secret': roomSecret,
                        'display_name': displayName,
                        'device_name': deviceName,
                        'auto_accept': false
                    });
                    objectStoreRequest.onsuccess = _ => resolve();
                    objectStoreRequest.onerror = err => reject(err);
                }
                DBOpenRequest.onerror = err => reject(err);
            } catch (e) {
                reject(e);
            }
        })
    }

    static async getAllRoomSecrets() {
        try {
            const roomSecrets = await this.getAllRoomSecretEntries();
            let secrets = [];
            if (Array.isArray(roomSecrets)) {
                for (let i = 0; i < roomSecrets.length; i++) {
                    if (roomSecrets[i] && roomSecrets[i].secret) {
                        secrets.push(roomSecrets[i].secret);
                    }
                }
            }
            return secrets;
        } catch (e) {
            this.logBrowserNotCapable();
            return [];
        }
    }

    static getAllRoomSecretEntries() {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('room_secrets')) {
                        resolve([]);
                        return;
                    }
                    const transaction = db.transaction('room_secrets', 'readonly');
                    const objectStore = transaction.objectStore('room_secrets');
                    const objectStoreRequest = objectStore.getAll();
                    objectStoreRequest.onsuccess = evt => resolve(evt.target.result || []);
                    objectStoreRequest.onerror = _ => resolve([]);
                }
                DBOpenRequest.onerror = _ => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });
    }

    static getRoomSecretEntry(roomSecret) {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('room_secrets')) {
                        resolve(null);
                        return;
                    }
                    const transaction = db.transaction('room_secrets', 'readonly');
                    const objectStore = transaction.objectStore('room_secrets');
                    const objectStoreRequestKey = objectStore.index("secret").getKey(roomSecret);
                    objectStoreRequestKey.onsuccess = evt => {
                        const key = evt.target.result;
                        if (!key) {
                            resolve(null);
                            return;
                        }
                        const objectStoreRequestRetrieval = objectStore.get(key);
                        objectStoreRequestRetrieval.onsuccess = retEvt => {
                            resolve({
                                "entry": retEvt.target.result,
                                "key": key
                            });
                        }
                        objectStoreRequestRetrieval.onerror = _ => resolve(null);
                    };
                    objectStoreRequestKey.onerror = _ => resolve(null);
                }
                DBOpenRequest.onerror = _ => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    static deleteRoomSecret(roomSecret) {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('room_secrets')) {
                        resolve(roomSecret);
                        return;
                    }
                    const transaction = db.transaction('room_secrets', 'readwrite');
                    const objectStore = transaction.objectStore('room_secrets');
                    const objectStoreRequestKey = objectStore.index("secret").getKey(roomSecret);
                    objectStoreRequestKey.onsuccess = evt => {
                        if (!evt.target.result) {
                            resolve(roomSecret);
                            return;
                        }
                        const key = evt.target.result;
                        const objectStoreRequestDeletion = objectStore.delete(key);
                        objectStoreRequestDeletion.onsuccess = _ => resolve(roomSecret);
                        objectStoreRequestDeletion.onerror = _ => resolve(roomSecret);
                    };
                    objectStoreRequestKey.onerror = _ => resolve(roomSecret);
                }
                DBOpenRequest.onerror = _ => resolve(roomSecret);
            } catch (e) {
                resolve(roomSecret);
            }
        })
    }

    static clearRoomSecrets() {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('room_secrets')) {
                        resolve();
                        return;
                    }
                    const transaction = db.transaction('room_secrets', 'readwrite');
                    const objectStore = transaction.objectStore('room_secrets');
                    const objectStoreRequest = objectStore.clear();
                    objectStoreRequest.onsuccess = _ => resolve();
                    objectStoreRequest.onerror = _ => resolve();
                }
                DBOpenRequest.onerror = _ => resolve();
            } catch (e) {
                resolve();
            }
        })
    }

    static updateRoomSecretNames(roomSecret, displayName, deviceName) {
        return this.updateRoomSecret(roomSecret, undefined, displayName, deviceName);
    }

    static updateRoomSecretAutoAccept(roomSecret, autoAccept) {
        return this.updateRoomSecret(roomSecret, undefined, undefined, undefined, autoAccept);
    }

    static updateRoomSecret(roomSecret, updatedRoomSecret = undefined, updatedDisplayName = undefined, updatedDeviceName = undefined, updatedAutoAccept = undefined) {
        return new Promise((resolve) => {
            try {
                const DBOpenRequest = window.indexedDB.open('pairdrop_store', 5);
                DBOpenRequest.onsuccess = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('room_secrets')) {
                        resolve(false);
                        return;
                    }
                    this.getRoomSecretEntry(roomSecret)
                        .then(roomSecretEntry => {
                            if (!roomSecretEntry) {
                                resolve(false);
                                return;
                            }
                            const transaction = db.transaction('room_secrets', 'readwrite');
                            const objectStore = transaction.objectStore('room_secrets');
                            const updatedRoomSecretEntry = {
                                'secret': updatedRoomSecret !== undefined ? updatedRoomSecret : roomSecretEntry.entry.secret,
                                'display_name': updatedDisplayName !== undefined ? updatedDisplayName : roomSecretEntry.entry.display_name,
                                'device_name': updatedDeviceName !== undefined ? updatedDeviceName : roomSecretEntry.entry.device_name,
                                'auto_accept': updatedAutoAccept !== undefined ? updatedAutoAccept : roomSecretEntry.entry.auto_accept
                            };

                            const objectStoreRequestUpdate = objectStore.put(updatedRoomSecretEntry, roomSecretEntry.key);
                            objectStoreRequestUpdate.onsuccess = _ => {
                                resolve({
                                    "entry": updatedRoomSecretEntry,
                                    "key": roomSecretEntry.key
                                });
                            }
                            objectStoreRequestUpdate.onerror = _ => resolve(false);
                        })
                        .catch(_ => resolve(false));
                };
                DBOpenRequest.onerror = _ => resolve(false);
            } catch (e) {
                resolve(false);
            }
        })
    }
}