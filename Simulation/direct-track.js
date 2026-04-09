

import { faker } from '@faker-js/faker';
import crypto from 'node:crypto';

// ── Config ────────────────────────────────────────────────────────────────
const WRITE_KEY = '3BtgnG9O19EIKEJptG1h4k9Nps6';
const DATAPLANE = 'https://insatrefkarbfv.dataplane.rudderstack.com';
const AUTH = 'Basic ' + Buffer.from(WRITE_KEY + ':').toString('base64');
const TOTAL = 300;

const SITES = [
  'https://www.mytek.tn',
  'https://www.jumia.com.tn',
  'https://www.amazon.fr',
  'https://www.zalando.fr',
  'https://www.aliexpress.com',
];

const ALL_CATEGORIES = [
  'Electronics', 'Fashion', 'Beauty', 'Home', 'Sports',
  'Books', 'Toys', 'Food', 'Tools', 'Gaming',
];

const PAYMENT_METHODS = [
  'card_visa',
  'card_mastercard',
  'paypal',
  'cash_on_delivery',
  'bank_transfer',
  'apple_pay',
  'google_pay',
];

const PAYMENT_FAILURE_CODES = [
  'insufficient_funds',
  'card_declined',
  '3ds_fail',
  'timeout',
  'invalid_cvv',
  'address_mismatch',
  'provider_unavailable',
];

const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'linkedin.com',
  'twitter.com',
  'pinterest.com',
];

const COLORS = ['black', 'white', 'red', 'blue', 'green', 'grey', 'navy', 'beige', 'pink', 'yellow', 'brown', 'purple'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'one-size'];
const CARRIERS = ['DHL', 'FedEx', 'UPS', 'La Poste', 'Aramex', 'TNT', 'Chronopost'];
const MATERIALS = ['cotton', 'polyester', 'leather', 'plastic', 'metal', 'wood', 'glass', 'aluminum'];

const SOURCE_WEIGHTS = {
  direct: 0.22,
  organic: 0.28,
  social: 0.20,
  paid: 0.15,
  email: 0.08,
  referral: 0.07,
};

const DEVICE_PROFILES = {
  mobile: { screens: ['375x667', '390x844', '412x915', '360x800', '393x852'], os: ['Android', 'iOS'] },
  desktop: { screens: ['1920x1080', '1440x900', '1280x800', '2560x1440'], os: ['Windows', 'macOS', 'Linux'] },
  tablet: { screens: ['768x1024', '820x1180', '1024x768', '800x1280'], os: ['Android', 'iPadOS'] },
};

const BROWSERS_BY_OS = {
  Android: ['Chrome', 'Samsung Internet', 'Firefox'],
  iOS: ['Safari', 'Chrome'],
  iPadOS: ['Safari', 'Chrome'],
  Windows: ['Chrome', 'Edge', 'Firefox'],
  macOS: ['Safari', 'Chrome', 'Firefox'],
  Linux: ['Chrome', 'Firefox'],
};

const PRODUCT_TAGS = {
  Electronics: ['wireless', 'smart', '4K', 'portable', 'rechargeable', 'bluetooth', 'HDR', 'fast-charge'],
  Fashion: ['casual', 'slim-fit', 'organic-cotton', 'waterproof', 'vintage', 'sustainable', 'streetwear'],
  Beauty: ['vegan', 'cruelty-free', 'SPF50', 'anti-aging', 'hydrating', 'natural', 'dermatologist-tested'],
  Home: ['eco-friendly', 'minimalist', 'handmade', 'BPA-free', 'foldable', 'smart', 'bamboo'],
  Sports: ['lightweight', 'breathable', 'anti-slip', 'UV-protection', 'ergonomic', 'wicking', 'trail'],
  Books: ['bestseller', 'signed', 'illustrated', 'hardcover', 'educational', 'award-winning', 'translated'],
  Toys: ['educational', 'age-3+', 'BPA-free', 'STEM', 'washable', 'interactive', 'montessori'],
  Food: ['organic', 'gluten-free', 'vegan', 'local', 'sugar-free', 'non-GMO', 'fair-trade'],
  Tools: ['professional', 'cordless', 'ergonomic', 'heavy-duty', 'rust-proof', 'precision', 'german-made'],
  Gaming: ['4K-ready', 'HDR', 'low-latency', 'RGB', 'tournament-grade', 'VR-compatible', 'cross-platform'],
};

// ── Helpers ───────────────────────────────────────────────────────────────
function safeInt(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo === hi ? lo : faker.number.int({ min: lo, max: hi });
}

function safeFloat(a, b, fd = 2) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo === hi ? lo : +faker.number.float({ min: lo, max: hi, fractionDigits: fd });
}

