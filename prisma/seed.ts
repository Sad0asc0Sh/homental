/**
 * Homental — Initial Seed (pilot: Mashhad)
 * ============================================================================
 * Seeds:
 *   1. Branch admin → City (Mashhad) → Central branch (partner showroom, 10% commission)
 *   2. Technicians (linked to the central branch) + demo customer (+ wallet)
 *   3. Platform configs (bundle discount, surge, urgency, escrow split, dispatch)
 *   4. Service definitions: full `uiSchema` + `pricingSchema` JSON (all copy in fa)
 *   5. Advisory rules: 7 cross-service JSON-Logic gap detectors
 *
 * Execution order matters: the branch admin, City and Branch are created FIRST,
 * then `cityId` / `branchId` are passed into the technician & customer seeders
 * (a fresh database has no City rows — technicians must not be orphaned).
 *
 * JSON-Logic dialect
 * ------------------
 * The pricing & advisory JSON-Logic evaluator MUST support (register) the
 * operators `ceil` and `max` (built into json-logic-js; register equivalents
 * when using another engine). `max` is also used to clamp remote quantities:
 * `{ max: [0, { '-': [{ var: 'remoteCount' }, 1] }] }` — remoteCount is
 * UI-clamped at 0, so without the clamp the formula would produce −1 and
 * SUBTRACT money from the quote.
 *
 * UI Schema grammar (homental/ui-schema/v1):
 *   steps[].fields[] — type: STEPPER | CHIPS | SWITCH
 *     • STEPPER: min/max/step/default/unitFa
 *     • CHIPS:   select SINGLE|MULTI + options[{ value, labelFa, hintFa }]
 *     • SWITCH:  boolean default
 *     • optional `locationTypes[]` filters the field to certain location types
 *     • `pricingVar` binds the answer to a pricing_schema variable
 *   goalCards — qualitative multi-select cards (advisory facts + messaging)
 *
 * Pricing Schema grammar (homental/pricing-schema/v1):
 *   hardware.lineItems[] — qty (JSON-Logic) × unitPrice | unitPriceByOption |
 *                          unitPriceLogic (JSON-Logic -> number)
 *   labor — base + perUnit[{ qty(JSON-Logic), included, perUnitAmount }] +
 *           complexity[{ when(JSON-Logic), multiplier }]   (multipliers are
 *           part of base labor; surge/urgency are applied by the engine on
 *           labor+dispatch ONLY — never on hardware)
 *   dispatch.base — flat dispatch fee
 *   range — estimatedMin/estimatedMax variance band around the base
 *
 * Advisory facts document (what `condition` JSON-Logic is evaluated against):
 *   {
 *     locationType: LocationType,
 *     building:     { unitsCount, floorsCount, hasGuard?, ... },
 *     services: {
 *       CCTV:             { active, cameraCount, nightPlate, colorNight, audioRecord, ... },
 *       ALARM:            { active, doorSensorCount, petImmune, ... },
 *       ELECTRIC_SHUTTER: { active, upsBackup, bladeType, ... },
 *       PARKING_JACK:     { active, jackType, usagePerDay, electricLock, ... }
 *     }
 *   }
 *   (`active` = customer has saved a configuration for that service)
 */

import type {
  LocationType} from '@prisma/client';
