import {
    cpuUsage,
    diskUsage,
    formatBytes,
    formatPercent,
    formatRate,
    formatTemperature,
    networkRates,
    parseCpuStat,
    parseMemInfo,
    parseNetDev,
    parseThermal,
    sparklinePoints,
} from '../extension/src/modules/monitor/monitorData.js';
import {MonitorSampler} from '../extension/src/modules/monitor/monitorSampler.js';
import {assert, assertEqual, waitFor} from './helpers.js';

const statA = 'cpu  100 0 100 800 0 0 0 0 0 0\n';
const statB = 'cpu  150 0 150 900 0 0 0 0 0 0\n';
assertEqual(parseCpuStat(statA).total, 1000, 'cpu total');
assertEqual(parseCpuStat(statA).idle, 800, 'cpu idle');
assertEqual(cpuUsage(parseCpuStat(statA), parseCpuStat(statB)), 50, 'cpu percent');

const mem = parseMemInfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\n');
assertEqual(mem.totalBytes, 1024000, 'mem total');
assertEqual(mem.usedBytes, 768000, 'mem used');
assertEqual(mem.percent, 75, 'mem percent');
const fallbackMem = parseMemInfo(
    'MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 100 kB\n'
);
assertEqual(fallbackMem.availableBytes, 256000, 'mem fallback available');

const net = parseNetDev('lo: 9 9 9 9 9 9 9 9 9 9\neth0: 100 0 0 0 0 0 0 0 200 0\n');
assertEqual(net.rxBytes, 100, 'net rx');
assertEqual(net.txBytes, 200, 'net tx');
const rates = networkRates({rxBytes: 0, txBytes: 0}, net, 2);
assertEqual(rates.rxPerSecond, 50, 'net rx rate');
assertEqual(rates.txPerSecond, 100, 'net tx rate');
assertEqual(networkRates(null, net, 2).rxPerSecond, 0, 'missing network baseline');
assertEqual(networkRates(net, net, 0).rxPerSecond, 0, 'zero elapsed time');

assertEqual(parseThermal('65000\n'), 65, 'thermal millidegrees');
assertEqual(parseThermal('1000\n'), 1, 'thermal 1000 millidegrees');
assertEqual(parseThermal('65\n'), 65, 'thermal degrees');
assertEqual(parseThermal('bad'), null, 'invalid thermal');
assertEqual(diskUsage(1000, 250).percent, 75, 'disk percent');
assertEqual(diskUsage(0, 0), null, 'empty disk');
assertEqual(formatBytes(1536), '1.5 KB', 'bytes');
assertEqual(formatBytes(1024), '1.0 KB', 'bytes one decimal');
assertEqual(formatPercent(42.4), '42%', 'percent');
assertEqual(formatRate(1536), '1.5 KB/s', 'rate');
assertEqual(formatTemperature(64.6), '65 °C', 'temperature');
assertEqual(sparklinePoints([], 10, 10).length, 0, 'empty sparkline');
assertEqual(sparklinePoints([0, 100], 10, 10)[1][1], 0, 'sparkline top');
assertEqual(sparklinePoints([0, 100], 10, 10, 0, 100)[0][1], 10, 'sparkline bottom');

const sampler = new MonitorSampler({
    readFile: async path => {
        if (path === '/proc/stat') return statB;
        if (path === '/proc/meminfo') return 'MemTotal: 1000 kB\nMemAvailable: 500 kB\n';
        if (path === '/proc/net/dev') return net;
        if (path === '/sys/class/thermal/thermal_zone0/temp') return '42000\n';
        throw new Error('missing');
    },
    queryDisk: async () => ({size: 1000, free: 250}),
    now: () => 100,
});
const first = waitFor(sampler.sample());
assertEqual(first.memory.percent, 50, 'sampler memory');
assertEqual(first.temperature, 42, 'sampler temperature');
assertEqual(first.disk.percent, 75, 'sampler disk');
assertEqual(first.cpu.percent, 0, 'first cpu sample');

const failed = new MonitorSampler({
    readFile: async () => {
        throw new Error('missing');
    },
    queryDisk: async () => {
        throw new Error('missing');
    },
    now: () => 101,
});
const empty = waitFor(failed.sample());
assertEqual(empty.memory, null, 'failed memory read');
assertEqual(empty.disk, null, 'failed disk read');
assertEqual(empty.temperature, null, 'failed temperature read');
assertEqual(empty.cpu.percent, null, 'failed cpu read');
assertEqual(empty.network, null, 'failed network read');

let seenCancellable = null;
const cancellableSampler = new MonitorSampler({
    readFile: async (path, cancellable) => {
        seenCancellable = cancellable;
        return path === '/proc/stat' ? statB : null;
    },
    queryDisk: async (path, cancellable) => {
        seenCancellable = cancellable;
        return {size: 1000, free: 250};
    },
    now: () => 102,
});
const token = {};
waitFor(cancellableSampler.sample(token));
assert(seenCancellable === token, 'sampler forwards the cancellable');

print('monitor tests passed');
