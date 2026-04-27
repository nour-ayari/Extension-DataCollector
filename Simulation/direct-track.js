// bot/direct-track-random.js
import { faker } from '@faker-js/faker';

const WRITE_KEY = '3BtgnG9O19EIKEJptG1h4k9Nps6';
const DATAPLANE = "https://insatrefkarbfv.dataplane.rudderstack.com";
const AUTH      = 'Basic ' + Buffer.from(WRITE_KEY + ':').toString('base64');
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 0);
const TOTAL = Number(process.env.TOTAL ?? 300);

// ── Persona definitions ──────────────────────────────────────────────────────
// Each persona models a distinct e-commerce user archetype.
// All probability ranges are [min, max]; a random value is drawn each session.

const PERSONA_CONFIG = {
  impulsive_buyer: {
    label:            'Impulsive Buyer',
    ageRange:         [18, 30],
    deviceWeights:    { mobile: 0.75, desktop: 0.15, tablet: 0.10 },
    bounce:           [0.03, 0.20],
    doSearch:         [0.50, 0.80],
    nbProducts:       [1, 3],         
    scrollDepth:      [20, 65],
    addToCart:        [0.40, 0.80],
    removeFromCart:   [0.03, 0.15],
    cartToCheckout:   [0.60, 0.90],
    checkoutToPurchase: [0.70, 0.95],
    maxPriceRange:    [15, 150],
    promoPage:        [0.10, 0.30],
    preferredPayment: ['card', 'paypal'],
    categories:       ['Fashion', 'Electronics', 'Gaming', 'Toys', 'Beauty'],
    thinkScale:       0.6,
  },

  careful_researcher: {
    label:            'Careful Researcher',
    ageRange:         [30, 55],
    deviceWeights:    { mobile: 0.20, desktop: 0.70, tablet: 0.10 },
    bounce:           [0.02, 0.10],
    doSearch:         [0.80, 0.99],
    nbProducts:       [5, 12],
    scrollDepth:      [60, 100],
    addToCart:        [0.20, 0.50],
    removeFromCart:   [0.20, 0.50],
    cartToCheckout:   [0.30, 0.60],
    checkoutToPurchase: [0.70, 0.95],
    maxPriceRange:    [50, 600],
    promoPage:        [0.20, 0.50],
    preferredPayment: ['card', 'bank_transfer'],
    categories:       ['Electronics', 'Books', 'Tools', 'Home', 'Sports'],
    thinkScale:       1.5,
  },

  bargain_hunter: {
    label:            'Bargain Hunter',
    ageRange:         [20, 50],
    deviceWeights:    { mobile: 0.50, desktop: 0.35, tablet: 0.15 },
    bounce:           [0.10, 0.40],
    doSearch:         [0.70, 0.95],
    nbProducts:       [3, 8],
    scrollDepth:      [30, 80],
    addToCart:        [0.20, 0.50],
    removeFromCart:   [0.30, 0.60],
    cartToCheckout:   [0.20, 0.45],
    checkoutToPurchase: [0.40, 0.70],
    maxPriceRange:    [10, 100],
    promoPage:        [0.60, 0.95],
    preferredPayment: ['cash_on_delivery', 'paypal'],
    categories:       ['Food', 'Fashion', 'Beauty', 'Toys'],
    thinkScale:       1.0,
  },

  loyal_customer: {
    label:            'Loyal Customer',
    ageRange:         [25, 60],
    deviceWeights:    { mobile: 0.45, desktop: 0.45, tablet: 0.10 },
    bounce:           [0.01, 0.08],
    doSearch:         [0.60, 0.85],
    nbProducts:       [2, 6],
    scrollDepth:      [40, 90],
    addToCart:        [0.50, 0.85],
    removeFromCart:   [0.05, 0.20],
    cartToCheckout:   [0.70, 0.95],
    checkoutToPurchase: [0.80, 0.99],
    maxPriceRange:    [30, 400],
    promoPage:        [0.15, 0.40],
    preferredPayment: ['card', 'paypal'],
    categories:       ['Electronics', 'Home', 'Sports', 'Fashion', 'Beauty'],
    thinkScale:       0.9,
    startVisitsRange: [5, 30],
  },

  window_shopper: {
    label:            'Window Shopper',
    ageRange:         [16, 45],
    deviceWeights:    { mobile: 0.65, desktop: 0.25, tablet: 0.10 },
    bounce:           [0.20, 0.55],
    doSearch:         [0.60, 0.85],
    nbProducts:       [3, 10],
    scrollDepth:      [20, 70],
    addToCart:        [0.05, 0.20],
    removeFromCart:   [0.50, 0.85],
    cartToCheckout:   [0.05, 0.20],
    checkoutToPurchase: [0.10, 0.30],
    maxPriceRange:    [10, 200],
    promoPage:        [0.10, 0.30],
    preferredPayment: ['card'],
    categories:       ['Fashion', 'Beauty', 'Electronics', 'Gaming', 'Toys'],
    thinkScale:       0.8,
  },

  senior_shopper: {
    label:            'Senior Shopper',
    ageRange:         [55, 72],
    deviceWeights:    { mobile: 0.20, desktop: 0.70, tablet: 0.10 },
    bounce:           [0.03, 0.15],
    doSearch:         [0.40, 0.70],
    nbProducts:       [2, 5],
    scrollDepth:      [50, 100],
    addToCart:        [0.40, 0.70],
    removeFromCart:   [0.05, 0.15],
    cartToCheckout:   [0.60, 0.85],
    checkoutToPurchase: [0.65, 0.90],
    maxPriceRange:    [50, 800],
    promoPage:        [0.10, 0.35],
    preferredPayment: ['cash_on_delivery', 'bank_transfer'],
    categories:       ['Home', 'Health', 'Books', 'Tools', 'Food'],
    thinkScale:       2.0,
  },
};

