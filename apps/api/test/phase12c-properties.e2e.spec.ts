import { randomUUID } from 'node:crypto';
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { PrismaClient, type User } from '@prisma/client';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { BigIntSerializerInterceptor } from '@common/interceptors/bigint-serializer.interceptor';
import type { AuthenticatedRequest, AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { LocalDevMediaStorageProvider, MEDIA_STORAGE_PROVIDER } from '@modules/properties/media-storage.provider';
import { PropertiesController } from '@modules/properties/properties.controller';
import { PropertiesService } from '@modules/properties/properties.service';
import { DispatchService } from '@modules/security-services/dispatch/dispatch.service';
import { OrdersController } from '@modules/security-services/orders/orders.controller';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import { PricingService } from '@modules/security-services/pricing/pricing.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';

const databaseUrl = process.env['PHASE12C_PROPERTIES_TEST_DATABASE_URL'];
const describePostgres = databaseUrl ? describe : describe.skip;

function actor(user: User, branchId: string | null = null): AuthenticatedUser {
  return { id: user.id, role: user.role, phone: user.phone, branchId };
}

describePostgres('Phase 12C — Customer Properties, Spatial Media & Role Access (PostgreSQL + PostGIS)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let actors: Record<string, AuthenticatedUser>;
  let cityId: string;
  let branchAId: string;
  let orderId: string;
  let offerOrderId: string;
  let techAssignedProfileId: string;
  let techOfferedProfileId: string;

  beforeAll(async () => {
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();

    const tag = randomUUID();
    const coords = { lat: 36.3105, lng: 59.5663 };

    const seeded = await client.$transaction(async (db) => {
      const city = await db.city.create({
        data: { slug: `${tag}-mashhad`, nameFa: 'مشهد', nameEn: 'Mashhad', centerLat: coords.lat, centerLng: coords.lng },
      });
      const branchA = await db.branch.create({
        data: { code: `${tag}-b1`, cityId: city.id, nameFa: 'شعبه یک', addressFa: 'وکیل‌آباد', ...coords },
      });
      const branchB = await db.branch.create({
        data: { code: `${tag}-b2`, cityId: city.id, nameFa: 'شعبه دو', addressFa: 'سجاد', ...coords },
      });

      const custAUser = await db.user.create({ data: { phone: `${tag}-ca`, role: 'CUSTOMER', status: 'ACTIVE' } });
      const custBUser = await db.user.create({ data: { phone: `${tag}-cb`, role: 'CUSTOMER', status: 'ACTIVE' } });
      const custAProfile = await db.customerProfile.create({ data: { userId: custAUser.id } });
      const addressA = await db.address.create({
        data: {
          customerId: custAProfile.id,
          cityId: city.id,
          titleFa: 'خانه',
          locationType: 'APARTMENT',
          fullAddressFa: 'مشهد، بلوار وکیل‌آباد، پلاک ۱۰',
          ...coords,
        },
      });

      const techAssignedUser = await db.user.create({ data: { phone: `${tag}-t1`, role: 'TECHNICIAN', status: 'ACTIVE' } });
      const techOfferedUser = await db.user.create({ data: { phone: `${tag}-t2`, role: 'TECHNICIAN', status: 'ACTIVE' } });
      const techUnassignedUser = await db.user.create({ data: { phone: `${tag}-t3`, role: 'TECHNICIAN', status: 'ACTIVE' } });
      const techAssignedProfile = await db.technicianProfile.create({
        data: { userId: techAssignedUser.id, branchId: branchA.id, status: 'APPROVED', skills: ['CCTV'] },
      });
      const techOfferedProfile = await db.technicianProfile.create({
        data: { userId: techOfferedUser.id, branchId: branchA.id, status: 'APPROVED', skills: ['CCTV'] },
      });
      await db.technicianProfile.create({
        data: { userId: techUnassignedUser.id, branchId: branchA.id, status: 'APPROVED', skills: ['CCTV'] },
      });

      const sellerUser = await db.user.create({ data: { phone: `${tag}-s1`, role: 'SELLER', status: 'ACTIVE' } });
      const sellerProfile = await db.sellerProfile.create({
        data: { userId: sellerUser.id, cityId: city.id, branchId: branchA.id, shopNameFa: 'فروشگاه تست', addressFa: 'مشهد', status: 'APPROVED', ...coords },
      });

      const branchAdminAUser = await db.user.create({ data: { phone: `${tag}-ba`, role: 'BRANCH_ADMIN', status: 'ACTIVE' } });
      const branchAdminBUser = await db.user.create({ data: { phone: `${tag}-bb`, role: 'BRANCH_ADMIN', status: 'ACTIVE' } });
      const superAdminUser = await db.user.create({ data: { phone: `${tag}-sa`, role: 'SUPER_ADMIN', status: 'ACTIVE' } });

      const def = await db.serviceDefinition.create({
        data: { key: 'CCTV', titleFa: 'دوربین', pillar: 'MONITORING', supportedLocationTypes: ['APARTMENT'], uiSchema: {}, pricingSchema: {} },
      });

      const order = await db.serviceOrder.create({
        data: {
          orderNumber: `HM-12C-${tag.slice(0, 8)}`,
          customerId: custAUser.id,
          technicianId: techAssignedUser.id,
          branchId: branchA.id,
          addressId: addressA.id,
          locationType: 'APARTMENT',
          state: 'IN_PROGRESS',
          pricingVersion: 2,
          ...coords,
        },
      });
      await db.orderItem.create({ data: { orderId: order.id, serviceDefinitionId: def.id, config: {} } });
      await db.supplyFulfillment.create({
        data: { orderId: order.id, sellerId: sellerProfile.id, deliveryMode: 'BIKE', freightCost: 50_000n },
      });

      const offerOrder = await db.serviceOrder.create({
        data: {
          orderNumber: `HM-12C-OFFER-${tag.slice(0, 6)}`,
          customerId: custAUser.id,
          branchId: branchA.id,
          addressId: addressA.id,
          locationType: 'APARTMENT',
          state: 'SEARCHING_EXPERT',
          pricingVersion: 2,
          ...coords,
        },
      });

      return {
        city,
        branchA,
        order,
        offerOrder,
        techAssignedProfile,
        techOfferedProfile,
        actors: {
          customerA: actor(custAUser),
          customerB: actor(custBUser),
          techAssigned: actor(techAssignedUser, branchA.id),
          techOffered: actor(techOfferedUser, branchA.id),
          techUnassigned: actor(techUnassignedUser, branchA.id),
          seller: actor(sellerUser, branchA.id),
          branchAdminA: actor(branchAdminAUser, branchA.id),
          branchAdminB: actor(branchAdminBUser, branchB.id),
          superAdmin: actor(superAdminUser),
        },
      };
    });

    await client.$disconnect();

    cityId = seeded.city.id;
    branchAId = seeded.branchA.id;
    orderId = seeded.order.id;
    offerOrderId = seeded.offerOrder.id;
    techAssignedProfileId = seeded.techAssignedProfile.id;
    techOfferedProfileId = seeded.techOfferedProfile.id;
    actors = seeded.actors;

    const moduleRef = await Test.createTestingModule({
      controllers: [PropertiesController, OrdersController],
      providers: [
        PropertiesService,
        LocalDevMediaStorageProvider,
        { provide: MEDIA_STORAGE_PROVIDER, useExisting: LocalDevMediaStorageProvider },
        OrdersService,
        {
          provide: PrismaService,
          useFactory: () => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
        },
        { provide: PricingService, useValue: {} },
        { provide: WalletEscrowService, useValue: {} },
        { provide: NotificationsService, useValue: { send: jest.fn() } },
        { provide: DispatchService, useValue: {} },
        EventEmitter2,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          const header = req.get('x-test-actor');
          req.user = header ? actors[header] : undefined;
          return Boolean(req.user);
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    prisma = moduleRef.get(PrismaService);
    await (prisma as unknown as PrismaClient).$connect();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntSerializerInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await (prisma as unknown as PrismaClient | undefined)?.$disconnect();
  });

  async function apiCall(as: string, path: string, method = 'GET', body?: object) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'x-test-actor': as,
        'content-type': 'application/json',
        connection: 'close',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: response.status, payload };
  }

  it('enforces CRUD, PostGIS location sync, presign/complete media lifecycle, and strict role/ownership isolation', async () => {
    // 1. Customer A creates property
    const created = await apiCall('customerA', '/properties', 'POST', {
      cityId,
      title: 'منزل وکیل‌آباد',
      propertyType: 'RESIDENTIAL',
      address: 'مشهد، بلوار وکیل‌آباد، پلاک ۱۲، واحد ۳',
      lat: 36.3105,
      lng: 59.5663,
      notes: 'درب پارکینگ ریموت‌دار است',
      defaultDimensionsJson: { areaM2: 145, ceilingHeightCm: 295 },
    });
    expect(created.status).toBe(201);
    const propertyId = created.payload?.['id'] as string;
    expect(propertyId).toBeTruthy();

    // Verify PostGIS geography trigger populated CustomerProperty.location
    const geoRows = await prisma.$queryRaw<Array<{ populated: boolean }>>`
      SELECT ("location" IS NOT NULL) AS populated
      FROM "CustomerProperty"
      WHERE "id" = ${propertyId}::uuid
    `;
    expect(geoRows[0]?.populated).toBe(true);

    // 2. Customer A presigns + completes PHOTO (READY) and MODEL_3D_GLB (PROCESSING)
    const badPresign = await apiCall('customerA', `/properties/${propertyId}/media/presign`, 'POST', {
      kind: 'PHOTO',
      mimeType: 'text/plain',
      sizeBytes: 120,
    });
    expect(badPresign.status).toBe(400);

    const photoPresign = await apiCall('customerA', `/properties/${propertyId}/media/presign`, 'POST', {
      kind: 'PHOTO',
      mimeType: 'image/jpeg',
      sizeBytes: 102_400,
      fileName: 'front.jpg',
    });
    expect(photoPresign.status).toBe(201);
    const photoAssetId = photoPresign.payload?.['assetId'] as string;

    const photoComplete = await apiCall(
      'customerA',
      `/properties/${propertyId}/media/${photoAssetId}/complete`,
      'POST',
      { spatialMetadataJson: { scannerSource: 'web-upload', cableEstimateCm: 1800 } },
    );
    expect(photoComplete.status).toBe(201);
    expect(photoComplete.payload?.['status']).toBe('READY');

    const modelPresign = await apiCall('customerA', `/properties/${propertyId}/media/presign`, 'POST', {
      kind: 'MODEL_3D_GLB',
      mimeType: 'model/gltf-binary',
      sizeBytes: 2_500_000,
      fileName: 'home.glb',
    });
    expect(modelPresign.status).toBe(201);
    const modelAssetId = modelPresign.payload?.['assetId'] as string;

    const modelComplete = await apiCall(
      'customerA',
      `/properties/${propertyId}/media/${modelAssetId}/complete`,
      'POST',
      { spatialMetadataJson: { ceilingHeightCm: 295, scannerSource: 'capacitor-ar' } },
    );
    expect(modelComplete.status).toBe(201);
    expect(modelComplete.payload?.['status']).toBe('PROCESSING');

    // 3. Ownership isolation: Customer B blocked (403)
    expect((await apiCall('customerB', `/properties/${propertyId}`)).status).toBe(403);
    expect((await apiCall('customerB', `/properties/${propertyId}`, 'PATCH', { title: 'هک' })).status).toBe(403);
    expect((await apiCall('customerB', `/properties/${propertyId}`, 'DELETE')).status).toBe(403);
    expect(
      (await apiCall('customerB', `/properties/${propertyId}/media/presign`, 'POST', {
        kind: 'PHOTO',
        mimeType: 'image/jpeg',
        sizeBytes: 500,
      })).status,
    ).toBe(403);

    // 4. SELLER has zero access (403)
    expect((await apiCall('seller', '/properties')).status).toBe(403);
    expect((await apiCall('seller', `/properties/${propertyId}`)).status).toBe(403);

    // 5. Link property to Customer A's active order & create an active offer for techOffered
    const linked = await apiCall('customerA', `/orders/${orderId}/property`, 'PATCH', { propertyId });
    expect(linked.status).toBe(200);
    expect(linked.payload?.['propertyId']).toBe(propertyId);
    expect(linked.payload?.['propertySummary']).toMatchObject({
      id: propertyId,
      title: 'منزل وکیل‌آباد',
      mediaCount: 2,
    });

    await prisma.serviceOrder.update({ where: { id: offerOrderId }, data: { propertyId } });
    await prisma.dispatchOffer.create({
      data: {
        orderId: offerOrderId,
        technicianId: techOfferedProfileId,
        wave: 1,
        radiusMeters: 5000,
        score: 90,
        scoreBreakdown: { proximity: 30, skillMatch: 30, rating: 20, warrantyClaimRate: 10 },
        orderLockKey: `dispatch:order:lock:${offerOrderId}`,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(techAssignedProfileId).toBeTruthy();

    // 6. Assigned TECHNICIAN, offered TECHNICIAN, matching BRANCH_ADMIN, SUPER_ADMIN can read property;
    // unassigned TECHNICIAN and other BRANCH_ADMIN cannot.
    expect((await apiCall('techAssigned', `/properties/${propertyId}`)).status).toBe(200);
    expect((await apiCall('techOffered', `/properties/${propertyId}`)).status).toBe(200);
    expect((await apiCall('techUnassigned', `/properties/${propertyId}`)).status).toBe(403);

    expect((await apiCall('branchAdminA', `/properties/${propertyId}`)).status).toBe(200);
    expect((await apiCall('branchAdminB', `/properties/${propertyId}`)).status).toBe(403);
    expect((await apiCall('superAdmin', `/properties/${propertyId}`)).status).toBe(200);

    // 7. Order projections include propertySummary for allowed roles & ZERO property leakage for SELLER
    const techOrder = await apiCall('techAssigned', `/orders/${orderId}`);
    expect(techOrder.status).toBe(200);
    expect(techOrder.payload?.['propertySummary']).toMatchObject({ id: propertyId, mediaCount: 2 });

    const branchOrder = await apiCall('branchAdminA', `/orders/${orderId}`);
    expect(branchOrder.status).toBe(200);
    expect(branchOrder.payload?.['propertySummary']).toMatchObject({ id: propertyId, mediaCount: 2 });

    expect((await apiCall('techUnassigned', `/orders/${orderId}`)).status).toBe(404);
    expect((await apiCall('branchAdminB', `/orders/${orderId}`)).status).toBe(404);

    const sellerOrder = await apiCall('seller', `/orders/${orderId}`);
    expect(sellerOrder.status).toBe(200);
    expect(sellerOrder.payload).not.toHaveProperty('propertyId');
    expect(sellerOrder.payload).not.toHaveProperty('propertySummary');

    const sellerOrdersList = await apiCall('seller', '/orders');
    expect(sellerOrdersList.status).toBe(200);
    const serializedSeller = JSON.stringify(sellerOrdersList.payload);
    expect(serializedSeller).not.toContain(propertyId);
    expect(serializedSeller).not.toContain('propertySummary');

    // 8. Customer A updates and soft-archives property without breaking historical order reference
    const patched = await apiCall('customerA', `/properties/${propertyId}`, 'PATCH', {
      title: 'واحد وکیل‌آباد (ویرایش)',
      notes: 'سقف کاذب دارد',
    });
    expect(patched.status).toBe(200);
    expect(patched.payload?.['title']).toBe('واحد وکیل‌آباد (ویرایش)');

    const archived = await apiCall('customerA', `/properties/${propertyId}`, 'DELETE');
    expect(archived.status).toBe(200);
    expect(archived.payload).toEqual({ id: propertyId, isArchived: true });
    expect((await apiCall('customerA', '/properties')).payload).toEqual([]);

    // Historical order keeps propertySummary for assigned technician & branch admin
    const techOrderAfterArchive = await apiCall('techAssigned', `/orders/${orderId}`);
    expect(techOrderAfterArchive.status).toBe(200);
    expect(techOrderAfterArchive.payload?.['propertySummary']).toMatchObject({ id: propertyId });
    expect(branchAId).toBeTruthy();
  });
});