import {
  PrismaClient,
  UserRole,
  ServiceKey,
  SecurityPillar,
  WalletOwnerType,
  WalletTransactionType,
  WalletTransactionStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

// Fixed identifier for the single PLATFORM wallet (fees & warranty reserve).
const PLATFORM_WALLET_OWNER_ID = '00000000-0000-0000-0000-000000000001';

// Demo top-up — idempotent: created once, balance increments only on first run.
const DEMO_TOPUP_IDEMPOTENCY_KEY = 'seed-customer-topup-001';
const DEMO_TOPUP_AMOUNT_TOMAN = 50_000_000n;

// ============================================================================
// 1) CITY & BRANCH (seeded FIRST — everything else references them)
// ============================================================================

const mashhad = {
  slug: 'mashhad',
  nameFa: 'مشهد',
  nameEn: 'Mashhad',
  centerLat: 36.2972,
  centerLng: 59.6067,
};

// Partner branch with a physical showroom → reduced commission (10% instead of
// the 15% default in PlatformConfig['escrow.split']); warranty reserve stays
// at the default (null => fallback).
const centralBranch = {
  code: 'MSHD-C1',
  nameFa: 'شعبه مرکزی مشهد',
  addressFa: 'بلوار وکیل‌آباد، نبش وکیل‌آباد ۲۵، ساختمان هومنتال',
  phone: '+989120000002',
  lat: 36.3105,
  lng: 59.5663,
  hasPhysicalShowroom: true,
  commissionRateOverride: 0.1,
  warrantyReserveOverride: null as number | null,
};

// ============================================================================
// 2) SERVICE DEFINITIONS — UI SCHEMAS (all customer copy in Persian)
// ============================================================================

const cctvUiSchema = {
  $schema: 'homental/ui-schema/v1',
  titleFa: 'دوربین مداربسته',
  subtitleFa: 'دیده‌بانی ۲۴ ساعته با امکان مشاهده زنده از موبایل',
  iconKey: 'cctv',
  steps: [
    {
      id: 'coverage',
      titleFa: 'پوشش دوربین‌ها',
      descriptionFa: 'تقریبی بگو چند نقطه می‌خواهی زیر نظر باشد.',
      fields: [
        {
          id: 'cameraCount',
          type: 'STEPPER',
          labelFa: 'تعداد دوربین',
          unitFa: 'دوربین',
          min: 1,
          max: 32,
          step: 1,
          default: 4,
          pricingVar: 'cameraCount',
        },
        {
          id: 'nightPlate',
          type: 'SWITCH',
          labelFa: 'خواندن پلاک خودرو در شب',
          descriptionFa: 'دوربین مخصوص دهانه برای ثبت واضح پلاک در نور کم',
          locationTypes: ['PARKING', 'WAREHOUSE'],
          default: false,
          pricingVar: 'nightPlate',
        },
      ],
    },
    {
      id: 'equipment',
      titleFa: 'کیفیت و ضبط',
      fields: [
        {
          id: 'cameraQuality',
          type: 'CHIPS',
          select: 'SINGLE',
          labelFa: 'کیفیت دوربین‌ها',
          default: 'STANDARD_4MP',
          pricingVar: 'cameraQuality',
          options: [
            { value: 'ECONOMY_2MP', labelFa: '۲ مگاپیکسل', hintFa: 'اقتصادی، برای فضای کوچک' },
            { value: 'STANDARD_4MP', labelFa: '۴ مگاپیکسل', hintFa: 'پیشنهاد ما؛ تعادل قیمت و کیفیت' },
            { value: 'PRO_AI_5MP', labelFa: '۵ مگاپیکسل هوشمند', hintFa: 'تشخیص انسان و خودرو؛ هشدارهای نادرست کمتر' },
          ],
        },
        {
          id: 'storageDays',
          type: 'STEPPER',
          labelFa: 'مدت نگهداری تصاویر',
          unitFa: 'روز',
          min: 3,
          max: 60,
          step: 1,
          default: 15,
          pricingVar: 'storageDays',
        },
        {
          id: 'colorNight',
          type: 'SWITCH',
          labelFa: 'دید در شب رنگی',
          descriptionFa: 'ثبت تصویر رنگی در نور کم به‌جای سیاه‌وسفید؛ شناسایی رنگ خودرو و لباس',
          default: false,
          pricingVar: 'colorNight',
        },
        {
          id: 'audioRecord',
          type: 'SWITCH',
          labelFa: 'ضبط صدا',
          descriptionFa: 'ثبت صدای محیط کنار تصویر هر دوربین',
          default: false,
          pricingVar: 'audioRecord',
        },
        {
          id: 'remoteView',
          type: 'SWITCH',
          labelFa: 'مشاهده زنده و هشدار در موبایل',
          default: true,
          pricingVar: 'remoteView',
        },
      ],
    },
  ],
  goalCards: {
    titleFa: 'هدفت از دوربین مداربسته چیست؟',
    multiSelect: true,
    cards: [
      {
        id: 'TRAVEL_PEACE',
        titleFa: 'آرامش در سفر',
        descriptionFa: 'دید زنده و هشدار حرکت هنگام غیبت',
        iconKey: 'travel',
      },
      {
        id: 'SHOP_WATCH',
        titleFa: 'مراقبت از مغازه',
        descriptionFa: 'پوشش ورودی و صندوق فروش با هشدار فوری',
        iconKey: 'shop',
        locationTypes: ['SHOP'],
      },
      {
        id: 'DETERRENCE',
        titleFa: 'بازدارندگی',
        descriptionFa: 'نصب مشخص دوربین‌ها برای دیده‌شدن و پیشگیری',
        iconKey: 'shield',
      },
      {
        id: 'NIGHT_PLATE_GOAL',
        titleFa: 'ثبت پلاک شبانه',
        descriptionFa: 'برای پارکینگ و بارانداز',
        iconKey: 'plate',
        locationTypes: ['PARKING', 'WAREHOUSE'],
      },
    ],
  },
};

const alarmUiSchema = {
  $schema: 'homental/ui-schema/v1',
  titleFa: 'دزدگیر اماکن',
  subtitleFa: 'هشدار فوری سرقت با تماس، پیامک و آژیر بازدارنده',
  iconKey: 'alarm',
  steps: [
    {
      id: 'sensors',
      titleFa: 'ورودی‌های حساس',
      descriptionFa: 'هر درب و پنجره در دسترس، یک نقطه ورود محسوب می‌شود.',
      fields: [
        {
          id: 'doorSensorCount',
          type: 'STEPPER',
          labelFa: 'سنسور درب',
          unitFa: 'عدد',
          min: 1,
          max: 12,
          step: 1,
          default: 2,
          pricingVar: 'doorSensorCount',
        },
        {
          id: 'windowSensorCount',
          type: 'STEPPER',
          labelFa: 'سنسور پنجره',
          unitFa: 'عدد',
          min: 0,
          max: 16,
          step: 1,
          default: 2,
          pricingVar: 'windowSensorCount',
        },
        {
          id: 'motionSensorCount',
          type: 'STEPPER',
          labelFa: 'سنسور تشخیص حرکت',
          unitFa: 'عدد',
          min: 0,
          max: 8,
          step: 1,
          default: 1,
          pricingVar: 'motionSensorCount',
        },
        {
          id: 'petImmune',
          type: 'SWITCH',
          labelFa: 'ضدحساسیت به حیوان خانگی',
          descriptionFa: 'سنسور حرکتی هوشمند که با تکان خوردن گربه یا سگ کوچک هشدار نمی‌دهد',
          default: false,
          pricingVar: 'petImmune',
        },
      ],
    },
    {
      id: 'features',
      titleFa: 'نوع هشدار',
      fields: [
        {
          id: 'sirenType',
          type: 'CHIPS',
          select: 'SINGLE',
          labelFa: 'آژیر',
          default: 'INDOOR_OUTDOOR',
          pricingVar: 'sirenType',
          options: [
            { value: 'INDOOR', labelFa: 'داخلی', hintFa: 'صدا فقط داخل فضا پخش می‌شود' },
            { value: 'INDOOR_OUTDOOR', labelFa: 'داخلی + بیرونی', hintFa: 'پیشنهاد ما؛ بازدارندگی خیلی بیشتر' },
          ],
        },
        {
          id: 'gsmModule',
          type: 'SWITCH',
          labelFa: 'اطلاع‌رسان GSM',
          descriptionFa: 'تماس و پیامک خودکار به شماره‌های تعریف‌شده هنگام هشدار',
          default: true,
          pricingVar: 'gsmModule',
        },
        {
          id: 'panicButton',
          type: 'SWITCH',
          labelFa: 'دکمه پنیک',
          descriptionFa: 'هشدار فوری با یک لمس، مناسب مغازه',
          locationTypes: ['SHOP'],
          default: false,
          pricingVar: 'panicButton',
        },
      ],
    },
  ],
  goalCards: {
    titleFa: 'هدفت از دزدگیر چیست؟',
    multiSelect: true,
    cards: [
      {
        id: 'INSTANT_ALERT',
        titleFa: 'اطلاع فوری سرقت',
        descriptionFa: 'تماس و پیامک به من و خانواده در همان لحظه',
        iconKey: 'bell',
      },
      {
        id: 'DETERRENT_SIREN',
        titleFa: 'بازدارندگی با آژیر',
        descriptionFa: 'فرار سارق با شنیدن آژیر بیرونی',
        iconKey: 'siren',
      },
      {
        id: 'TRAVEL_SAFE',
        titleFa: 'خیال راحت در سفر',
        descriptionFa: 'پایش ورودی‌ها هنگام غیبت طولانی',
        iconKey: 'travel',
      },
    ],
  },
};

const parkingJackUiSchema = {
  $schema: 'homental/ui-schema/v1',
  titleFa: 'جک پارکینگی',
  subtitleFa: 'مانع فیزیکی مطمئن جلوی خودرو، حتی در نبود نگهبان',
  iconKey: 'parking-jack',
  steps: [
    {
      id: 'specs',
      titleFa: 'مشخصات دهانه',
      descriptionFa: 'ابعاد دهانه را دقیق بده تا موتور و سازه درست انتخاب شود.',
      fields: [
        {
          id: 'jackType',
          type: 'CHIPS',
          select: 'SINGLE',
          labelFa: 'نوع جک',
          default: 'SINGLE_ARM',
          pricingVar: 'jackType',
          options: [
            { value: 'SINGLE_ARM', labelFa: 'تک‌بازو', hintFa: 'مناسب سواری و تردد کم' },
            { value: 'DOUBLE_ARM', labelFa: 'دوبازو', hintFa: 'سنگین‌تر و مناسب تردد بالا و خودروهای بزرگ' },
            { value: 'HYDRAULIC', labelFa: 'هیدرولیک پرتردد', hintFa: 'موتور قوی برای دهانه پهن و تردد سنگین؛ انتخاب ساختمان‌های بزرگ' },
          ],
        },
        {
          id: 'openingWidthCm',
          type: 'STEPPER',
          labelFa: 'عرض دهانه پارکینگ',
          unitFa: 'سانتی‌متر',
          min: 250,
          max: 600,
          step: 10,
          default: 400,
          pricingVar: 'openingWidthCm',
        },
        {
          id: 'usagePerDay',
          type: 'STEPPER',
          labelFa: 'رفت‌وآمد روزانه',
          unitFa: 'بار',
          min: 1,
          max: 100,
          step: 1,
          default: 10,
          pricingVar: 'usagePerDay',
        },
      ],
    },
    {
      id: 'features',
      titleFa: 'امکانات',
      fields: [
        {
          id: 'remoteCount',
          type: 'STEPPER',
          labelFa: 'ریموت کنترل',
          unitFa: 'عدد',
          min: 1,
          max: 6,
          step: 1,
          default: 2,
          pricingVar: 'remoteCount',
        },
        {
          id: 'electricLock',
          type: 'SWITCH',
          labelFa: 'قفل برقی ضددیلم',
          descriptionFa: 'قفل مکانیکی برقی که باز کردن جک با دیل و هره را تقریباً غیرممکن می‌کند',
          default: false,
          pricingVar: 'electricLock',
        },
        {
          id: 'batteryBackup',
          type: 'SWITCH',
          labelFa: 'باتری پشتیبان',
          descriptionFa: 'کارکرد خودکار در قطع برق',
          default: true,
          pricingVar: 'batteryBackup',
        },
        {
          id: 'safetyEdge',
          type: 'SWITCH',
          labelFa: 'سنسور ایمنی',
          descriptionFa: 'توقف خودکار هنگام برخورد با مانع',
          default: false,
          pricingVar: 'safetyEdge',
        },
      ],
    },
  ],
  goalCards: {
    titleFa: 'هدفت از جک پارکینگی چیست؟',
    multiSelect: true,
    cards: [
      {
        id: 'ANTI_THEFT',
        titleFa: 'جلوگیری از سرقت خودرو',
        descriptionFa: 'سد فیزیکی قوی حتی وقتی خانه خالی است',
        iconKey: 'car',
      },
      {
        id: 'ACCESS_CONTROL',
        titleFa: 'کنترل تردد',
        descriptionFa: 'مدیریت رفت‌وآمد ساکنین یا کارمندان',
        iconKey: 'users',
        locationTypes: ['APARTMENT', 'WAREHOUSE'],
      },
      {
        id: 'DEPOT_SECURITY',
        titleFa: 'امنیت انبار و بارانداز',
        descriptionFa: 'خواب پارک خودرو و کالا در ساعات غیرکاری',
        iconKey: 'warehouse',
        locationTypes: ['WAREHOUSE', 'PARKING'],
      },
    ],
  },
};

const electricShutterUiSchema = {
  $schema: 'homental/ui-schema/v1',
  titleFa: 'کرکره برقی',
  subtitleFa: 'سد امنیتی و مرتب برای ویترین و درب مغازه',
  iconKey: 'electric-shutter',
  steps: [
    {
      id: 'specs',
      titleFa: 'ابعاد و پره',
      descriptionFa: 'ابعاد دهانه را دقیق بده تا متراژ پره و موتور درست محاسبه شود.',
      fields: [
        {
          id: 'widthCm',
          type: 'STEPPER',
          labelFa: 'عرض دهانه',
          unitFa: 'سانتی‌متر',
          min: 100,
          max: 800,
          step: 5,
          default: 300,
          pricingVar: 'widthCm',
        },
        {
          id: 'heightCm',
          type: 'STEPPER',
          labelFa: 'ارتفاع دهانه',
          unitFa: 'سانتی‌متر',
          min: 100,
          max: 500,
          step: 5,
          default: 280,
          pricingVar: 'heightCm',
        },
        {
          id: 'bladeType',
          type: 'CHIPS',
          select: 'SINGLE',
          labelFa: 'نوع پره',
          default: 'ALU_STANDARD',
          pricingVar: 'bladeType',
          options: [
            { value: 'ALU_STANDARD', labelFa: 'آلومینیوم استاندارد', hintFa: 'اقتصادی، برای مغازه معمولی' },
            { value: 'ALU_INSULATED', labelFa: 'فوم‌دار عایق', hintFa: 'عایق حرارت و صدای خیابان' },
            { value: 'POLYCARBONATE', labelFa: 'پلی‌کربنات شفاف ویترینی', hintFa: 'نمایش کامل ویترین با مقاومت بالا' },
            { value: 'STEEL_HEAVY', labelFa: 'فولادی ضدسرقت', hintFa: 'پیشنهاد ما برای مغازه‌های حساس مثل طلا و موبایل' },
          ],
        },
      ],
    },
    {
      id: 'features',
      titleFa: 'امکانات',
      fields: [
        {
          id: 'upsBackup',
          type: 'SWITCH',
          labelFa: 'UPS پشتیبان برق',
          descriptionFa: 'باز و بسته کردن کرکره در قطع برق',
          default: false,
          pricingVar: 'upsBackup',
        },
        {
          id: 'smartControl',
          type: 'SWITCH',
          labelFa: 'کنترل هوشمند موبایل',
          descriptionFa: 'باز و بسته کردن و گزارش وضعیت از راه دور',
          default: false,
          pricingVar: 'smartControl',
        },
        {
          id: 'remoteCount',
          type: 'STEPPER',
          labelFa: 'ریموت کنترل',
          unitFa: 'عدد',
          min: 0,
          max: 6,
          step: 1,
          default: 2,
          pricingVar: 'remoteCount',
        },
      ],
    },
  ],
  goalCards: {
    titleFa: 'هدفت از کرکره برقی چیست؟',
    multiSelect: true,
    cards: [
      {
        id: 'SENSITIVE_SHOP',
        titleFa: 'امنیت مغازه حساس',
        descriptionFa: 'طلا، موبایل، صرافی و مغازه‌های مشابه',
        iconKey: 'shop',
        locationTypes: ['SHOP'],
      },
      {
        id: 'INSULATION',
        titleFa: 'عایق حرارتی و صوتی',
        descriptionFa: 'کاهش هدررفت انرژی و صدای خیابان',
        iconKey: 'insulation',
      },
      {
        id: 'DAILY_COMFORT',
        titleFa: 'راحتی روزانه',
        descriptionFa: 'باز و بسته کردن آسان بدون زحمت دستی',
        iconKey: 'hand',
      },
    ],
  },
};

// ============================================================================
// 3) SERVICE DEFINITIONS — PRICING SCHEMAS (Toman; JSON-Logic quantities)
//    NOTE: evaluator must register `ceil` and `max` JSON-Logic operators.
// ============================================================================

const cctvPricingSchema = {
  $schema: 'homental/pricing-schema/v1',
  currency: 'TOMAN',
  variables: {
    cameraCount: 4,
    nightPlate: false,
    colorNight: false,
    audioRecord: false,
    cameraQuality: 'STANDARD_4MP',
    storageDays: 15,
    remoteView: true,
  },
  hardware: {
    lineItems: [
      {
        ref: 'CAM',
        labelFa: 'دوربین مداربسته',
        qty: { var: 'cameraCount' },
        unitPriceByOption: {
          variable: 'cameraQuality',
          options: { ECONOMY_2MP: 2800000, STANDARD_4MP: 4100000, PRO_AI_5MP: 7200000 },
        },
      },
      {
        ref: 'DVR',
        labelFa: 'دستگاه ضبط (هر ۴ کانال)',
        qty: { ceil: { '/': [{ var: 'cameraCount' }, 4] } },
        unitPrice: 7500000,
      },
      {
        ref: 'HDD',
        labelFa: 'هارد نگهداری تصاویر',
        qty: { if: [{ '>=': [{ var: 'storageDays' }, 30] }, 2, 1] },
        unitPrice: 4800000,
      },
      {
        ref: 'PLATE_CAM',
        labelFa: 'دوربین پلاک‌خوان شبانه',
        qty: { if: [{ var: 'nightPlate' }, 1, 0] },
        unitPrice: 9800000,
      },
      {
        ref: 'COLOR_NIGHT',
        labelFa: 'ماژول دید در شب رنگی (هر دوربین)',
        qty: { if: [{ var: 'colorNight' }, { var: 'cameraCount' }, 0] },
        unitPrice: 1650000,
      },
      {
        ref: 'AUDIO_MODULE',
        labelFa: 'ماژول ضبط صدا (هر دوربین)',
        qty: { if: [{ var: 'audioRecord' }, { var: 'cameraCount' }, 0] },
        unitPrice: 850000,
      },
      {
        ref: 'CABLE_KIT',
        labelFa: 'کابل، کانکتور و متعلقات نصب',
        qty: 1,
        unitPrice: 1200000,
      },
    ],
  },
  labor: {
    base: { labelFa: 'اجرت نصب و راه‌اندازی پایه', amount: 450000 },
    perUnit: [
      {
        labelFa: 'نصب و کابل‌کشی هر دوربین',
        qty: { var: 'cameraCount' },
        included: 0,
        perUnitAmount: 480000,
      },
      {
        labelFa: 'پیکربندی مشاهده و هشدار در موبایل',
        amount: 350000,
        when: { var: 'remoteView' },
      },
    ],
    complexity: [
      {
        labelFa: 'پیکربندی هوش مصنوعی و تنظیم مناطق هشدار',
        multiplier: 1.15,
        when: { '==': [{ var: 'cameraQuality' }, 'PRO_AI_5MP'] },
      },
    ],
  },
  dispatch: { base: { labelFa: 'اعزام تکنسین', amount: 180000 } },
  multipliersApplyTo: ['labor', 'dispatch'], // surge & urgency NEVER touch hardware
  range: { minAdjustPct: -10, maxAdjustPct: 12 },
};

const alarmPricingSchema = {
  $schema: 'homental/pricing-schema/v1',
  currency: 'TOMAN',
  variables: {
    doorSensorCount: 2,
    windowSensorCount: 2,
    motionSensorCount: 1,
    petImmune: false,
    sirenType: 'INDOOR_OUTDOOR',
    gsmModule: true,
    panicButton: false,
  },
  hardware: {
    lineItems: [
      { ref: 'PANEL_KIT', labelFa: 'پنل مرکزی + منبع تغذیه', qty: 1, unitPrice: 6800000 },
      {
        ref: 'DOOR_SENSOR',
        labelFa: 'سنسور مغناطیسی درب',
        qty: { var: 'doorSensorCount' },
        unitPrice: 850000,
      },
      {
        ref: 'WINDOW_SENSOR',
        labelFa: 'سنسور مغناطیسی پنجره',
        qty: { var: 'windowSensorCount' },
        unitPrice: 780000,
      },
      {
        ref: 'MOTION_SENSOR',
        labelFa: 'سنسور تشخیص حرکت',
        qty: { var: 'motionSensorCount' },
        // Pet-immune sensors cost more than standard PIR sensors
        unitPriceLogic: { if: [{ var: 'petImmune' }, 1850000, 1250000] },
      },
      {
        ref: 'SIREN_OUT',
        labelFa: 'آژیر بیرونی',
        qty: { if: [{ '==': [{ var: 'sirenType' }, 'INDOOR_OUTDOOR'] }, 1, 0] },
        unitPrice: 1450000,
      },
      {
        ref: 'GSM_MODULE',
        labelFa: 'ماژول GSM (سیم‌کارت)',
        qty: { if: [{ var: 'gsmModule' }, 1, 0] },
        unitPrice: 3200000,
      },
      {
        ref: 'PANIC',
        labelFa: 'دکمه پنیک',
        qty: { if: [{ var: 'panicButton' }, 1, 0] },
        unitPrice: 950000,
      },
    ],
  },
  labor: {
    base: { labelFa: 'اجرت نصب، برنامه‌ریزی ساعتی و تست کامل سیستم', amount: 650000 },
    perUnit: [
      {
        labelFa: 'نصب و راه‌اندازی هر سنسور',
        qty: {
          '+': [{ var: 'doorSensorCount' }, { var: 'windowSensorCount' }, { var: 'motionSensorCount' }],
        },
        included: 0,
        perUnitAmount: 180000,
      },
    ],
    complexity: [],
  },
  dispatch: { base: { labelFa: 'اعزام تکنسین', amount: 180000 } },
  multipliersApplyTo: ['labor', 'dispatch'],
  range: { minAdjustPct: -8, maxAdjustPct: 10 },
};

const parkingJackPricingSchema = {
  $schema: 'homental/pricing-schema/v1',
  currency: 'TOMAN',
  variables: {
    jackType: 'SINGLE_ARM',
    openingWidthCm: 400,
    usagePerDay: 10,
    remoteCount: 2,
    electricLock: false,
    batteryBackup: true,
    safetyEdge: false,
  },
  hardware: {
    lineItems: [
      {
        ref: 'JACK_UNIT',
        labelFa: 'جک پارکینگی کامل با پایه',
        qty: 1,
        unitPriceByOption: {
          variable: 'jackType',
          options: { SINGLE_ARM: 46000000, DOUBLE_ARM: 79000000, HYDRAULIC: 118000000 },
        },
      },
      {
        ref: 'INSTALL_FRAME',
        labelFa: 'قاب و سازه نصب (هر متر عرض)',
        qty: { ceil: { '/': [{ var: 'openingWidthCm' }, 100] } },
        unitPrice: 3200000,
      },
      {
        ref: 'ELECTRIC_LOCK',
        labelFa: 'قفل برقی ضددیلم',
        qty: { if: [{ var: 'electricLock' }, 1, 0] },
        unitPrice: 6500000,
      },
      {
        ref: 'BATTERY',
        labelFa: 'باتری پشتیبان',
        qty: { if: [{ var: 'batteryBackup' }, 1, 0] },
        unitPrice: 9500000,
      },
      {
        ref: 'SAFETY_EDGE',
        labelFa: 'سنسور ایمنی برخورد',
        qty: { if: [{ var: 'safetyEdge' }, 1, 0] },
        unitPrice: 4200000,
      },
      {
        ref: 'REMOTE',
        labelFa: 'ریموت اضافه (اولین ریموت همراه جک است)',
        // remoteCount >= 1 for the jack, but clamp at 0 anyway for safety:
        // never let a quantity go negative and SUBTRACT from hardware cost.
        qty: { max: [0, { '-': [{ var: 'remoteCount' }, 1] }] },
        unitPrice: 900000,
      },
    ],
  },
  labor: {
    base: { labelFa: 'اجرت نصب مکانیکی و برق‌کاری', amount: 3500000 },
    perUnit: [],
    complexity: [
      {
        labelFa: 'نصب سنگین نوع دوبازو',
        multiplier: 1.2,
        when: { '==': [{ var: 'jackType' }, 'DOUBLE_ARM'] },
      },
      {
        labelFa: 'نصب جک هیدرولیک پرتردد',
        multiplier: 1.3,
        when: { '==': [{ var: 'jackType' }, 'HYDRAULIC'] },
      },
      {
        labelFa: 'نصب و هم‌زمان‌سازی قفل برقی ضددیلم',
        multiplier: 1.05,
        when: { var: 'electricLock' },
      },
      {
        labelFa: 'تردد بالا (بیش از ۳۰ بار در روز)',
        multiplier: 1.1,
        when: { '>': [{ var: 'usagePerDay' }, 30] },
      },
    ],
  },
  dispatch: { base: { labelFa: 'اعزام تیم نصب', amount: 250000 } },
  multipliersApplyTo: ['labor', 'dispatch'],
  range: { minAdjustPct: -10, maxAdjustPct: 15 },
};

const electricShutterPricingSchema = {
  $schema: 'homental/pricing-schema/v1',
  currency: 'TOMAN',
  variables: {
    widthCm: 300,
    heightCm: 280,
    bladeType: 'ALU_STANDARD',
    upsBackup: false,
    smartControl: false,
    remoteCount: 2,
  },
  hardware: {
    lineItems: [
      {
        ref: 'MOTOR',
        labelFa: 'موتور برقی و درام',
        qty: 1,
        // motor class depends on area: > 8 m² needs heavy-duty motor
        unitPriceLogic: {
          if: [
            {
              '>': [
                { '*': [
                  { ceil: { '/': [{ var: 'widthCm' }, 100] } },
                  { ceil: { '/': [{ var: 'heightCm' }, 100] } },
                ] },
                8,
              ],
            },
            32000000,
            21000000,
          ],
        },
      },
      {
        ref: 'BLADE',
        labelFa: 'پره کرکره (هر متر مربع)',
        qty: {
          '*': [
            { ceil: { '/': [{ var: 'widthCm' }, 100] } },
            { ceil: { '/': [{ var: 'heightCm' }, 100] } },
          ],
        },
        unitPriceByOption: {
          variable: 'bladeType',
          options: {
            ALU_STANDARD: 2600000,
            ALU_INSULATED: 3600000,
            POLYCARBONATE: 4400000,
            STEEL_HEAVY: 5800000,
          },
        },
      },
      {
        ref: 'UPS',
        labelFa: 'UPS پشتیبان برق',
        qty: { if: [{ var: 'upsBackup' }, 1, 0] },
        unitPrice: 12800000,
      },
      {
        ref: 'SMART_MODULE',
        labelFa: 'ماژول کنترل هوشمند',
        qty: { if: [{ var: 'smartControl' }, 1, 0] },
        unitPrice: 4900000,
      },
      {
        ref: 'REMOTE',
        labelFa: 'ریموت اضافه (اولین ریموت همراه موتور است)',
        // remoteCount can be 0 (customer uses smart control only) — clamp at 0
        // so the quote is never REDUCED by a negative quantity.
        qty: { max: [0, { '-': [{ var: 'remoteCount' }, 1] }] },
        unitPrice: 1150000,
      },
    ],
  },
  labor: {
    base: { labelFa: 'اجرت نصب موتور، پره و راه‌اندازی', amount: 2800000 },
    perUnit: [],
    complexity: [
      {
        labelFa: 'نصب پره فولادی سنگین',
        multiplier: 1.25,
        when: { '==': [{ var: 'bladeType' }, 'STEEL_HEAVY'] },
      },
      {
        labelFa: 'دهانه بزرگ (بیش از ۸ متر مربع)',
        multiplier: 1.15,
        when: {
          '>': [
            { '*': [
              { ceil: { '/': [{ var: 'widthCm' }, 100] } },
              { ceil: { '/': [{ var: 'heightCm' }, 100] } },
            ] },
            8,
          ],
        },
      },
    ],
  },
  dispatch: { base: { labelFa: 'اعزام تکنسین', amount: 220000 } },
  multipliersApplyTo: ['labor', 'dispatch'],
  range: { minAdjustPct: -10, maxAdjustPct: 15 },
};

const allLocationTypes: LocationType[] = [
  'APARTMENT',
  'VILLA',
  'SHOP',
  'PARKING',
  'WAREHOUSE',
];

export const serviceDefinitions = [
  {
    key: ServiceKey.CCTV,
    pillar: SecurityPillar.MONITORING,
    titleFa: 'دوربین مداربسته',
    subtitleFa: 'دیده‌بانی ۲۴ ساعته با امکان مشاهده زنده از موبایل',
    descriptionFa:
      'طراحی و نصب سیستم دوربین مداربسته متناسب با متراژ و نقاط حساس فضای شما؛ با ضبط ابری‌پسند، هشدار حرکتی و مشاهده زنده در موبایل.',
    iconKey: 'cctv',
    displayOrder: 1,
    supportedLocationTypes: allLocationTypes,
    baseReadinessScore: 40,
    warrantyMonths: 18,
    typicalDurationMinutes: 240,
    uiSchema: cctvUiSchema,
    pricingSchema: cctvPricingSchema,
  },
  {
    key: ServiceKey.ALARM,
    pillar: SecurityPillar.INTRUSION,
    titleFa: 'دزدگیر اماکن',
    subtitleFa: 'هشدار فوری سرقت با تماس، پیامک و آژیر بازدارنده',
    descriptionFa:
      'سیستم دزدگیر با سنسورهای درب، پنجره و حرکت؛ هنگام نفوذ، آژیر فعال و به‌صورت تماس و پیامک به شما اطلاع داده می‌شود.',
    iconKey: 'alarm',
    displayOrder: 2,
    supportedLocationTypes: allLocationTypes,
    baseReadinessScore: 45,
    warrantyMonths: 12,
    typicalDurationMinutes: 180,
    uiSchema: alarmUiSchema,
    pricingSchema: alarmPricingSchema,
  },
  {
    key: ServiceKey.PARKING_JACK,
    pillar: SecurityPillar.PHYSICAL,
    titleFa: 'جک پارکینگی',
    subtitleFa: 'مانع فیزیکی مطمئن جلوی خودرو، حتی در نبود نگهبان',
    descriptionFa:
      'جک پارکینگی تک‌بازو، دوبازو یا هیدرولیک پرتردد با ریموت، قفل برقی ضددیلم و باتری پشتیبان؛ سد فیزیکی مطمئن برای پارکینگ منزل، ساختمان یا انبار.',
    iconKey: 'parking-jack',
    displayOrder: 3,
    supportedLocationTypes: allLocationTypes,
    baseReadinessScore: 55,
    warrantyMonths: 24,
    typicalDurationMinutes: 300,
    uiSchema: parkingJackUiSchema,
    pricingSchema: parkingJackPricingSchema,
  },
  {
    key: ServiceKey.ELECTRIC_SHUTTER,
    pillar: SecurityPillar.PHYSICAL,
    titleFa: 'کرکره برقی',
    subtitleFa: 'سد امنیتی و مرتب برای ویترین و درب مغازه',
    descriptionFa:
      'کرکره برقی با پره آلومینیوم، فوم‌دار، پلی‌کربنات شفاف ویترینی یا فولادی ضدسرقت؛ با موتور متناسب با متراژ دهانه، UPS پشتیبان و کنترل هوشمند.',
    iconKey: 'electric-shutter',
    displayOrder: 4,
    supportedLocationTypes: allLocationTypes,
    baseReadinessScore: 50,
    warrantyMonths: 24,
    typicalDurationMinutes: 300,
    uiSchema: electricShutterUiSchema,
    pricingSchema: electricShutterPricingSchema,
  },
];

// ============================================================================
// 4) ADVISORY RULES — cross-service gap detection (JSON-Logic)
//    Selected suggestions: sorted by priority ASC, max 2 returned per profile.
// ============================================================================

export const advisoryRules = [
  {
    code: 'SHOP_CCTV_NO_ALARM',
    pillar: SecurityPillar.INTRUSION,
    priority: 10,
    appliesToLocationTypes: ['SHOP'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'locationType' }, 'SHOP'] },
        { '==': [{ var: 'services.CCTV.active' }, true] },
        { '!=': [{ var: 'services.ALARM.active' }, true] },
      ],
    },
    suggestedActionFa:
      'دوربین فقط فیلم ماجرا را نگه می‌دارد؛ دزدگیر جلوی ماجرا را می‌گیرد. برای مغازه شما یک پکیج دزدگیر با سنسور درب مغازه، آژیر بیرونی و دکمه پنیک پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.ALARM,
    suggestedConfig: { doorSensorCount: 1, sirenType: 'INDOOR_OUTDOOR', panicButton: true },
    scoreImpact: { intrusion: 30 },
  },
  {
    code: 'SHOP_SENSITIVE_SHUTTER_NO_UPS_HEAVY',
    pillar: SecurityPillar.PHYSICAL,
    priority: 15,
    appliesToLocationTypes: ['SHOP'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'locationType' }, 'SHOP'] },
        { '==': [{ var: 'services.ELECTRIC_SHUTTER.active' }, true] },
        {
          or: [
            { '==': [{ var: 'services.ELECTRIC_SHUTTER.upsBackup' }, false] },
            { '!=': [{ var: 'services.ELECTRIC_SHUTTER.bladeType' }, 'STEEL_HEAVY'] },
          ],
        },
      ],
    },
    suggestedActionFa:
      'کرکره بدون UPS در قطع برق از کار می‌افتد و پره آلومینیومی معمولی با دیل و هره باز می‌شود. برای مغازه حساس، اضافه کردن UPS و ارتقای پره به فولادی ضدسرقت پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.ELECTRIC_SHUTTER,
    suggestedConfig: { upsBackup: true, bladeType: 'STEEL_HEAVY' },
    scoreImpact: { physical: 15 },
  },
  {
    code: 'WAREHOUSE_ALARM_NO_CCTV',
    pillar: SecurityPillar.MONITORING,
    priority: 15,
    appliesToLocationTypes: ['WAREHOUSE'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'locationType' }, 'WAREHOUSE'] },
        { '==': [{ var: 'services.ALARM.active' }, true] },
        { '!=': [{ var: 'services.CCTV.active' }, true] },
      ],
    },
    suggestedActionFa:
      'دزدگیر بدون دوربین یعنی هشدار بدون سند؛ در انبار باید بتوانی علت هشدار را از راه دور ببینی. پکیج دوربین با ضبط ۳۰ روزه برای ورودی و راهروهای اصلی پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.CCTV,
    suggestedConfig: { cameraCount: 4, storageDays: 30 },
    scoreImpact: { monitoring: 30 },
  },
  {
    code: 'PARKING_CCTV_NO_PLATE_NIGHT',
    pillar: SecurityPillar.MONITORING,
    priority: 20,
    appliesToLocationTypes: ['PARKING'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'locationType' }, 'PARKING'] },
        { '==': [{ var: 'services.CCTV.active' }, true] },
        { '<': [{ var: 'services.CCTV.cameraCount' }, 3] },
        { '==': [{ var: 'services.CCTV.nightPlate' }, false] },
      ],
    },
    suggestedActionFa:
      'دوربین‌های معمولی در نور کم، پلاک خودرو را واضح ثبت نمی‌کنند. برای پارکینگ شما یک دوربین پلاک‌خوان شبانه نصب‌شده روی دهانه پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.CCTV,
    suggestedConfig: { nightPlate: true },
    scoreImpact: { monitoring: 15 },
  },
  {
    code: 'HIGH_TRAFFIC_PARKING_JACK_UPGRADE',
    pillar: SecurityPillar.PHYSICAL,
    priority: 22,
    appliesToLocationTypes: ['APARTMENT', 'PARKING', 'WAREHOUSE'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'services.PARKING_JACK.active' }, true] },
        {
          or: [
            { '>=': [{ var: 'building.unitsCount' }, 15] },
            { '>': [{ var: 'services.PARKING_JACK.usagePerDay' }, 30] },
          ],
        },
        {
          or: [
            { '!=': [{ var: 'services.PARKING_JACK.jackType' }, 'HYDRAULIC'] },
            { '!=': [{ var: 'services.PARKING_JACK.electricLock' }, true] },
          ],
        },
      ],
    },
    suggestedActionFa:
      'با این حجم از تردد، جک معمولی به‌سرعت فرسوده می‌شود و قفل مکانیکی ساده جلوی دیل و هره را نمی‌گیرد. ارتقا به جک هیدرولیک پرتردد به‌همراه قفل برقی ضددیلم پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.PARKING_JACK,
    suggestedConfig: { jackType: 'HYDRAULIC', electricLock: true },
    scoreImpact: { physical: 20 },
  },
  {
    code: 'VILLA_NO_CCTV',
    pillar: SecurityPillar.MONITORING,
    priority: 25,
    appliesToLocationTypes: ['VILLA'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'locationType' }, 'VILLA'] },
        { '!=': [{ var: 'services.CCTV.active' }, true] },
      ],
    },
    suggestedActionFa:
      'ویلا به دلیل ورودی مستقل و دیوار جدا، بیشترین نیاز به دیده‌بانی محیطی را دارد. پکیج ۴ دوربین با دید در شب و هشدار حرکت برای گوشه‌های حیاط پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.CCTV,
    suggestedConfig: { cameraCount: 4, cameraQuality: 'STANDARD_4MP' },
    scoreImpact: { monitoring: 30 },
  },
  {
    code: 'APARTMENT_HIGH_UNITS_NO_PARKING_JACK',
    pillar: SecurityPillar.PHYSICAL,
    priority: 30,
    appliesToLocationTypes: ['APARTMENT'] as LocationType[],
    condition: {
      and: [
        { '==': [{ var: 'locationType' }, 'APARTMENT'] },
        { '>=': [{ var: 'building.unitsCount' }, 8] },
        { '!=': [{ var: 'services.PARKING_JACK.active' }, true] },
      ],
    },
    suggestedActionFa:
      'در ساختمان‌های پرجمعیت، پارکینگ مشترک معمولاً بی‌حفاظ است و تردد غریبه‌ها بالا می‌رود. نصب جک پارکینگی دوبازو روی دهانه مشترک پیشنهاد می‌شود.',
    suggestedServiceKey: ServiceKey.PARKING_JACK,
    suggestedConfig: { jackType: 'DOUBLE_ARM' },
    scoreImpact: { physical: 20 },
  },
];

