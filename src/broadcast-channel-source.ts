import {
  Source,
  Pushable,
  Pullable,
  Syncable,
  pullable,
  pushable,
  syncable,
  Transform,
  TransformOrOperations,
  SourceSettings,
  Query,
  queryable,
  Queryable
} from '@orbit/data';
import BroadcastChannel from 'broadcast-channel';

export interface BroadcastChannelSourceSettings extends SourceSettings {
  channel?: string;
}

interface TransformMessage {
  type: 'transform';
  transform: Transform;
}

interface QueryMessage {
  type: 'query';
  query: Query;
}

interface ResultMessage {
  type: 'result';
  query: Query;
  hints: any;
}

type Message = TransformMessage | QueryMessage | ResultMessage;
type Resolve = (transforms: Transform[]) => void;

@pullable
@pushable
@syncable
@queryable
export default class BroadcastChannelSource extends Source
  implements Pushable, Pullable, Syncable, Queryable {
  channel: BroadcastChannel<Message>;
  protected _channelName: string;
  protected _requests: Record<string, Resolve>;

  // Pushable interface stubs
  push: (
    transformOrOperations: TransformOrOperations,
    options?: object,
    id?: string
  ) => Promise<Transform[]>;

  // Pullable interface stubs
  pull: (
    query: Query,
    options?: object,
    id?: string
  ) => Promise<Transform[]>;

  // Queryable interface stubs
  query: (
    query: Query,
    options?: object,
    id?: string
  ) => Promise<any>;

  // Syncable interface stubs
  sync: (transformOrTransforms: Transform | Transform[]) => Promise<void>;

  constructor(settings: BroadcastChannelSourceSettings = {}) {
    settings.name = settings.name || 'broadcast';
    super(settings);
    this._channelName = settings.channel || 'orbit';
    this._requests = {};
  }

  /////////////////////////////////////////////////////////////////////////////
  // Pushable interface implementation
  /////////////////////////////////////////////////////////////////////////////
  async _push(transform: Transform): Promise<Transform[]> {
    if (!this.transformLog.contains(transform.id)) {
      await this.channel.postMessage({
        type: 'transform',
        transform
      });
      await this.transformed([transform]);
      return [transform];
    }
    return [];
  }

  /////////////////////////////////////////////////////////////////////////////
  // Pullable interface implementation
  /////////////////////////////////////////////////////////////////////////////
  async _pull(query: Query): Promise<Transform[]> {
    await this.channel.postMessage({
      type: 'query',
      query
    });

    await new Promise(resolve => {
      this._requests[query.id] = resolve;
    });
    return [];
  }

  /////////////////////////////////////////////////////////////////////////////
  // Syncable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async _sync(transform: Transform): Promise<void> {
    if (!this.transformLog.contains(transform.id)) {
      await this.channel.postMessage({
        type: 'transform',
        transform
      });
      await this.transformed([transform]);
    }
  }

  /////////////////////////////////////////////////////////////////////////////
  // Queryable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async _query(query, hints) {
    if (hints && hints.data) {
      await this.channel.postMessage({
        type: 'result',
        query,
        hints
      });
      return hints.data;
    }
    return undefined;
  }

  async _activate(): Promise<void> {
    await super._activate();
    this.channel = new BroadcastChannel<Message>(this._channelName, {
      webWorkerSupport: true
    });
    this.channel.addEventListener('message', (message: Message): void => {
      switch(message.type) {
      case 'transform':
        this.sync(message.transform);
        break;
      case 'query':
        this.query(message.query);
        break;
      case 'result':
        this.sendResult(message.query, message.hints);
        break;
      }
    });
  }

  async deactivate(): Promise<void> {
    await this.channel.close();
    await super.deactivate();
  }

  protected sendResult(query: Query, hints: any) {
    this._requests[query.id](hints);
  }
}
