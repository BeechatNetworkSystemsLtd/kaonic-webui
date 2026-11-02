import { describe, expect, it } from 'vitest';
import { fromVpnGateway, fromVpnSharePatch, fromVpnUplink, toVpn } from './http/convert';
import type { WireVpnState } from './http/wire';
import { checkAdvertised, checkGateway, checkSharePatch, checkUplink, isCidr, isIpv4, parseList } from './vpnShare';

describe('vpn sharing checks', () => {
  it('reads addresses, prefixes and typed lists', () => {
    expect(isIpv4('192.168.10.1')).toBe(true);
    expect(isIpv4('256.1.1.1')).toBe(false);
    expect(isIpv4('10.0.0')).toBe(false);
    expect(isCidr('0.0.0.0/0')).toBe(true);
    expect(isCidr('10.78.0.0/16')).toBe(true);
    expect(isCidr('10.78.0.0/33')).toBe(false);
    expect(isCidr('10.78.0.0')).toBe(false);
    expect(parseList(' 1.1.1.1, 8.8.8.8\n9.9.9.9 ')).toEqual(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
  });

  it('checks the sharing settings like the hub', () => {
    expect(checkSharePatch({ mappingPool: '10.78.0.0/16', dnsServers: ['1.1.1.1'], lanInterfaces: ['br0', 'usb0'] })).toEqual({});
    expect(checkSharePatch({ mappingPool: '10.0.0.0/4' }).mappingPool).toMatch(/\/8 to \/24/);
    expect(checkSharePatch({ dnsServers: ['1.1.1.1', 'dns.example'] }).dnsServers).toMatch(/dns.example/);
    expect(checkSharePatch({ lanInterfaces: ['br0', 'bad name'] }).lanInterfaces).toBeDefined();
    expect(checkAdvertised(['192.168.50.0/24', 'nope']).advertised).toMatch(/nope/);
  });

  it('needs routes for a gateway and for an uplink without the default route', () => {
    expect(checkGateway({ enabled: true, egressInterface: null, routes: [] }).routes).toBeDefined();
    expect(checkGateway({ enabled: true, egressInterface: 'wlan0', routes: ['0.0.0.0/0'] })).toEqual({});
    expect(checkGateway({ enabled: false, egressInterface: null, routes: [] })).toEqual({});
    expect(checkUplink({ enabled: true, peerId: null, defaultRoute: true, routes: [] })).toEqual({});
    expect(checkUplink({ enabled: true, peerId: null, defaultRoute: false, routes: [] }).routes).toBeDefined();
    expect(checkUplink({ enabled: true, peerId: 'xyz', defaultRoute: true, routes: [] }).peerId).toBeDefined();
  });
});

describe('vpn sharing on the wire', () => {
  const wire: WireVpnState = {
    enabled: true,
    status: 'running',
    network: '10.77.0.0/16',
    counters: { tx_packets: 0, tx_bytes: 0, tx_bps: 0, rx_packets: 0, rx_bytes: 0, rx_bps: 0, dropped: 0 },
    peers: [],
    routes: { advertised: ['10.78.12.0/24'], local_mappings: [{ subnet: '192.168.10.0/24', mapped_subnet: '10.78.12.0/24', interface: 'br0' }], remote: [] },
    uplink: { enabled: true, active: false, peer_id: null, routes: [], default_route: true, detail: 'No gateway heard yet.', gateways: [{ peer_id: 'a'.repeat(32), codename: 'emunode2', routes: ['0.0.0.0/0'] }] },
    gateway: { enabled: false, active: false, egress_interface: null, routes: [], available_interfaces: ['wlan0', 'usb0'], detail: null },
    settings: { share_lans: true, lan_interfaces: ['br0', 'usb0'], map_lans: true, mapping_pool: '10.78.0.0/16', lan_router: 'auto', dns_servers: ['1.1.1.1'], advertise: [] },
  };

  it('reads the sharing state', () => {
    const state = toVpn(wire);
    expect(state.routes.localMappings).toEqual([{ subnet: '192.168.10.0/24', mappedSubnet: '10.78.12.0/24', interface: 'br0' }]);
    expect(state.uplink.gateways[0]).toEqual({ peerId: 'a'.repeat(32), codename: 'emunode2', routes: ['0.0.0.0/0'] });
    expect(state.uplink.detail).toBe('No gateway heard yet.');
    expect(state.gateway.availableInterfaces).toEqual(['wlan0', 'usb0']);
    expect(state.settings?.lanRouter).toBe('auto');
  });

  it('copes with a hub that reports no sharing', () => {
    const state = toVpn({ ...wire, uplink: undefined, gateway: undefined, settings: undefined });
    expect(state.settings).toBeNull();
    expect(state.uplink.enabled).toBe(false);
    expect(state.gateway.availableInterfaces).toEqual([]);
  });

  it('writes only what changed, in snake case', () => {
    expect(fromVpnSharePatch({ lanRouter: 'never', dnsServers: ['8.8.8.8'] })).toEqual({ lan_router: 'never', dns_servers: ['8.8.8.8'] });
    expect(fromVpnUplink({ enabled: true, peerId: null, defaultRoute: false, routes: ['10.0.0.0/8'] })).toEqual({ enabled: true, peer_id: null, default_route: false, routes: ['10.0.0.0/8'] });
    expect(fromVpnGateway({ enabled: true, egressInterface: 'wlan0', routes: ['0.0.0.0/0'] })).toEqual({ enabled: true, egress_interface: 'wlan0', routes: ['0.0.0.0/0'] });
  });
});