const PERSONA_TYPES = Object.keys(PERSONA_CONFIG);

// ── Tunisian address data ────────────────────────────────────────────────────
const TN_CITIES = [
  { city: 'Tunis',        zip: '1000' },
  { city: 'Sfax',         zip: '3000' },
  { city: 'Sousse',       zip: '4000' },
  { city: 'Ettadhamen',   zip: '2041' },
  { city: 'Kairouan',     zip: '3100' },
  { city: 'Bizerte',      zip: '7000' },
  { city: 'Gabès',        zip: '6000' },
  { city: 'Ariana',       zip: '2080' },
  { city: 'Gafsa',        zip: '2100' },
  { city: 'Monastir',     zip: '5000' },
  { city: 'Ben Arous',    zip: '2013' },
  { city: 'Kasserine',    zip: '1200' },
  { city: 'Médenine',     zip: '4100' },
  { city: 'Nabeul',       zip: '8000' },
  { city: 'Tataouine',    zip: '3200' },
  { city: 'Béja',         zip: '9000' },
  { city: 'Jendouba',     zip: '8100' },
  { city: 'El Kef',       zip: '7100' },
  { city: 'Mahdia',       zip: '5100' },
  { city: 'Sidi Bouzid',  zip: '9100' },
  { city: 'Tozeur',       zip: '2200' },
  { city: 'Kebili',       zip: '4200' },
  { city: 'Zaghouan',     zip: '1100' },
  { city: 'Siliana',      zip: '6100' },
  { city: 'Manouba',      zip: '2010' },
  { city: 'La Marsa',     zip: '2070' },
  { city: 'Hammam-Lif',   zip: '2050' },
  { city: 'Djerba',       zip: '4180' },
  { city: 'Zarzis',       zip: '4170' },
  { city: 'Hammamet',     zip: '8050' },
];

