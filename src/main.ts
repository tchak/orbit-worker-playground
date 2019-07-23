import { Schema } from '@orbit/data';
import MemorySource from '@orbit/memory';
import Coordinator, { SyncStrategy, RequestStrategy, EventLoggingStrategy } from '@orbit/coordinator';
import BroadcastChannelSource from './broadcast-channel-source';

export default async function Main(schema: Schema) {
  const broadcast = new BroadcastChannelSource({ schema });
  const memory = new MemorySource({ schema });

  const eventLog = new EventLoggingStrategy({ logPrefix: '[Main]' });
  const syncToMemory = new SyncStrategy({
    source: 'broadcast',
    target: 'memory',
    blocking: true
  });
  const query = new RequestStrategy({
    source: 'memory',
    on: 'beforeQuery',

    target: 'broadcast',
    action: 'pull',

    blocking: true
  });
  const update = new RequestStrategy({
    source: 'memory',
    on: 'beforeUpdate',

    target: 'broadcast',
    action: 'push',

    blocking: false
  });

  const coordinator = new Coordinator({
    sources: [memory, broadcast],
    strategies: [eventLog, syncToMemory, query, update]
  });

  await coordinator.activate();

  return memory;
}
