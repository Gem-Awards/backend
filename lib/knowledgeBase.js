// Knowledge base entries, sourced from gemawards.com/help, gemawards.com/membership,
// a production timeline graphic, and a bulk pricing spreadsheet (all provided
// directly, pulled/added Aug 2026).
// This does simple keyword matching for now - replace with real vector search
// once you have more content and real traffic (see spec doc).
// All entries below are verified against real content - no more placeholders.

const KB = [
  {
    title: 'Damaged, Wrong, or Unsatisfactory Order',
    content:
      "If an order arrives damaged, isn't what the customer expected, or something's wrong with it, direct them to fill out the claim form at gemawards.com/help. The form requires: first name, last name, email address, order number, a clear photo showing the issue, and a description of the problem. All shipments are insured. Claims are typically reviewed within 1 business day. If they don't have an account yet, one is created automatically when they submit the form.",
    keywords: [
      'damaged',
      'broken',
      'wrong item',
      'not what i expected',
      'replacement',
      'issue',
      'problem with my order',
      'claim',
    ],
  },
  {
    title: 'Claim Status',
    content:
      'Customers can check the status of a submitted claim by logging into their Gem Awards account and selecting "Support" from the account menu. They will also get email updates on the account\'s associated email address.',
    keywords: ['status', 'claim status', 'where is my claim', 'update on my claim'],
  },
  {
    title: 'Contact Information',
    content:
      'Gem Awards is located at 2155 W. 580 N., Cedar City, UT 84721. Phone: (435) 586-7526 or (800) 660-7638. Email: orders@gemawards.com. Business hours: Monday-Friday, 9:30am-5:00pm.',
    keywords: ['contact', 'phone number', 'address', 'hours', 'call you', 'location'],
  },
  {
    title: 'About Gem Awards',
    content:
      'Gem Awards has been in the trophy and custom award business since 1988, based in Cedar City, Utah. All engraving is done in-house using diamond, laser, and sublimation engraving techniques. They specialize in trophies, plaques, medals, name tags, and custom engraved gifts.',
    keywords: ['about', 'who are you', 'how long in business', 'engraving process'],
  },

  {
    title: 'Membership - Plans & Perks',
    content:
      'Gem Awards offers two membership plans, billed monthly with no contract. Standard Member is $9.99/month: $9.99 in store credit every month, 10% discount on every order (stackable with sale pricing), member-only specials, free shipping, and rush production. Business Member is $19.99/month: same perks, with $19.99 in monthly store credit and free standard shipping on every order. A free account is created automatically at checkout if the customer doesn\'t already have one.',
    keywords: [
      'membership',
      'member',
      'join',
      'plans',
      'standard member',
      'business member',
      'become a member',
    ],
  },
  {
    title: 'Membership - Store Credit',
    content:
      'Each billing cycle, members receive store credit equal to their monthly fee ($9.99 for Standard, $19.99 for Business), applied automatically to their account. Store credit is usable immediately as soon as it posts to the account - no waiting period. Store credit is non-refundable and cannot be exchanged for cash, but it never expires - even if the membership is canceled - and can be used toward any order.',
    keywords: [
      'store credit',
      'credit',
      'monthly credit',
      'does credit expire',
      'refund credit',
      'use credit immediately',
      'when can i use my credit',
    ],
  },
  {
    title: 'Membership - Cancellation & Management',
    content:
      'Members can cancel anytime from My Account -> Subscriptions -> Cancel, with no cancellation fees. Benefits remain active until the end of the current billing period. The same Subscriptions page is used to view billing dates, update payment methods, or change plans. If a member\'s benefits (like the 10% discount) aren\'t applying correctly, they should be directed to email support and it will be resolved within one business day.',
    keywords: [
      'cancel membership',
      'cancel subscription',
      'change plan',
      'update payment',
      'billing date',
      'benefits not working',
      'discount not applying',
    ],
  },

  {
    title: 'Order Timeline: Customization, Production, Shipping, Delivery',
    content:
      "The order process has four stages. Customization: if a customer wants to customize their order, they let Gem Awards know their preferences (size, color, style, special requests) and it's tailored to their needs. Production: typically takes 1-2 business days, though if design proofs are requested, it may take a few additional days while waiting for the customer's approval. Shipping: generally takes 3-5 business days within the continental USA; tracking information is provided once the order ships. Delivery: once received, customers are encouraged to reach out with any issues or concerns.",
    keywords: [
      'shipping',
      'ship',
      'delivery',
      'when will it arrive',
      'how long',
      'production time',
      'timeline',
      'proof',
      'when will my order ship',
      'processing time',
    ],
  },
  {
    title: 'Bulk / Volume Pricing',
    content:
      "Gem Awards offers automatic volume discounts based on quantity ordered, varying by product category (the discount % is the same for every item within a category). Discounts apply automatically at checkout once the qualifying quantity is reached - no code or request needed. Name tags, wedges, bells, plaques, EOM plaques, clocks, cast plaques, wooden name tags, plastic signs, and supplies: 10-24 units = 10% off, 25-49 = 20% off, 50-99 = 30% off, 100+ = 35% off. Business/laser name tags, challenge coins, custom medals, stock medals, column trophies, art glass trophies: 25-49 = 10% off, 50-99 = 20% off, 100-199 = 30% off, 200+ = 40% off. Pet tags: 25-49 = 10% off, 50-99 = 15% off, 100-199 = 20% off, 200+ = 25% off. Stock ribbons: 26-100 = 10% off, 101-200 = 15% off, 201-499 = 20% off, 500+ = 25% off. Cobra/Sun Ray/Broadcast/Shield awards: 13-24 = 10% off, 25-48 = 20% off, 49-85 = 30% off, 86+ = 40% off. Crystal and glass trophies: 2-5 = 10% off, 6-14 = 20% off, 15-30 = 30% off, 31+ = 40% off. Missionary plaques are sold at retail price with no volume discount at any quantity.",
    keywords: [
      'bulk',
      'volume',
      'quantity discount',
      'bulk discount',
      'bulk pricing',
      'wholesale',
      'large order',
      'discount for buying more',
      'discount',
      'trophies',
      'trophy',
      'crystal',
      'medals',
      'plaques',
      'name tags',
      'multiple',
      'how many do i need to order',
      'group order',
    ],
  },
];

function searchKnowledgeBase(query) {
  const q = query.toLowerCase();
  const scored = KB.map((entry) => {
    const score = entry.keywords.reduce(
      (acc, kw) => acc + (q.includes(kw) ? 1 : 0),
      0
    );
    return { ...entry, score };
  });

  return scored
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ title, content }) => ({ title, content }));
}

module.exports = { searchKnowledgeBase, KB };