function rand(min, max) { return min + Math.random() * (max - min); }
function roll(p) { return Math.random() < Math.min(1, Math.max(0, p)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function advance(cursor, ms) {
  cursor.ms += Math.max(0, ms);
  return new Date(new Date(cursor.base).getTime() + cursor.ms).toISOString();
}

function siteCurrency(site) {
  if (site.includes('.tn')) return 'TND';
  if (site.includes('.fr')) return 'EUR';
  return 'USD';
}

function ensureUserDemographics(user) {
  if (user.age == null) user.age = safeInt(18, 70);
  if (!user.gender) user.gender = pick(['male', 'female', 'non_binary', 'prefer_not_to_say']);
  if (!user.dob) {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - user.age, safeInt(0, 11), safeInt(1, 28));
    user.dob = dob.toISOString().split('T')[0];
  }
}

// ── Time distribution ─────────────────────────────────────────────────────
const HOUR_WEIGHTS = [
  0.007, 0.004, 0.003, 0.003, 0.003, 0.007,
  0.017, 0.028, 0.038, 0.044, 0.050, 0.058,
  0.082, 0.077, 0.062, 0.052, 0.057, 0.068,
  0.092, 0.108, 0.097, 0.078, 0.042, 0.017,
];

function randomTimestamp() {
  let r = Math.random();
  let cumul = 0;
  let hour = 23;

  for (let h = 0; h < 24; h++) {
    cumul += HOUR_WEIGHTS[h];
    if (r < cumul) {
      hour = h;
      break;
    }
  }

  const d = new Date();
  d.setDate(d.getDate() - safeInt(0, 60));
  d.setHours(hour, safeInt(0, 59), safeInt(0, 59), 0);
  return d.toISOString();
}

// ── Traffic / device ──────────────────────────────────────────────────────
function randomTrafficSource() {
  let r = Math.random();
  let cumul = 0;
  for (const [src, w] of Object.entries(SOURCE_WEIGHTS)) {
    cumul += w;
    if (r < cumul) return src;
  }
  return 'direct';
}

function buildReferrer(source, site) {
  const domain = new URL(site).hostname;
  switch (source) {
    case 'organic':
      return `https://www.google.com/search?q=${encodeURIComponent(faker.commerce.department())}`;
    case 'social':
      return `https://www.${pick(SOCIAL_DOMAINS)}/`;
    case 'paid':
      return `https://ads.google.com/campaign/${faker.string.alphanumeric(8)}`;
    case 'email':
      return `https://email.${domain}/nl/${faker.string.alphanumeric(6)}`;
    case 'referral':
      return faker.internet.url();
    default:
      return null;
  }
}

function buildCampaign(source) {
  if (source === 'direct' || source === 'organic') return null;
  return pick([
    'spring_sale',
    'flash_deal',
    'ramadan_offer',
    'newsletter_push',
    'retargeting_q2',
    'brand_awareness',
    'black_friday_early',
  ]);
}

function randomDevice() {
  const r = Math.random();
  const category = r < 0.57 ? 'mobile' : r < 0.84 ? 'desktop' : 'tablet';
  const prof = DEVICE_PROFILES[category];
  const screen = pick(prof.screens);
  const os = pick(prof.os);

  return {
    category,
    screen,
    viewport_width: parseInt(screen.split('x')[0], 10),
    viewport_height: parseInt(screen.split('x')[1], 10),
    os,
    browser: pick(BROWSERS_BY_OS[os] || ['Chrome']),
    connection_type: pick(['wifi', '4g', '5g', '3g', 'ethernet']),
    locale: pick(['en-US', 'fr-FR', 'ar-TN', 'de-DE', 'es-ES']),
  };
}

function buildSessionContext(device) {
  return {
    connection_type: device.connection_type,
    cookie_consent: pick(['all', 'necessary_only', 'declined', 'not_shown']),
    ad_blocker_detected: roll(0.28),
    is_incognito_likely: roll(0.12),
    do_not_track: roll(0.18),
    touch_capable: device.category !== 'desktop',
    pixel_ratio: pick([1, 1.5, 2, 3]),
  };
}

// ── User generation ───────────────────────────────────────────────────────
function makeUser() {
  const gender = pick(['male', 'female', 'non_binary', 'prefer_not_to_say']);
  const fakerSex = gender === 'female' ? 'female' : 'male';
  const age = safeInt(18, 72);
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - age, safeInt(0, 11), safeInt(1, 28));

  return {
    userId: 'user_' + crypto.randomUUID(),
    anonymousId: 'anon_' + crypto.randomUUID(),
    firstName: faker.person.firstName(fakerSex),
    lastName: faker.person.lastName(),
    email: null,
    phone: null,
    age,
    dob: dob.toISOString().split('T')[0],
    gender,
    address: {
      street: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
      zip: faker.location.zipCode(),
      country: faker.location.countryCode(),
      timezone: faker.location.timeZone(),
    },
    preferred_language: pick(['en', 'fr', 'ar', 'es', 'de']),
    preferred_categories: faker.helpers.arrayElements(ALL_CATEGORIES, safeInt(1, 3)),
    registration_date: new Date(Date.now() - safeInt(0, 730) * 86400000).toISOString(),
    nb_visits: 0,
    total_spent: 0,
    total_orders: 0,
    last_seen: null,
  };
}

const USER_POOL = Array.from({ length: 100 }, makeUser);

// ── Behaviour profile ─────────────────────────────────────────────────────
function buildBehaviourProfile(user, device) {
  const isMobile = device.category === 'mobile';
  const returning = user.nb_visits > 2;

  const engagement = rand(0.0, 1.0);
  const priceSensitivity = rand(0.0, 1.0);
  const rawMax = priceSensitivity < 0.4 ? rand(60, 900) : rand(20, 250);
  const maxPrice = Math.max(20, Math.round(rawMax));

  const thinkHome = safeInt(isMobile ? 800 : 1500, isMobile ? 5000 : 12000);
  const thinkProduct = safeInt(isMobile ? 1200 : 2000, isMobile ? 8000 : 25000);
  const thinkCart = safeInt(isMobile ? 500 : 1000, isMobile ? 5000 : 12000);
  const scrollMax = Math.max(300, Math.min(thinkHome, thinkProduct) - 200);
  const thinkScroll = safeInt(300, scrollMax);

  return {
    bouncePr: clamp(0.55 - engagement * 0.55 + (isMobile ? 0.06 : 0), 0.03, 0.65),
    doSearchPr: clamp(0.50 + engagement * 0.45, 0.20, 0.99),
    nbProducts: safeInt(1, isMobile ? 6 : 10),
    addToCartPr: clamp(engagement * 0.80 - priceSensitivity * 0.20, 0.05, 0.85),
    removeFromCartPr: clamp(priceSensitivity * 0.45, 0.03, 0.45),
    cartToCheckoutPr: clamp(engagement * 0.75 - (isMobile ? 0.10 : 0) + (returning ? 0.08 : 0), 0.12, 0.92),
    checkoutToPurchasePr: clamp(engagement * 0.85 + (returning ? 0.06 : 0), 0.20, 0.97),
    promoPagePr: clamp(priceSensitivity * 0.40, 0.02, 0.35),
    goBackPr: rand(0.10, 0.55),
    browseEmptyCartPr: rand(0.04, 0.22),
    leaveReviewPr: clamp(engagement * 0.35, 0.02, 0.30),
    qty: pick([1, 1, 1, 1, 2, 2, 2, 3, 3, 4]),
    scrollDepth: safeInt(15, isMobile ? 75 : 100),
    paymentMethod: pick(PAYMENT_METHODS),
    language: user.preferred_language === 'ar' ? 'ar-TN' : user.preferred_language === 'fr' ? 'fr-FR' : 'en-US',
    thinkHome,
    thinkProduct,
    thinkCart,
    thinkCheckout: safeInt(3000, 15000),
    thinkScroll,
    maxPrice,
    preferredCategories: user.preferred_categories,
  };
}

