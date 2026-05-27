import type {
  ActionChannel,
  ActionType,
  ActionUrgency,
  DecisionRecord,
  Persona,
  Sentiment,
} from '../types/api'

function ts(days: number, hours = 0, minutes = 0): string {
  const ms = Date.now() - (days * 86_400_000 + hours * 3_600_000 + minutes * 60_000)
  return new Date(ms).toISOString()
}

const USER_PROFILES: Record<string, Record<string, unknown>> = {
  'USR-001': { rfm_score: 4, recency_days: 3, frequency: 12, monetary: 1450, avg_scroll_depth: 0.72, avg_clicks: 8, bounce_rate: 0.22, avg_session_duration: 340, checkout_rate: 0.31, purchase_rate: 0.24, cart_abandonment_rate: 0.38, max_funnel_depth: 4, device_mode: 'desktop', region: 'Paris', preferred_source: 'email', age: 34, gender: 'F' },
  'USR-002': { rfm_score: 5, recency_days: 1, frequency: 24, monetary: 3200, avg_scroll_depth: 0.85, avg_clicks: 14, bounce_rate: 0.12, avg_session_duration: 520, checkout_rate: 0.45, purchase_rate: 0.38, cart_abandonment_rate: 0.19, max_funnel_depth: 5, device_mode: 'mobile', region: 'Lyon', preferred_source: 'organic', age: 29, gender: 'M' },
  'USR-003': { rfm_score: 3, recency_days: 18, frequency: 6, monetary: 680, avg_scroll_depth: 0.51, avg_clicks: 5, bounce_rate: 0.41, avg_session_duration: 190, checkout_rate: 0.18, purchase_rate: 0.12, cart_abandonment_rate: 0.55, max_funnel_depth: 3, device_mode: 'desktop', region: 'Marseille', preferred_source: 'social', age: 41, gender: 'M' },
  'USR-004': { rfm_score: 5, recency_days: 2, frequency: 31, monetary: 5600, avg_scroll_depth: 0.91, avg_clicks: 18, bounce_rate: 0.08, avg_session_duration: 640, checkout_rate: 0.52, purchase_rate: 0.47, cart_abandonment_rate: 0.14, max_funnel_depth: 5, device_mode: 'desktop', region: 'Paris', preferred_source: 'email', age: 38, gender: 'F' },
  'USR-005': { rfm_score: 2, recency_days: 45, frequency: 3, monetary: 280, avg_scroll_depth: 0.32, avg_clicks: 3, bounce_rate: 0.62, avg_session_duration: 95, checkout_rate: 0.08, purchase_rate: 0.05, cart_abandonment_rate: 0.74, max_funnel_depth: 2, device_mode: 'mobile', region: 'Bordeaux', preferred_source: 'paid', age: 52, gender: 'F' },
  'USR-006': { rfm_score: 5, recency_days: 1, frequency: 28, monetary: 4900, avg_scroll_depth: 0.88, avg_clicks: 16, bounce_rate: 0.09, avg_session_duration: 580, checkout_rate: 0.49, purchase_rate: 0.42, cart_abandonment_rate: 0.16, max_funnel_depth: 5, device_mode: 'tablet', region: 'Nice', preferred_source: 'direct', age: 33, gender: 'M' },
  'USR-007': { rfm_score: 4, recency_days: 5, frequency: 15, monetary: 1890, avg_scroll_depth: 0.78, avg_clicks: 11, bounce_rate: 0.26, avg_session_duration: 420, checkout_rate: 0.36, purchase_rate: 0.29, cart_abandonment_rate: 0.32, max_funnel_depth: 4, device_mode: 'mobile', region: 'Toulouse', preferred_source: 'organic', age: 27, gender: 'M' },
  'USR-008': { rfm_score: 3, recency_days: 12, frequency: 8, monetary: 920, avg_scroll_depth: 0.63, avg_clicks: 7, bounce_rate: 0.35, avg_session_duration: 240, checkout_rate: 0.22, purchase_rate: 0.16, cart_abandonment_rate: 0.48, max_funnel_depth: 3, device_mode: 'desktop', region: 'Nantes', preferred_source: 'email', age: 45, gender: 'F' },
  'USR-009': { rfm_score: 4, recency_days: 4, frequency: 17, monetary: 2100, avg_scroll_depth: 0.81, avg_clicks: 12, bounce_rate: 0.19, avg_session_duration: 390, checkout_rate: 0.38, purchase_rate: 0.31, cart_abandonment_rate: 0.28, max_funnel_depth: 4, device_mode: 'mobile', region: 'Strasbourg', preferred_source: 'social', age: 31, gender: 'F' },
  'USR-010': { rfm_score: 1, recency_days: 72, frequency: 1, monetary: 90, avg_scroll_depth: 0.21, avg_clicks: 2, bounce_rate: 0.78, avg_session_duration: 45, checkout_rate: 0.03, purchase_rate: 0.01, cart_abandonment_rate: 0.88, max_funnel_depth: 1, device_mode: 'mobile', region: 'Rennes', preferred_source: 'paid', age: 23, gender: 'M' },
  'USR-011': { rfm_score: 2, recency_days: 30, frequency: 4, monetary: 350, avg_scroll_depth: 0.42, avg_clicks: 4, bounce_rate: 0.55, avg_session_duration: 140, checkout_rate: 0.11, purchase_rate: 0.07, cart_abandonment_rate: 0.67, max_funnel_depth: 2, device_mode: 'desktop', region: 'Lille', preferred_source: 'organic', age: 37, gender: 'F' },
  'USR-012': { rfm_score: 4, recency_days: 6, frequency: 14, monetary: 1720, avg_scroll_depth: 0.76, avg_clicks: 10, bounce_rate: 0.24, avg_session_duration: 360, checkout_rate: 0.34, purchase_rate: 0.27, cart_abandonment_rate: 0.35, max_funnel_depth: 4, device_mode: 'tablet', region: 'Montpellier', preferred_source: 'email', age: 43, gender: 'M' },
  'USR-013': { rfm_score: 3, recency_days: 14, frequency: 9, monetary: 1050, avg_scroll_depth: 0.58, avg_clicks: 6, bounce_rate: 0.38, avg_session_duration: 210, checkout_rate: 0.20, purchase_rate: 0.14, cart_abandonment_rate: 0.51, max_funnel_depth: 3, device_mode: 'mobile', region: 'Grenoble', preferred_source: 'social', age: 26, gender: 'F' },
  'USR-014': { rfm_score: 5, recency_days: 1, frequency: 35, monetary: 6800, avg_scroll_depth: 0.93, avg_clicks: 21, bounce_rate: 0.06, avg_session_duration: 720, checkout_rate: 0.55, purchase_rate: 0.51, cart_abandonment_rate: 0.11, max_funnel_depth: 5, device_mode: 'desktop', region: 'Paris', preferred_source: 'direct', age: 48, gender: 'M' },
  'USR-015': { rfm_score: 3, recency_days: 9, frequency: 11, monetary: 1280, avg_scroll_depth: 0.67, avg_clicks: 8, bounce_rate: 0.31, avg_session_duration: 280, checkout_rate: 0.26, purchase_rate: 0.19, cart_abandonment_rate: 0.43, max_funnel_depth: 3, device_mode: 'mobile', region: 'Bordeaux', preferred_source: 'organic', age: 35, gender: 'M' },
}