const TN_STREET_TYPES = ['Rue', 'Avenue', 'Boulevard', 'Impasse', 'Cité', 'Résidence'];
const TN_STREET_NAMES = [
  'de la République', 'de l\'Indépendance', 'Habib Bourguiba', 'de la Liberté',
  'de Carthage', 'du 7 Novembre', 'de la Paix', 'des Martyrs', 'de l\'Environnement',
  'Ibn Khaldoun', 'de Tunis', 'de Sfax', 'du Lac', 'des Roses', 'de l\'Olivier',
  'Farhat Hached', 'de la Médina', 'des Orangers', 'du Commerce', 'de la Jeunesse',
];

function randomTunisianAddress() {
  const { city, zip } = faker.helpers.arrayElement(TN_CITIES);
  const streetType     = faker.helpers.arrayElement(TN_STREET_TYPES);
  const streetName     = faker.helpers.arrayElement(TN_STREET_NAMES);
  const number         = faker.number.int({ min: 1, max: 200 });
  return {
    street:  `${number} ${streetType} ${streetName}`,
    city,
    zip,
    country: 'TN',
  };
}

function randomGender() {
  const r = Math.random();
  if (r < 0.48) return 'F';
  if (r < 0.96) return 'M';
  return 'other';
}

// ── User pool (70 % of sessions are recurring users) ────────────────────────
const USER_POOL = Array.from({ length: 120 }, () => {
  const personaType = faker.helpers.arrayElement(PERSONA_TYPES);
  const cfg         = PERSONA_CONFIG[personaType];
  const age         = faker.number.int({ min: cfg.ageRange[0], max: cfg.ageRange[1] });

  return {
    anonymousId: 'anon_' + crypto.randomUUID(),
    nb_visits: cfg.startVisitsRange
      ? faker.number.int({ min: cfg.startVisitsRange[0], max: cfg.startVisitsRange[1] })
      : 0,
    age,
    gender: randomGender(),
    address: randomTunisianAddress(),
    persona: personaType,
  };
});

// ── HTTP helpers ─────────────────────────────────────────────────────────
async function post(endpoint, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const res = await fetch(`${DATAPLANE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': AUTH },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return res.status;

    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) {
        console.warn(`  ⚠ POST failed after ${retries} attempts: ${err.message}`);
        return null; // ne pas crasher, continuer les sessions
      }
      console.warn(`  ↻ Attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff
    }
  }
}

async function track(event, props, anonId, ts) {
  const body = {
    anonymousId: anonId,
    event,
    properties: props,
    context: { library: { name: 'sim-bot', version: '4.0' } },
    timestamp: ts,
    sentAt: new Date().toISOString(),
  };

  // Debug: print full payload for order events so you can verify what is sent
  if (['purchase_completed', 'checkout_started', 'cart_abandon', 'checkout_abandon'].includes(event)) {
    console.log(`\n  🔍 DEBUG ${event} properties:\n` + JSON.stringify(props, null, 4));
  }

  const status = await post('/v1/track', body);
  console.log(`  📡 ${event} → ${status}`);
}

async function identify(anonId, traits, ts) {
  await post('/v1/identify', {
    anonymousId: anonId,
    traits,
    timestamp: ts,
    sentAt: new Date().toISOString(),
  });
}

// ── Générateurs aléatoires purs ──────────────────────────────────────────

function randomDevice() {
  // Distribution réaliste mobile/desktop/tablet
  const r = Math.random();
  if (r < 0.58) return { category: 'mobile',  screen: '390x844',   os: faker.helpers.arrayElement(['Android', 'iOS']) };
  if (r < 0.85) return { category: 'desktop', screen: '1920x1080', os: faker.helpers.arrayElement(['Windows', 'macOS']) };
  return           { category: 'tablet',  screen: '768x1024',  os: faker.helpers.arrayElement(['Android', 'iOS']) };
}