// ── Product builders ──────────────────────────────────────────────────────
function makeProduct(profile, currency, site) {
  const category = pick(profile.preferredCategories);
  const price = safeFloat(5, profile.maxPrice);
  const discountPct = pick([0, 0, 0, 0, 5, 10, 15, 20, 25, 30]);
  const finalPrice = +(price * (1 - discountPct / 100)).toFixed(2);
  const productId = faker.string.uuid();
  const isFashion = category === 'Fashion';

  return {
    product_id: productId,
    product_name: faker.commerce.productName(),
    product_url: `${site}/product/${faker.string.alphanumeric(10)}`,
    image_url: `https://cdn.example.com/products/${productId}/main.webp`,
    sku: faker.string.alphanumeric(10).toUpperCase(),
    barcode_ean: faker.string.numeric(13),
    category,
    subcategory: faker.commerce.department(),
    brand: faker.company.name(),
    material: pick(MATERIALS),
    price,
    discount_pct: discountPct,
    final_price: finalPrice,
    price_text: `${finalPrice} ${currency}`,
    currency,
    stock_status: pick(['in_stock', 'in_stock', 'in_stock', 'low_stock', 'out_of_stock']),
    stock_qty: safeInt(0, 500),
    color: pick(COLORS),
    size: isFashion ? pick(SIZES) : null,
    weight_kg: safeFloat(0.1, 15, 2),
    dimensions_cm: `${safeInt(5, 60)}x${safeInt(5, 60)}x${safeInt(2, 30)}`,
    warranty_months: pick([0, 0, 12, 12, 24, 36]),
    is_returnable: roll(0.80),
    return_window_days: pick([14, 30, 60]),
    seller_id: 'seller_' + faker.string.alphanumeric(6),
    fulfillment_center: pick(['TUN-1', 'CDG-3', 'LTN-2', 'AMS-5', 'DXB-4']),
    tags: faker.helpers.arrayElements(PRODUCT_TAGS[category] || ['popular'], safeInt(2, 5)),
  };
}

function makeAddress(base) {
  if (roll(0.70)) return { ...base };
  return {
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zip: faker.location.zipCode(),
    country: faker.location.countryCode(),
  };
}

function buildProductSnapshot(product, quantity = 1) {
  return {
    product_id: product.product_id,
    product_name: product.product_name,
    product_url: product.product_url,
    image_url: product.image_url,
    sku: product.sku,
    barcode_ean: product.barcode_ean,
    category: product.category,
    subcategory: product.subcategory,
    brand: product.brand,
    material: product.material,
    color: product.color,
    size: product.size,
    price: product.price,
    final_price: product.final_price,
    discount_pct: product.discount_pct,
    currency: product.currency,
    stock_status: product.stock_status,
    stock_qty: product.stock_qty,
    quantity,
  };
}

function buildPaymentDetails(total, currency, forcedStatus = null) {
  const payment_method = pick(PAYMENT_METHODS);
  const payment_status = forcedStatus || pick(['approved', 'approved', 'approved', 'pending', 'failed']);

  return {
    payment_method,
    payment_status,
    payment_provider: payment_method.includes('paypal') ? 'PayPal'
      : payment_method.includes('apple_pay') ? 'Apple'
      : payment_method.includes('google_pay') ? 'Google'
      : payment_method.includes('bank_transfer') ? 'Bank'
      : payment_method.includes('cash_on_delivery') ? 'Merchant'
      : pick(['Stripe', 'Adyen', 'Checkout', 'Paymee']),
    transaction_id: 'txn_' + faker.string.alphanumeric(14),
    billing_currency: currency,
    charged_amount: total,
  };
}

function buildCustomerSnapshot(user) {
  ensureUserDemographics(user);
  return {
    user_id: user.userId,
    anonymous_id: user.anonymousId,
    age: user.age,
    gender: user.gender,
    city: user.address?.city ?? null,
    country: user.address?.country ?? null,
  };
}

function buildEventDescription(eventName, extra = {}) {
  return {
    event_name: eventName,
    action_source: extra.action_source || null,
    action_label: extra.action_label || null,
    action_location: extra.action_location || null,
    page_type: extra.page_type || null,
    query: extra.query || null,
  };
}

function buildSessionMetrics(sequence, cartItems, pageViews, cursorMs) {
  return {
    page_views: pageViews,
    products_viewed: sequence.filter((e) => e === 'product_viewed').length,
    add_to_cart_count: sequence.filter((e) => e === 'add_to_cart').length,
    remove_from_cart_count: sequence.filter((e) => e === 'remove_from_cart').length,
    search_count: sequence.filter((e) => e === 'search_performed').length,
    cart_items: cartItems.length,
    cart_value: +cartItems.reduce((s, it) => s + it.final_price * it.quantity, 0).toFixed(2),
    session_elapsed_sec: Math.round(cursorMs / 1000),
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
async function post(endpoint, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${DATAPLANE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: AUTH },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      return res.status;
    } catch (err) {
      if (attempt === retries) {
        console.warn(`  ⚠ POST ${endpoint} failed: ${err.message}`);
        return null;
      }
      console.warn(`  ↻ Retry ${attempt}/${retries}…`);
      await sleep(1000 * attempt);
    }
  }
}

