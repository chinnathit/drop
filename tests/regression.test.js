import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import Peer from '../server/peer.js';
import PairDropWsServer from '../server/ws-server.js';

const server = () => {
    const instance = Object.create(PairDropWsServer.prototype);
    instance._rooms = Object.create(null);
    instance._keepAliveTimers = new WeakMap();
    instance._roomSecrets = Object.create(null);
    instance._send = () => {};
    return instance;
};

test('pair secrets stay unique and all rooms are left on disconnect', () => {
    const peer = Object.create(Peer.prototype);
    peer.id = 'device';
    peer.roomSecrets = [];
    peer.addRoomSecret('first');
    peer.addRoomSecret('first');
    peer.addRoomSecret('second');
    assert.deepEqual(peer.roomSecrets, ['first', 'second']);
    const instance = server();
    instance._rooms.first = {device: peer};
    instance._rooms.second = {device: peer};
    instance._leaveAllSecretRooms(peer);
    assert.deepEqual(peer.roomSecrets, []);
    assert.equal(Object.keys(instance._rooms).length, 0);
});

test('untrusted messages cannot delete, rotate or relay into another room', () => {
    const instance = server();
    const sender = {id: 'outsider', roomSecrets: []};
    instance._rooms.secret = {member: {id: 'member'}};
    instance._deleteSecretRoom = () => assert.fail('Unauthorized deletion');
    instance._send = () => assert.fail('Unauthorized relay');
    instance._onMessage(sender, 'null');
    instance._onMessage(sender, '{"type":"room-secrets","roomSecrets":{}}');
    instance._onRoomSecretsDeleted(sender, {roomSecrets: ['secret']});
    instance._onRegenerateRoomSecret(sender, {roomSecret: 'secret'});
    instance._signalAndRelay(sender, {roomType: 'secret', roomId: 'secret', to: '00000000-0000-0000-0000-000000000000'});
    assert.ok(instance._rooms.secret.member);
});

test('an old socket cannot remove its replacement from a room', () => {
    const instance = server();
    const replacement = {id: 'device'};
    instance._rooms.secret = {device: replacement};
    instance._leaveRoom({id: 'device'}, 'secret', 'secret');
    assert.equal(instance._rooms.secret.device, replacement);
});

test('returning to a visible tab detects a stale socket', () => {
    const context = vm.createContext({document: {hidden: false}, window: {hiddenProperty: 'hidden'}, navigator: {onLine: true}, Date});
    vm.runInContext(fs.readFileSync('public/scripts/network.js', 'utf8') + '\nglobalThis.Connection = ServerConnection;', context);
    const connection = Object.create(context.Connection.prototype);
    connection._socket = {};
    connection._lastMessageAt = Date.now() - 20000;
    let reconnects = 0;
    connection._reconnect = () => reconnects++;
    connection._onVisibilityChange();
    assert.equal(reconnects, 1);
    context.document.hidden = true;
    connection._onVisibilityChange();
    assert.equal(reconnects, 1);
});

test('removing an unknown browser tab preserves the other tabs', async () => {
    const values = new Map([['peer_ids_browser', '["first","second"]']]);
    const context = vm.createContext({localStorage: {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)}});
    vm.runInContext(fs.readFileSync('public/scripts/browser-tabs-connector.js', 'utf8') + '\nglobalThis.Tabs = BrowserTabsConnector;', context);
    await context.Tabs.removePeerIdFromLocalStorage('missing');
    assert.equal(values.get('peer_ids_browser'), '["first","second"]');
    values.set('peer_ids_browser', 'invalid');
    assert.equal(context.Tabs.peerIsSameBrowser('first'), false);
});


test('public room requests cannot use a private room secret as an id', () => {
    const instance = server();
    instance._joinPublicRoom = () => assert.fail('Private room joined as public');
    instance._onJoinPublicRoom({}, {publicRoomId: 'a'.repeat(256), createIfInvalid: true});
    instance._onJoinPublicRoom({}, {publicRoomId: '__proto__', createIfInvalid: true});
});

const workerContext = () => {
    const context = vm.createContext({
        self: {registration: {scope: 'https://drop.test/'}, addEventListener() {}},
        URL, AbortController, setTimeout, clearTimeout,
        caches: {open: async () => ({match: async () => {throw new Error('Unavailable');}})}
    });
    vm.runInContext(fs.readFileSync('public/service-worker.js', 'utf8') + '\nglobalThis.policy = doNotCacheRequest; globalThis.lookup = fromCache;', context);
    return context;
};

test('dynamic endpoints and external requests bypass the offline cache', () => {
    const context = workerContext();
    for (const url of ['https://drop.test/config?fresh=1', 'https://drop.test/auto-restart?test=1', 'https://other.test/image']) {
        assert.equal(context.policy({url, method: 'GET'}), true);
    }
    assert.equal(context.policy({url: 'https://drop.test/scripts/network.js', method: 'GET'}), false);
});

test('cache lookup rejects instead of hanging when cache storage fails', async () => {
    await assert.rejects(workerContext().lookup({url: 'https://drop.test/'}), /Unavailable/);
});

test('theme changes update the page background state and Safari theme color together', () => {
    const classes = new Set();
    const values = new Map();
    const handlers = {};
    const media = {matches: true, addEventListener() {}};
    const root = {dataset: {}, style: {}};
    let color;
    const context = vm.createContext({
        window: {matchMedia: () => media, addEventListener: (name, callback) => {handlers[name] = callback;}, dispatchEvent() {}},
        document: {
            body: {classList: {contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name)}},
            documentElement: root, hidden: false,
            getElementById: () => null,
            querySelector: () => ({setAttribute: (_, value) => {color = value;}}),
            addEventListener: (name, callback) => {handlers[name] = callback;}
        },
        localStorage: {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)},
        CustomEvent: class {}
    });
    vm.runInContext(fs.readFileSync('public/scripts/ui-main.js', 'utf8') + '\nglobalThis.theme = new ThemeUI();', context);
    assert.equal(root.dataset.theme, 'dark');
    context.theme.setModeToLight();
    assert.equal(root.dataset.theme, 'light');
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(color, '#f8fafc');
    context.theme.setModeToDark();
    assert.equal(color, '#090a0f');
    context.theme.setModeToAuto();
    media.matches = false;
    handlers.pageshow();
    assert.equal(root.dataset.theme, 'light');
    assert.equal(values.has('theme'), false);
});
