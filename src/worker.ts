import { Schema } from '@orbit/data';
import JSONAPISource from '@orbit/jsonapi';
import Coordinator, { SyncStrategy, RequestStrategy, EventLoggingStrategy } from '@orbit/coordinator';
import BroadcastChannelSource from './broadcast-channel-source';

export default async function Worker(schema: Schema) {
  const broadcast = new BroadcastChannelSource({ schema });
  const jsonapi = new JSONAPISource({
    schema,
    host: 'https://jsonapiplayground.reyesoft.com',
    namespace: 'v2'
  });

  const eventLog = new EventLoggingStrategy({ logPrefix: '[Worker]'});
  const syncFromRemote = new SyncStrategy({
    source: 'jsonapi',
    target: 'broadcast'
  });
  const syncToRemote = new SyncStrategy({
    source: 'broadcast',
    target: 'jsonapi',
    blocking: true
  });
  const query = new RequestStrategy({
    source: 'broadcast',
    on: 'beforeQuery',

    target: 'jsonapi',
    action: 'query',

    blocking: true,
    passHints: true
  });

  const coordinator = new Coordinator({
    sources: [jsonapi, broadcast],
    strategies: [eventLog, syncFromRemote, syncToRemote, query]
  });

  await coordinator.activate();
}