// ============================================================================
// 5) PLATFORM CONFIGS (bundle discount, surge, urgency, escrow split, dispatch)
// ============================================================================

export const platformConfigs = [
  {
    key: 'pricing.bundleDiscount',
    value: {
      tiers: [
        { minServices: 2, percent: 6 },
        { minServices: 3, percent: 10 },
      ],
    },
  },
  {
    key: 'pricing.urgency',
    value: {
      // applies to labor + dispatch ONLY — never hardware
      multipliers: { SCHEDULED: 1.0, SAME_DAY: 1.12, EMERGENCY: 1.3 },
    },
  },
  {
    key: 'pricing.surge',
    value: {
      // supply/demand ratio = online skilled technicians / pending orders in the Redis GEO zone
      minMultiplier: 1.0,
      maxMultiplier: 1.25, // trust cap — Homental never surges above 25%
      balancedRatio: 1.0, // ratio >= this => no surge
      scarceRatio: 0.4, // ratio <= this => max surge
    },
  },
  {
    key: 'escrow.split',
    value: {
      platformCommissionRate: 0.15, // default; Branch.commissionRateOverride wins when set
      warrantyReserveRate: 0.05, // dedicated ledger, released to technician after warranty ends
    },
  },
  {
    key: 'dispatch.offer',
    value: {
      ttlSeconds: 30,
      initialRadiusMeters: 2000,
      radiusStepMeters: 2000,
      maxRadiusMeters: 20000,
      maxRounds: 5,
      maxParallelOffers: 3,
      weights: {
        proximity: 0.35,
        skillMatch: 0.3,
        rating: 0.2,
        warrantyClaimRate: 0.15,
      },
    },
  },
];

