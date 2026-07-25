import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.js';

/**
 * Rate limiter for /api/public/* — blunts scripted duplicate-submission
 * attempts (a supporting control for the anti-duplicate model). Effectively
 * disabled under NODE_ENV=test so the suite can fire many requests.
 */
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 100000 : 30, // 30 requests/min/IP in normal operation
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

/** Tighter limiter for login to slow credential-stuffing. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});