function randomTimestamp() {
  // Distribution horaire réelle — peak 12h et 20h
  const HOUR_WEIGHTS = [
    0.01,0.01,0.01,0.01,0.01,0.02,
    0.03,0.04,0.05,0.05,0.05,0.06,
    0.08,0.07,0.06,0.05,0.06,0.07,
    0.09,0.10,0.09,0.07,0.04,0.02,
  ];
  let r = Math.random(), hour = 0, cumul = 0;
  for (let h = 0; h < 24; h++) {
    cumul += HOUR_WEIGHTS[h];
    if (r < cumul) { hour = h; break; }
  }
  const d = new Date();
  d.setDate(d.getDate() - faker.number.int({ min: 0, max: Math.max(0, LOOKBACK_DAYS) }));
  d.setHours(hour, faker.number.int({ min: 0, max: 59 }), faker.number.int({ min: 0, max: 59 }), 0);
  return d.toISOString();
}

function randomTrafficSource() {
  return faker.helpers.weightedArrayElement([
    { weight: 0.30, value: 'direct' },
    { weight: 0.35, value: 'organic' },
    { weight: 0.20, value: 'social' },
    { weight: 0.10, value: 'email' },
    { weight: 0.05, value: 'referral' },
  ]);
}

function tsOffset(base, ms) {
  return new Date(new Date(base).getTime() + ms).toISOString();
}

// Build session probabilities from persona config
function randomProbs(user, device) {
  const cfg      = PERSONA_CONFIG[user.persona];
  const isMobile = device.category === 'mobile';
  const scale    = cfg.thinkScale;
  const r  = ([min, max]) => min + Math.random() * (max - min);
  const nb = ([min, max]) => faker.number.int({ min, max });

  return {
    bounce:             r(cfg.bounce),
    doSearch:           r(cfg.doSearch),
    nbProducts:         nb(cfg.nbProducts),
    scrollDepth:        nb(cfg.scrollDepth),
    addToCart:          r(cfg.addToCart),
    qty:                faker.helpers.arrayElement([1, 1, 1, 2, 2, 3]),
    removeFromCart:     r(cfg.removeFromCart),
    cartToCheckout:     r(cfg.cartToCheckout),
    checkoutToPurchase: r(cfg.checkoutToPurchase),
    paymentMethod:      faker.helpers.arrayElement(cfg.preferredPayment),
    thinkHome:    Math.round(faker.number.int({ min: 500,  max: isMobile ? 4000  : 10000 }) * scale),
    thinkProduct: Math.round(faker.number.int({ min: 800,  max: isMobile ? 6000  : 20000 }) * scale),
    thinkCart:    Math.round(faker.number.int({ min: 300,  max: isMobile ? 3000  : 8000  }) * scale),
    maxPrice:     nb(cfg.maxPriceRange),
    categories:   faker.helpers.arrayElements(cfg.categories, nb([1, Math.min(3, cfg.categories.length)])),
    goBack:       0.10 + Math.random() * 0.50,
    browseCart:   0.05 + Math.random() * 0.20,
    promoPage:    r(cfg.promoPage),
  };
}

function roll(prob) { return Math.random() < prob; }

// ── Order helpers ────────────────────────────────────────────────────────────

const TN_CARRIERS          = ['Rapid-Post', 'Aramex TN', 'DHL Tunisia', 'FedEx', 'Colissimo', 'MTPS'];
const SHIPPING_METHODS     = ['standard', 'express', 'relay_point', 'click_and_collect'];
const FULFILLMENT_CENTERS  = ['Tunis', 'Sfax', 'Sousse', 'Bizerte', 'Monastir'];
const CART_ABANDON_REASONS = ['distracted', 'just_browsing', 'waiting_for_payday', 'comparison_shopping', 'shipping_too_expensive'];
const CHECKOUT_ABANDON_REASONS = ['price_too_high', 'changed_mind', 'found_better_deal', 'not_ready_to_buy', 'payment_declined', 'complicated_checkout'];

function paymentProvider(method) {
  return { card: 'Stripe', paypal: 'PayPal', cash_on_delivery: 'COD', bank_transfer: 'BankTransfer TN' }[method] || method;
}