// ============================================================================
// SEED RUNNER
// ============================================================================

interface UpsertUserInput {
  phone: string;
  role: UserRole;
  firstName: string;
  lastName: string;
}

function upsertUser(data: UpsertUserInput) {
  return prisma.user.upsert({
    where: { phone: data.phone },
    update: { role: data.role, firstName: data.firstName, lastName: data.lastName },
    create: { ...data, status: 'ACTIVE' },
  });
}

/** Creates branch admin → City → Branch (partner showroom, 10% commission). */
async function seedCityAndBranch(): Promise<{ cityId: string; branchId: string }> {
  const branchAdmin = await upsertUser({
    phone: '+989120000002',
    role: UserRole.BRANCH_ADMIN,
    firstName: 'حسین',
    lastName: 'رضایی',
  });

  const city = await prisma.city.upsert({
    where: { slug: mashhad.slug },
    update: {
      nameFa: mashhad.nameFa,
      centerLat: mashhad.centerLat,
      centerLng: mashhad.centerLng,
    },
    create: {
      slug: mashhad.slug,
      nameFa: mashhad.nameFa,
      nameEn: mashhad.nameEn,
      centerLat: mashhad.centerLat,
      centerLng: mashhad.centerLng,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { code: centralBranch.code },
    update: {
      adminId: branchAdmin.id,
      nameFa: centralBranch.nameFa,
      hasPhysicalShowroom: centralBranch.hasPhysicalShowroom,
      commissionRateOverride: centralBranch.commissionRateOverride,
      warrantyReserveOverride: centralBranch.warrantyReserveOverride,
    },
    create: {
      code: centralBranch.code,
      cityId: city.id,
      adminId: branchAdmin.id,
      nameFa: centralBranch.nameFa,
      addressFa: centralBranch.addressFa,
      phone: centralBranch.phone,
      lat: centralBranch.lat,
      lng: centralBranch.lng,
      hasPhysicalShowroom: centralBranch.hasPhysicalShowroom,
      commissionRateOverride: centralBranch.commissionRateOverride,
      warrantyReserveOverride: centralBranch.warrantyReserveOverride,
    },
  });

  await prisma.wallet.upsert({
    where: { ownerType_ownerId: { ownerType: WalletOwnerType.BRANCH, ownerId: branch.id } },
    update: {},
    create: {
      ownerType: WalletOwnerType.BRANCH,
      ownerId: branch.id,
      branchId: branch.id,
    },
  });

  return { cityId: city.id, branchId: branch.id };
}

interface TechnicianSeed {
  phone: string;
  firstName: string;
  lastName: string;
  skills: ServiceKey[];
  rating: number;
  ratingCount: number;
  completedJobs: number;
  warrantyClaimRate: number;
  lat: number;
  lng: number;
}

const technicianSeeds: TechnicianSeed[] = [
  {
    phone: '+989120000010',
    firstName: 'امیر',
    lastName: 'کریمی',
    skills: [ServiceKey.CCTV, ServiceKey.ALARM],
    rating: 4.8,
    ratingCount: 126,
    completedJobs: 143,
    warrantyClaimRate: 0.02,
    lat: 36.3121,
    lng: 59.5679,
  },
  {
    phone: '+989120000011',
    firstName: 'رضا',
    lastName: 'احمدی',
    skills: [ServiceKey.ELECTRIC_SHUTTER, ServiceKey.PARKING_JACK],
    rating: 4.6,
    ratingCount: 89,
    completedJobs: 97,
    warrantyClaimRate: 0.03,
    lat: 36.3052,
    lng: 59.5741,
  },
  {
    phone: '+989120000012',
    firstName: 'مهدی',
    lastName: 'نوری',
    skills: [
      ServiceKey.CCTV,
      ServiceKey.ALARM,
      ServiceKey.ELECTRIC_SHUTTER,
      ServiceKey.PARKING_JACK,
    ],
    rating: 4.9,
    ratingCount: 210,
    completedJobs: 233,
    warrantyClaimRate: 0.01,
    lat: 36.3098,
    lng: 59.5612,
  },
];

/** All technicians belong to the Mashhad central branch — never orphaned. */
async function seedTechnicians(branchId: string): Promise<void> {
  const superAdmin = await upsertUser({
    phone: '+989120000001',
    role: UserRole.SUPER_ADMIN,
    firstName: 'مدیر',
    lastName: 'سامانه',
  });
  void superAdmin; // seeded for completeness; no profile needed

  for (const t of technicianSeeds) {
    const user = await upsertUser({
      phone: t.phone,
      role: UserRole.TECHNICIAN,
      firstName: t.firstName,
      lastName: t.lastName,
    });

    await prisma.technicianProfile.upsert({
      where: { userId: user.id },
      update: {
        branchId,
        skills: t.skills,
        rating: t.rating,
        ratingCount: t.ratingCount,
        completedJobs: t.completedJobs,
        warrantyClaimRate: t.warrantyClaimRate,
      },
      create: {
        userId: user.id,
        branchId,
        status: 'APPROVED',
        skills: t.skills,
        rating: t.rating,
        ratingCount: t.ratingCount,
        completedJobs: t.completedJobs,
        warrantyClaimRate: t.warrantyClaimRate,
        isOnline: true,
        isAcceptingOffers: true,
        lastKnownLat: t.lat,
        lastKnownLng: t.lng,
      },
    });

    await prisma.wallet.upsert({
      where: { ownerType_ownerId: { ownerType: WalletOwnerType.TECHNICIAN, ownerId: user.id } },
      update: {},
      create: { ownerType: WalletOwnerType.TECHNICIAN, ownerId: user.id },
    });
  }
}

async function seedCustomerAndAddress(cityId: string): Promise<void> {
  const customer = await upsertUser({
    phone: '+989120000020',
    role: UserRole.CUSTOMER,
    firstName: 'سارا',
    lastName: 'محمدی',
  });

  const profile = await prisma.customerProfile.upsert({
    where: { userId: customer.id },
    update: {},
    create: { userId: customer.id },
  });

  const wallet = await prisma.wallet.upsert({
    where: { ownerType_ownerId: { ownerType: WalletOwnerType.CUSTOMER, ownerId: customer.id } },
    update: {},
    create: { ownerType: WalletOwnerType.CUSTOMER, ownerId: customer.id },
  });

  // Idempotent demo top-up: if the transaction already exists (previous seed
  // run), the customer may have spent part of the balance — NEVER reset it.
  // Increment happens only on the very first run, inside one atomic transaction.
  await prisma.$transaction(async (tx) => {
    const alreadyToppedUp = await tx.walletTransaction.findUnique({
      where: { idempotencyKey: DEMO_TOPUP_IDEMPOTENCY_KEY },
    });
    if (alreadyToppedUp) return;

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.TOPUP,
        status: WalletTransactionStatus.SETTLED,
        amount: DEMO_TOPUP_AMOUNT_TOMAN,
        balanceAfter: DEMO_TOPUP_AMOUNT_TOMAN,
        description: 'شارژ کیف پول اولیه (داده آزمایشی)',
        idempotencyKey: DEMO_TOPUP_IDEMPOTENCY_KEY,
      },
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: DEMO_TOPUP_AMOUNT_TOMAN } },
    });
  });

  await prisma.address.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: { cityId },
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      customerId: profile.id,
      cityId,
      titleFa: 'خانه',
      locationType: 'APARTMENT',
      fullAddressFa: 'مشهد، بلوار وکیل‌آباد، خیابان مهدی، پلاک ۱۲، واحد ۳',
      lat: 36.288,
      lng: 59.615,
      isDefault: true,
    },
  });
}

