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
import { fulfillInSeries, settleInSeries } from '@orbit/core';
import { QueryResultData } from '@orbit/record-cache';
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

interface PullMessage {
  type: 'pull';
  query: Query;
}

interface UpdateMessage {
  type: 'update';
  transform: Transform;
}

interface PushMessage {
  type: 'push';
  transform: Transform;
}

interface QueryResultMessage {
  type: 'query-result';
  id: string;
  result?: QueryResultData;
}

interface PullResultMessage {
  type: 'pull-result';
  id: string;
}

interface UpdateResultMessage {
  type: 'update-result';
  id: string;
  result?: QueryResultData | QueryResultData[];
}

interface PushResultMessage {
  type: 'push-result';
  id: string;
}

interface ErrorMessage {
  type: 'error';
  id: string;
  error: Error;
}

type Message = TransformMessage | QueryMessage | PullMessage | UpdateMessage | PushMessage | QueryResultMessage | PullResultMessage | UpdateResultMessage | PushResultMessage | ErrorMessage;
type Resolve = (result?: QueryResultData | QueryResultData[]) => void;

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
        type: 'push',
        transform
      });

      await new Promise(resolve => {
        this._requests[transform.id] = resolve;
      });
    }
    return [];
  }

  /////////////////////////////////////////////////////////////////////////////
  // Pullable interface implementation
  /////////////////////////////////////////////////////////////////////////////
  async _pull(query: Query): Promise<Transform[]> {
    await this.channel.postMessage({
      type: 'pull',
      query
    });

    await new Promise(resolve => {
      this._requests[query.id] = resolve;
    });
    return [];
  }

  /////////////////////////////////////////////////////////////////////////////
  // Queryable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async _query(query) {
    await this.channel.postMessage({
      type: 'query',
      query
    });

    return new Promise(resolve => {
      this._requests[query.id] = resolve;
    });
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

  protected async __proxyQuery__(query: Query): Promise<any> {
    try {
      const hints: any = {};

      await fulfillInSeries(this, 'beforeQuery', query, hints);

      const result = hints && hints.data;

      await settleInSeries(this, 'proxyQuery', query, result);

      await this.channel.postMessage({
        type: 'query-result',
        id: query.id,
        result
      });
      return result;
    } catch (error) {
      await settleInSeries(this, 'queryFail', query, error);

      await this.channel.postMessage({
        type: 'error',
        id: query.id,
        error
      });
    }
  };

  protected async __proxyPull__(query: Query): Promise<any> {
    try {
      const hints: any = {};

      await fulfillInSeries(this, 'beforePull', query, hints);

      await settleInSeries(this, 'proxyPull', query, []);

      await this.channel.postMessage({
        type: 'pull-result',
        id: query.id
      });
      return [];
    } catch (error) {
      await settleInSeries(this, 'pullFail', query, error);

      await this.channel.postMessage({
        type: 'error',
        id: query.id,
        error
      });
    }
  };

  async _activate(): Promise<void> {
    await super._activate();
    this.channel = new BroadcastChannel<Message>(this._channelName, {
      webWorkerSupport: true
    });
    this.channel.addEventListener('message', (message: Message): void => {
      this.handleMessage(message);
    });
  }

  async deactivate(): Promise<void> {
    await this.channel.close();
    await super.deactivate();
  }

  protected handleMessage(message: Message) {
    switch(message.type) {
    case 'transform':
      this.sync(message.transform);
      break;
    case 'query':
      this._requestQueue.push({ type: 'proxyQuery', data: message.query });
      break;
    case 'pull':
      this._requestQueue.push({ type: 'proxyPull', data: message.query });
      break;
    case 'query-result':
    case 'update-result':
      this.resolveRequest(message.id, message.result);
      break;
    case 'pull-result':
    case 'push-result':
      this.resolveRequest(message.id);
      break;
    case 'error':
      throw message.error;
    }
  }

  protected resolveRequest(requestId: string, result?: QueryResultData | QueryResultData[]) {
    this._requests[requestId](result);
    delete this._requests[requestId];
  }
}