async function track(event, props, anonId, ts) {
  const status = await post('/v1/track', {
    anonymousId: anonId,
    event,
    properties: props,
    context: {
      sessionId: props.session_id,
      device: {
        category: props.device_category,
        os: props.device_os,
        browser: props.browser,
      },
      library: { name: 'sim-bot', version: '6.2-raw' },
    },
    timestamp: ts,
    sentAt: new Date().toISOString(),
  });
  console.log(`  📡 ${event.padEnd(24)} → HTTP ${status ?? 'ERR'}`);
}

async function identify(anonId, userId, traits, ts) {
  const status = await post('/v1/identify', {
    anonymousId: anonId,
    userId,
    traits,
    timestamp: ts,
    sentAt: new Date().toISOString(),
  });
  console.log(`  🪪 identify                    → HTTP ${status ?? 'ERR'}`);
}

// ── Base properties ───────────────────────────────────────────────────────
function baseProps(ctx, pageType, url, tsIso) {
  const u = ctx.user;
  ensureUserDemographics(u);

  return {
    client_id: ctx.loggedIn ? u.userId : u.anonymousId,
    session_id: ctx.sessionId,
    event_type: pageType,
    logged_in: ctx.loggedIn,
    timestamp: tsIso,
    nb_visits: u.nb_visits,
    address_text: `${u.address.street}, ${u.address.city}, ${u.address.state}, ${u.address.country}`,
    gender: u.gender,
    age: u.age,
    device_summary: `${ctx.device.category}|${ctx.device.os}|${ctx.device.browser}|${ctx.device.screen}`,

    page_url: url,
    page_title: `${pageType.replace(/_/g, ' ')} — ${ctx.hostname}`,
    page_type: pageType,
    domain: ctx.hostname,
    site: ctx.site,
    landing_page: ctx.site,

    referrer: ctx.referrer,
    referrer_domain: ctx.referrer ? new URL(ctx.referrer).hostname : null,
    traffic_source: ctx.trafficSource,
    campaign: ctx.campaign,

    device_category: ctx.device.category,
    device_os: ctx.device.os,
    browser: ctx.device.browser,
    screen: ctx.device.screen,
    viewport_width: ctx.device.viewport_width,
    viewport_height: ctx.device.viewport_height,
    connection_type: ctx.device.connection_type,
    locale: ctx.device.locale,

    city: u.address.city,
    country: u.address.country,
    currency: ctx.currency,
    cookie_consent: ctx.sessionCtx.cookie_consent,
    ad_blocker_detected: ctx.sessionCtx.ad_blocker_detected,
    is_incognito_likely: ctx.sessionCtx.is_incognito_likely,
    do_not_track: ctx.sessionCtx.do_not_track,
    touch_capable: ctx.sessionCtx.touch_capable,
    pixel_ratio: ctx.sessionCtx.pixel_ratio,
  };
}