async function seedPlatformConfigs(): Promise<void> {
  for (const cfg of platformConfigs) {
    await prisma.platformConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value },
      create: cfg,
    });
  }

  // PLATFORM wallet (fees + warranty reserve ledger) — fixed owner id
  await prisma.wallet.upsert({
    where: {
      ownerType_ownerId: { ownerType: WalletOwnerType.PLATFORM, ownerId: PLATFORM_WALLET_OWNER_ID },
    },
    update: {},
    create: { ownerType: WalletOwnerType.PLATFORM, ownerId: PLATFORM_WALLET_OWNER_ID },
  });
}

async function seedServiceDefinitions(): Promise<void> {
  for (const def of serviceDefinitions) {
    await prisma.serviceDefinition.upsert({
      where: { key: def.key },
      update: {
        titleFa: def.titleFa,
        subtitleFa: def.subtitleFa,
        descriptionFa: def.descriptionFa,
        uiSchema: def.uiSchema,
        pricingSchema: def.pricingSchema,
        supportedLocationTypes: def.supportedLocationTypes,
      },
      create: {
        key: def.key,
        pillar: def.pillar,
        titleFa: def.titleFa,
        subtitleFa: def.subtitleFa,
        descriptionFa: def.descriptionFa,
        iconKey: def.iconKey,
        displayOrder: def.displayOrder,
        supportedLocationTypes: def.supportedLocationTypes,
        baseReadinessScore: def.baseReadinessScore,
        warrantyMonths: def.warrantyMonths,
        typicalDurationMinutes: def.typicalDurationMinutes,
        uiSchema: def.uiSchema,
        pricingSchema: def.pricingSchema,
      },
    });
  }
}

