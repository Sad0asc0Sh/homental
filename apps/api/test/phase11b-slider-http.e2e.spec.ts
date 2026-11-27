import type { AddressInfo } from 'node:net';
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { AdvisoryController } from '@modules/security-services/advisory/advisory.controller';
import { AdvisoryService } from '@modules/security-services/advisory/advisory.service';
import { DispatchService } from '@modules/security-services/dispatch/dispatch.service';
import { OrdersController } from '@modules/security-services/orders/orders.controller';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import { PricingController } from '@modules/security-services/pricing/pricing.controller';
import { PricingService } from '@modules/security-services/pricing/pricing.service';

const orderId = 'afa04aae-22bc-4dea-ad2d-6ba0d849bd57';
const actor: AuthenticatedUser = {
  id: '2ab683bf-5361-4daf-af74-f853f3b972d6', phone: '+989121234567', branchId: null, role: 'CUSTOMER',
};
const pricing = { estimate: jest.fn() };
const advisory = { evaluate: jest.fn() };
const orders = { create: jest.fn(), submit: jest.fn() };
const receipt = { accepted: true };
const routes = [
  { label: 'estimate', path: '/pricing/estimate', body: { items: [{ serviceKey: 'CCTV' }] }, handler: pricing.estimate, args: [] },
  { label: 'evaluate', path: '/advisor/evaluate', body: { locationType: 'SHOP' }, handler: advisory.evaluate, args: [] },
  {
    label: 'create', path: '/orders', body: { addressId: orderId, items: [{ serviceKey: 'CCTV' }] },
    handler: orders.create, args: [actor],
  },
  { label: 'submit', path: `/orders/${orderId}/submit`, body: {}, handler: orders.submit, args: [actor, orderId] },
];

describe('Phase 11B slider HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PricingController, AdvisoryController, OrdersController],
      providers: [
        { provide: PricingService, useValue: pricing },
        { provide: AdvisoryService, useValue: advisory },
        { provide: OrdersService, useValue: orders },
        { provide: DispatchService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user = actor;
          return true;
        },
      })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    for (const { handler } of routes) handler.mockReset().mockResolvedValue(receipt);
  });

  afterAll(async () => app?.close());

  function post(path: string, body?: object) {
    return fetch(baseUrl + path, {
      method: 'POST',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  }

  it.each(routes)('$label forwards valid slider values through validation', async ({ path, body, handler, args }) => {
    for (const sliderBps of [-1500, -1000, 0, 500, 2500]) {
      const response = await post(path, { ...body, sliderBps });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual(receipt);
      expect(handler).toHaveBeenLastCalledWith(...args, expect.objectContaining({ sliderBps }));
    }
  });

  it.each(routes)('$label rejects noninteger, out-of-range, and non-step options with Persian 400', async ({ path, body, handler }) => {
    for (const sliderBps of [-1600, 501, 2600, 500.5, '500', null]) {
      const response = await post(path, { ...body, sliderBps });
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/بسته/);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('continues to accept bodyless submit requests', async () => {
    const response = await post(`/orders/${orderId}/submit`);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(receipt);
  });
});