const INTENT_CATEGORIES: Record<ActionType, string> = {
  upsell: 'revenue_expansion',
  scarcity_push: 'urgency_conversion',
  exit_overlay: 'cart_recovery',
  price_nudge: 'price_optimization',
  welcome_offer: 'acquisition',
  early_access: 'loyalty',
  referral: 'advocacy',
  review_ask: 'social_proof',
  nurture_email: 'engagement',
  apology_offer: 'churn_recovery',
  chatbot_fix: 'support_recovery',
  chatbot_guide: 'guided_conversion',
  human_call: 'high_touch_retention',
  trust_signals: 'friction_reduction',
  survey: 'voice_of_customer',
}

function mkRecord(
  id: string,
  userId: string,
  persona: Persona,
  sentiment: Sentiment,
  actionType: ActionType,
  channel: ActionChannel,
  urgency: ActionUrgency,
  confidence: number,
  converted: boolean,
  description: string,
  reasoning: string,
  recommendation: string,
  created_at: string,
): DecisionRecord {
  const profile = USER_PROFILES[userId] ?? USER_PROFILES['USR-001']
  const trigger = `${persona.toLowerCase().replace(/ /g, '_')}_${sentiment.toLowerCase()}_${actionType}`
  const adj1 = Math.max(0.1, confidence - 0.05)
  const adj2 = Math.max(0.1, confidence - 0.02)

  return {
    id,
    decision_id: id,
    user_id: userId,
    persona,
    sentiment,
    action_type: actionType,
    channel,
    urgency,
    confidence,
    converted,
    description,
    reasoning,
    recommendation,
    created_at,
    updated_at: created_at,
    status: converted ? 'completed' : 'pending',
    action: { action_type: actionType, channel, urgency, description, trigger_cond: trigger },
    agent1: {
      record_id: id,
      intent: { label: actionType, category: INTENT_CATEGORIES[actionType], confidence: adj1 },
      sentiment: {
        label: sentiment,
        value: sentiment === 'Positive' ? 0.82 : sentiment === 'Neutral' ? 0.51 : 0.21,
        confidence: adj1,
      },
      confidence: adj1,
      churn_risk: urgency === 'critical' || urgency === 'high' ? 'high' : urgency === 'medium' ? 'medium' : 'low',
    },
    agent2: {
      persona,
      sentiment,
      action_type: actionType,
      channel,
      urgency,
      description,
      confidence: adj2,
      reasoning,
      recommendation,
    },
    agent3_output: {
      user_id: userId,
      persona,
      sentiment,
      action: { action_type: actionType, channel, urgency, description, trigger_cond: trigger },
      confidence,
      reasoning,
      recommendation,
      created_at,
      status: converted ? 'completed' : 'pending',
    },
    user_meta: profile,
  }
}

