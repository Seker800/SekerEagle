'use strict';

const crypto = require('node:crypto');

function normalizeApiBase(value) {
  const trimmed = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed))
    throw new Error('服务器地址必须以 http:// 或 https:// 开头。');
  return trimmed.toLowerCase().endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function randomId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function clampText(value, maxLength, fallback = '') {
  const text = String(value ?? fallback)
    .normalize('NFKC')
    .trim();
  return text.slice(0, maxLength);
}

function chunksOf(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let current = bytes / 1024;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[unit]}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { clampText, chunksOf, delay, formatBytes, normalizeApiBase, randomId };
