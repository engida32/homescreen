import {
    cpuUsage,
    diskUsage,
    networkRates,
    parseCpuStat,
    parseMemInfo,
    parseNetDev,
    parseThermal,
} from './monitorData.js';

export class MonitorSampler {
    constructor({readFile, queryDisk, now, diskPath = '/'}) {
        this._readFile = readFile;
        this._queryDisk = queryDisk;
        this._now = now ?? (() => Date.now());
        this._diskPath = diskPath;
        this._previousCpu = null;
        this._previousNet = null;
        this._previousAt = 0;
    }

    async sample() {
        const read = path => Promise.resolve()
            .then(() => this._readFile(path))
            .catch(() => null);
        const queryDisk = () => Promise.resolve()
            .then(() => this._queryDisk(this._diskPath))
            .catch(() => null);

        const [statText, memText, netText, thermalText, disk] = await Promise.all([
            read('/proc/stat'),
            read('/proc/meminfo'),
            read('/proc/net/dev'),
            read('/sys/class/thermal/thermal_zone0/temp'),
            queryDisk(),
        ]);

        const stat = parseCpuStat(statText);
        const net = parseNetDev(netText);
        const at = this._now();
        const elapsed = at - this._previousAt;

        const result = {
            cpu: {percent: cpuUsage(this._previousCpu, stat)},
            memory: parseMemInfo(memText),
            network: networkRates(this._previousNet, net, elapsed),
            temperature: parseThermal(thermalText),
            disk: disk ? diskUsage(disk.size, disk.free) : null,
        };

        if (stat)
            this._previousCpu = stat;
        if (net)
            this._previousNet = net;
        this._previousAt = at;

        return result;
    }
}
