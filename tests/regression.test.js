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