function buildOrderPayload(cartItems, user, probs, orderTs) {
  const rawSubtotal    = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const usedPromo      = roll(probs.promoPage > 0.4 ? 0.50 : 0.15);
  const promoCode      = usedPromo ? `PROMO${faker.string.alphanumeric(5).toUpperCase()}` : null;
  const discountPct    = usedPromo ? faker.helpers.arrayElement([5, 10, 15, 20]) : 0;
  const discountTotal  = parseFloat((rawSubtotal * discountPct / 100).toFixed(2));
  const subtotal       = parseFloat((rawSubtotal - discountTotal).toFixed(2));
  const shippingCost   = parseFloat(faker.commerce.price({ min: 3, max: 15, dec: 2 }));
  const TAX_RATE       = 0.19; // TVA standard Tunisie
  const taxAmount      = parseFloat((subtotal * TAX_RATE).toFixed(2));
  const total          = parseFloat((subtotal + shippingCost + taxAmount).toFixed(2));
  const shippingMethod = faker.helpers.arrayElement(SHIPPING_METHODS);
  const carrier        = faker.helpers.arrayElement(TN_CARRIERS);
  const deliveryDays   = shippingMethod === 'express' ? [1, 2] : [3, 7];
  const estimatedDelivery = new Date(
    new Date(orderTs).getTime() + faker.number.int({ min: deliveryDays[0], max: deliveryDays[1] }) * 86_400_000
  ).toISOString();

  const orderLines = cartItems.map(i => ({
    product_id:   i.product_id,
    product_name: i.product_name,
    category:     i.category,
    price:        i.price,
    quantity:     i.quantity,
    subtotal:     parseFloat((i.price * i.quantity).toFixed(2)),
  }));

  const addressStr = `${user.address.street}, ${user.address.zip} ${user.address.city}, TN`;
  const orderId    = 'ord_' + faker.string.alphanumeric(10);

  return {
    orders:            cartItems,
    order_description: {
      order_id:              orderId,
      order_datetime:        orderTs,
      currency:              'TND',
      subtotal,
      shipping_cost:         shippingCost,
      tax_rate:              TAX_RATE,
      tax_amount:            taxAmount,
      discount_total:        discountTotal,
      total,
      used_promo:            usedPromo,
      promo_code:            promoCode,
      items_count:           cartItems.length,
      unique_products_count: new Set(cartItems.map(i => i.product_id)).size,
      categories:            [...new Set(cartItems.map(i => i.category))],
      order_lines:           orderLines,
      payment_method:        probs.paymentMethod,
      payment_provider:      paymentProvider(probs.paymentMethod),
      shipping_method:       shippingMethod,
      carrier,
      shipping_address:      addressStr,
      billing_address:       addressStr,
      fulfillment_center:    faker.helpers.arrayElement(FULFILLMENT_CENTERS),
      estimated_delivery:    estimatedDelivery,
      installments:          faker.helpers.weightedArrayElement([
        { weight: 0.70, value: 1 },
        { weight: 0.20, value: 3 },
        { weight: 0.10, value: 6 },
      ]),
      customer_snapshot: {
        age:       user.age,
        gender:    user.gender,
        persona:   user.persona,
        nb_visits: user.nb_visits,
      },
    },
  };
}

// ── Session simulation ───────────────────────────────────────────────────────