async function seedAdvisoryRules(): Promise<void> {
  for (const rule of advisoryRules) {
    await prisma.advisoryRule.upsert({
      where: { code: rule.code },
      update: {
        priority: rule.priority,
        condition: rule.condition,
        suggestedActionFa: rule.suggestedActionFa,
        suggestedConfig: rule.suggestedConfig,
        scoreImpact: rule.scoreImpact,
        appliesToLocationTypes: rule.appliesToLocationTypes,
      },
      create: {
        code: rule.code,
        pillar: rule.pillar,
        priority: rule.priority,
        appliesToLocationTypes: rule.appliesToLocationTypes,
        condition: rule.condition,
        suggestedActionFa: rule.suggestedActionFa,
        suggestedServiceKey: rule.suggestedServiceKey,
        suggestedConfig: rule.suggestedConfig,
        scoreImpact: rule.scoreImpact,
      },
    });
  }
}

async function main() {
  console.log('🌱 Seeding Homental (pilot: Mashhad)...');

  // 1) Branch admin → City → Branch (MUST run first on a fresh database)
  const { cityId, branchId } = await seedCityAndBranch();

  // 2) Users (technicians receive branchId — no orphans)
  await seedTechnicians(branchId);
  await seedCustomerAndAddress(cityId);

  // 3) Configs, catalog and rules
  await seedPlatformConfigs();
  await seedServiceDefinitions();
  await seedAdvisoryRules();

  console.log('✅ Seed complete:');
  console.log('   • 1 city (Mashhad) + 1 central branch (showroom, 10% commission) + wallets');
  console.log('   • 6 users (super admin, branch admin, 3 technicians with branch, 1 customer)');
  console.log('   • 4 service definitions with full fa uiSchema + pricingSchema');
  console.log('   • 7 advisory rules (JSON-Logic)');
  console.log('   • 5 platform configs (pricing, escrow, dispatch)');
}

// Only execute when run directly (`prisma db seed` / ts-node) — importing the
// exported seed constants (rules, service definitions) from tests must NOT
// trigger a seed run against the database.
if (require.main === module) {
  main()
    .catch((e) => {
      console.error('❌ Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
