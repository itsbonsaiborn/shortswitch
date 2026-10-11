import type { ServerResponse } from 'node:http';
import type { LiveResultsDelta, LiveResultsSnapshot } from '@/shared/types.js';

type LiveProtocol = 'legacy' | 'delta';
type LiveScope = 'public' | 'presentation';

interface LiveClient {
  response: ServerResponse;
  protocol: LiveProtocol;
  scope: LiveScope;
  backpressured: boolean;
  drainHandler?: () => void;
}

const MAX_BUFFERED_BYTES = 256 * 1024;
const stableKey = (text: string) => text.normalize('NFKC').toLocaleLowerCase();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const buildLiveResultsDelta = (previous: LiveResultsSnapshot, current: LiveResultsSnapshot): LiveResultsDelta => {
  const delta: LiveResultsDelta = {
    type: 'delta',
    baseRevision: previous.revision,
    revision: current.revision
  };
  if (previous.status !== current.status) delta.status = current.status;
  if (previous.publicResults !== current.publicResults) delta.publicResults = current.publicResults;
  if (previous.responseCount !== current.responseCount) delta.responseCount = current.responseCount;
  if (previous.uniqueParticipantCount !== current.uniqueParticipantCount) delta.uniqueParticipantCount = current.uniqueParticipantCount;
  if (previous.openAnswerTotal !== current.openAnswerTotal) delta.openAnswerTotal = current.openAnswerTotal;
  if (previous.wordCloudTotal !== current.wordCloudTotal) delta.wordCloudTotal = current.wordCloudTotal;

  if (current.type === 'open_answer') {
    const previousById = new Map(previous.openAnswers.map((answer) => [answer.id, answer]));
    const currentById = new Map(current.openAnswers.map((answer) => [answer.id, answer]));
    const upsert = current.openAnswers.filter((answer) => !same(previousById.get(answer.id), answer));
    const removeIds = previous.openAnswers.filter((answer) => !currentById.has(answer.id)).map((answer) => answer.id);
    if (upsert.length || removeIds.length) delta.openAnswers = { upsert, removeIds };
  } else if (current.type === 'word_cloud') {
    const previousByKey = new Map(previous.wordCloud.map((word) => [stableKey(word.text), word]));
    const currentByKey = new Map(current.wordCloud.map((word) => [stableKey(word.text), word]));
    const upsert = current.wordCloud.filter((word) => !same(previousByKey.get(stableKey(word.text)), word));
    const removeKeys = previous.wordCloud
      .filter((word) => !currentByKey.has(stableKey(word.text)))
      .map((word) => stableKey(word.text));
    if (upsert.length || removeKeys.length) delta.wordCloud = { upsert, removeKeys };
  } else if (current.type === 'multiple_choice' && !same(previous.choices, current.choices)) {
    delta.choices = current.choices;
  } else if (current.type === 'scale' && !same(previous.scale, current.scale)) {
    delta.scale = current.scale;
  }

  return delta;
};