async function simulateSession(site, user) {
  const sessionTs     = randomTimestamp();
  const sessionId     = 'sess_' + crypto.randomUUID();
  const cfg           = PERSONA_CONFIG[user.persona];
  const device        = randomDevice(cfg);
  const loggedIn      = roll(user.nb_visits > 5 ? 0.75 : 0.30);
  const trafficSource = randomTrafficSource();

  user.nb_visits++;

  const probs = randomProbs(user, device);

  // Identify call with full traits (including address)
  await identify(user.anonymousId, {
    age:       user.age,
    gender:    user.gender,
    address:   user.address,
    persona:   user.persona,
    loggedIn,
    nb_visits: user.nb_visits,
    device,
  }, sessionTs);

  let pageCount = 0;
  const sequence = [];
  let ms = 0;
  const base = (page_type, url) => ({
    session_id:      sessionId,
    page_url:        url || site,
    page_type,
    domain:          new URL(site).hostname,
    device_category: device.category,
    device_os:       device.os,
    screen:          device.screen,
    traffic_source:    trafficSource,
    logged_in:       loggedIn,
    nb_visits:       user.nb_visits,
    age:             user.age,
    gender:          user.gender,
    user_address:      `${user.address.street}, ${user.address.zip} ${user.address.city}, ${user.address.country}`,
    persona:           user.persona,
    pages_per_session: ++pageCount,
    timestamp:       tsOffset(sessionTs, ms),
  });

  // ── Page d'accueil ───────────────────────────────────────────────────
  await track('page_view', base('home', site), user.anonymousId, tsOffset(sessionTs, ms));
  sequence.push('home');

  // Scroll home
  await track('scroll_depth', {
    ...base('home', site, ms + 2000),
    depth_pct: faker.number.int({ min: 10, max: 60 }),
  }, user.anonymousId, tsOffset(sessionTs, ms + 2000));

  // ── Bounce immédiat ──────────────────────────────────────────────────
  if (roll(probs.bounce)) {
    const bounceSec = faker.number.int({ min: 1, max: 12 });
    ms += bounceSec * 1000;
    await track('page_engagement', {
      ...base('home', site, ms),
      duration:          bounceSec,
      max_scroll_pct:   faker.number.int({ min: 0, max: 25 }),
      click_count:      0,
      is_bounce:        true,
      cart_abandoned:   false,
      sequence_summary:  sequence.join(' → '),
      order_description: null,
      orders:            0,
    }, user.anonymousId, tsOffset(sessionTs, ms));
    console.log(`  ↩ bounce after ${bounceSec}s`);
    return sequence;
  }

  ms += probs.thinkHome;

  // ── Page promo (optionnel) ───────────────────────────────────────────
  if (roll(probs.promoPage)) {
    const promoUrl = `${site}/promo`;
    await track('page_view',    { ...base('promo', promoUrl, ms) }, user.anonymousId, tsOffset(sessionTs, ms));
    await track('promo_viewed', { ...base('promo', promoUrl, ms), promo_url: promoUrl }, user.anonymousId, tsOffset(sessionTs, ms));
    sequence.push('promo');
    ms += faker.number.int({ min: 1000, max: 4000 });
  }

  // ── Recherche ────────────────────────────────────────────────────────
  if (roll(probs.doSearch)) {
    const category = faker.helpers.arrayElement(probs.categories);
    const query    = `${category} ${faker.commerce.productAdjective()}`.toLowerCase();
    await track('search_performed', {
      ...base('search', `${site}/search?q=${encodeURIComponent(query)}`),
      query,
      category,
    }, user.anonymousId, tsOffset(sessionTs, ms));
    sequence.push('search');
    ms += faker.number.int({ min: 500, max: 2500 });
  }

  // ── Produits ─────────────────────────────────────────────────────────
  const cartItems = [];

  for (let i = 0; i < probs.nbProducts; i++) {
    const category   = faker.helpers.arrayElement(probs.categories);
    const price      = parseFloat(faker.commerce.price({ min: 5, max: probs.maxPrice }));
    const product    = {
      product_id:   faker.string.uuid(),
      product_name: faker.commerce.productName(),
      price,
      category,
    };
    const productUrl = `${site}/product/${faker.string.alphanumeric(8)}`;

    await track('product_view', {
      ...base('product', productUrl, ms),
      ...product,
    }, user.anonymousId, tsOffset(sessionTs, ms));
    sequence.push('product_view');

    ms += probs.thinkProduct;

    // Scroll produit
    await track('scroll_depth', {
      ...base('product', productUrl, ms),
      depth_pct: probs.scrollDepth,
    }, user.anonymousId, tsOffset(sessionTs, ms));

    // Add to cart
    if (roll(probs.addToCart)) {
      const qty = probs.qty;
      cartItems.push({ ...product, quantity: qty });
      await track('add_to_cart', {
        ...base('product', productUrl, ms),
        ...product,
        quantity: qty,
      }, user.anonymousId, tsOffset(sessionTs, ms));
      sequence.push('add_to_cart');
      ms += faker.number.int({ min: 300, max: 1200 });

      // Remove from cart
      if (roll(probs.removeFromCart) && cartItems.length > 0) {
        cartItems.pop();
        await track('remove_from_cart', {
          ...base('cart', `${site}/cart`, ms),
          ...product,
          quantity: qty,
        }, user.anonymousId, tsOffset(sessionTs, ms));
        sequence.push('remove_from_cart');
        ms += 300;
      }
    }

    // Retour en arrière aléatoire
    if (i < probs.nbProducts - 1 && roll(probs.goBack)) {
      await track('page_view', {
        ...base('category', `${site}/category/${category}`, ms),
      }, user.anonymousId, tsOffset(sessionTs, ms));
      ms += faker.number.int({ min: 400, max: 1500 });
    }
  }

  // ── Visite panier sans intention d'achat ─────────────────────────────
  if (roll(probs.browseCart) && cartItems.length === 0) {
    await track('page_view', {
      ...base('cart', `${site}/cart`, ms),
    }, user.anonymousId, tsOffset(sessionTs, ms));
    sequence.push('cart_browse');
    ms += faker.number.int({ min: 500, max: 2000 });
  }

  // ── Checkout flow ────────────────────────────────────────────────────
  let cartAbandoned = false;

  if (cartItems.length > 0) {
    await track('page_view', {
      ...base('cart', `${site}/cart`, ms),
    }, user.anonymousId, tsOffset(sessionTs, ms));
    sequence.push('cart_view');
    ms += probs.thinkCart;

    if (roll(probs.cartToCheckout)) {
      const checkoutPayload = buildOrderPayload(cartItems, user, probs, tsOffset(sessionTs, ms));

      await track('checkout_started', {
        ...base('checkout', `${site}/checkout`),
        ...checkoutPayload,
        checkout_step_reached:   faker.helpers.arrayElement(['address', 'shipping', 'payment']),
        order_status:            'pending',
        payment_status:          'pending',
        recovery_email_eligible: false,
      }, user.anonymousId, tsOffset(sessionTs, ms));
      sequence.push('checkout');
      ms += faker.number.int({ min: 3000, max: 12000 });

      if (roll(probs.checkoutToPurchase)) {
        const purchasePayload = buildOrderPayload(cartItems, user, probs, tsOffset(sessionTs, ms));
        await track('purchase_completed', {
          ...base('checkout', `${site}/order-confirm`),
          ...purchasePayload,
          order_status:            'confirmed',
          payment_status:          'paid',
          transaction_id:          'txn_' + faker.string.alphanumeric(12),
          tracking_number:         'TRK' + faker.string.alphanumeric(10).toUpperCase(),
          checkout_step_reached:   'payment',
          loyalty_points_earned:   Math.round(purchasePayload.order_description.total),
          is_first_order:          user.nb_visits === 1,
          recovery_email_eligible: false,
          abandon_reason:          null,
        }, user.anonymousId, tsOffset(sessionTs, ms));
        sequence.push('purchase');
      } else {
        cartAbandoned = true;
        const abandonPayload = buildOrderPayload(cartItems, user, probs, tsOffset(sessionTs, ms));
        await track('checkout_abandon', {
          ...base('checkout', `${site}/checkout`),
          ...abandonPayload,
          order_status:            'abandoned',
          payment_status:          'pending',
          checkout_step_reached:   faker.helpers.arrayElement(['address', 'shipping', 'payment']),
          abandon_reason:          faker.helpers.arrayElement(CHECKOUT_ABANDON_REASONS),
          recovery_email_eligible: roll(0.70),
          is_first_order:          user.nb_visits === 1,
          loyalty_points_earned:   0,
        }, user.anonymousId, tsOffset(sessionTs, ms));
        sequence.push('checkout_abandon');
      }
    } else {
      cartAbandoned = true;
      const abandonPayload = buildOrderPayload(cartItems, user, probs, tsOffset(sessionTs, ms));
      await track('cart_abandon', {
        ...base('cart', `${site}/cart`),
        ...abandonPayload,
        order_status:            'abandoned',
        payment_status:          'none',
        checkout_step_reached:   'cart',
        abandon_reason:          faker.helpers.arrayElement(CART_ABANDON_REASONS),
        recovery_email_eligible: roll(0.50),
        is_first_order:          user.nb_visits === 1,
        loyalty_points_earned:   0,
      }, user.anonymousId, tsOffset(sessionTs, ms));
      sequence.push('cart_abandon');
    }
  }

  // ── Engagement final ─────────────────────────────────────────────────
  await track('page_engagement', {
    ...base('session_end', site),
    duration:          Math.round(ms / 1000),
    max_scroll_pct:    probs.scrollDepth,
    click_count:       faker.number.int({ min: 1, max: 30 }),
    is_bounce:         false,
    cart_abandoned:    cartAbandoned,
    sequence_summary:  sequence.join(' → '),
    order_description: null,
    orders:            0,
  }, user.anonymousId, tsOffset(sessionTs, ms));

  return sequence;
}

