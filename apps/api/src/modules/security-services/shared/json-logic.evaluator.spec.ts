import { BadRequestException } from '@nestjs/common';
import { advisoryRules } from '../../../../prisma/seed';
import { JsonLogicEvaluator } from './json-logic.evaluator';

describe('JsonLogicEvaluator — custom operators (Invariant 4)', () => {
  const evaluator = new JsonLogicEvaluator();

  it('ceil handles both { ceil: expr } and { ceil: [expr] } forms', () => {
    expect(evaluator.evaluateNumber({ ceil: { '/': [45, 100] } }, {})).toBe(1);
    expect(evaluator.evaluateNumber({ ceil: [{ '/': [45, 100] }] }, {})).toBe(1);
    expect(evaluator.evaluateNumber({ ceil: { '/': [400, 100] } }, {})).toBe(4);
  });

  it('max clamps negative quantities to 0 (remote-count pricing bug guard)', () => {
    const qtyRule = { max: [0, { '-': [{ var: 'remoteCount' }, 1] }] };
    expect(evaluator.evaluateNumber(qtyRule, { remoteCount: 0 })).toBe(0);
    expect(evaluator.evaluateNumber(qtyRule, { remoteCount: 1 })).toBe(0);
    expect(evaluator.evaluateNumber(qtyRule, { remoteCount: 3 })).toBe(2);
  });

  it('max takes the largest of several evaluated arguments', () => {
    expect(evaluator.evaluateNumber({ max: [2, 7, 4] }, {})).toBe(7);
  });

  it('evaluateNumber rejects non-finite results instead of returning NaN', () => {
    expect(() => evaluator.evaluateNumber({ '*': ['abc', 2] }, {})).toThrow(/non-finite/);
  });

  it('evaluateBoolean evaluates a seeded advisory condition against real facts', () => {
    const shopCctvNoAlarm = advisoryRules.find((r) => r.code === 'SHOP_CCTV_NO_ALARM');
    if (!shopCctvNoAlarm) throw new Error('seed rule missing');

    const firingFacts = {
      locationType: 'SHOP',
      building: {},
      services: { CCTV: { active: true }, ALARM: { active: false } },
    };
    const calmFacts = {
      locationType: 'SHOP',
      building: {},
      services: { CCTV: { active: true }, ALARM: { active: true } },
    };
    expect(evaluator.evaluateBoolean(shopCctvNoAlarm.condition, firingFacts)).toBe(true);
    expect(evaluator.evaluateBoolean(shopCctvNoAlarm.condition, calmFacts)).toBe(false);
  });
});

describe('JsonLogicEvaluator.validateLogic (admin rule dry-run)', () => {
  const evaluator = new JsonLogicEvaluator();

  it('accepts a structurally valid rule', () => {
    expect(() =>
      evaluator.validateLogic({
        and: [{ '==': [{ var: 'locationType' }, 'SHOP'] }, { '==': [true, true] }],
      }),
    ).not.toThrow();
  });

  it('rejects non-object rules with a Persian 400', () => {
    expect(() => evaluator.validateLogic(42)).toThrow(BadRequestException);
    expect(() => evaluator.validateLogic(null)).toThrow(/JSON-Logic/);
    expect(() => evaluator.validateLogic('and')).toThrow(BadRequestException);
  });

  it('rejects unknown operators with a Persian 400', () => {
    expect(() => evaluator.validateLogic({ totally_unknown_op: [1, 2] })).toThrow(
      BadRequestException,
    );
    try {
      evaluator.validateLogic({ totally_unknown_op: [1, 2] });
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('نامعتبر');
    }
  });
});
