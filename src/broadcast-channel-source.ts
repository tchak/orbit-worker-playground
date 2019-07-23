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
  Queryable,
  Updatable,
  updatable
} from '@orbit/data';
import { fulfillInSeries, settleInSeries } from '@orbit/core';
import { QueryResultData } from '@orbit/record-cache';
import BroadcastChannel from 'broadcast-channel';

export interface BroadcastChannelSourceSettings extends SourceSettings {
  channel?: string;
}

interface SyncMessage {
  type: 'sync';
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

interface SuccessMessage {
  type: 'success';
  id: string;
  result?: QueryResultData | QueryResultData[];
}

interface ErrorMessage {
  type: 'error';
  id: string;
  error: Error;
}

type Message = SyncMessage | QueryMessage | PullMessage | UpdateMessage | PushMessage | SuccessMessage | ErrorMessage;
type Resolver = {
  resolve: (result?: QueryResultData | QueryResultData[]) => void;
  reject: (error: Error) => void;
};

@pushable
@updatable
@pullable
@syncable
@queryable
export default class BroadcastChannelSource extends Source
  implements Pushable, Updatable, Pullable, Syncable, Queryable {
  channel: BroadcastChannel<Message>;
  protected _channelName: string;
  protected _requests: Record<string, Resolver>;

  // Pushable interface stubs
  push: (
    transformOrOperations: TransformOrOperations,
    options?: object,
    id?: string
  ) => Promise<Transform[]>;

  // Updatable interface stubs
  update: (
    transformOrOperations: TransformOrOperations,
    options?: object,
    id?: string
  ) => Promise<any>;

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

      await new Promise((resolve, reject) => {
        this._requests[transform.id] = { resolve, reject };
      });
    }
    return [];
  }

  /////////////////////////////////////////////////////////////////////////////
  // Updatable interface implementation
  /////////////////////////////////////////////////////////////////////////////
  async _update(transform: Transform): Promise<any> {
    if (!this.transformLog.contains(transform.id)) {
      await this.channel.postMessage({
        type: 'update',
        transform
      });

      return new Promise((resolve, reject) => {
        this._requests[transform.id] = { resolve, reject };
      });
    }
    return;
  }

  /////////////////////////////////////////////////////////////////////////////
  // Pullable interface implementation
  /////////////////////////////////////////////////////////////////////////////
  async _pull(query: Query): Promise<Transform[]> {
    await this.channel.postMessage({
      type: 'pull',
      query
    });

    await new Promise((resolve, reject) => {
      this._requests[query.id] = { resolve, reject };
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

    return new Promise((resolve, reject) => {
      this._requests[query.id] = { resolve, reject };
    });
  }

  /////////////////////////////////////////////////////////////////////////////
  // Syncable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async _sync(transform: Transform): Promise<void> {
    if (!this.transformLog.contains(transform.id)) {
      await this.channel.postMessage({
        type: 'sync',
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
        type: 'success',
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

  protected async __proxyPull__(query: Query): Promise<Transform[]> {
    try {
      const hints: any = {};

      await fulfillInSeries(this, 'beforePull', query, hints);

      await settleInSeries(this, 'proxyPull', query, []);

      await this.channel.postMessage({
        type: 'success',
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

  protected async __proxyUpdate__(transform: Transform): Promise<any> {
    if (this.transformLog.contains(transform.id)) {
      return [];
    }

    try {
      const hints: any = {};
      await fulfillInSeries(this, 'beforeUpdate', transform, hints);

      const result = hints && hints.data;

      await settleInSeries(this, 'proxyUpdate', transform, result);

      await this.channel.postMessage({
        type: 'success',
        id: transform.id,
        result
      });
      return result;
    } catch (error) {
      await settleInSeries(this, 'updateFail', transform, error);

      await this.channel.postMessage({
        type: 'error',
        id: transform.id,
        error
      });
    }
  }

  protected async __proxyPush__(transform: Transform): Promise<Transform[]> {
    if (this.transformLog.contains(transform.id)) {
      return [];
    }

    try {
      const hints: any = {};
      await fulfillInSeries(this, 'beforePush', transform, hints);

      await settleInSeries(this, 'proxyPush', transform, []);

      await this.channel.postMessage({
        type: 'success',
        id: transform.id
      });
      return [];
    } catch (error) {
      await settleInSeries(this, 'pushFail', transform, error);

      await this.channel.postMessage({
        type: 'error',
        id: transform.id,
        error
      });
    }
  }

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
    case 'sync':
      this.sync(message.transform);
      break;
    case 'query':
      this._requestQueue.push({ type: 'proxyQuery', data: message.query });
      break;
    case 'pull':
      this._requestQueue.push({ type: 'proxyPull', data: message.query });
      break;
    case 'update':
      this._requestQueue.push({ type: 'proxyUpdate', data: message.transform });
      break;
    case 'push':
      this._requestQueue.push({ type: 'proxyPush', data: message.transform });
      break;
    case 'success':
      this.resolveRequest(message.id, message.result);
      break;
    case 'error':
      this.rejectRequest(message.id, message.error);
    }
  }

  protected resolveRequest(requestId: string, result?: QueryResultData | QueryResultData[]) {
    const { resolve } = this._requests[requestId];
    delete this._requests[requestId];
    resolve(result);
  }

  protected rejectRequest(requestId: string, error: Error) {
    const { reject } = this._requests[requestId];
    delete this._requests[requestId];
    reject(error);
  }
}