export const MOCK_DECISIONS: DecisionRecord[] = [
  // ── VIP · Positive (critical) ─────────────────────────────────────────
  mkRecord('d001', 'USR-001', 'VIP', 'Positive', 'upsell', 'email', 'critical', 0.94, true,
    "Exclusive Premium Upgrade – Limited Offer Just for You",
    "VIP user with high LTV showing strong purchase intent. Recent checkout completion and high frequency signals peak engagement window.",
    "Trigger upsell email within 1 hour with exclusive bundle pricing.",
    ts(0, 1)),

  mkRecord('d002', 'USR-002', 'VIP', 'Positive', 'early_access', 'email', 'critical', 0.91, true,
    "You're First: Early Access to Our New Collection",
    "VIP with 95th percentile spend, browsing new arrivals. Immediate action maximises conversion probability.",
    "Send early access campaign with 48-hour window before public launch.",
    ts(0, 2)),

  mkRecord('d044', 'USR-014', 'VIP', 'Positive', 'upsell', 'email', 'high', 0.92, true,
    "Upgrade Your Experience – Premium Bundle Available",
    "VIP user with exceptional spend history. Upsell affinity score is 88%.",
    "Send premium bundle offer with exclusive VIP pricing.",
    ts(3, 4)),

  mkRecord('d053', 'USR-009', 'VIP', 'Positive', 'referral', 'email', 'high', 0.90, true,
    "Your Exclusive Referral Reward is Ready",
    "VIP user with strong social influence score. Referral programme ROI is maximised for this segment.",
    "Send VIP referral invitation with enhanced reward structure.",
    ts(7, 2)),

  // ── VIP · Neutral ─────────────────────────────────────────────────────
  mkRecord('d003', 'USR-006', 'VIP', 'Neutral', 'review_ask', 'email', 'medium', 0.82, true,
    "Share Your Experience – Your Opinion Matters",
    "High-value customer with 12 completed orders, no reviews submitted. Social proof opportunity is high.",
    "Send personalised review request highlighting their most recent purchase.",
    ts(1, 3)),

  mkRecord('d004', 'USR-004', 'VIP', 'Neutral', 'referral', 'email', 'high', 0.88, true,
    "Refer a Friend – Earn Exclusive Rewards",
    "VIP user with strong network engagement signals. Referral programmes yield 3× ROI for this segment.",
    "Launch referral incentive with tiered reward structure.",
    ts(2, 0)),

  mkRecord('d049', 'USR-012', 'VIP', 'Neutral', 'survey', 'email', 'medium', 0.80, false,
    "Exclusive VIP Insights Survey",
    "VIP engagement dropped 15% in last quarter. Understanding evolving preferences is critical.",
    "Send exclusive VIP survey with premium gift incentive for completion.",
    ts(8, 0)),

  // ── VIP · Negative (urgent) ───────────────────────────────────────────
  mkRecord('d005', 'USR-004', 'VIP', 'Negative', 'apology_offer', 'email', 'critical', 0.96, false,
    "We're Sorry – Here's Something Special for You",
    "VIP customer filed a complaint 2 days ago. NPS dropped sharply. Churn probability at 78%. Immediate recovery action needed.",
    "Deploy personal apology with 30% discount and free expedited shipping on next order.",
    ts(0, 0, 30)),

  mkRecord('d006', 'USR-006', 'VIP', 'Negative', 'human_call', 'alert', 'critical', 0.93, false,
    "Priority Customer Recovery – Escalate to Senior Agent",
    "VIP user showing exit intent after two failed checkout attempts. High LTV at risk.",
    "Escalate to senior support agent for immediate phone outreach.",
    ts(0, 0, 45)),

  mkRecord('d057', 'USR-014', 'VIP', 'Negative', 'human_call', 'alert', 'critical', 0.95, false,
    "VIP Recovery: Immediate Escalation Required",
    "VIP customer with €5 800 LTV showing critical churn signals. Three support escalations in 7 days.",
    "Immediate escalation to dedicated VIP success manager.",
    ts(0, 0, 15)),

  // ── High Intent · Positive ────────────────────────────────────────────
  mkRecord('d007', 'USR-007', 'High Intent', 'Positive', 'scarcity_push', 'overlay', 'high', 0.89, true,
    "Only 3 Left – Grab Yours Before It's Gone!",
    "User viewed the same product 6 times in 24 hours. Cart abandonment followed. Urgency messaging will convert.",
    "Display real-time scarcity overlay on next product page visit.",
    ts(0, 3)),

  mkRecord('d008', 'USR-009', 'High Intent', 'Positive', 'price_nudge', 'overlay', 'high', 0.87, true,
    "Special Price Drop – Just for Today",
    "High intent signals: 4 product views, 2 add-to-cart events, no checkout. Price sensitivity detected.",
    "Trigger 15% discount overlay on next visit within 2 hours.",
    ts(1, 0)),

  mkRecord('d009', 'USR-007', 'High Intent', 'Positive', 'exit_overlay', 'overlay', 'high', 0.85, true,
    "Wait! Here's 10% Off Your Cart",
    "Cart value €240. Exit intent triggered. High probability of recovery with immediate incentive.",
    "Deploy exit-intent overlay with time-limited coupon (expires in 30 min).",
    ts(1, 5)),

  mkRecord('d045', 'USR-001', 'High Intent', 'Positive', 'scarcity_push', 'overlay', 'high', 0.86, false,
    "Selling Fast – Only 5 Remaining!",
    "User showed strong purchase intent with 8 product views in 1 hour.",
    "Display real-time inventory counter on cart page.",
    ts(4, 1)),

  // ── High Intent · Neutral ─────────────────────────────────────────────
  mkRecord('d010', 'USR-015', 'High Intent', 'Neutral', 'chatbot_guide', 'chatbot', 'medium', 0.78, false,
    "Let Me Help You Find the Perfect Option",
    "User navigating between 3 product categories, average session 8 min. Decision paralysis detected.",
    "Initiate chatbot product recommendation flow based on browsing history.",
    ts(2, 2)),

  mkRecord('d011', 'USR-013', 'High Intent', 'Neutral', 'trust_signals', 'overlay', 'medium', 0.76, false,
    "Trusted by 50 000+ Happy Customers",
    "New user with strong engagement but no purchase. Trust barrier is likely friction point.",
    "Display social proof overlay with reviews and security badges.",
    ts(3, 1)),

  mkRecord('d050', 'USR-007', 'High Intent', 'Neutral', 'price_nudge', 'overlay', 'high', 0.82, true,
    "Price Match Guarantee – We Beat Any Price",
    "High intent user compared prices on competitor site. Price matching will convert.",
    "Trigger price-match offer overlay with competitor comparison.",
    ts(2, 3)),

  // ── High Intent · Negative ────────────────────────────────────────────
  mkRecord('d012', 'USR-009', 'High Intent', 'Negative', 'chatbot_fix', 'chatbot', 'high', 0.84, false,
    "I'm Here to Resolve Your Issue Right Away",
    "User submitted 2 support tickets in 48 hours. High frustration score detected. Recovery chatbot flow needed.",
    "Trigger proactive chatbot with issue resolution template and escalation option.",
    ts(0, 4)),

  mkRecord('d054', 'USR-007', 'High Intent', 'Negative', 'apology_offer', 'email', 'critical', 0.88, false,
    "We Sincerely Apologise – Here's How We'll Fix It",
    "High intent customer with order fulfilment issue. Risk of viral negative review is high.",
    "Send priority apology with full refund offer and expedited replacement.",
    ts(0, 1, 20)),

  mkRecord('d058', 'USR-002', 'High Intent', 'Negative', 'chatbot_fix', 'chatbot', 'high', 0.83, true,
    "Let's Get Your Cart Back on Track",
    "Technical error caused cart loss for high-intent user. Recovery chatbot will reconvert.",
    "Deploy cart recovery chatbot with order recreation assistance.",
    ts(1, 1)),

  // ── Warm · Positive ───────────────────────────────────────────────────
  mkRecord('d013', 'USR-013', 'Warm', 'Positive', 'upsell', 'email', 'medium', 0.72, false,
    "Complete Your Look – Recommended Add-ons",
    "Warm customer with 3 recent purchases. Cross-sell opportunity score is 71%.",
    "Send curated product recommendations based on purchase history.",
    ts(2, 6)),

  mkRecord('d014', 'USR-008', 'Warm', 'Positive', 'review_ask', 'email', 'low', 0.68, true,
    "How Was Your Recent Purchase?",
    "Post-purchase window 7 days. Customer satisfaction signals positive. Ideal review request timing.",
    "Send post-purchase review request with product-specific template.",
    ts(5, 0)),

  mkRecord('d015', 'USR-001', 'Warm', 'Positive', 'referral', 'email', 'low', 0.71, false,
    "Love Our Products? Share the Love!",
    "Warm engaged user, 2nd purchase completed. High social sharing propensity based on profile.",
    "Send referral programme email with double-sided incentive.",
    ts(4, 8)),

  mkRecord('d016', 'USR-002', 'Warm', 'Positive', 'early_access', 'email', 'medium', 0.74, false,
    "Be the First to See What's New",
    "Engaged warm customer with strong newsletter open rate. Early access offer will deepen loyalty.",
    "Add to early access list and send preview campaign.",
    ts(6, 0)),

  mkRecord('d046', 'USR-015', 'Warm', 'Positive', 'upsell', 'sms', 'medium', 0.73, false,
    "Add This to Complete Your Order",
    "Post-purchase SMS opportunity. Complementary product detected with 65% affinity.",
    "Send SMS with complementary product 2 hours after order confirmation.",
    ts(5, 6)),

  mkRecord('d055', 'USR-008', 'Warm', 'Positive', 'early_access', 'email', 'medium', 0.75, false,
    "Exclusive Preview: New Season Drop",
    "Loyal warm customer with fashion category affinity. Early access deepens brand loyalty.",
    "Add to early access segment and send 48-hour exclusive preview.",
    ts(9, 5)),

  // ── Warm · Neutral ────────────────────────────────────────────────────
  mkRecord('d017', 'USR-003', 'Warm', 'Neutral', 'nurture_email', 'email', 'low', 0.63, false,
    "We Miss You – Here's What's New",
    "Moderate engagement, no recent purchase in 14 days. Nurture sequence will re-engage.",
    "Enrol in 3-email nurture sequence highlighting new arrivals and bestsellers.",
    ts(7, 0)),

  mkRecord('d018', 'USR-011', 'Warm', 'Neutral', 'survey', 'email', 'low', 0.61, true,
    "Quick Question: Help Us Improve",
    "Warm customer with stable engagement. Survey response rate for this segment is 34%.",
    "Send 3-question satisfaction survey with small reward incentive.",
    ts(8, 3)),

  mkRecord('d019', 'USR-005', 'Warm', 'Neutral', 'chatbot_guide', 'chatbot', 'medium', 0.69, false,
    "Not Sure Which to Choose? I Can Help!",
    "Browsing 5+ products in same category. Comparison fatigue detected.",
    "Trigger guided selling chatbot with comparison table feature.",
    ts(9, 0)),

  mkRecord('d020', 'USR-015', 'Warm', 'Neutral', 'price_nudge', 'overlay', 'medium', 0.67, false,
    "Today Only: Price Drop on Your Wishlist",
    "Wishlist items detected. Price-sensitive segment. Limited-time nudge will drive action.",
    "Send wishlist price drop notification with 12-hour countdown.",
    ts(3, 2)),

  mkRecord('d059', 'USR-015', 'Warm', 'Neutral', 'price_nudge', 'sms', 'medium', 0.70, false,
    "Flash Deal: 20% Off Expires Tonight",
    "Warm customer has been comparison shopping. Time-sensitive SMS offer will convert.",
    "Send SMS flash deal with deep link to cart and 8-hour countdown.",
    ts(2, 5)),

  // ── Warm · Negative ───────────────────────────────────────────────────
  mkRecord('d021', 'USR-008', 'Warm', 'Negative', 'apology_offer', 'email', 'high', 0.79, false,
    "We Apologise – Let Us Make It Right",
    "Customer reported delivery delay. Satisfaction score dropped to 2/5. Recovery needed.",
    "Send apology with 20% discount and priority shipping on next order.",
    ts(1, 8)),

  mkRecord('d022', 'USR-003', 'Warm', 'Negative', 'chatbot_fix', 'chatbot', 'high', 0.77, true,
    "Support Is Here – Let's Fix This Together",
    "User experiencing checkout errors. 3 failed payment attempts detected.",
    "Deploy checkout recovery chatbot with payment troubleshooting flow.",
    ts(2, 4)),

  mkRecord('d023', 'USR-005', 'Warm', 'Negative', 'survey', 'email', 'medium', 0.65, false,
    "Your Feedback Matters – Tell Us What Went Wrong",
    "Post-return customer. Understanding churn reasons will improve retention.",
    "Send post-return survey with empathy-first messaging.",
    ts(10, 0)),

  mkRecord('d051', 'USR-013', 'Warm', 'Negative', 'chatbot_guide', 'chatbot', 'medium', 0.70, false,
    "Having Trouble? Our Virtual Assistant Can Help",
    "User stuck on account settings page for 6 min. Frustration signals detected.",
    "Proactively launch help chatbot with account navigation assistance.",
    ts(3, 7)),

  // ── Hesitant · Positive ───────────────────────────────────────────────
  mkRecord('d024', 'USR-010', 'Hesitant', 'Positive', 'trust_signals', 'overlay', 'medium', 0.66, true,
    "Join 50 000 Satisfied Customers",
    "New visitor with 3 sessions, no purchase. Trust signals will reduce purchase anxiety.",
    "Display customer testimonials and security certification overlay.",
    ts(4, 5)),

  mkRecord('d025', 'USR-011', 'Hesitant', 'Positive', 'price_nudge', 'overlay', 'medium', 0.64, false,
    "Special First-Time Buyer Discount Inside",
    "First-time visitor showing interest but price-sensitive behaviour. Welcome offer converts at 28%.",
    "Display first-purchase discount with social proof element.",
    ts(5, 2)),

  mkRecord('d026', 'USR-013', 'Hesitant', 'Positive', 'chatbot_guide', 'chatbot', 'low', 0.60, true,
    "Let Me Guide You to the Right Choice",
    "High bounce rate on product pages. Interactive guidance will reduce friction.",
    "Launch guided shopping assistant after 2 min on product page.",
    ts(6, 3)),

  mkRecord('d027', 'USR-003', 'Hesitant', 'Positive', 'welcome_offer', 'email', 'medium', 0.68, true,
    "Welcome – Here's 15% Off Your First Order",
    "New subscriber, positive sentiment in browsing session. Welcome offer timing is optimal.",
    "Send welcome email series with progressive discount structure.",
    ts(7, 1)),

  mkRecord('d047', 'USR-003', 'Hesitant', 'Positive', 'exit_overlay', 'overlay', 'medium', 0.66, false,
    "Before You Go – 10% Off Awaits",
    "Hesitant visitor with 12-minute session, exit intent on product page.",
    "Deploy exit overlay with time-sensitive discount on browsed items.",
    ts(6, 7)),

  // ── Hesitant · Neutral ────────────────────────────────────────────────
  mkRecord('d028', 'USR-011', 'Hesitant', 'Neutral', 'nurture_email', 'email', 'low', 0.58, false,
    "Discover Products We Think You'll Love",
    "Hesitant user, 4 sessions with no conversion. Soft nurture approach to build relationship.",
    "Enrol in educational content nurture sequence.",
    ts(11, 0)),

  mkRecord('d029', 'USR-010', 'Hesitant', 'Neutral', 'welcome_offer', 'email', 'low', 0.57, false,
    "Welcome to the Family – Start Your Journey",
    "New account created 3 days ago, no purchase. Welcome incentive needed.",
    "Trigger welcome automation with product discovery quiz.",
    ts(12, 0)),

  mkRecord('d030', 'USR-005', 'Hesitant', 'Neutral', 'survey', 'email', 'low', 0.59, false,
    "Help Us Understand What You're Looking For",
    "Multiple visits with no purchase. Understanding intent will personalise future campaigns.",
    "Send intent-discovery survey with 3 quick questions.",
    ts(13, 4)),

  mkRecord('d031', 'USR-011', 'Hesitant', 'Neutral', 'trust_signals', 'overlay', 'medium', 0.62, false,
    "Safe, Secure, Guaranteed – Shop with Confidence",
    "Hesitant user abandoning checkout at payment step. Trust barrier confirmed.",
    "Display security badges and money-back guarantee overlay at checkout.",
    ts(14, 0)),

  mkRecord('d060', 'USR-001', 'Hesitant', 'Neutral', 'chatbot_guide', 'chatbot', 'low', 0.61, false,
    "Hi! I'm Here If You Need Any Help",
    "Long-session hesitant user on FAQ page. Soft chatbot introduction will build confidence.",
    "Trigger friendly chatbot greeting after 3 min on FAQ page.",
    ts(15, 0)),

  // ── Hesitant · Negative ───────────────────────────────────────────────
  mkRecord('d032', 'USR-010', 'Hesitant', 'Negative', 'chatbot_fix', 'chatbot', 'high', 0.73, false,
    "Something Went Wrong? We're Here to Help",
    "New user with negative first experience. Site error detected during onboarding.",
    "Trigger proactive recovery chatbot with guided resolution flow.",
    ts(0, 5)),

  mkRecord('d033', 'USR-011', 'Hesitant', 'Negative', 'apology_offer', 'email', 'high', 0.76, false,
    "We Noticed Something Went Wrong – Here's 20% Off",
    "Hesitant first-time visitor experienced error. High churn risk for new user segment.",
    "Send recovery email with discount and simplified re-engagement flow.",
    ts(1, 2)),

  mkRecord('d052', 'USR-013', 'Hesitant', 'Negative', 'trust_signals', 'overlay', 'medium', 0.63, false,
    "Your Privacy is 100% Protected",
    "Hesitant user abandoned at personal info form. Privacy concern signals detected.",
    "Display GDPR compliance badge and data protection overlay.",
    ts(5, 3)),

  // ── Cold · Positive ───────────────────────────────────────────────────
  mkRecord('d034', 'USR-005', 'Cold', 'Positive', 'welcome_offer', 'email', 'low', 0.55, false,
    "We'd Love to Have You Back",
    "Dormant user showing signs of re-engagement. Positive signals after 45 days inactive.",
    "Send win-back campaign with personalised product recommendations.",
    ts(15, 0)),

  mkRecord('d035', 'USR-003', 'Cold', 'Positive', 'nurture_email', 'email', 'low', 0.57, false,
    "Catch Up on What You've Missed",
    "Cold user opened last 2 emails. Gradual re-engagement sequence recommended.",
    "Enrol in 5-part re-engagement email sequence.",
    ts(16, 0)),

  mkRecord('d036', 'USR-013', 'Cold', 'Positive', 'survey', 'email', 'low', 0.56, false,
    "Quick Survey – Help Us Serve You Better",
    "Cold customer, 60+ days inactive but email-engaged. Survey will reactivate relationship.",
    "Send preference survey to understand current needs.",
    ts(17, 0)),

  mkRecord('d048', 'USR-005', 'Cold', 'Positive', 'nurture_email', 'email', 'low', 0.57, false,
    "Personalised Picks Just for You",
    "Cold user re-engaged via social channel. Personalised content will rebuild connection.",
    "Send interest-based content digest to reignite engagement.",
    ts(28, 0)),

  mkRecord('d056', 'USR-011', 'Cold', 'Positive', 'welcome_offer', 'email', 'low', 0.56, false,
    "Your Comeback Gift is Waiting",
    "Cold customer clicked win-back email but did not purchase. Follow-up needed.",
    "Send win-back sequence part 2 with stronger incentive.",
    ts(26, 0)),

  // ── Cold · Neutral ────────────────────────────────────────────────────
  mkRecord('d037', 'USR-008', 'Cold', 'Neutral', 'nurture_email', 'email', 'low', 0.55, false,
    "We're Still Here – Check Out What's New",
    "90 days inactive. Neutral sentiment on last interaction. Soft reactivation needed.",
    "Send monthly digest email with trending products and special offers.",
    ts(18, 0)),

  mkRecord('d038', 'USR-010', 'Cold', 'Neutral', 'survey', 'email', 'low', 0.54, false,
    "Tell Us What Brought You Back",
    "Cold user with recent site visit. Understanding motivation improves targeting.",
    "Trigger micro-survey popup on second page view.",
    ts(20, 0)),

  mkRecord('d039', 'USR-005', 'Cold', 'Neutral', 'welcome_offer', 'sms', 'low', 0.58, false,
    "A Special Offer Just for You – Come Back and Save",
    "Cold segment phone number available. SMS reactivation outperforms email for this cohort.",
    "Send reactivation SMS with one-click discount redemption.",
    ts(22, 0)),

  mkRecord('d040', 'USR-011', 'Cold', 'Neutral', 'referral', 'email', 'low', 0.56, false,
    "Refer a Friend and Earn While You're Away",
    "Cold but not churned. Referral programmes keep dormant users engaged.",
    "Send low-pressure referral email focused on helping friends.",
    ts(25, 0)),

  // ── Cold · Negative ───────────────────────────────────────────────────
  mkRecord('d041', 'USR-010', 'Cold', 'Negative', 'apology_offer', 'email', 'medium', 0.68, false,
    "We Know We Let You Down – Let Us Make It Up to You",
    "Customer churned after bad experience 3 months ago. Last-chance recovery campaign.",
    "Send personal apology from CEO with substantial win-back offer.",
    ts(19, 0)),

  mkRecord('d042', 'USR-013', 'Cold', 'Negative', 'survey', 'email', 'low', 0.60, false,
    "We'd Like to Understand What Went Wrong",
    "Long-inactive customer who left negative review. Feedback loop will inform product improvements.",
    "Send empathy-driven feedback request with no sales pressure.",
    ts(21, 0)),

  mkRecord('d043', 'USR-005', 'Cold', 'Negative', 'human_call', 'alert', 'medium', 0.65, false,
    "Personal Outreach – We Care About Your Experience",
    "High-LTV cold customer with documented negative experience. Human touch required.",
    "Assign to retention specialist for personal call within 48 hours.",
    ts(23, 0)),
]