export class LiveRealtimeService {
  private clients = new Map<string, Set<LiveClient>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private providers = new Map<string, () => LiveResultsSnapshot>();
  private latest = new Map<string, LiveResultsSnapshot>();
  private forceSnapshots = new Set<string>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const [activityId, clients] of this.clients) {
        for (const client of clients) this.write(activityId, client, ': keep-alive\n\n');
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  addClient(
    activityId: string,
    response: ServerResponse,
    provider: () => LiveResultsSnapshot,
    protocol: LiveProtocol = 'delta',
    scope: LiveScope = 'public'
  ) {
    const client: LiveClient = { response, protocol, scope, backpressured: false };
    const clients = this.clients.get(activityId) ?? new Set<LiveClient>();
    clients.add(client);
    this.clients.set(activityId, clients);
    const snapshot = provider();
    this.latest.set(activityId, snapshot);
    this.sendSnapshot(activityId, client, snapshot);
    return () => this.removeClient(activityId, client);
  }

  schedule(activityId: string, provider: () => LiveResultsSnapshot, options: { forceSnapshot?: boolean } = {}) {
    if (!this.clients.get(activityId)?.size) return;
    this.providers.set(activityId, provider);
    if (options.forceSnapshot) this.forceSnapshots.add(activityId);
    if (this.timers.has(activityId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(activityId);
      const currentProvider = this.providers.get(activityId);
      this.providers.delete(activityId);
      if (!currentProvider) return;
      const previous = this.latest.get(activityId);
      const snapshot = currentProvider();
      this.latest.set(activityId, snapshot);
      const forceSnapshot = this.forceSnapshots.delete(activityId);
      if (previous && same(previous, snapshot)) return;

      const delta = previous ? buildLiveResultsDelta(previous, snapshot) : null;
      const snapshotPayload = JSON.stringify(snapshot);
      const deltaPayload = delta ? JSON.stringify(delta) : '';
      const sendFullSnapshot = forceSnapshot || !delta || delta.baseRevision !== previous?.revision || deltaPayload.length >= snapshotPayload.length;
      for (const client of this.clients.get(activityId) ?? []) {
        if (client.scope === 'public' && !snapshot.publicResults) {
          if (client.protocol === 'legacy') client.response.end();
          else this.writeEvent(activityId, client, 'visibility', JSON.stringify({ publicResults: false, revision: snapshot.revision }));
        } else if (client.protocol === 'legacy') this.writeEvent(activityId, client, 'results', snapshotPayload);
        else if (sendFullSnapshot) this.writeEvent(activityId, client, 'snapshot', snapshotPayload);
        else this.writeEvent(activityId, client, 'delta', deltaPayload);
      }
    }, 500);
    timer.unref();
    this.timers.set(activityId, timer);
  }

  closeActivity(activityId: string) {
    for (const client of this.clients.get(activityId) ?? []) {
      this.writeEvent(activityId, client, 'gone', JSON.stringify({ message: 'Activity is no longer available.' }));
      client.response.end();
    }
    this.clients.delete(activityId);
    this.latest.delete(activityId);
    this.providers.delete(activityId);
    this.forceSnapshots.delete(activityId);
    const timer = this.timers.get(activityId);
    if (timer) clearTimeout(timer);
    this.timers.delete(activityId);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const clients of this.clients.values()) {
      for (const client of clients) client.response.end();
    }
    this.timers.clear();
    this.clients.clear();
    this.latest.clear();
    this.providers.clear();
    this.forceSnapshots.clear();
  }

  private sendSnapshot(activityId: string, client: LiveClient, snapshot: LiveResultsSnapshot) {
    if (client.scope === 'public' && !snapshot.publicResults) {
      this.writeEvent(activityId, client, 'visibility', JSON.stringify({ publicResults: false, revision: snapshot.revision }));
      return;
    }
    this.writeEvent(activityId, client, client.protocol === 'legacy' ? 'results' : 'snapshot', JSON.stringify(snapshot));
  }

  private writeEvent(activityId: string, client: LiveClient, event: string, payload: string) {
    this.write(activityId, client, `event: ${event}\ndata: ${payload}\n\n`);
  }

  private write(activityId: string, client: LiveClient, payload: string) {
    const { response } = client;
    if (response.destroyed || response.writableEnded) {
      this.removeClient(activityId, client);
      return;
    }
    if (client.backpressured) {
      if (response.writableLength > MAX_BUFFERED_BYTES) response.destroy();
      return;
    }
    const canContinue = response.write(payload);
    if (canContinue) return;
    client.backpressured = true;
    if (response.writableLength > MAX_BUFFERED_BYTES) {
      response.destroy();
      return;
    }
    client.drainHandler = () => {
      client.backpressured = false;
      client.drainHandler = undefined;
      const snapshot = this.latest.get(activityId);
      if (snapshot) this.sendSnapshot(activityId, client, snapshot);
    };
    response.once('drain', client.drainHandler);
  }

  private removeClient(activityId: string, client: LiveClient) {
    if (client.drainHandler) client.response.off('drain', client.drainHandler);
    const clients = this.clients.get(activityId);
    clients?.delete(client);
    if (clients?.size === 0) {
      this.clients.delete(activityId);
      this.latest.delete(activityId);
    }
  }
}
