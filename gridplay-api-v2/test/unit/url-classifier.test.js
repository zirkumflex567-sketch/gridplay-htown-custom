import { test, describe } from 'node:test';
import assert from 'node:assert';
import { classifyUrl, ProviderRegistry, createProviderRegistry } from '../src/providers/registry.js';
import pmvhavenProvider from '../src/providers/pmvhaven.provider.js';
import xvideosProvider from '../src/providers/xvideos.provider.js';
import xhamsterProvider from '../src/providers/xhamster.provider.js';

describe('ProviderRegistry', () => {
  test('should register providers', () => {
    const registry = createProviderRegistry([pmvhavenProvider]);
    assert.strictEqual(registry.getById('pmvhaven').id, 'pmvhaven');
  });

  test('should find provider by domain', () => {
    const registry = createProviderRegistry([pmvhavenProvider, xvideosProvider]);
    const provider = registry.getByDomain('www.pmvhaven.com');
    assert.strictEqual(provider.id, 'pmvhaven');
  });

  test('should return null for unknown domain', () => {
    const registry = createProviderRegistry([pmvhavenProvider]);
    const provider = registry.getByDomain('unknown.com');
    assert.strictEqual(provider, null);
  });
});

describe('URL Classifier', () => {
  test('should classify pmvhaven video url', () => {
    const registry = createProviderRegistry([pmvhavenProvider]);
    const result = classifyUrl('https://pmvhaven.com/video/abc123', registry);
    assert.strictEqual(result.kind, 'video');
    assert.strictEqual(result.providerId, 'pmvhaven');
    assert.ok(result.confidence > 0.8);
  });

  test('should classify pmvhaven playlist url', () => {
    const registry = createProviderRegistry([pmvhavenProvider]);
    const result = classifyUrl('https://pmvhaven.com/playlist/abc123', registry);
    assert.strictEqual(result.kind, 'playlist');
  });

  test('should classify xvideos video url', () => {
    const registry = createProviderRegistry([xvideosProvider]);
    const result = classifyUrl('https://www.xvideos.com/video123/test', registry);
    assert.strictEqual(result.kind, 'video');
    assert.strictEqual(result.providerId, 'xvideos');
  });

  test('should classify xhamster profile url', () => {
    const registry = createProviderRegistry([xhamsterProvider]);
    const result = classifyUrl('https://www.xhamster.com/users/testuser', registry);
    assert.strictEqual(result.kind, 'profile');
    assert.strictEqual(result.providerId, 'xhamster');
  });

  test('should classify search url', () => {
    const registry = createProviderRegistry([xvideosProvider]);
    const result = classifyUrl('https://www.xvideos.com/?k=test', registry);
    assert.strictEqual(result.kind, 'search');
  });

  test('should return unknown for invalid url', () => {
    const registry = createProviderRegistry([pmvhavenProvider]);
    const result = classifyUrl('not-a-url', registry);
    assert.strictEqual(result.kind, 'unknown');
    assert.ok(result.signals.includes('invalid-url'));
  });
});