import { BadRequestException, Injectable } from '@nestjs/common';
import {
  add_operation as addJsonLogicOperation,
  apply as jsonLogicApply,
} from 'json-logic-js';

/**
 * Custom JSON-Logic operators required by ARCHITECTURE.md Invariant 4.
 *
 * `ceil` accepts both `{ "ceil": expr }` and `{ "ceil": [expr] }` (used by the
 * seeded pricing schemas for per-meter quantities). `max` accepts an argument
 * list and is CRITICAL for quantity clamping:
 *   { "max": [0, { "-": [{ "var": "remoteCount" }, 1] }] }
 * prevents negative quantities from SUBTRACTING money from quotes.
 *
 * Both are built into json-logic-js; registering them here keeps the dialect
 * explicit (and works with alternative engines later).
 */
addJsonLogicOperation('ceil', (value: unknown) => Math.ceil(Number(value)));
addJsonLogicOperation('max', (...values: unknown[]) =>
  Math.max(...values.map((v) => Number(v))),
);

/** Shared JSON-Logic dialect for the Advisory AND Pricing engines (Invariant 4). */
@Injectable()
export class JsonLogicEvaluator {
  /** Evaluates a rule document to a truthy/falsy boolean. */
  evaluateBoolean(rule: unknown, data: unknown): boolean {
    return Boolean(jsonLogicApply(rule as never, data as never));
  }

  /** Evaluates a rule document to a finite number (NaN/Infinity are rejected). */
  evaluateNumber(rule: unknown, data: unknown): number {
    const result = Number(jsonLogicApply(rule as never, data as never));
    if (!Number.isFinite(result)) {
      throw new Error('JSON-Logic numeric evaluation produced a non-finite value');
    }
    return result;
  }

  /**
   * Dry-run validation for admin-created rules/schemas: structural checks plus
   * an actual evaluation against an empty facts document. Throws a Persian 400.
   */
  validateLogic(rule: unknown): void {
    if (rule === null || rule === undefined || typeof rule !== 'object') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'قاعده JSON-Logic باید یک آبجکت (یا آرایه‌ای از قواعد) باشد.',
      });
    }
    try {
      jsonLogicApply(rule as never, {} as never);
    } catch (error: unknown) {
      throw new BadRequestException({
        statusCode: 400,
        message: `ساختار قاعده JSON-Logic نامعتبر است: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
