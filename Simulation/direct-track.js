// bot/direct-track-random.js
import { faker } from '@faker-js/faker';

const WRITE_KEY = '3BtgnG9O19EIKEJptG1h4k9Nps6';
const DATAPLANE = "https://insatrefkarbfv.dataplane.rudderstack.com";
const AUTH      = 'Basic ' + Buffer.from(WRITE_KEY + ':').toString('base64');
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 0);
const TOTAL = Number(process.env.TOTAL ?? 300);

// ── Pool d'users récurrents (70% des sessions) ───────────────────────────
const USER_POOL = Array.from({ length: 100 }, () => ({
  anonymousId: 'anon_' + crypto.randomUUID(),
  nb_visits: 0,
  // profil figé pour cet user
  age:    faker.number.int({ min: 16, max: 72 }),
  gender: faker.helpers.arrayElement(['M', 'F', 'other']),
  address: { city: faker.location.city(), country: faker.location.countryCode() },
}));

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
  const status = await post('/v1/track', {
    anonymousId: anonId,
    event,
    properties: props,
    context: { library: { name: 'sim-bot', version: '3.0' } },
    timestamp: ts,
    sentAt: new Date().toISOString(),
  });
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
  d.setHours(hour, faker.number.int({min:0,max:59}), faker.number.int({min:0,max:59}), 0);
  return d.toISOString();
}

function tsOffset(base, ms) {
  return new Date(new Date(base).getTime() + ms).toISOString();
}

// Toutes les probabilités sont tirées indépendamment — aucun persona
function randomProbs(age, device) {
  const isMobile  = device.category === 'mobile';
  const isOlder   = age > 45;
  const isYoung   = age < 25;

  return {
    // Mobile → bounce plus fréquent
    bounce:             rand(0.05, isMobile ? 0.45 : 0.25),
    // Jeunes → plus impulsifs sur la recherche
    doSearch:           rand(isYoung ? 0.75 : 0.60, 0.99),
    // Nombre de produits vus
    nbProducts:         faker.number.int({ min: 1, max: isMobile ? 5 : 8 }),
    // Scroll plus profond sur desktop
    scrollDepth:        faker.number.int({ min: 15, max: isMobile ? 70 : 100 }),
    // Add to cart
    addToCart:          rand(0.10, isOlder ? 0.50 : 0.70),
    // Quantité
    qty:                weighted([1,1,1,2,2,3]),
    // Remove from cart
    removeFromCart:     rand(0.05, 0.40),
    // Cart → checkout
    cartToCheckout:     rand(0.20, 0.85),
    // Checkout → purchase
    checkoutToPurchase: rand(0.30, 0.95),
    // Payment method
    paymentMethod:      faker.helpers.arrayElement(['card','paypal','cash_on_delivery','bank_transfer']),
    // Think time en ms — mobile plus rapide
    thinkHome:    faker.number.int({ min: 500,  max: isMobile ? 4000  : 10000 }),
    thinkProduct: faker.number.int({ min: 800,  max: isMobile ? 6000  : 20000 }),
    thinkCart:    faker.number.int({ min: 300,  max: isMobile ? 3000  : 8000  }),
    // Prix max que cet user est prêt à payer
    maxPrice:     faker.number.int({ min: 15, max: isOlder ? 800 : 350 }),
    // Catégories d'intérêt (tirage libre)
    categories: faker.helpers.arrayElements(
      ['Electronics','Fashion','Beauty','Home','Sports','Books','Toys','Food','Tools','Gaming'],
      faker.number.int({ min: 1, max: 3 })
    ),
    // Retours en arrière dans la navigation
    goBack: rand(0.10, 0.60),
    // Visite le panier sans ajouter
    browseCart: rand(0.05, 0.25),
    // Utilise promo/discount
    promoPage: rand(0.05, 0.30),
  };
}

// Helpers probabilistes
function rand(min, max) { return min + Math.random() * (max - min); }
function weighted(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }
function roll(prob)     { return Math.random() < prob; }

// ── Session principale ────────────────────────────────────────────────────

