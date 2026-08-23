const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const PdvDesktopHost = require('../models/PdvDesktopHost');

const requireReady = process.argv.includes('--require-ready');
const hoursArgument = process.argv.find((argument) => argument.startsWith('--hours='));
const hours = Math.max(1, Number(hoursArgument?.split('=')[1] || 72) || 72);

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI/MONGODB_URI não configurada.');
  await mongoose.connect(mongoUri, { compressors: ['zlib'], zlibCompressionLevel: 6 });
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const hosts = await PdvDesktopHost.find({ status: 'active', lastHeartbeatAt: { $gte: since } })
    .select('pdv empresa name machineId appVersion syncProtocolVersion lastHeartbeatAt')
    .sort({ lastHeartbeatAt: -1 })
    .lean();
  const summary = hosts.map((host) => ({
    hostId: String(host._id), pdvId: String(host.pdv || ''), companyId: String(host.empresa || ''),
    name: host.name || '', machineId: host.machineId || '', appVersion: host.appVersion || '',
    syncProtocolVersion: Number(host.syncProtocolVersion || 1), lastHeartbeatAt: host.lastHeartbeatAt || null,
  }));
  const legacy = summary.filter((host) => host.syncProtocolVersion < 2);
  const result = {
    checkedAt: new Date().toISOString(), heartbeatWindowHours: hours,
    activeHosts: summary.length, protocolV2Hosts: summary.length - legacy.length,
    legacyHosts: legacy.length, readyToDisableLegacyRoutes: summary.length > 0 && legacy.length === 0,
    hosts: summary,
  };
  console.log(JSON.stringify(result, null, 2));
  if (requireReady && !result.readyToDisableLegacyRoutes) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