// ── Main simulator ────────────────────────────────────────────────────────
async function simulateSession(site, user) {
  ensureUserDemographics(user);

  const sessionTs = randomTimestamp();
  const cursor = { base: sessionTs, ms: 0 };

  const device = randomDevice();
  const profile = buildBehaviourProfile(user, device);
  const trafficSource = randomTrafficSource();
  const referrer = buildReferrer(trafficSource, site);
  const campaign = buildCampaign(trafficSource);
  const currency = siteCurrency(site);
  const loggedIn = roll(user.nb_visits > 5 ? 0.70 : 0.28);
  const hostname = new URL(site).hostname;
  const sessionCtx = buildSessionContext(device);

  user.nb_visits++;
  user.last_seen = sessionTs;

  const ctx = {
    sessionId: 'sess_' + crypto.randomUUID(),
    site,
    hostname,
    device,
    profile,
    trafficSource,
    referrer,
    campaign,
    currency,
    loggedIn,
    user,
    sessionCtx,
  };

  const sequence = [];
  const cartItems = [];
  let pageViews = 0;
  let funnelStep = 'home';
  let eventN = 0;
  let lastPaymentDetails = null;

  const emit = async (event, extra, offsetMs = 0) => {
    const ts = advance(cursor, Math.max(0, offsetMs));
    const url = extra._url || site;
    eventN++;

    const eventContext = {
      event_number_in_session: eventN,
      prior_event: sequence.length > 0 ? sequence[sequence.length - 1] : null,
      funnel_step: funnelStep,
      cart_size: cartItems.length,
      cart_value: +cartItems.reduce((s, it) => s + it.final_price * it.quantity, 0).toFixed(2),
      pages_visited: pageViews,
      session_elapsed_sec: Math.round(cursor.ms / 1000),
      ...(extra._eventCtx || {}),
    };

    const props = {
      ...baseProps(ctx, extra._pageType || 'home', url, ts),
      event_context: eventContext,
      pages_per_session_detail: buildSessionMetrics(sequence, cartItems, pageViews, cursor.ms),
      sequence_summary: [...sequence],
      ...extra,
    };

    delete props._url;
    delete props._pageType;
    delete props._eventCtx;

    sequence.push(event);
    await track(event, props, user.anonymousId, ts);
    return ts;
  };

  await identify(
    user.anonymousId,
    loggedIn ? user.userId : null,
    {
      age: user.age,
      dob: user.dob,
      gender: user.gender,
      city: user.address.city,
      country: user.address.country,
      preferred_language: user.preferred_language,
      logged_in: loggedIn,
      nb_visits: user.nb_visits,
      total_orders: user.total_orders,
      total_spent: user.total_spent,
      registration_date: user.registration_date,
      device_primary: device.category,
    },
    sessionTs,
  );

  // Home
  funnelStep = 'home';
  await emit('page_view', {
    _pageType: 'home',
    _url: site,
    _eventCtx: { intent: 'browse_homepage', entry_point: trafficSource, is_landing: true },
    event_description: buildEventDescription('page_view', {
      action_source: 'landing',
      action_label: 'page_view',
      action_location: 'homepage',
      page_type: 'home',
    }),
    customer_snapshot: buildCustomerSnapshot(user),
    section_visible: pick(['hero', 'featured_products', 'promo_banner', 'trending', 'categories']),
    page_load_ms: safeInt(200, 3500),
  }, 0);
  pageViews++;

  if (roll(profile.bouncePr)) {
    const bounceSec = safeInt(2, 14);
    const bounceMs = bounceSec * 1000;
    const scrollOffset = safeInt(200, Math.max(200, bounceMs - 300));

    await emit('scroll_depth', {
      _pageType: 'home',
      _url: site,
      _eventCtx: { intent: 'passive_scan', is_bounce_session: true },
      event_description: buildEventDescription('scroll_depth', {
        action_source: 'scroll',
        action_location: 'homepage',
        page_type: 'home',
      }),
      depth_pct: safeInt(5, 30),
      direction: 'down',
      scroll_speed: pick(['slow', 'normal', 'fast']),
    }, scrollOffset);

    await emit('session_ended', {
      _pageType: 'home',
      _url: site,
      _eventCtx: { intent: 'exit', is_bounce_session: true },
      event_description: buildEventDescription('session_ended', {
        action_source: 'session_timeout',
        action_location: 'sitewide',
        page_type: 'home',
      }),
      duration: bounceSec,
      orders: 0,
      time_on_site_sec: bounceSec,
      pages_per_session: 1,
      events_in_session: eventN + 1,
      max_scroll_pct: safeInt(0, 25),
      click_count: safeInt(0, 2),
      is_bounce: true,
      cart_abandoned: false,
      cart_abandonned: false,
      converted: false,
      revenue: 0,
      exit_page: 'home',
      entry_page: 'home',
      products_viewed: 0,
      searches_performed: 0,
    }, Math.max(0, bounceMs - scrollOffset));

    console.log(`  ↩ bounce ${bounceSec}s`);
    return { sequence, revenue: 0 };
  }

  await emit('scroll_depth', {
    _pageType: 'home',
    _url: site,
    _eventCtx: { intent: 'explore_homepage' },
    event_description: buildEventDescription('scroll_depth', {
      action_source: 'scroll',
      action_location: 'homepage',
      page_type: 'home',
    }),
    depth_pct: safeInt(20, 65),
    direction: 'down',
    scroll_speed: pick(['slow', 'normal', 'fast']),
    sections_seen: faker.helpers.arrayElements(['hero', 'featured', 'trending', 'categories', 'newsletter', 'footer'], safeInt(2, 5)),
  }, profile.thinkScroll);

  cursor.ms += Math.max(0, profile.thinkHome - profile.thinkScroll);

  // Promo
  if (roll(profile.promoPagePr)) {
    funnelStep = 'promo';
    const promoUrl = `${site}/promo`;
    const promoId = 'promo_' + faker.string.alphanumeric(6).toUpperCase();
    const promoName = campaign || pick(['site_promotion', 'seasonal_deal', 'flash_sale', 'clearance']);

    await emit('page_view', {
      _pageType: 'promo',
      _url: promoUrl,
      _eventCtx: { intent: 'check_deals', trigger: 'promo_banner_click' },
      event_description: buildEventDescription('page_view', {
        action_source: 'banner_click',
        action_location: 'homepage',
        page_type: 'promo',
      }),
    }, safeInt(300, 1200));
    pageViews++;

    await emit('promo_viewed', {
      _pageType: 'promo',
      _url: promoUrl,
      _eventCtx: { intent: 'evaluate_offer' },
      event_description: buildEventDescription('promo_viewed', {
        action_source: 'page_view',
        action_location: 'promo_page',
        page_type: 'promo',
      }),
      promo_id: promoId,
      promo_name: promoName,
      promo_type: pick(['percentage_off', 'fixed_amount', 'free_shipping', 'bundle', 'buy_x_get_y']),
      promo_value: pick([5, 10, 15, 20, 25, 30, 50]),
      promo_end_date: new Date(Date.now() + safeInt(1, 14) * 86400000).toISOString(),
    }, safeInt(500, 2000));
  }

  // Search
  if (roll(profile.doSearchPr)) {
    funnelStep = 'search';
    const category = pick(profile.preferredCategories);
    const query = `${category} ${faker.commerce.productAdjective()}`.toLowerCase();
    const searchUrl = `${site}/search?q=${encodeURIComponent(query)}`;
    const minP = safeInt(0, 40);
    const maxP = safeInt(minP + 10, Math.max(minP + 10, profile.maxPrice));

    await emit('page_view', {
      _pageType: 'search',
      _url: searchUrl,
      _eventCtx: { intent: 'find_product', trigger: 'searchbar' },
      event_description: buildEventDescription('page_view', {
        action_source: 'searchbar',
        action_location: 'header',
        page_type: 'search',
      }),
    }, safeInt(200, 900));
    pageViews++;

    const resultsCount = safeInt(0, 180);
    await emit('search_performed', {
      _pageType: 'search',
      _url: searchUrl,
      _eventCtx: { intent: 'find_product', search_type: 'keyword' },
      event_description: buildEventDescription('search_performed', {
        action_source: 'searchbar',
        action_label: 'submit_search',
        action_location: 'header',
        page_type: 'search',
        query,
      }),
      query,
      query_length: query.length,
      query_word_count: query.split(' ').length,
      filters: {
        category,
        min_price: minP,
        max_price: maxP,
        sort_by: pick(['relevance', 'price_asc', 'price_desc', 'rating', 'popularity', 'newest']),
        in_stock_only: roll(0.35),
      },
      results_count: resultsCount,
      has_results: resultsCount > 0,
      clicked_position: resultsCount > 0 ? safeInt(1, Math.min(24, resultsCount)) : null,
    }, safeInt(300, 1200));
  }

  // Product browsing
  for (let i = 0; i < profile.nbProducts; i++) {
    const product = makeProduct(profile, currency, site);
    const productUrl = `${site}/product/${faker.string.alphanumeric(8)}`;
    funnelStep = 'product';

    await emit('page_view', {
      _pageType: 'product',
      _url: productUrl,
      _eventCtx: { intent: 'evaluate_product', product_rank_in_session: i + 1 },
      event_description: buildEventDescription('page_view', {
        action_source: 'navigation',
        action_location: 'search_or_listing',
        page_type: 'product',
      }),
      page_load_ms: safeInt(150, 2500),
    }, safeInt(300, 1400));
    pageViews++;

    await emit('product_viewed', {
      _pageType: 'product',
      _url: productUrl,
      _eventCtx: { intent: 'evaluate_product', position_in_results: safeInt(1, 24) },
      event_description: buildEventDescription('product_viewed', {
        action_source: 'product_click',
        action_location: 'product_grid',
        page_type: 'product',
      }),
      product_snapshot: buildProductSnapshot(product, 1),
      customer_snapshot: buildCustomerSnapshot(user),
      ...product,
      image_views: safeInt(1, 8),
      zoom_used: roll(0.30),
      video_played: roll(0.15),
      read_description: roll(0.55),
      read_reviews: roll(0.45),
      compared_with_similar: roll(0.18),
      delivery_date_checked: roll(0.40),
    }, safeInt(200, 600));

    await emit('scroll_depth', {
      _pageType: 'product',
      _url: productUrl,
      _eventCtx: { intent: 'read_product_details' },
      event_description: buildEventDescription('scroll_depth', {
        action_source: 'scroll',
        action_location: 'product_page',
        page_type: 'product',
      }),
      depth_pct: profile.scrollDepth,
      direction: 'down',
      scroll_speed: pick(['slow', 'normal', 'fast']),
      reached_reviews: profile.scrollDepth > 60,
    }, profile.thinkScroll);

    cursor.ms += Math.max(0, profile.thinkProduct - profile.thinkScroll);

    if (product.stock_status !== 'out_of_stock' && roll(profile.addToCartPr)) {
      funnelStep = 'cart';
      const qty = profile.qty;
      cartItems.push({ ...product, quantity: qty });

      const cartValue = +cartItems.reduce((s, it) => s + it.final_price * it.quantity, 0).toFixed(2);

      await emit('add_to_cart', {
        _pageType: 'product',
        _url: productUrl,
        _eventCtx: { intent: 'purchase_intent', cart_trigger: pick(['add_to_cart_btn', 'buy_now_btn', 'quick_add']) },
        event_description: buildEventDescription('add_to_cart', {
          action_source: 'button_click',
          action_label: 'add_to_cart',
          action_location: 'product_page',
          page_type: 'product',
        }),
        product_snapshot: buildProductSnapshot(product, qty),
        customer_snapshot: buildCustomerSnapshot(user),
        quantity: qty,
        line_total: +(product.final_price * qty).toFixed(2),
        cart_size: cartItems.length,
        cart_value: cartValue,
        cart_unique_items: cartItems.length,
        element_text: pick(['Add to cart', 'Buy now', 'Ajouter au panier', 'أضف إلى السلة']),
        size_selected: product.size,
        color_selected: product.color,
      }, safeInt(200, 800));

      if (roll(profile.removeFromCartPr) && cartItems.length > 0) {
        const removed = cartItems.pop();
        const cartValueAfter = +cartItems.reduce((s, it) => s + it.final_price * it.quantity, 0).toFixed(2);

        await emit('remove_from_cart', {
          _pageType: 'cart',
          _url: `${site}/cart`,
          _eventCtx: { intent: 'reconsider_purchase' },
          event_description: buildEventDescription('remove_from_cart', {
            action_source: 'button_click',
            action_label: 'remove_from_cart',
            action_location: 'cart_page',
            page_type: 'cart',
          }),
          product_snapshot: buildProductSnapshot(removed, removed.quantity),
          quantity: removed.quantity,
          removal_reason: pick(['changed_mind', 'found_better_price', 'too_expensive', 'accidental_add', 'out_of_budget', 'duplicate_item']),
          cart_size_after: cartItems.length,
          cart_value_after: cartValueAfter,
        }, safeInt(200, 1000));
      }
    }

    if (i < profile.nbProducts - 1 && roll(profile.goBackPr)) {
      const catSlug = product.category.toLowerCase().replace(/\s+/g, '-');
      await emit('page_view', {
        _pageType: 'category',
        _url: `${site}/category/${catSlug}`,
        _eventCtx: { intent: 'browse_more', trigger: 'back_button' },
        event_description: buildEventDescription('page_view', {
          action_source: 'navigation',
          action_location: 'category_page',
          page_type: 'category',
        }),
        category_name: product.category,
        sort_applied: pick(['relevance', 'price_asc', 'price_desc', 'rating']),
        page_number: safeInt(1, 3),
      }, safeInt(300, 1200));
      pageViews++;
    }
  }

  if (roll(profile.browseEmptyCartPr) && cartItems.length === 0) {
    await emit('page_view', {
      _pageType: 'cart',
      _url: `${site}/cart`,
      _eventCtx: { intent: 'check_cart', trigger: 'cart_icon' },
      event_description: buildEventDescription('page_view', {
        action_source: 'cart_icon',
        action_location: 'header',
        page_type: 'cart',
      }),
      cart_is_empty: true,
    }, safeInt(400, 1500));
    pageViews++;
  }

  // Checkout
  let cartAbandoned = false;
  let orderRevenue = 0;
  let orderId = null;

  if (cartItems.length > 0) {
    funnelStep = 'cart_review';
    const cartUrl = `${site}/cart`;
    const subtotal = +cartItems.reduce((s, it) => s + it.final_price * it.quantity, 0).toFixed(2);
    const shippingCost = subtotal > 100 ? 0 : safeInt(3, 25);
    const taxRate = +rand(0.05, 0.19).toFixed(3);
    const taxAmount = +(subtotal * taxRate).toFixed(2);
    const total = +(subtotal + shippingCost + taxAmount).toFixed(2);
    const nbItems = cartItems.reduce((s, it) => s + it.quantity, 0);
    const categories = [...new Set(cartItems.map((it) => it.category))];

    await emit('page_view', {
      _pageType: 'cart',
      _url: cartUrl,
      _eventCtx: { intent: 'review_cart' },
      event_description: buildEventDescription('page_view', {
        action_source: 'navigation',
        action_location: 'cart_page',
        page_type: 'cart',
      }),
    }, safeInt(400, 1500));
    pageViews++;
    cursor.ms += profile.thinkCart;

    if (roll(profile.cartToCheckoutPr)) {
      funnelStep = 'checkout';
      const checkoutUrl = `${site}/checkout`;
      const shippingAddress = makeAddress(user.address);
      const billingAddress = roll(0.75) ? shippingAddress : makeAddress(user.address);

      await emit('checkout_started', {
        _pageType: 'checkout',
        _url: checkoutUrl,
        _eventCtx: { intent: 'complete_purchase' },
        event_description: buildEventDescription('checkout_started', {
          action_source: 'checkout_button',
          action_location: 'cart_page',
          page_type: 'checkout',
        }),
        customer_snapshot: buildCustomerSnapshot(user),
        cart_items: cartItems.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          sku: it.sku,
          category: it.category,
          brand: it.brand,
          quantity: it.quantity,
          final_price: it.final_price,
          line_total: +(it.final_price * it.quantity).toFixed(2),
          discount_pct: it.discount_pct,
        })),
        nb_items: nbItems,
        nb_unique_products: cartItems.length,
        categories_in_cart: categories,
        subtotal,
        shipping_cost: shippingCost,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        cart_value: total,
        payment_candidates: PAYMENT_METHODS,
        shipping_address: shippingAddress,
        billing_address: billingAddress,
        estimated_delivery: new Date(Date.now() + safeInt(1, 10) * 86400000).toISOString().split('T')[0],
      }, safeInt(500, 2000));

      cursor.ms += profile.thinkCheckout;

      if (roll(profile.checkoutToPurchasePr)) {
        funnelStep = 'purchase';
        orderId = 'ORD-' + faker.string.alphanumeric(10).toUpperCase();
        orderRevenue = total;
        const carrier = pick(CARRIERS);
        const shippingMethod = pick(['standard', 'express', 'pickup', 'same_day']);
        const estDelivery = new Date(Date.now() + (shippingMethod === 'same_day' ? 0 : safeInt(1, 10)) * 86400000).toISOString().split('T')[0];
        const paymentDetails = buildPaymentDetails(total, currency, 'approved');
        lastPaymentDetails = paymentDetails;

        const orderDescription = {
          order_id: orderId,
          order_status: 'success',
          order_datetime: new Date().toISOString(),
          currency,
          subtotal,
          shipping_cost: shippingCost,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          total,
          payment_method: paymentDetails.payment_method,
          payment_status: paymentDetails.payment_status,
          payment_provider: paymentDetails.payment_provider,
          shipping_method: shippingMethod,
          carrier,
          estimated_delivery: estDelivery,
          shipping_address: makeAddress(user.address),
          billing_address: makeAddress(user.address),
          items_count: nbItems,
          unique_products_count: cartItems.length,
          categories_purchased: categories,
          customer_snapshot: buildCustomerSnapshot(user),
          order_lines: cartItems.map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            sku: it.sku,
            category: it.category,
            brand: it.brand,
            unit_price: it.price,
            final_unit_price: it.final_price,
            discount_pct: it.discount_pct,
            quantity: it.quantity,
            line_total: +(it.final_price * it.quantity).toFixed(2),
            currency,
          })),
        };

        await emit('purchase_completed', {
          _pageType: 'order_confirm',
          _url: `${site}/order-confirm/${orderId}`,
          _eventCtx: { intent: 'confirm_order' },
          event_description: buildEventDescription('purchase_completed', {
            action_source: 'checkout_submit',
            action_location: 'checkout_page',
            page_type: 'order_confirm',
          }),
          duration: Math.round(profile.thinkCheckout / 1000),
          orders: 1,
          order_description: orderDescription,
          order_id: orderId,
          status: 'success',
          subtotal,
          shipping_cost: shippingCost,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          total,
          payment_method: paymentDetails.payment_method,
          payment_status: paymentDetails.payment_status,
          shipping_method: shippingMethod,
          carrier,
          estimated_delivery: estDelivery,
          nb_items: nbItems,
          nb_unique_products: cartItems.length,
          categories_purchased: categories,
        }, 0);

        user.total_orders++;
        user.total_spent = +(user.total_spent + total).toFixed(2);

        if (roll(profile.leaveReviewPr)) {
          await emit('review_submitted', {
            _pageType: 'order_confirm',
            _url: `${site}/order-confirm/${orderId}`,
            _eventCtx: { intent: 'share_experience', trigger: 'post_purchase_prompt' },
            event_description: buildEventDescription('review_submitted', {
              action_source: 'review_prompt',
              action_location: 'order_confirm',
              page_type: 'order_confirm',
            }),
            order_id: orderId,
            satisfaction: pick(['very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied']),
            review_length: safeInt(0, 400),
            review_tags: faker.helpers.arrayElements([
              'fast_delivery', 'good_quality', 'great_price', 'poor_packaging',
              'wrong_item', 'as_described', 'good_packaging', 'slow_delivery',
            ], safeInt(1, 3)),
          }, safeInt(5000, 30000));
        }
      } else {
        cartAbandoned = true;
        const paymentDetails = buildPaymentDetails(total, currency, pick(['failed', 'pending']));
        lastPaymentDetails = paymentDetails;

        await emit('checkout_abandoned', {
          _pageType: 'checkout',
          _url: checkoutUrl,
          _eventCtx: { intent: 'abandon' },
          event_description: buildEventDescription('checkout_abandoned', {
            action_source: 'form_exit',
            action_location: 'checkout_page',
            page_type: 'checkout',
          }),
          payment_details: paymentDetails,
          order_description: {
            order_status: 'abandoned_at_checkout',
            currency,
            subtotal,
            shipping_cost: shippingCost,
            tax_rate: taxRate,
            tax_amount: taxAmount,
            total,
            payment_method: paymentDetails.payment_method,
            payment_status: paymentDetails.payment_status,
            items_count: nbItems,
            unique_products_count: cartItems.length,
            categories_in_cart: categories,
          },
          cart_value: total,
          nb_items: nbItems,
          checkout_step: pick(['shipping_info', 'payment_info', 'order_review']),
          payment_attempted: roll(0.35),
          payment_error_code: roll(0.35) ? pick(PAYMENT_FAILURE_CODES) : null,
          time_in_checkout_sec: Math.round(profile.thinkCheckout / 1000),
          abandon_reason: pick(['payment_failure', 'forced_signup', 'long_process', 'unexpected_fees', 'delivery_too_slow', 'changed_mind', 'security_concern', 'coupon_not_working', 'session_timeout']),
        }, 0);
      }
    } else {
      cartAbandoned = true;

      await emit('cart_abandoned', {
        _pageType: 'cart',
        _url: cartUrl,
        _eventCtx: { intent: 'abandon', time_in_cart_sec: Math.round(profile.thinkCart / 1000) },
        event_description: buildEventDescription('cart_abandoned', {
          action_source: 'navigation_exit',
          action_location: 'cart_page',
          page_type: 'cart',
        }),
        order_description: {
          order_status: 'abandoned_in_cart',
          currency,
          subtotal,
          items_count: nbItems,
          unique_products_count: cartItems.length,
          categories_in_cart: categories,
          order_lines: cartItems.map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: it.quantity,
            final_unit_price: it.final_price,
            line_total: +(it.final_price * it.quantity).toFixed(2),
          })),
        },
        cart_value: subtotal,
        nb_items: nbItems,
        nb_unique_products: cartItems.length,
        highest_price_item: Math.max(...cartItems.map((it) => it.final_price)),
        categories_in_cart: categories,
        time_in_cart_sec: Math.round(profile.thinkCart / 1000),
        abandon_reason: pick(['high_shipping_cost', 'just_browsing', 'price_too_high', 'save_for_later', 'comparison_shopping', 'distracted', 'no_preferred_payment', 'coupon_not_found']),
      }, 0);
    }
  }

  // Session end
  const timeOnSiteSec = Math.round(cursor.ms / 1000);
  const clickCount = safeInt(pageViews > 1 ? 1 : 0, 40);
  const isBounce = pageViews === 1 && clickCount < 3 && timeOnSiteSec < 15;

  await emit('session_ended', {
    _pageType: 'session_end',
    _url: site,
    _eventCtx: { intent: 'exit', exit_reason: cartAbandoned ? 'cart_abandoned' : orderRevenue > 0 ? 'converted' : 'browsed' },
    event_description: buildEventDescription('session_ended', {
      action_source: 'session_end',
      action_location: 'sitewide',
      page_type: 'session_end',
    }),
    duration: timeOnSiteSec,
    orders: orderRevenue > 0 ? 1 : 0,
    order_description: orderRevenue > 0 ? {
      order_status: 'completed',
      payment_details: lastPaymentDetails,
      revenue: orderRevenue,
      order_id: orderId,
    } : cartAbandoned ? {
      order_status: 'abandoned',
      payment_details: lastPaymentDetails,
    } : null,
    time_on_site_sec: timeOnSiteSec,
    pages_per_session: pageViews,
    events_in_session: eventN + 1,
    max_scroll_pct: profile.scrollDepth,
    click_count: clickCount,
    is_bounce: isBounce,
    cart_abandoned: cartAbandoned,
    cart_abandonned: cartAbandoned,
    reached_cart: sequence.some((e) => e === 'add_to_cart'),
    reached_checkout: sequence.includes('checkout_started'),
    converted: sequence.includes('purchase_completed'),
    revenue: orderRevenue,
    order_id: orderId,
    entry_page: 'home',
    exit_page: funnelStep,
    entry_traffic_source: trafficSource,
    products_viewed: sequence.filter((e) => e === 'product_viewed').length,
    products_added: sequence.filter((e) => e === 'add_to_cart').length,
    searches_performed: sequence.filter((e) => e === 'search_performed').length,
  }, 0);

  return { sequence, revenue: orderRevenue };
}

// ── Runner ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`🚀  Generating ${TOTAL} sessions…\n`);

  let totalRevenue = 0;
  let purchases = 0;

  for (let i = 0; i < TOTAL; i++) {
    const user = Math.random() < 0.70
      ? USER_POOL[Math.floor(Math.random() * USER_POOL.length)]
      : makeUser();

    const site = pick(SITES);
    const { sequence, revenue } = await simulateSession(site, user);
    totalRevenue += revenue;
    if (revenue > 0) purchases++;

    console.log(
      `[${String(i + 1).padStart(3)}/${TOTAL}]` +
      ` ${new URL(site).hostname.padEnd(22)}` +
      ` rev=${revenue > 0 ? revenue.toFixed(2).padStart(8) : '       —'}` +
      ` | ${sequence.join(' → ')}\n`
    );

    await sleep(safeInt(60, 250));
  }

  console.log('═'.repeat(70));
  console.log(`✅  Done — ${purchases}/${TOTAL} purchases · Total revenue: ${totalRevenue.toFixed(2)}`);
})();
