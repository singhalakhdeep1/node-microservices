/**
 * Message Broker for Node Microservices
 * Implements publish-subscribe pattern for event-driven architecture
 */
const EventEmitter = require('events');

class MessageBroker extends EventEmitter {
  constructor() {
    super();
    this.subscribers = new Map();
  }

  publish(eventType, data, correlationId) {
    const payload = {
      eventType,
      data,
      timestamp: new Date(),
      correlationId
    };

    this.emit(eventType, payload);
    console.log(`Published event: ${eventType}`);
  }

  subscribe(eventType, handler) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }

    this.subscribers.get(eventType).push(handler);
    this.on(eventType, handler);

    console.log(`Subscribed to event: ${eventType}`);
  }

  unsubscribe(eventType, handler) {
    const handlers = this.subscribers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }

    this.off(eventType, handler);
  }

  getSubscribers() {
    return new Map(this.subscribers);
  }
}

module.exports = MessageBroker;