async function simulateSession(site, user) {
  const sessionTs = randomTimestamp();
  const sessionId = 'sess_' + crypto.randomUUID();
  const device    = randomDevice();
  const loggedIn  = roll(user.nb_visits > 5 ? 0.7 : 0.3);
  user.nb_visits++;

  const probs = randomProbs(user.age, device);

  // Identify
  await identify(user.anonymousId, {
    age:      user.age,
    gender:   user.gender,
    address:  user.address,
    loggedIn,
    nb_visits: user.nb_visits,
    device,
  }, sessionTs);

  // Helper base properties
  const base = (page_type, url, ms = 0) => ({
    session_id:      sessionId,
    page_url:        url || site,
    page_type,
    domain:          new URL(site).hostname,
    device_category: device.category,
    device_os:       device.os,
    screen:          device.screen,
    loggedIn,
    nb_visits:       user.nb_visits,
    age:             user.age,
    gender:          user.gender,
    timestamp:       tsOffset(sessionTs, ms),
  });

  let ms = 0;
  const sequence = [];

  // ── Page d'accueil ───────────────────────────────────────────────────
  await track('page_view', base('home', site, ms), user.anonymousId, tsOffset(sessionTs, ms));
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
      time_on_page_sec: bounceSec,
      max_scroll_pct:   faker.number.int({ min: 0, max: 25 }),
      click_count:      0,
      is_bounce:        true,
      cart_abandoned:   false,
      pages_per_session: 1,
      sequence:         'home → bounce',
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
      ...base('search', `${site}/search?q=${encodeURIComponent(query)}`, ms),
      query,
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
      const total = cartItems.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2);
      await track('checkout_started', {
        ...base('checkout', `${site}/checkout`, ms),
        cart_items:  cartItems,
        total,
        nb_items:    cartItems.length,
      }, user.anonymousId, tsOffset(sessionTs, ms));
      sequence.push('checkout');
      ms += faker.number.int({ min: 3000, max: 12000 });

      if (roll(probs.checkoutToPurchase)) {
        await track('purchase_completed', {
          ...base('checkout', `${site}/order-confirm`, ms),
          order_id:    'ord_' + faker.string.alphanumeric(10),
          orders:      cartItems,
          order_description: cartItems.map(i => ({
            name:     i.product_name,
            price:    i.price,
            qty:      i.quantity,
            category: i.category,
          })),
          total,
          payment_method: probs.paymentMethod,
        }, user.anonymousId, tsOffset(sessionTs, ms));
        sequence.push('purchase');
      } else {
        cartAbandoned = true;
        sequence.push('checkout_abandon');
      }
    } else {
      cartAbandoned = true;
      sequence.push('cart_abandon');
    }
  }

  // ── Engagement final ─────────────────────────────────────────────────
  await track('page_engagement', {
    ...base('session_end', site, ms),
    time_on_page_sec:  Math.round(ms / 1000),
    max_scroll_pct:    probs.scrollDepth,
    click_count:       faker.number.int({ min: 1, max: 30 }),
    is_bounce:         false,
    cart_abandoned:    cartAbandoned,
    pages_per_session: sequence.length,
    sequence:          sequence.join(' → '),
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
  console.log(`🚀 Generating ${TOTAL} random sessions (LOOKBACK_DAYS=${LOOKBACK_DAYS})...\n`);

  for (let i = 0; i < TOTAL; i++) {
    // 70% user récurrent du pool, 30% nouveau visiteur
    const user = Math.random() < 0.70
      ? USER_POOL[Math.floor(Math.random() * USER_POOL.length)]
      : {
          anonymousId: 'anon_' + crypto.randomUUID(),
          nb_visits: 0,
          age:    faker.number.int({ min: 16, max: 72 }),
          gender: faker.helpers.arrayElement(['M', 'F', 'other']),
          address: { city: faker.location.city(), country: faker.location.countryCode() },
        };

    const site = faker.helpers.arrayElement(SITES);
    const seq  = await simulateSession(site, user);
    console.log(`[${i+1}/${TOTAL}] ${new URL(site).hostname.padEnd(22)} | ${seq.join(' → ')}\n`);

    await new Promise(r => setTimeout(r, faker.number.int({ min: 80, max: 300 })));
  }

  console.log('✅ Done');
})();