// ── Runner ────────────────────────────────────────────────────────────────

const SITES = [
  'https://www.mytek.tn',
  'https://www.jumia.com.tn',
  'https://www.amazon.fr',
  'https://www.zalando.fr',
  'https://www.aliexpress.com',
];

(async () => {
  const personaCounts = Object.fromEntries(PERSONA_TYPES.map(p => [p, 0]));

  console.log(`🚀 Generating ${TOTAL} sessions (LOOKBACK_DAYS=${LOOKBACK_DAYS})\n`);
  console.log('Personas:', PERSONA_TYPES.map(p => PERSONA_CONFIG[p].label).join(', '), '\n');

  for (let i = 0; i < TOTAL; i++) {
    // 70% user récurrent du pool, 30% nouveau visiteur
    const user = Math.random() < 0.70
      ? USER_POOL[Math.floor(Math.random() * USER_POOL.length)]
      : (() => {
          const personaType = faker.helpers.arrayElement(PERSONA_TYPES);
          const cfg         = PERSONA_CONFIG[personaType];
          return {
          anonymousId: 'anon_' + crypto.randomUUID(),
          nb_visits: 0,
          age:    faker.number.int({ min: cfg.ageRange[0], max: cfg.ageRange[1] }),
          gender:      randomGender(),
          address: {           
              ...randomTunisianAddress(),
            },
            persona: personaType,
        };
      })();
    personaCounts[user.persona]++;
    const site = faker.helpers.arrayElement(SITES);
    const seq  = await simulateSession(site, user);
    const host = new URL(site).hostname.padEnd(22);
    const persona = PERSONA_CONFIG[user.persona].label.padEnd(22);
    console.log(`[${String(i + 1).padStart(3)}/${TOTAL}] ${host} | ${persona} | ${seq.join(' → ')}\n`);

    await new Promise(r => setTimeout(r, faker.number.int({ min: 80, max: 300 })));
  }

  console.log('✅ Done');
  console.log('\nPersona distribution:');
  for (const [type, count] of Object.entries(personaCounts)) {
    const pct = ((count / TOTAL) * 100).toFixed(1);
    console.log(`  ${PERSONA_CONFIG[type].label.padEnd(22)} ${String(count).padStart(4)} sessions (${pct}%)`);
  }
})();